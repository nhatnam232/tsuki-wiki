/**
 * Auth routes — Phase 0 / Slice 2.
 *
 *   POST /api/auth/register  (+ alias /signup)  email+password → 201
 *   POST /api/auth/login                        201? không: 200
 *   POST /api/auth/refresh                      rotate refresh token
 *   POST /api/auth/logout                       revoke + clear cookie
 *   GET  /api/auth/me                           requireAuth
 *   GET  /api/auth/google/start|callback        OAuth 2.0 + PKCE
 *
 * Error shape thống nhất: `{ success:false, error:'code', message?:'...' }`.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db/index';
import { hashPassword, needsRehash, validatePasswordPolicy, verifyPassword } from '../crypto/password';
import { ACCESS_TOKEN_TTL_SEC, verifyAccessToken } from '../crypto/jwt';
import { readCookie } from './cookies';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  getSessionById,
  getSessionByToken,
  issueSession,
  revokeSession,
  rotateSession,
  setAuthCookies,
} from './session';
import { ensureProfile } from './profile';
import { extractAccessToken, requireAuth } from '../middleware/requireAuth';
import { envInt, rateLimit } from '../middleware/rateLimit';
import { googleCallback, googleStart } from './google';
import { nowIso } from '../lib/time';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const EMAIL_MAX = 254;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) return null;
  return EMAIL_RE.test(email) ? email : null;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  email_verified: number;
  created_at: string;
  last_login_at: string | null;
  password_hash: string | null;
}

function selectUserByEmail(db: Db, email: string): UserRow | undefined {
  return db
    .prepare(
      `select id, email, name, picture, email_verified, created_at, last_login_at, password_hash
       from users where lower(email) = ? limit 1`
    )
    .get(email) as UserRow | undefined;
}

function publicUser(user: UserRow): Record<string, unknown> {
  // KHÔNG bao giờ trả password_hash.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    email_verified: user.email_verified === 1,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

/** Hash giả để cân bằng thời gian khi email không tồn tại (chống dò tài khoản). */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('timing-equalizer-not-a-real-password');
  return dummyHashPromise;
}

export interface AuthRouterOptions {
  /** Tắt rate limit (dùng cho test cần nhiều request). */
  disableRateLimit?: boolean;
}

