/** Test bcrypt legacy (Supabase) + import dump thật. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcryptjs from 'bcryptjs';

import { BCRYPT_RE, needsRehash, verifyPassword, hashPassword } from '../crypto/password';
import { toIso, rewriteStorageUrl } from '../lib/import-helpers';
import { openDb } from '../db/index';
import { runImport } from '../scripts/import-supabase';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/root/supabase-backup/data';

test('bcrypt: verify được hash $2a$/$2b$ của Supabase và báo cần rehash', async () => {
  const hash = bcryptjs.hashSync('Str0ngPass!23', 10);
  assert.match(hash, BCRYPT_RE);
  assert.equal(await verifyPassword('Str0ngPass!23', hash), true);
  assert.equal(await verifyPassword('sai-mat-khau', hash), false);
  assert.equal(needsRehash(hash), true, 'bcrypt phải bị rehash sang scrypt');

  const scryptHash = await hashPassword('Str0ngPass!23');
  assert.equal(await verifyPassword('Str0ngPass!23', scryptHash), true);
  assert.equal(needsRehash(scryptHash), false);
});

test('toIso: timestamp Postgres → ISO UTC có ms + Z; date-only giữ nguyên', () => {
  assert.equal(toIso('2026-04-23 15:15:00.572296+00'), '2026-04-23T15:15:00.572Z');
  assert.equal(toIso('2026-04-23T15:15:00+00:00'), '2026-04-23T15:15:00.000Z');
  assert.equal(toIso('2026-04-23T15:15:00.1Z'), '2026-04-23T15:15:00.100Z');
  assert.equal(toIso('1999-05-01'), '1999-05-01');
  assert.equal(toIso(null), null);
  assert.equal(toIso(''), null);
});

test('rewriteStorageUrl: supabase.co → /media/, URL ngoài giữ nguyên', () => {
  assert.equal(
    rewriteStorageUrl('https://abc.supabase.co/storage/v1/object/public/avatars/u1/a.png'),
    '/media/avatars/u1/a.png'
  );
  assert.equal(
    rewriteStorageUrl('https://images.anilist.co/x.jpg'),
    'https://images.anilist.co/x.jpg'
  );
  assert.equal(rewriteStorageUrl(null), null);
});

test('import dump thật: đủ 4/4/2/4/2/6, idempotent, không còn URL supabase', (t) => {
  if (!existsSync(join(IMPORT_DIR, 'auth_users.json'))) {
    t.skip(`không có ${IMPORT_DIR} — bỏ qua test import`);
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'tsuki-import-'));
  const db = openDb({ path: join(dir, 'app.db') });
  try {
    const first = runImport(db);
    const byTable = new Map(first.map((c) => [c.table, c]));

    assert.equal(byTable.get('users (auth_users)')?.inserted, 4);
    assert.equal(byTable.get('profiles')?.inserted, 4);
    assert.equal(byTable.get('favorites')?.inserted, 4);
    assert.equal(byTable.get('user_library')?.inserted, 2);
    assert.equal(byTable.get('comments')?.inserted, 2);
    assert.equal(byTable.get('quests')?.source, 6, 'JSON có 6 quest (seed sẵn 6 → insert 0)');

    const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    assert.equal(count('select count(*) c from users'), 4);
    assert.equal(count('select count(*) c from profiles'), 4);
    assert.equal(count('select count(*) c from comments'), 2);
    assert.equal(count('select count(*) c from quests'), 6);

    assert.ok(count("select count(*) c from profiles where avatar_url like '/media/%'") > 0);
    assert.equal(count("select count(*) c from profiles where avatar_url like '%supabase.co%'"), 0);
    assert.equal(
      (db.pragma('foreign_key_check') as unknown[]).length,
      0,
      'foreign_key_check phải rỗng'
    );

    // idempotent: chạy lần 2 không thêm row
    const second = runImport(db);
    for (const c of second) {
      if (c.table === 'quests') continue;
      assert.equal(c.inserted, 0, `lần 2: ${c.table} không được insert thêm`);
    }
    assert.equal(count('select count(*) c from profiles'), 4);

    // password bcrypt giữ nguyên sau import (rehash chỉ xảy ra khi login)
    const legacy = db
      .prepare("select password_hash, provider from users where password_hash is not null limit 1")
      .get() as { password_hash: string; provider: string };
    assert.match(legacy.password_hash, BCRYPT_RE);
    assert.equal(legacy.provider, 'email');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
