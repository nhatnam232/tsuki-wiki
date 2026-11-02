/**
 * Import dump Supabase → SQLite (1 transaction, idempotent).
 *
 *   IMPORT_DIR=/root/supabase-backup/data DB_PATH=./data/app.db npx tsx scripts/import-supabase.ts
 *
 * - Giữ nguyên UUID của users/profiles/favorites/comments/user_library/quests.
 * - Timestamp Postgres `2026-04-23 15:15:00.572296+00` → `2026-04-23T15:15:00.572Z`.
 * - URL storage Supabase → `/media/<bucket>/<key>`; URL ngoài (googleusercontent/
 *   anilist/spotify) giữ nguyên.
 * - `insert ... on conflict do nothing` → chạy lại không nhân đôi.
 * - Không in nội dung user (email/bio...) ra stdout, chỉ in số đếm.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, type Db } from '../db/index';
import { toIso, rewriteStorageUrl } from '../lib/import-helpers';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/root/supabase-backup/data';

interface JsonRow { [k: string]: unknown }
type JsonTable = JsonRow[];

function readTable(name: string): JsonTable {
  const file = join(IMPORT_DIR, `${name}.json`);
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(parsed)) return parsed as JsonTable;
  const wrapped = parsed as { data?: unknown };
  return Array.isArray(wrapped.data) ? (wrapped.data as JsonTable) : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

interface Counter { table: string; source: number; inserted: number; skipped: number }
const counters: Counter[] = [];
function countersSnapshot(): Counter[] { return [...counters]; }

function record(table: string, source: number, inserted: number): void {
  counters.push({ table, source, inserted, skipped: source - inserted });
}

function providerOf(row: JsonRow): string {
  const meta = row.raw_app_meta_data;
  if (meta && typeof meta === 'object') {
    const provider = (meta as { provider?: unknown }).provider;
    if (typeof provider === 'string' && provider.length > 0) return provider;
  }
  return asString(row.encrypted_password) ? 'email' : 'google';
}

export function runImport(db: Db): Counter[] {
  const authUsers = readTable('auth_users');
  const profiles = readTable('profiles');
  const favorites = readTable('favorites');
  const userLibrary = readTable('user_library');
  const comments = readTable('comments');
  const quests = readTable('quests');

  const insertUser = db.prepare(
    `insert into users (id, email, provider, password_hash, email_verified, created_at, last_login_at)
     values (?, ?, ?, ?, 1, ?, ?) on conflict(id) do nothing`
  );
  const insertProfile = db.prepare(
    `insert into profiles (id, username, display_name, avatar_url, cover_url, bio, gender, birthday,
                           spotify_url, badges, comments_count, library_count, reviews_count,
                           created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing`
  );
  const insertFavorite = db.prepare(
    `insert into favorites (id, user_id, anime_id, anime_title, anime_cover, created_at)
     values (?, ?, ?, ?, ?, ?) on conflict do nothing`
  );
  const insertLibrary = db.prepare(
    `insert into user_library (id, user_id, anime_id, anime_title, anime_cover, anime_episodes,
                               status, current_episode, score, notes, started_at, completed_at,
                               created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict do nothing`
  );
  const insertComment = db.prepare(
    `insert into comments (id, user_id, entity_type, entity_id, parent_id, body, image_url,
                           is_deleted, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing`
  );
  const insertQuest = db.prepare(
    `insert into quests (id, title, description, badge_reward, target_value, metric, category,
                         starts_at, ends_at, is_active, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do nothing`
  );

  const run = db.transaction((): Counter[] => {
    counters.length = 0;
    let inserted = 0;
    for (const row of authUsers) {
      const res = insertUser.run(
        row.id, String(row.email ?? '').toLowerCase(), providerOf(row),
        asString(row.encrypted_password), toIso(row.created_at) ?? new Date().toISOString(),
        toIso(row.last_sign_in_at)
      );
      inserted += res.changes;
    }
    record('users (auth_users)', authUsers.length, inserted);

    inserted = 0;
    for (const row of profiles) {
      const badges = Array.isArray(row.badges) ? JSON.stringify(row.badges) : '[]';
      const res = insertProfile.run(
        row.id, asString(row.username), asString(row.display_name),
        rewriteStorageUrl(asString(row.avatar_url)), rewriteStorageUrl(asString(row.cover_url)),
        asString(row.bio), asString(row.gender), asString(row.birthday),
        rewriteStorageUrl(asString(row.spotify_url)), badges,
        asInt(row.comments_count), asInt(row.library_count), asInt(row.reviews_count),
        toIso(row.created_at) ?? new Date().toISOString(),
        toIso(row.updated_at) ?? toIso(row.created_at) ?? new Date().toISOString()
      );
      inserted += res.changes;
    }
    record('profiles', profiles.length, inserted);

    inserted = 0;
    for (const row of favorites) {
      inserted += insertFavorite.run(
        row.id, row.user_id, asInt(row.anime_id), asString(row.anime_title),
        rewriteStorageUrl(asString(row.anime_cover)), toIso(row.created_at) ?? new Date().toISOString()
      ).changes;
    }
    record('favorites', favorites.length, inserted);

    inserted = 0;
    for (const row of userLibrary) {
      inserted += insertLibrary.run(
        row.id, row.user_id, asInt(row.anime_id), String(row.anime_title ?? ''),
        rewriteStorageUrl(asString(row.anime_cover)),
        row.anime_episodes === null || row.anime_episodes === undefined ? null : asInt(row.anime_episodes),
        String(row.status ?? 'plan_to_watch'), asInt(row.current_episode),
        row.score === null || row.score === undefined ? null : asInt(row.score),
        asString(row.notes), toIso(row.started_at), toIso(row.completed_at),
        toIso(row.created_at) ?? new Date().toISOString(),
        toIso(row.updated_at) ?? toIso(row.created_at) ?? new Date().toISOString()
      ).changes;
    }
    record('user_library', userLibrary.length, inserted);

    inserted = 0;
    for (const row of comments) {
      inserted += insertComment.run(
        row.id, row.user_id, String(row.entity_type ?? 'anime'), asInt(row.entity_id),
        asString(row.parent_id), String(row.body ?? ''),
        rewriteStorageUrl(asString(row.image_url)),
        row.is_deleted === true ? 1 : 0,
        toIso(row.created_at) ?? new Date().toISOString(),
        toIso(row.updated_at) ?? toIso(row.created_at) ?? new Date().toISOString()
      ).changes;
    }
    record('comments', comments.length, inserted);

    inserted = 0;
    for (const row of quests) {
      inserted += insertQuest.run(
        row.id, String(row.title ?? ''), String(row.description ?? ''), asString(row.badge_reward),
        asInt(row.target_value, 1), String(row.metric ?? ''), String(row.category ?? 'general'),
        toIso(row.starts_at), toIso(row.ends_at), row.is_active === false ? 0 : 1,
        toIso(row.created_at) ?? new Date().toISOString()
      ).changes;
    }
    record('quests', quests.length, inserted);

    return [...counters];
  });

  return run();
}

export function printReport(db: Db, report: Counter[]): void {
  const pad = (v: string, n: number) => v.padEnd(n, ' ');
  process.stdout.write(`\nIMPORT_DIR=${IMPORT_DIR}\n`);
  process.stdout.write(`${pad('bảng', 24)}${pad('rows JSON', 12)}${pad('insert', 10)}skip\n`);
  for (const c of report) {
    process.stdout.write(`${pad(c.table, 24)}${pad(String(c.source), 12)}${pad(String(c.inserted), 10)}${c.skipped}\n`);
  }
  const violations = db.pragma('foreign_key_check') as unknown[];
  process.stdout.write(`\npragma foreign_key_check: ${violations.length === 0 ? 'rỗng (OK)' : JSON.stringify(violations)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('import-supabase.ts')) {
  const dbPath = process.env.DB_PATH ?? './data/app.db';
  const db = openDb({ path: dbPath });
  runImport(db);
  const violations = db.pragma('foreign_key_check') as unknown[];
  printReport(db, countersSnapshot());
  db.close();
  process.exit(violations.length === 0 ? 0 : 1);
}
