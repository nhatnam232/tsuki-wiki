/**
 * server-v2 — test khung cho DB layer (node:test + tsx).
 *
 * Phạm vi slice 1:
 *   1. mở DB tạm → migration chạy 1 lần
 *   2. chạy migration LẦN 2 → idempotent (no-op, không lỗi)
 *   3. insert/select round-trip trên bảng `favorites` (+ view `anime_like_counts`)
 *   4. WAL đang bật, foreign_keys đang bật, FK thực sự chặn dữ liệu rác
 *
 * Chạy: npm test   (= tsx --test test/*.test.ts)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MIGRATIONS_TABLE,
  isForeignKeysEnabled,
  loadMigrations,
  isWalEnabled,
  migrate,
  openDb,
  ping,
  type Db,
} from '../db/index';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 24 bảng nghiệp vụ port từ supabase/setup_all.sql. */
const BUSINESS_TABLES = [
  'profiles',
  'favorites',
  'comments',
  'anime_seasons',
  'anime_recommendations',
  'user_library',
  'anime_schedule',
  'anime_reactions',
  'anime_reviews',
  'mal_sync_jobs',
  'translation_cache',
  'comment_votes',
  'notifications',
  'collections',
  'collection_items',
  'collection_likes',
  'audit_logs',
  'anime_edit_suggestions',
  'compare_history',
  'quests',
  'user_quest_progress',
  'activity_feed',
  'admin_passwords',
  'system_secrets',
] as const;

const EXPECTED_VIEWS = [
  'activity_feed_enriched',
  'anime_like_counts',
  'anime_reaction_counts',
  'comment_vote_counts',
  'user_library_stats',
] as const;

function tempDbPath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-sv2-test-'));
  return { dir, file: join(dir, 'tsuki.db') };
}

function tableNames(db: Db): string[] {
  return (
    db
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

test('openDb: WAL + foreign_keys + busy_timeout đang bật', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(isWalEnabled(db), true, 'journal_mode phải là wal');
  assert.equal(isForeignKeysEnabled(db), true, 'foreign_keys phải là ON');
  assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
  assert.equal(ping(db), true, 'select 1 phải chạy được');

  // File DB thật sự được tạo trên đĩa (không phải :memory:).
  assert.equal(existsSync(file), true);
});

test('migrate: chạy 2 lần là idempotent, không nhân đôi bảng', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Lần 1 đã được openDb() chạy. Ghi nhận trạng thái.
  const appliedRows = db.prepare(`select id from ${MIGRATIONS_TABLE} order by id`).all() as {
    id: string;
  }[];
  const expectedIds = loadMigrations().map((m) => m.id);
  assert.deepEqual(
    appliedRows.map((r) => r.id),
    expectedIds,
    '_migrations phải ghi nhận đúng toàn bộ migration hiện có'
  );
  assert.ok(expectedIds.includes('001_schema.sql'), 'phải có 001_schema.sql');
  assert.ok(expectedIds.includes('002_auth.sql'), 'phải có 002_auth.sql (auth columns)');

  const tablesBefore = tableNames(db);
  const viewsBefore = (
    db.prepare("select name from sqlite_master where type = 'view'").all() as { name: string }[]
  ).length;

  // Lần 2: phải skip, không apply lại.
  const second = migrate(db);
  assert.deepEqual(second.applied, [], 'lần 2 không được apply lại migration');
  assert.deepEqual(second.skipped, expectedIds, 'lần 2 phải skip toàn bộ migration đã apply');

  const tablesAfter = tableNames(db);
  const viewsAfter = (
    db.prepare("select name from sqlite_master where type = 'view'").all() as { name: string }[]
  ).length;

  assert.deepEqual(tablesAfter, tablesBefore, 'chạy lại không được tạo thêm bảng');
  assert.equal(viewsAfter, viewsBefore, 'chạy lại không được tạo thêm view');
});

