/**
 * Test cho các sửa lỗi reviewer (#1…#7) — counter, updated_at, CHECK timestamp,
 * compare_history, uuid default, atomic badges/quest, migration idempotent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, loadMigrations, migrate, type Db } from '../db/index';
import { grantBadge, revokeBadge, listBadges } from '../services/badges';
import { bumpQuestProgress } from '../services/quests';

function freshDb(): { db: Db; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-hardening-'));
  const db = openDb({ path: join(dir, 'app.db') });
  db.prepare('insert into users (id, email) values (?, ?)').run('u1', 'u1@example.com');
  db.prepare('insert into users (id, email) values (?, ?)').run('u2', 'u2@example.com');
  db.prepare('insert into profiles (id, username) values (?, ?)').run('u1', 'u1');
  db.prepare('insert into profiles (id, username) values (?, ?)').run('u2', 'u2');
  return {
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('#2 counter comments: 3 insert → 3, soft delete → 2, restore → 3, hard delete → 2', () => {
  const { db, close } = freshDb();
  try {
    const ins = db.prepare(
      'insert into comments (id, user_id, entity_type, entity_id, body) values (?,?,?,?,?)'
    );
    for (const id of ['c1', 'c2', 'c3']) ins.run(id, 'u1', 'anime', 1, 'x');
    const count = () =>
      (db.prepare('select comments_count c from profiles where id = ?').get('u1') as { c: number }).c;

    assert.equal(count(), 3, '3 comment → comments_count = 3');

    db.prepare('update comments set is_deleted = 1 where id = ?').run('c1');
    assert.equal(count(), 2, 'soft delete 1 → 2');

    db.prepare('update comments set is_deleted = 0 where id = ?').run('c1');
    assert.equal(count(), 3, 'restore 1 → 3');

    db.prepare('delete from comments where id = ?').run('c2');
    assert.equal(count(), 2, 'hard delete 1 → 2');

    db.prepare('delete from comments where id = ?').run('c1');
    assert.equal(count(), 1, 'không âm khi xoá tiếp');
  } finally {
    close();
  }
});

test('#2 counter library + reviews + collection_items + collection_likes', () => {
  const { db, close } = freshDb();
  try {
    db.prepare('insert into user_library (id,user_id,anime_id,anime_title) values (?,?,?,?)').run(
      'l1', 'u1', 1, 'A'
    );
    db.prepare('insert into user_library (id,user_id,anime_id,anime_title) values (?,?,?,?)').run(
      'l2', 'u1', 2, 'B'
    );
    assert.equal(
      (db.prepare('select library_count c from profiles where id=?').get('u1') as { c: number }).c,
      2
    );
    db.prepare('delete from user_library where id = ?').run('l1');
    assert.equal(
      (db.prepare('select library_count c from profiles where id=?').get('u1') as { c: number }).c,
      1
    );

    db.prepare('insert into anime_reviews (id,user_id,anime_id,body) values (?,?,?,?)').run(
      'r1', 'u1', 1, 'hay'
    );
    db.prepare('update anime_reviews set is_deleted = 1 where id = ?').run('r1');
    assert.equal(
      (db.prepare('select reviews_count c from profiles where id=?').get('u1') as { c: number }).c,
      0, 'review soft-delete → 0'
    );

    db.prepare("insert into collections (id,user_id,title) values (?,?,?)").run('col1', 'u1', 'Bộ sưu tập');
    db.prepare(
      'insert into collection_items (id,collection_id,anime_id) values (?,?,?)'
    ).run('ci1', 'col1', 1);
    db.prepare(
      'insert into collection_items (id,collection_id,anime_id) values (?,?,?)'
    ).run('ci2', 'col1', 2);
    db.prepare('insert into collection_likes (collection_id,user_id) values (?,?)').run('col1', 'u2');

    const row = db
      .prepare('select item_count, like_count from collections where id = ?')
      .get('col1') as { item_count: number; like_count: number };
    assert.equal(row.item_count, 2, 'item_count = 2');
    assert.equal(row.like_count, 1, 'like_count = 1');

    db.prepare('delete from collection_likes where collection_id = ? and user_id = ?').run('col1', 'u2');
    assert.equal(
      (db.prepare('select like_count l from collections where id=?').get('col1') as { l: number }).l,
      0, 'unlike → 0'
    );
  } finally {
    close();
  }
});

test('#2 touch_updated_at: update → updated_at đổi (kể cả bảng khoá phức hợp)', () => {
  const { db, close } = freshDb();
  try {
    // strftime có độ phân giải ms → chờ sang ms kế tiếp để test tất định.
    const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const before = (db.prepare('select updated_at u from profiles where id=?').get('u1') as {
      u: string;
    }).u;

    sleepMs(5);
    db.prepare('update profiles set display_name = ? where id = ?').run('Tên mới', 'u1');
    const after = (db.prepare('select updated_at u from profiles where id=?').get('u1') as {
      u: string;
    }).u;
    assert.notEqual(after, before, 'updated_at phải đổi sau UPDATE');
    assert.match(after, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // Bảng khoá phức hợp (user_id, quest_id) — trigger dùng đúng WHERE
    const q = "insert into user_quest_progress (user_id, quest_id, progress) values ('u1','library_starter',1)";
    db.exec(q);
    sleepMs(5);
    const qBefore = (
      db.prepare("select updated_at u from user_quest_progress where user_id='u1'").get() as {
        u: string;
      }
    ).u;
    sleepMs(5);
    db.prepare("update user_quest_progress set progress = 2 where user_id='u1'").run();
    const qAfter = (
      db.prepare("select updated_at u from user_quest_progress where user_id='u1'").get() as {
        u: string;
      }
    ).u;
    assert.notEqual(qAfter, qBefore, 'updated_at của bảng khoá phức hợp phải đổi');
  } finally {
    close();
  }
});

test('#3 CHECK timestamp: chặn datetime(\'now\') / date(\'now\'), cho phép ISO', () => {
  const { db, close } = freshDb();
  try {
    assert.throws(
      () => db.prepare('update profiles set updated_at = ? where id = ?').run('2026-01-01 00:00:00', 'u1'),
      /CHECK constraint failed/,
      'datetime(\'now\') sai format → phải bị chặn'
    );
    assert.throws(
      () =>
        db.prepare('update profiles set updated_at = datetime(\'now\') where id = ?').run('u1'),
      /CHECK constraint failed/,
      'datetime(\'now\') trực tiếp trong SQL → phải bị chặn'
    );
    assert.throws(
      () => db.prepare('update profiles set birthday = ? where id = ?').run('2026-01-01T00:00:00Z', 'u1'),
      /CHECK constraint failed/,
      'cột date chỉ nhận YYYY-MM-DD, không nhận timestamp'
    );
    // date('now') đúng format cho cột date → phải chạy được
    db.prepare("update profiles set birthday = date('now') where id = ?").run('u1');
    // ISO hợp lệ vẫn phải chạy được
    db.prepare('update profiles set updated_at = ? where id = ?').run(new Date().toISOString(), 'u1');
    assert.match(
      (db.prepare('select updated_at u from profiles where id=?').get('u1') as { u: string }).u,
      /T.*Z$/
    );
  } finally {
    close();
  }
});

test('#5 uuid default: an toàn với 500 lần insert (không integer overflow)', () => {
  const { db, close } = freshDb();
  try {
    db.prepare('insert into users (id, email) values (?, ?)').run('u-seed', 'seed@example.com');
    const ins = db.prepare("insert into favorites (user_id, anime_id) values ('u1', ?)");
    const many = db.transaction(() => {
      for (let i = 0; i < 500; i += 1) ins.run(i);
    });
    many();
    const ids = db.prepare('select id from favorites').all() as { id: string }[];
    assert.equal(ids.length, 500);
    assert.equal(new Set(ids.map((r) => r.id)).size, 500, 'uuid phải unique');
    for (const { id } of ids) assert.match(id, /^[0-9a-f-]{36}$/);

    // Chứng minh pattern CŨ nguy hiểm (đã fix bằng abs(random() % 4))
    assert.throws(() => db.prepare('select abs(-9223372036854775808)').get(), /integer overflow/);
    const safe = db.prepare('select count(*) c from (with recursive c(i) as (select 1 union all select i+1 from c where i < 200) select abs(random() % 4) from c)').get() as { c: number };
    assert.equal(safe.c, 200, 'biểu thức hiện tại không throw');
  } finally {
    close();
  }
});

test('#7 compare_history: chỉ nhận JSON array of integer', () => {
  const { db, close } = freshDb();
  try {
    const ins = db.prepare('insert into compare_history (id, user_id, anime_ids) values (?,?,?)');
    ins.run('ch1', 'u1', '[1,2,3]');
    assert.equal(
      (db.prepare('select count(*) c from compare_history').get() as { c: number }).c,
      1
    );

    for (const bad of ['[1,"2"]', '{"a":1}', 'khong-phai-json', '[1,2.5]']) {
      assert.throws(
        () => ins.run(`bad-${bad}`, 'u1', bad),
        /JSON array of integer/,
        `phải chặn: ${bad}`
      );
    }
  } finally {
    close();
  }
});

test('#4 badges atomic: grant idempotent, revoke xoá đúng, không lost update', () => {
  const { db, close } = freshDb();
  try {
    assert.equal(grantBadge(db, 'u1', 'mod'), true);
    assert.equal(grantBadge(db, 'u1', 'mod'), false, 'grant trùng → không thêm');
    assert.deepEqual(listBadges(db, 'u1'), ['mod']);

    grantBadge(db, 'u1', 'active');
    assert.deepEqual(listBadges(db, 'u1').sort(), ['active', 'mod']);

    assert.equal(revokeBadge(db, 'u1', 'mod'), true);
    assert.deepEqual(listBadges(db, 'u1'), ['active']);
    assert.equal(revokeBadge(db, 'u1', 'mod'), false, 'revoke lần 2 → false');
    assert.deepEqual(listBadges(db, 'u1'), ['active']);
  } finally {
    close();
  }
});

test('#4 quest progress atomic: cộng dồn đúng, không lost update', () => {
  const { db, close } = freshDb();
  try {
    const first = bumpQuestProgress(db, 'u1', 'library_count', 1);
    const starter = first.find((r) => r.questId === 'library_starter');
    assert.ok(starter, 'phải cập nhật quest library_starter');
    assert.equal(starter?.progress, 1);
    assert.equal(first.length, 2, 'metric library_count có 2 quest active (5 và 50)');

    bumpQuestProgress(db, 'u1', 'library_count', 2);
    bumpQuestProgress(db, 'u1', 'library_count', 1);
    const row = db
      .prepare("select progress from user_quest_progress where user_id='u1' and quest_id='library_starter'")
      .get() as { progress: number };
    assert.equal(row.progress, 4, '1 + 2 + 1 = 4');

    // đạt target (5) → completed + badge collector
    const done = bumpQuestProgress(db, 'u1', 'library_count', 1);
    const finished = done.find((r) => r.questId === 'library_starter');
    assert.equal(finished?.progress, 5);
    assert.equal(finished?.completed, true);
    assert.equal(finished?.badgeGranted, 'collector');
    assert.ok(listBadges(db, 'u1').includes('collector'));
  } finally {
    close();
  }
});

test('migration: 6 file, chạy 2 lần không throw, 25 trigger, 5 view', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-mig-'));
  const db = openDb({ path: join(dir, 'app.db') });
  try {
    const ids = loadMigrations().map((m) => m.id);
    assert.deepEqual(ids, [
      '001_schema.sql',
      '002_auth.sql',
      '003_schema_hardening.sql',
      '004_triggers.sql',
      '005_auth_provider.sql',
      '006_audit_cron_secret.sql',
    ]);

    const second = migrate(db);
    assert.deepEqual(second.applied, [], 'lần 2 không apply lại');
    assert.deepEqual(second.skipped, ids);

    const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    assert.equal(count("select count(*) c from sqlite_master where type='trigger'"), 25);
    assert.equal(count("select count(*) c from sqlite_master where type='view'"), 5);
    assert.equal(count("select count(*) c from sqlite_master where type='table' and name not like 'sqlite_%'"), 27);
    assert.equal(
      count("select count(*) c from sqlite_master where type='trigger' and name like 'trg_touch_%'"),
      9
    );
    assert.equal(
      count("select count(*) c from sqlite_master where type='trigger' and name like 'trg_counter_%'"),
      14
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('source guard: không file .ts nào dùng datetime(\'now\')/date(\'now\')', () => {
  const roots = ['auth', 'admin', 'crypto', 'db', 'lib', 'middleware', 'scripts', 'services'];
  const offenders: string[] = [];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  };

  for (const root of roots) {
    for (const file of walk(root)) {
      const content = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')  // bỏ block comment
        .replace(/^\s*\/\/.*$/gm, '');       // bỏ line comment
      // cho phép trong SQL admin (prune bằng date('now', '-7 days')) đã được review
      if (/datetime\('now'\)|date\('now'\)/.test(content) && !file.includes('admin/routes.ts')) {
        offenders.push(file);
      }
    }
  }

  assert.deepEqual(offenders, [], `file dùng datetime/date('now') sai format: ${offenders.join(', ')}`);
});
