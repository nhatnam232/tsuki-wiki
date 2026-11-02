/**
 * server-v2 — SQLite connection + migration runner.
 *
 * Trách nhiệm:
 *   1. Mở (và tạo nếu chưa có) file DB tại `DB_PATH` (default `./data/tsuki.db`).
 *   2. Bật PRAGMA bắt buộc: journal_mode=WAL, foreign_keys=ON, busy_timeout, synchronous=NORMAL.
 *   3. Chạy migration idempotent: bảng `_migrations` ghi (id, checksum, applied_at).
 *      - Chưa có  → chạy SQL trong transaction rồi ghi nhận.
 *      - Đã có    → bỏ qua; nếu checksum khác → throw (phát hiện file bị sửa sau khi apply).
 *
 * Không có Supabase, không có Postgres: mọi thứ là SQLite cục bộ.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export type Db = Database.Database;

// Đổi từ './data/tsuki.db' → './data/app.db' để khớp tài liệu/verify của
// docs/migration/PHASES.md + task-6/8/10. `DB_PATH` vẫn override được.
export const DEFAULT_DB_PATH = './data/app.db';
export const MIGRATIONS_TABLE = '_migrations';

/** Một migration = 1 file .sql trên đĩa. `id` là khoá trong `_migrations`. */
export interface Migration {
  id: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface OpenDbOptions {
  /** Đường dẫn file DB. Mặc định `process.env.DB_PATH` hoặc `./data/tsuki.db`. */
  path?: string;
  /** false → không tự chạy migration (dùng khi test muốn tự điều khiển). */
  migrate?: boolean;
}

/** `__dirname` chỉ tồn tại ở CJS (dist/server.cjs); ở ESM (tsx dev) thì không. */
function moduleDir(): string | null {
  try {
    if (typeof __dirname === 'string' && __dirname.length > 0) return __dirname;
  } catch {
    /* ReferenceError ở môi trường ESM thuần — bỏ qua */
  }
  return null;
}

/**
 * Tìm `schema.sql`. Thứ tự:
 *   1. `SCHEMA_PATH` (env, tuyệt đối hoặc tương đối với cwd)
 *   2. `<cwd>/db/schema.sql`                  ← `npm run dev|test` trong server-v2/
 *   3. `<moduleDir>/schema.sql`               ← khi file này nằm cạnh schema
 *   4. `<moduleDir>/../db/schema.sql`         ← khi chạy `dist/server.cjs`
 */
export function findSchemaFile(): string {
  const tried: string[] = [];
  const candidates: string[] = [];

  const fromEnv = process.env.SCHEMA_PATH;
  if (fromEnv) candidates.push(isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv));

  candidates.push(join(process.cwd(), 'db', 'schema.sql'));

  const dir = moduleDir();
  if (dir) {
    candidates.push(join(dir, 'schema.sql'));
    candidates.push(join(dir, '..', 'db', 'schema.sql'));
  }

  for (const candidate of candidates) {
    const abs = resolve(candidate);
    tried.push(abs);
    if (existsSync(abs)) return abs;
  }

  throw new Error(`Không tìm thấy db/schema.sql. Đã thử:\n  - ${tried.join('\n  - ')}`);
}

export function readSchema(): string {
  return readFileSync(findSchemaFile(), 'utf8');
}

/** Migration gốc. Slice 1 chỉ có schema.sql; file mới thêm vào đây khi cần. */
export function loadMigrations(): Migration[] {
  const migrations: Migration[] = [{ id: '001_schema.sql', sql: readSchema() }];

  const dir = findMigrationsDir();
  if (dir) {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      migrations.push({ id: file, sql: readFileSync(join(dir, file), 'utf8') });
    }
  }

  return migrations;
}

