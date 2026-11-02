/**
 * Chuẩn hoá field JSON TEXT của SQLite (map jsonb/text[] của Postgres) trước khi trả API.
 * Parse lỗi → fallback + log, KHÔNG bao giờ trả string cho client (frontend cần array/object).
 */
export function parseJsonField<T>(value: unknown, fallback: T, field = 'json'): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null) return fallback;
    return parsed as T;
  } catch {
    process.stderr.write(`[json] parse lỗi field=${field}: trả fallback\n`);
    return fallback;
  }
}

/** Chuẩn hoá 1 row: các key trong `map` được parse với fallback tương ứng. */
export function normalizeRow<T extends Record<string, unknown>>(
  row: T | undefined,
  map: Record<string, unknown>
): T | undefined {
  if (!row) return row;
  const out: Record<string, unknown> = { ...row };
  for (const [key, fallback] of Object.entries(map)) {
    if (key in out) out[key] = parseJsonField(out[key], fallback, key);
  }
  return out as T;
}

export function normalizeRows<T extends Record<string, unknown>>(
  rows: T[],
  map: Record<string, unknown>
): T[] {
  return rows.map((row) => normalizeRow(row, map) as T);
}

export const PROFILE_JSON = { badges: [] as string[] };
export const ACTIVITY_JSON = { meta: null };
export const COMPARE_JSON = { anime_ids: [] as number[] };
export const NOTIFICATION_JSON = { data: null };
