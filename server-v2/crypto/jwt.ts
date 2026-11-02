/**
 * JWT HS256 tự ký bằng `node:crypto` HMAC (KHÔNG cài `jose`/`jsonwebtoken`).
 *
 * Payload access token: `{ sub, sid, iat, exp }` — TTL 15 phút.
 * Verify: chữ ký constant-time, kiểm `alg` (chỉ chấp nhận HS256 → chặn `alg:none`),
 * kiểm `typ`, `exp`, `sub`, `sid` là string.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const MIN_SECRET_LENGTH = 32;

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
}

export type VerifyResult =
  | { valid: true; payload: AccessTokenPayload }
  | { valid: false; reason: 'malformed' | 'bad_algorithm' | 'bad_signature' | 'expired' | 'not_yet_valid' | 'bad_claims' };

let cachedSecret: string | null = null;

/**
 * Secret lấy từ `JWT_SECRET` (>= 32 ký tự).
 * - production mà thiếu → throw (fail-fast, không chạy với secret tạm).
 * - dev/test mà thiếu → sinh secret tạm 1 lần, log cảnh báo (token mất hiệu lực khi restart).
 */
export function getJwtSecret(): string {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      throw new Error(`JWT_SECRET phải >= ${MIN_SECRET_LENGTH} ký tự (hiện ${fromEnv.length})`);
    }
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET bắt buộc khi NODE_ENV=production');
  }

  cachedSecret = randomBytes(32).toString('hex');
  process.stderr.write(
    '[auth] JWT_SECRET chưa set — dùng secret tạm cho dev (token sẽ mất hiệu lực khi restart)\n'
  );
  return cachedSecret;
}

/** Dùng trong test để đổi secret giữa các suite. */
export function resetJwtSecretCache(): void {
  cachedSecret = null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export interface SignOptions {
  ttlSec?: number;
  /** Thời điểm phát hành (giây). Mặc định now — test truyền để tạo token hết hạn. */
  now?: number;
  secret?: string;
}

export function signAccessToken(
  claims: { sub: string; sid: string },
  options: SignOptions = {}
): string {
  if (!claims.sub || !claims.sid) throw new Error('sub và sid là bắt buộc');

  const secret = options.secret ?? getJwtSecret();
  const iat = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSec ?? ACCESS_TOKEN_TTL_SEC;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: AccessTokenPayload = { sub: claims.sub, sid: claims.sid, iat, exp: iat + ttl };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64url(sign(signingInput, secret));

  return `${signingInput}.${signature}`;
}

export function verifyAccessToken(token: unknown, options: { secret?: string; now?: number } = {}): VerifyResult {
  if (typeof token !== 'string') return { valid: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  // Chỉ nhận đúng thuật toán của mình → tự động chặn `alg: none` / thuật toán lạ.
  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'HS256'
  ) {
    return { valid: false, reason: 'bad_algorithm' };
  }

  const secret = options.secret ?? getJwtSecret();
  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const actual = Buffer.from(encodedSignature, 'base64url');
  if (actual.length !== expected.length) return { valid: false, reason: 'bad_signature' };
  if (!timingSafeEqual(actual, expected)) return { valid: false, reason: 'bad_signature' };

  if (typeof payload !== 'object' || payload === null) return { valid: false, reason: 'malformed' };
  const claims = payload as Partial<AccessTokenPayload>;
  if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string') {
    return { valid: false, reason: 'bad_claims' };
  }
  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') {
    return { valid: false, reason: 'bad_claims' };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (now >= claims.exp) return { valid: false, reason: 'expired' };
  if (claims.iat > now + 60) return { valid: false, reason: 'not_yet_valid' };

  return {
    valid: true,
    payload: { sub: claims.sub, sid: claims.sid, iat: claims.iat, exp: claims.exp },
  };
}

/** Giải payload mà KHÔNG verify — chỉ dùng cho log/debug, không dùng để cấp quyền. */
export function decodeWithoutVerify(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