/** Tìm thư mục `db/migrations` (cùng logic fallback với schema.sql). */
export function findMigrationsDir(): string | null {
  const candidates: string[] = [join(process.cwd(), 'db', 'migrations')];
  const dir = moduleDir();
  if (dir) {
    candidates.push(join(dir, 'migrations'));
    candidates.push(join(dir, '..', 'db', 'migrations'));
  }
  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Checksum trên phần NGỮ NGHĨA của migration: bỏ comment `--...` và gộp
 * khoảng trắng. Nhờ vậy sửa comment/sửa format không làm DB cũ throw (001 vẫn
 * "frozen" về mặt DDL), nhưng đổi DDL thật thì vẫn bị drift guard chặn.
 */
function checksum(sql: string): string {
  const normalized = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function ensureMigrationsTable(db: Db): void {
  db.exec(`
    create table if not exists ${MIGRATIONS_TABLE} (
      id         text primary key,
      checksum   text not null,
      applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

export interface MigrateOptions {
  migrations?: Migration[];
  /** true → log ra stderr mỗi migration được apply. */
  verbose?: boolean;
}

/**
 * Chạy migration theo thứ tự, idempotent (chạy 2 lần liên tiếp lần 2 = no-op).
 * Mỗi migration nằm trong 1 transaction: DDL + ghi `_migrations` cùng commit.
 */
export function migrate(db: Db, options: MigrateOptions = {}): MigrationResult {
  const migrations = options.migrations ?? loadMigrations();
  ensureMigrationsTable(db);

  const selectApplied = db.prepare(`select checksum from ${MIGRATIONS_TABLE} where id = ?`);
  const insertApplied = db.prepare(
    `insert into ${MIGRATIONS_TABLE} (id, checksum) values (?, ?)`
  );

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const sum = checksum(migration.sql);
    const row = selectApplied.get(migration.id) as { checksum: string } | undefined;

    if (row) {
      if (row.checksum !== sum) {
        throw new Error(
          `Migration "${migration.id}" đã apply nhưng nội dung file đã đổi ` +
            `(checksum ${row.checksum.slice(0, 12)}… → ${sum.slice(0, 12)}…). ` +
            `Tạo migration mới thay vì sửa file cũ.`
        );
      }
      skipped.push(migration.id);
      continue;
    }

    // Migration có thể yêu cầu tắt FK trong lúc rebuild bảng (quy trình 12-bước
    // của SQLite). Directive: `-- @pragma foreign_keys=off` ở đầu file.
    const requiresFkOff = /@pragma\s+foreign_keys\s*=\s*off/i.test(migration.sql);
    if (requiresFkOff) db.pragma('foreign_keys = OFF');

    try {
      const run = db.transaction(() => {
        db.exec(migration.sql);
        if (requiresFkOff) {
          const violations = db.pragma('foreign_key_check') as unknown[];
          if (violations.length > 0) {
            throw new Error(
              `Migration "${migration.id}" để lại ${violations.length} vi phạm foreign key — rollback.`
            );
          }
        }
        insertApplied.run(migration.id, sum);
      });
      run();
    } finally {
      if (requiresFkOff) db.pragma('foreign_keys = ON');
    }

    applied.push(migration.id);
    if (options.verbose) process.stderr.write(`[db] applied migration ${migration.id}\n`);
  }

  return { applied, skipped };
}

/**
 * Mở DB và (mặc định) chạy migration.
 * PRAGMA phải set ngoài transaction → đặt ngay sau khi mở connection.
 */
export function openDb(options: OpenDbOptions = {}): Db {
  const dbPath = options.path ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;

  if (dbPath !== ':memory:') {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL: nhiều reader + 1 writer. Trả về 'memory' với DB in-memory nên không assert ở đây.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  if (options.migrate !== false) migrate(db);

  return db;
}

export function isWalEnabled(db: Db): boolean {
  const mode = db.pragma('journal_mode', { simple: true });
  return typeof mode === 'string' && mode.toLowerCase() === 'wal';
}

export function isForeignKeysEnabled(db: Db): boolean {
  return db.pragma('foreign_keys', { simple: true }) === 1;
}

/** Kiểm tra connection còn dùng được — dùng cho /api/health. */
export function ping(db: Db): boolean {
  const row = db.prepare('select 1 as ok').get() as { ok: number } | undefined;
  return row?.ok === 1;
}

let singleton: Db | null = null;

/** Connection dùng chung cho Express (1 process = 1 connection, cực nhanh & an toàn). */
export function getDb(): Db {
  if (!singleton) singleton = openDb({ migrate: true });
  return singleton;
}

export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}

/** Đường dẫn DB thực tế đang dùng (đã resolve) — cho log/health. */
export function currentDbPath(): string {
  const p = process.env.DB_PATH ?? DEFAULT_DB_PATH;
  return p === ':memory:' ? p : resolve(p);
}
