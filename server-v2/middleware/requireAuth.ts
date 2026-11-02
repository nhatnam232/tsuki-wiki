/**
 * requireAuth / requireUser + requireRole.
 *
 * - Access token lấy từ cookie `tsuki_at` (hoặc `Authorization: Bearer` cho
 *   tooling). Verify HS256 → check session trong DB còn active (nên logout/
 *   revoke có hiệu lực ngay, không chờ JWT hết hạn).
 * - Role đọc từ `profiles.badges` trong DB (KHÔNG tin role trong JWT/body),
 *   cache ngắn `ROLE_CACHE_TTL_MS` (mặc định 30s; reviewer yêu cầu ≤60s).
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Db } from '../db/index';
import { readCookie } from '../auth/cookies';
import { ACCESS_COOKIE, getSessionById, isActive } from '../auth/session';
import { verifyAccessToken } from '../crypto/jwt';

export type Role = 'mod' | 'admin' | 'owner';

export interface ProfileLite {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  badges: string[];
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  badges: string[];
  profile: ProfileLite | null;
  tokenExp: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** badge cần có để thoả từng mức role (owner ⊃ admin ⊃ mod). */
const ROLE_BADGES: Record<Role, string[]> = {
  mod: ['mod', 'admin', 'owner'],
  admin: ['admin', 'owner'],
  owner: ['owner'],
};

interface BadgeCacheEntry {
  badges: string[];
  expiresAt: number;
}

const badgeCache = new Map<string, BadgeCacheEntry>();

function roleCacheTtlMs(): number {
  const raw = process.env.ROLE_CACHE_TTL_MS;
  if (raw === undefined) return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30_000;
}

/** Gọi sau khi grant/revoke badge để quyền mới có hiệu lực tức thì. */
export function invalidateRoleCache(userId?: string): void {
  if (userId) badgeCache.delete(userId);
  else badgeCache.clear();
}

export function parseBadges(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b): b is string => typeof b === 'string');
  } catch {
    return [];
  }
}

export function loadProfile(db: Db, userId: string): ProfileLite | null {
  const row = db
    .prepare(
      'select id, username, display_name, avatar_url, cover_url, badges from profiles where id = ?'
    )
    .get(userId) as
    | {
        id: string;
        username: string | null;
        display_name: string | null;
        avatar_url: string | null;
        cover_url: string | null;
        badges: string;
      }
    | undefined;

  if (!row) return null;
  return { ...row, badges: parseBadges(row.badges) };
}

export function badgesOf(db: Db, userId: string): string[] {
  const ttl = roleCacheTtlMs();
  const now = Date.now();
  const cached = badgeCache.get(userId);
  if (cached && (ttl === 0 ? false : cached.expiresAt > now)) return cached.badges;

  const profile = loadProfile(db, userId);
  const badges = profile?.badges ?? [];
  if (ttl > 0) badgeCache.set(userId, { badges, expiresAt: now + ttl });
  return badges;
}

function unauthorized(res: Response, error: string): void {
  res.status(401).json({ success: false, error });
}

/** Đọc token: ưu tiên cookie, sau đó header Bearer. */
export function extractAccessToken(req: Request): string | undefined {
  const fromCookie = readCookie(req.headers.cookie, ACCESS_COOKIE);
  if (fromCookie) return fromCookie;

  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export function requireAuth(db: Db): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractAccessToken(req);
    if (!token) return unauthorized(res, 'unauthorized');

    const result = verifyAccessToken(token);
    if (!result.valid) {
      return unauthorized(res, result.reason === 'expired' ? 'token_expired' : 'unauthorized');
    }

    const session = getSessionById(db, result.payload.sid);
    if (!session || session.user_id !== result.payload.sub) return unauthorized(res, 'unauthorized');
    if (!isActive(session)) return unauthorized(res, 'session_revoked');

    const profile = loadProfile(db, result.payload.sub);

    req.auth = {
      userId: result.payload.sub,
      sessionId: result.payload.sid,
      badges: profile?.badges ?? [],
      profile,
      tokenExp: result.payload.exp,
    };
    next();
  };
}

/**
 * Như requireAuth nhưng KHÔNG chặn khi thiếu/sai token — dùng cho route public
 * cần phân biệt owner/mod (vd collection private, comment của chính mình).
 */
export function optionalAuth(db: Db): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = extractAccessToken(req);
    if (token) {
      const result = verifyAccessToken(token);
      if (result.valid) {
        const session = getSessionById(db, result.payload.sid);
        if (session && isActive(session) && session.user_id === result.payload.sub) {
          const profile = loadProfile(db, result.payload.sub);
          req.auth = {
            userId: result.payload.sub,
            sessionId: result.payload.sid,
            badges: profile?.badges ?? [],
            profile,
            tokenExp: result.payload.exp,
          };
        }
      }
    }
    next();
  };
}

/** Alias theo naming của task-6. */
export const requireUser = requireAuth;

export function requireRole(...roles: Role[]): RequestHandler {
  const needed = new Set<string>();
  for (const role of roles) for (const badge of ROLE_BADGES[role]) needed.add(badge);

  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return unauthorized(res, 'unauthorized');

    if (auth.badges.some((badge) => needed.has(badge))) return next();

    res.status(403).json({
      success: false,
      error: 'forbidden',
      message: `Cần quyền: ${roles.join('|')}`,
    });
  };
}

/** Chỉ dùng cho test/tool: đặt auth thủ công. */
export function attachTestAuth(req: Request, auth: AuthContext): void {
  req.auth = auth;
}
