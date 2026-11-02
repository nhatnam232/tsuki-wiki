/**
 * Password hashing — scrypt của `node:crypto` (KHÔNG cài argon2/bcrypt).
 *
 * Lý do: Lead chốt dùng node:crypto cho Phase 0 để tránh native build.
 * Format lưu DB: `scrypt$N$r$p$saltB64$hashB64` (self-describing → đổi tham số
 * sau này vẫn verify được hash cũ, và `needsRehash()` báo khi cần nâng cấp).
 *
 * So sánh bằng `timingSafeEqual` (constant-time) — không dùng `===`.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { promisify } from 'node:util';

type ScryptOptions = { N: number; r: number; p: number; maxmem: number };
const scryptAsync = promisify(scryptCallback) as unknown as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

/** Tham số hiện hành (OWASP: N=2^14, r=8, p=1, keylen=64). */
export const SCRYPT_PARAMS: Readonly<ScryptOptions> = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const KEYLEN = 64;
const SALTLEN = 16;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** NFKC để cùng một mật khẩu Unicode luôn cho cùng một hash. */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Nhận diện hash bcrypt của Supabase/PHP ($2a$, $2b$, $2y$). */
export const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password rỗng');
  }
  const salt = randomBytes(SALTLEN);
  const key = await scryptAsync(normalize(password), salt, KEYLEN, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * Verify mật khẩu. Trả false (không throw) với mọi input hỏng để tránh
 * biến lỗi parse thành tín hiệu dò tài khoản.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (typeof password !== 'string' || !stored) return false;

  // Legacy: bcrypt ($2a$/$2b$/$2y$) từ Supabase auth.users.encrypted_password
  if (BCRYPT_RE.test(stored)) {
    try {
      return await bcryptjs.compare(password, stored);
    } catch {
      return false;
    }
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Chặn tham số kỳ dị (DoS qua N khổng lồ nếu DB bị sửa tay).
  if (n < 2 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scryptAsync(normalize(password), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: Math.max(SCRYPT_PARAMS.maxmem, 256 * n * r),
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** true khi hash dùng tham số yếu hơn hiện hành → nên rehash sau lần login kế tiếp. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return true;
  // bcrypt (legacy Supabase) → luôn rehash sang scrypt sau lần login đầu.
  if (BCRYPT_RE.test(stored)) return true;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  return n < SCRYPT_PARAMS.N || r < SCRYPT_PARAMS.r || p < SCRYPT_PARAMS.p;
}

/** Policy tối thiểu. Trả message lỗi hoặc null nếu hợp lệ. */
export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== 'string') return 'password_invalid';
  if (password.length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'password_too_long';
  return null;
}
