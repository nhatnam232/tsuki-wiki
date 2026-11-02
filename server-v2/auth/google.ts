import { clientIpOf } from '../middleware/security';
/**
 * Google OAuth 2.0 Authorization Code + PKCE (không cài `google-auth-library`).
 *
 * Luồng:
 *   GET /api/auth/google/start    → 503 nếu thiếu env; ngược lại set cookie
 *                                   state+code_verifier (HttpOnly) rồi 302 sang Google.
 *   GET /api/auth/google/callback → verify state, đổi code lấy token,
 *                                   verify `id_token` bằng JWKS của Google
 *                                   (RS256, chữ ký + iss + aud + exp),
 *                                   upsert users/profiles, cấp session cookie.
 *
 * Chưa có creds Google thì cả 2 endpoint trả 503 {error:'oauth_not_configured'}.
 * Phần gọi mạng Google CHƯA được test tự động (cần creds thật) — xem báo cáo.
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import type { Db } from '../db/index';
import { clearCookie, readCookie, serializeCookie } from './cookies';
import { issueSession, setAuthCookies } from './session';
import { ensureProfile } from './profile';
import { nowIso } from '../lib/time';

const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const OAUTH_STATE_COOKIE = 'tsuki_oauth_state';
const STATE_COOKIE_PATH = '/api/auth/google';
const STATE_TTL_SEC = 600;
const NETWORK_TIMEOUT_MS = 10_000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(): GoogleConfig {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID ?? '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET ?? '').trim(),
    redirectUri: (process.env.OAUTH_REDIRECT_URI ?? '').trim(),
  };
}

export function isOAuthConfigured(): boolean {
  const config = googleConfig();
  return config.clientId.length > 0 && config.clientSecret.length > 0;
}

export function callbackUrl(config: GoogleConfig = googleConfig()): string {
  if (config.redirectUri) return config.redirectUri;
  const site = (process.env.SITE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}`).replace(/\/+$/, '');
  return `${site}/api/auth/google/callback`;
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function notConfigured(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'oauth_not_configured',
    message: 'Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET',
  });
}

/** GET /api/auth/google/start */
export function googleStart(): RequestHandler {
  return (_req: Request, res: Response) => {
    const config = googleConfig();
    if (!isOAuthConfigured()) return notConfigured(res);

    // PKCE: verifier giữ trong cookie HttpOnly, chỉ gửi challenge cho Google.
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');

    const cookieValue = Buffer.from(
      JSON.stringify({ state, codeVerifier, ts: Date.now() })
    ).toString('base64url');

    res.append(
      'Set-Cookie',
      serializeCookie(OAUTH_STATE_COOKIE, cookieValue, {
        path: STATE_COOKIE_PATH,
        maxAgeSec: STATE_TTL_SEC,
        httpOnly: true,
        sameSite: 'Lax',
      })
    );

    const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', callbackUrl(config));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');

    res.redirect(302, url.toString());
  };
}

