/**
 * Một nguồn thời gian duy nhất cho toàn server-v2.
 *
 * Quy ước: MỌI cột timestamp lưu TEXT ISO-8601 UTC có milliseconds + 'Z'
 * (`2026-11-02T08:52:37.774Z`) — khớp default `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
 * và CHECK glob trong 003_schema_hardening.sql.
 *
 * CẤM `datetime('now')` ('YYYY-MM-DD HH:MM:SS', thiếu Z) cho cột timestamp:
 * so sánh lexicographic với ISO sẽ sai. test/schema-hardening.test.ts quét
 * source để chặn tái phát.
 */
// GLOB dùng '?' (không phải '_' như LIKE) — đã verify: '_' không phải wildcard của GLOB.
export const ISO_TIMESTAMP_GLOB = '????-??-??T??:??:??*Z';
export const ISO_DATE_GLOB = '????-??-??';

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