export function createAuthRouter(db: Db, options: AuthRouterOptions = {}): Router {
  const router = express.Router();
  const rateDisabled = options.disableRateLimit === true;

  // 10 request / 15 phút / IP cho login+signup (task-6). Override bằng env.
  const credentialsLimiter = (name: string) =>
    rateLimit({
      name,
      windowMs: envInt('AUTH_RATE_WINDOW_MS', 15 * 60 * 1000),
      max: envInt('AUTH_RATE_MAX', 10),
      enabled: !rateDisabled,
    });

  const refreshLimiter = rateLimit({
    name: 'auth:refresh',
    windowMs: envInt('AUTH_REFRESH_WINDOW_MS', 60 * 1000),
    max: envInt('AUTH_REFRESH_MAX', 60),
    enabled: !rateDisabled,
  });

  // ── Register ────────────────────────────────────────────────
  const register = (req: Request, res: Response): void => {
    void (async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeEmail(body.email);
      if (!email) {
        res.status(400).json({ success: false, error: 'invalid_email' });
        return;
      }

      const policyError = validatePasswordPolicy(body.password);
      if (policyError) {
        res.status(400).json({ success: false, error: policyError });
        return;
      }

      if (selectUserByEmail(db, email)) {
        res.status(409).json({ success: false, error: 'email_taken' });
        return;
      }

      const passwordHash = await hashPassword(body.password as string);
      const displayName =
        typeof body.name === 'string' && body.name.trim().length > 0
          ? body.name.trim().slice(0, 80)
          : null;

      let userId: string;
      try {
        const created = db.transaction((): { id: string } => {
          const row = db
            .prepare(
              `insert into users (email, name, password_hash, email_verified, last_login_at)
               values (?, ?, ?, 0, ?) returning id, email, name, picture, email_verified, created_at, last_login_at`
            )
            .get(email, displayName, passwordHash, nowIso()) as UserRow;
          ensureProfile(db, {
            userId: row.id,
            email,
            displayName: displayName ?? email.split('@')[0],
          });
          return { id: row.id };
        })();
        userId = created.id;
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed: users.email/.test(err.message)) {
          res.status(409).json({ success: false, error: 'email_taken' });
          return;
        }
        throw err;
      }

      const tokens = issueSession(db, {
        userId,
        userAgent: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
      });
      setAuthCookies(res, tokens);

      const user = db
        .prepare(
          `select id, email, name, picture, email_verified, created_at, last_login_at, password_hash
           from users where id = ?`
        )
        .get(userId) as UserRow;

      res.status(201).json({ success: true, user: publicUser(user) });
    })().catch(() => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'register_failed' });
    });
  };

  router.post('/register', credentialsLimiter('auth:register'), register);
  router.post('/signup', credentialsLimiter('auth:signup'), register); // alias theo task-6

  // ── Login ───────────────────────────────────────────────────
  router.post('/login', credentialsLimiter('auth:login'), (req: Request, res: Response) => {
    void (async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeEmail(body.email);
      const password = typeof body.password === 'string' ? body.password : '';

      if (!email || password.length === 0) {
        res.status(400).json({ success: false, error: 'invalid_credentials_input' });
        return;
      }

      const user = selectUserByEmail(db, email);

      // Luôn chạy 1 lần scrypt để thời gian phản hồi không tiết lộ email tồn tại.
      if (!user || !user.password_hash) {
        await verifyPassword(password, await dummyHash());
        res.status(401).json({ success: false, error: 'invalid_credentials' });
        return;
      }

      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        res.status(401).json({ success: false, error: 'invalid_credentials' });
        return;
      }

      // Rehash-on-login: bcrypt (legacy) hoặc scrypt tham số yếu → scrypt hiện hành.
      if (needsRehash(user.password_hash)) {
        const upgraded = await hashPassword(password);
        db.prepare(
          'update users set password_hash = ?, password_updated_at = ?, updated_at = ? where id = ?'
        ).run(upgraded, nowIso(), nowIso(), user.id);
      }

      const now = nowIso();
      db.prepare('update users set last_login_at = ?, updated_at = ? where id = ?').run(
        now,
        now,
        user.id
      );

      const tokens = issueSession(db, {
        userId: user.id,
        userAgent: req.headers['user-agent'] ?? null,
        ip: req.ip ?? null,
      });
      setAuthCookies(res, tokens);

      res.status(200).json({
        success: true,
        user: publicUser({ ...user, last_login_at: now }),
        accessExpiresIn: ACCESS_TOKEN_TTL_SEC,
      });
    })().catch(() => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'login_failed' });
    });
  });

  // ── Refresh (rotate) ────────────────────────────────────────
  router.post('/refresh', refreshLimiter, (req: Request, res: Response) => {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (!token) {
      res.status(401).json({ success: false, error: 'missing_refresh_token' });
      return;
    }

    const result = rotateSession(db, token, {
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? null,
    });

    if (!result.ok) {
      clearAuthCookies(res);
      const error = result.reason === 'reuse' ? 'refresh_reuse_detected' : 'invalid_refresh_token';
      res.status(401).json({ success: false, error, reason: result.reason });
      return;
    }

    setAuthCookies(res, result.tokens);
    res.status(200).json({ success: true, accessExpiresIn: ACCESS_TOKEN_TTL_SEC });
  });

  // ── Logout ──────────────────────────────────────────────────
  // Idempotent: luôn trả 200 và clear cookie. Nếu access token còn hợp lệ thì
  // revoke đúng session; nếu client có gửi refresh cookie (REFRESH_COOKIE_PATH=/)
  // thì revoke luôn session của refresh token đó.
  router.post('/logout', (req: Request, res: Response) => {
    const token = extractAccessToken(req);
    if (token) {
      const verified = verifyAccessToken(token);
      if (verified.valid) {
        const session = getSessionById(db, verified.payload.sid);
        if (session && session.user_id === verified.payload.sub) revokeSession(db, session.id);
      }
    }

    const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (refreshToken) {
      const session = getSessionByToken(db, refreshToken);
      if (session) revokeSession(db, session.id);
    }

    clearAuthCookies(res);
    res.status(200).json({ success: true, message: 'logged_out' });
  });

  // ── Me ──────────────────────────────────────────────────────
  router.get('/me', requireAuth(db), (req: Request, res: Response) => {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }

    const user = db
      .prepare(
        `select id, email, name, picture, email_verified, created_at, last_login_at
         from users where id = ?`
      )
      .get(auth.userId) as Omit<UserRow, 'password_hash'> | undefined;

    if (!user) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }

    res.status(200).json({
      success: true,
      user: publicUser({ ...user, password_hash: null }),
      profile: auth.profile,
      badges: auth.badges,
      session: { id: auth.sessionId, tokenExp: auth.tokenExp },
    });
  });

  // ── Google OAuth ────────────────────────────────────────────
  router.get('/google/start', googleStart());
  router.get('/google/callback', googleCallback(db));

  return router;
}