interface GoogleIdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  exp?: number;
  iat?: number;
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Lấy JWKS (cache 1h). Throw nếu mạng lỗi → route trả 502. */
async function getGoogleJwks(force = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;

  const response = await fetch(GOOGLE_JWKS_ENDPOINT, {
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`);

  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

export type IdTokenResult =
  | { ok: true; claims: GoogleIdTokenClaims }
  | { ok: false; reason: string };

/**
 * Verify id_token: RS256 + kid (JWKS) + iss + aud + exp.
 * Không chấp nhận `alg` khác RS256 (chặn `none`/HS256 confusion).
 */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<IdTokenResult> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  let header: { alg?: string; kid?: string };
  let claims: GoogleIdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as typeof header;
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as GoogleIdTokenClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: 'bad_algorithm' };

  let keys = await getGoogleJwks();
  let jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    keys = await getGoogleJwks(true); // kid mới sau khi Google rotate key
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return { ok: false, reason: 'unknown_key' };

  let verified = false;
  try {
    const publicKey = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' });
    verified = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], 'base64url')
    );
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!verified) return { ok: false, reason: 'bad_signature' };

  if (!claims.iss || !GOOGLE_ISSUERS.includes(claims.iss)) return { ok: false, reason: 'bad_issuer' };
  if (claims.aud !== clientId) return { ok: false, reason: 'bad_audience' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, reason: 'expired' };
  if (typeof claims.iat === 'number' && claims.iat > now + 300) return { ok: false, reason: 'bad_iat' };

  return { ok: true, claims };
}

/** Vá lỗi `JsonWebKey` của lib DOM không có trong lib ES2023. */
type JsonWebKey = { kty: string; n: string; e: string; [k: string]: unknown };

export interface UpsertResult {
  userId: string;
  created: boolean;
}

/** Tạo/link user Google. Throw Error với `code` để route map sang HTTP. */
export function upsertGoogleUser(
  db: Db,
  claims: GoogleIdTokenClaims
): UpsertResult {
  const sub = claims.sub;
  const email = claims.email?.trim().toLowerCase();
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

  if (!sub || !email) {
    throw Object.assign(new Error('oauth_profile_incomplete'), { code: 'oauth_profile_incomplete' });
  }
  if (!emailVerified) {
    throw Object.assign(new Error('email_not_verified'), { code: 'email_not_verified' });
  }

  const run = db.transaction((): UpsertResult => {
    const now = nowIso();
    const bySub = db.prepare('select id from users where google_sub = ?').get(sub) as
      | { id: string }
      | undefined;

    let userId: string;
    let created = false;

    if (bySub) {
      userId = bySub.id;
      db.prepare(
        'update users set email = ?, email_verified = 1, name = coalesce(?, name), picture = coalesce(?, picture), last_login_at = ?, updated_at = ? where id = ?'
      ).run(email, claims.name ?? null, claims.picture ?? null, now, now, userId);
    } else {
      const byEmail = db
        .prepare('select id, password_hash, email_verified from users where lower(email) = ?')
        .get(email) as { id: string; password_hash: string | null; email_verified: number } | undefined;

      if (byEmail) {
        // Account squatting defence: an attacker can pre-register someone
        // else's address (email_verified stays 0 and there is no reset flow),
        // which used to return 409 forever and lock the real owner out.
        // Google has just proven ownership of this address, so Google wins:
        // the squatter's password is dropped and the account is marked
        // verified. No user data is exposed to the Google user beyond their
        // own profile row, and the squatter loses access.
        const squatted = Boolean(byEmail.password_hash) && byEmail.email_verified !== 1;
        userId = byEmail.id;
        db.prepare(
          squatted
            ? `update users set google_sub = ?, provider = 'google', email_verified = 1,
                 password_hash = null, password_updated_at = null,
                 name = coalesce(?, name), picture = coalesce(?, picture),
                 last_login_at = ?, updated_at = ? where id = ?`
            : 'update users set google_sub = ?, email_verified = 1, name = coalesce(?, name), picture = coalesce(?, picture), last_login_at = ?, updated_at = ? where id = ?'
        ).run(sub, claims.name ?? null, claims.picture ?? null, now, now, userId);
        if (squatted) {
          db.prepare(
            `insert into audit_logs (actor_id, action, target_type, target_id, reason, created_at)
             values (?, 'other', 'users', ?, 'google_takeover_unverified', ?)`
          ).run(userId, userId, now);
        }
      } else {
        const inserted = db
          .prepare(
            `insert into users (google_sub, email, email_verified, name, picture, last_login_at)
             values (?, ?, 1, ?, ?, ?)
             returning id`
          )
          .get(sub, email, claims.name ?? null, claims.picture ?? null, now) as { id: string };
        userId = inserted.id;
        created = true;
      }
    }

    ensureProfile(db, {
      userId,
      email,
      displayName: claims.name ?? null,
      avatarUrl: claims.picture ?? null,
    });

    return { userId, created };
  });

  return run();
}

/** GET /api/auth/google/callback */
export function googleCallback(db: Db): RequestHandler {
  return (req: Request, res: Response) => {
    const config = googleConfig();
    if (!isOAuthConfigured()) return notConfigured(res);

    const rawCookie = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
    res.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE, { path: STATE_COOKIE_PATH }));

    let stored: { state?: string; codeVerifier?: string; ts?: number } = {};
    if (rawCookie) {
      try {
        stored = JSON.parse(Buffer.from(rawCookie, 'base64url').toString('utf8')) as typeof stored;
      } catch {
        stored = {};
      }
    }

    const stateParam = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

    if (errorParam) {
      res.status(400).json({ success: false, error: 'oauth_denied', message: errorParam });
      return;
    }
    if (!rawCookie || !stored.state || !stored.codeVerifier) {
      res.status(400).json({ success: false, error: 'missing_oauth_state' });
      return;
    }
    if (!stateParam || !safeEqualString(stateParam, stored.state)) {
      res.status(400).json({ success: false, error: 'invalid_oauth_state' });
      return;
    }
    if (!code) {
      res.status(400).json({ success: false, error: 'missing_code' });
      return;
    }

    void (async () => {
      try {
        const body = new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: callbackUrl(config),
          grant_type: 'authorization_code',
          code_verifier: stored.codeVerifier as string,
        });

        const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        });

        if (!tokenResponse.ok) {
          res.status(502).json({ success: false, error: 'oauth_exchange_failed' });
          return;
        }

        const tokenBody = (await tokenResponse.json()) as { id_token?: string };
        if (!tokenBody.id_token) {
          res.status(502).json({ success: false, error: 'oauth_missing_id_token' });
          return;
        }

        let verified;
        try {
          verified = await verifyGoogleIdToken(tokenBody.id_token, config.clientId);
        } catch {
          res.status(502).json({ success: false, error: 'jwks_unavailable' });
          return;
        }

        if (!verified.ok) {
          res.status(401).json({ success: false, error: 'id_token_invalid', reason: verified.reason });
          return;
        }

        const { userId } = upsertGoogleUser(db, verified.claims);
        const tokens = issueSession(db, {
          userId,
          userAgent: req.headers['user-agent'] ?? null,
          ip: clientIpOf(req) ?? null,
        });
        setAuthCookies(res, tokens);

        const target = (process.env.OAUTH_SUCCESS_REDIRECT ?? process.env.SITE_URL ?? '/').replace(
          /\/+$/,
          ''
        );
        res.redirect(302, target.length > 0 ? target : '/');
      } catch (err) {
        const code_ = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
        if (code_ === 'email_not_verified') {
          res.status(403).json({ success: false, error: 'email_not_verified' });
          return;
        }
        if (code_ === 'account_unverified_conflict') {
          res.status(409).json({ success: false, error: 'account_unverified_conflict' });
          return;
        }
        if (code_ === 'oauth_profile_incomplete') {
          res.status(502).json({ success: false, error: 'oauth_profile_incomplete' });
          return;
        }
        res.status(500).json({ success: false, error: 'oauth_failed' });
      }
    })();
  };
}
