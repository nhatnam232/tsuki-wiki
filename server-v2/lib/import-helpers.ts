/** Helper cho import Supabase: chuẩn hoá timestamp + rewrite URL storage. */

/**
 * `2026-04-23 15:15:00.572296+00` → `2026-04-23T15:15:00.572Z`
 * Date-only `1999-05-01` giữ nguyên (cột date). Null/undefined → null.
 */
export function toIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/
  );
  if (!match) return value;

  const [, date, time, frac] = match;
  const millis = (frac ?? '').padEnd(3, '0').slice(0, 3);
  return `${date}T${time}.${millis}Z`;
}

const SUPABASE_STORAGE_RE =
  /^https?:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/([^?#]+)/;

/** URL storage Supabase → `/media/<bucket>/<key>`; URL ngoài giữ nguyên. */
export function rewriteStorageUrl(value: string | null): string | null {
  if (!value) return value;
  const match = value.match(SUPABASE_STORAGE_RE);
  if (!match) return value;
  return `/media/${match[1]}`;
}