test('schema: đủ 24 bảng nghiệp vụ + 2 bảng auth + _migrations + 5 view', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tables = tableNames(db);

  for (const name of BUSINESS_TABLES) {
    assert.ok(tables.includes(name), `thiếu bảng nghiệp vụ: ${name}`);
  }
  assert.equal(BUSINESS_TABLES.length, 24, 'danh sách kỳ vọng phải là 24 bảng');

  // 2 bảng auth tự thêm cho v2 (thay auth.users của Supabase).
  assert.ok(tables.includes('users'), 'thiếu bảng users');
  assert.ok(tables.includes('sessions'), 'thiếu bảng sessions');
  assert.ok(tables.includes(MIGRATIONS_TABLE), 'thiếu bảng _migrations');

  assert.equal(tables.length, 27, `tổng số bảng phải là 27, thực tế ${tables.length}: ${tables.join(',')}`);

  const views = (
    db.prepare("select name from sqlite_master where type = 'view' order by name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  assert.deepEqual(views, [...EXPECTED_VIEWS], 'phải có đúng 5 view như Supabase');

  // Index: phải port đủ (Supabase có 40+ index, kể cả partial index).
  const indexCount = (
    db
      .prepare(
        "select count(*) as c from sqlite_master where type = 'index' and name not like 'sqlite_%'"
      )
      .get() as { c: number }
  ).c;
  assert.ok(indexCount >= 40, `kỳ vọng >= 40 index, thực tế ${indexCount}`);

  // Seed 6 quest mặc định.
  const questCount = (db.prepare('select count(*) as c from quests').get() as { c: number }).c;
  assert.equal(questCount, 6, 'phải seed đủ 6 quest');
});

test('insert/select: users → profiles → favorites, đọc lại qua view anime_like_counts', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const userId = 'u-test-1';
  db.prepare('insert into users (id, email, name) values (?, ?, ?)').run(
    userId,
    'tester@example.com',
    'Tester'
  );
  db.prepare('insert into profiles (id, username, display_name) values (?, ?, ?)').run(
    userId,
    'tester',
    'Tester'
  );

  const insertFav = db.prepare(
    'insert into favorites (user_id, anime_id, anime_title) values (?, ?, ?)'
  );
  const favId = insertFav.run(userId, 21, 'One Piece').lastInsertRowid;

  // unique(user_id, anime_id) → insert trùng phải throw.
  assert.throws(
    () => insertFav.run(userId, 21, 'One Piece'),
    /UNIQUE constraint failed/,
    'unique(user_id, anime_id) phải chặn bản ghi trùng'
  );

  const row = db
    .prepare('select id, user_id, anime_id, anime_title, created_at from favorites where anime_id = ?')
    .get(21) as {
    id: string;
    user_id: string;
    anime_id: number;
    anime_title: string;
    created_at: string;
  };

  assert.equal(row.user_id, userId);
  assert.equal(row.anime_id, 21);
  assert.equal(row.anime_title, 'One Piece');
  assert.match(row.id, UUID_RE, 'default id phải là uuid v4-like');
  assert.match(row.created_at, ISO_RE, 'created_at phải là ISO-8601 UTC');
  assert.ok(favId);

  // View port từ Postgres phải trả đúng số like.
  const likeCount = db
    .prepare('select anime_id, like_count from anime_like_counts where anime_id = ?')
    .get(21) as { anime_id: number; like_count: number };
  assert.deepEqual(likeCount, { anime_id: 21, like_count: 1 });
});

test('constraints: FK chặn user không tồn tại, CHECK chặn enum sai', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  assert.throws(
    () =>
      db
        .prepare('insert into favorites (user_id, anime_id) values (?, ?)')
        .run('khong-ton-tai', 1),
    /FOREIGN KEY constraint failed/,
    'foreign_keys=ON phải chặn favorite của user không tồn tại'
  );

  db.prepare('insert into users (id, email) values (?, ?)').run('u-2', 'u2@example.com');

  // enum watch_status → CHECK
  assert.throws(
    () =>
      db
        .prepare('insert into user_library (user_id, anime_id, anime_title, status) values (?,?,?,?)')
        .run('u-2', 5, 'Naruto', 'dang_xem_sai'),
    /CHECK constraint failed/,
    'CHECK enum watch_status phải chặn giá trị lạ'
  );

  // Giá trị hợp lệ phải insert được.
  db.prepare('insert into user_library (user_id, anime_id, anime_title, status) values (?,?,?,?)').run(
    'u-2',
    5,
    'Naruto',
    'watching'
  );
  const stats = db
    .prepare('select total_anime, watching_count from user_library_stats where user_id = ?')
    .get('u-2') as { total_anime: number; watching_count: number };
  assert.deepEqual(stats, { total_anime: 1, watching_count: 1 });

  // jsonb → TEXT + json_valid
  // (phải có row profiles thì UPDATE mới chạy CHECK)
  db.prepare('insert into profiles (id, username) values (?, ?)').run('u-2', 'u2');
  assert.throws(
    () => db.prepare('update profiles set badges = ? where id = ?').run('khong-phai-json', 'u-2'),
    /CHECK constraint failed/,
    'cột jsonb-map (badges) phải chặn JSON không hợp lệ'
  );
});

test('migrate: phát hiện drift khi file migration bị sửa sau khi apply', (t) => {
  const { dir, file } = tempDbPath();
  const db = openDb({ path: file });
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const first = migrate(db, { migrations: [{ id: 'zz_test.sql', sql: 'create table zz_a (i integer);' }] });
  assert.deepEqual(first.applied, ['zz_test.sql']);

  // Cùng id, nội dung khác → phải throw (không được im lặng chạy lại).
  assert.throws(
    () =>
      migrate(db, {
        migrations: [{ id: 'zz_test.sql', sql: 'create table zz_a (i integer, j integer);' }],
      }),
    /đã apply nhưng nội dung file đã đổi/,
    'checksum drift phải bị phát hiện'
  );

  // Cùng id, cùng nội dung → skip, không lỗi.
  const again = migrate(db, {
    migrations: [{ id: 'zz_test.sql', sql: 'create table zz_a (i integer);' }],
  });
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.skipped, ['zz_test.sql']);
});
