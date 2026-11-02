/**
 * Cron secret — sinh bằng CSPRNG, lưu `system_secrets`, không trả qua response thường.
 * Thứ tự ưu tiên: env `CRON_SECRET` → DB `system_secrets['cron_secret']` → sinh mới.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';

export const CRON_SECRET_KEY = 'cron_secret';
const MIN_LENGTH = 32;
const MIN_ENV_LENGTH = 32;

export function getCronSecret(db: Db): string {
  const fromEnv = process.env.CRON_SECRET;
  if (fromEnv && fromEnv.length >= MIN_ENV_LENGTH) return fromEnv;

  const row = db
    .prepare('select value from system_secrets where key = ?')
    .get(CRON_SECRET_KEY) as { value: string } | undefined;
  if (row && row.value.length >= MIN_LENGTH) return row.value;

  const secret = randomBytes(32).toString('base64url'); // 256 bit
  db.prepare(
    `insert into system_secrets (key, value, description, updated_at)
     values (?, ?, ?, ?)
     on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`
  ).run(CRON_SECRET_KEY, secret, 'Auto-generated shared secret for cron-fired API calls', nowIso());

  return secret;
}

/** So sánh constant-time, an toàn với chuỗi khác độ dài. */
export function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
