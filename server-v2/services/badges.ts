/**
 * Badge grant/revoke — ATOMIC trong 1 câu UPDATE.
 *
 * Postgres dùng `badges || array[badge]` / `array_remove`; port sang Node bằng
 * read-modify-write sẽ mất update khi 2 request đồng thời (lost update).
 * Vì vậy dùng JSON1 trong chính câu UPDATE:
 *   grant : json_insert(badges, '$[#]', :badge) với điều kiện NOT EXISTS
 *   revoke: json_group_array lọc phần tử cần xoá
 */
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';

export function grantBadge(db: Db, userId: string, badge: string): boolean {
  const info = db
    .prepare(
      `update profiles
          set badges = json_insert(badges, '$[#]', :badge),
              updated_at = :now
        where id = :userId
          and not exists (select 1 from json_each(badges) where json_each.value = :badge)`
    )
    .run({ badge, now: nowIso(), userId });
  return info.changes > 0;
}

export function revokeBadge(db: Db, userId: string, badge: string): boolean {
  const info = db
    .prepare(
      `update profiles
          set badges = coalesce((select json_group_array(value)
                                   from json_each(badges)
                                  where value <> :badge), '[]'),
              updated_at = :now
        where id = :userId
          and exists (select 1 from json_each(badges) where json_each.value = :badge)`
    )
    .run({ badge, now: nowIso(), userId });
  return info.changes > 0;
}

export function listBadges(db: Db, userId: string): string[] {
  const row = db.prepare('select badges from profiles where id = ?').get(userId) as
    | { badges: string }
    | undefined;
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.badges);
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : [];
  } catch {
    return [];
  }
}
