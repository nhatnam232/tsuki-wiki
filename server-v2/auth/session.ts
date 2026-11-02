/**
 * Session + token lifecycle trên bảng `sessions`.
 *
 * Mô hình:
 *   - 1 dòng `sessions` = 1 refresh token (lưu SHA-256, KHÔNG lưu token gốc).
 *   - `family_id` giữ các token sinh ra từ cùng 1 lần đăng nhập (rotate chain).
 *   - Access JWT (15m) mang `sid` = sessions.id; `requireAuth` kiểm session còn
 *     active → logout/revoke có hiệu lực NGAY, không phải chờ JWT hết hạn.
 *   - Refresh rotation: token cũ bị revoke + `replaced_by` trỏ token mới.
 *   - Dùng lại token đã revoke → revoke TOÀN BỘ family (chống replay).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { Db } from '../db/index';
import { signAccessToken, ACCESS_TOKEN_TTL_SEC } from '../crypto/jwt';
import { clearCookie, serializeCookie } from './cookies';
import { nowIso } from '../lib/time';

export const ACCESS_COOKIE = 'tsuki_at';
export const REFRESH_COOKIE = 'tsuki_rt';
/** Refresh cookie chỉ gửi tới đúng endpoint refresh (giảm bề mặt lộ token). */
/**
 * Path của refresh cookie: `/api/auth` (đủ hẹp — chỉ gửi cho auth routes, nhưng
 * gồm cả `/api/auth/logout` để logout revoke được refresh token kể cả khi access
 * JWT đã hết hạn). Đặt `/` chỉ khi thật cần chia sẻ cookie toàn site.
 */
export const REFRESH_COOKIE_PATH = process.env.REFRESH_COOKIE_PATH || '/api/auth';

/** Đọc lại env mỗi lần set/clear cookie (test có thể đổi giữa các suite). */
export function refreshCookiePath(): string {
  return process.env.REFRESH_COOKIE_PATH || REFRESH_COOKIE_PATH;
}
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  rotate_count: number;
  user_agent: string | null;
  ip: string | null;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function plusSeconds(sec: number): string {
  return new Date(Date.now() + sec * 1000).toISOString();
}

/** Session còn hiệu lực: chưa revoke + chưa hết hạn. */
export function isActive(session: SessionRecord, now = Date.now()): boolean {
  if (session.revoked_at) return false;
  return Date.parse(session.expires_at) > now;
}

export function getSessionById(db: Db, sessionId: string): SessionRecord | null {
  const row = db
    .prepare('select * from sessions where id = ?')
    .get(sessionId) as SessionRecord | undefined;
  return row ?? null;
}

export function getSessionByToken(db: Db, refreshToken: string): SessionRecord | null {
  const row = db
    .prepare('select * from sessions where token_hash = ?')
    .get(sha256Hex(refreshToken)) as SessionRecord | undefined;
  return row ?? null;
}

export interface IssueOptions {
  userId: string;
  userAgent?: string | null;
  ip?: string | null;
  /** Dùng cho test: thời điểm tạo (ms). */
  nowMs?: number;
}

export interface IssuedTokens {
  sessionId: string;
  familyId: string;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

/** Tạo session mới (login / đăng ký / OAuth callback). */
export function issueSession(db: Db, options: IssueOptions): IssuedTokens {
  const refreshToken = randomBytes(32).toString('base64url');
  const familyId = randomBytes(16).toString('hex');
  const nowMs = options.nowMs ?? Date.now();

  const row = db
    .prepare(
      `insert into sessions (user_id, token_hash, family_id, user_agent, ip, expires_at)
       values (?, ?, ?, ?, ?, ?)
       returning id, created_at, expires_at`
    )
    .get(
      options.userId,
      sha256Hex(refreshToken),
      familyId,
      options.userAgent ?? null,
      options.ip ?? null,
      plusSeconds(REFRESH_TTL_SEC)
    ) as { id: string; created_at: string; expires_at: string };

  const accessToken = signAccessToken(
    { sub: options.userId, sid: row.id },
    { now: Math.floor(nowMs / 1000) }
  );

  return {
    sessionId: row.id,
    familyId,
    refreshToken,
    accessToken,
    accessExpiresAt: new Date(nowMs + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
    refreshExpiresAt: row.expires_at,
  };
}

export function revokeSession(db: Db, sessionId: string): boolean {
  const info = db
    .prepare('update sessions set revoked_at = ? where id = ? and revoked_at is null')
    .run(nowIso(), sessionId);
  return info.changes > 0;
}

export function revokeFamily(db: Db, familyId: string): number {
  const info = db
    .prepare('update sessions set revoked_at = ? where family_id = ? and revoked_at is null')
    .run(nowIso(), familyId);
  return info.changes;
}

export type RotateResult =
  | { ok: true; tokens: IssuedTokens; reusedFrom: null }
  | { ok: false; reason: 'not_found' | 'expired' | 'reuse' | 'family_revoked' };

/**
 * Rotate refresh token.
 * - Token không tồn tại → not_found (401).
 * - Token đã revoke (replay) → revoke cả family → reuse (401).
 * - Token hết hạn → expired (401).
 */
export function rotateSession(
  db: Db,
  refreshToken: string,
  meta: { userAgent?: string | null; ip?: string | null } = {}
): RotateResult {
  const existing = getSessionByToken(db, refreshToken);
  if (!existing) return { ok: false, reason: 'not_found' };

  if (existing.revoked_at) {
    // Replay: token đã dùng/đã logout. Cắt toàn bộ chain của lần đăng nhập này.
    if (existing.family_id) revokeFamily(db, existing.family_id);
    return { ok: false, reason: 'reuse' };
  }

  if (!isActive(existing)) return { ok: false, reason: 'expired' };

  const newRefreshToken = randomBytes(32).toString('base64url');
  const familyId = existing.family_id ?? randomBytes(16).toString('hex');

  const rotate = db.transaction((): IssuedTokens => {
    const row = db
      .prepare(
        `insert into sessions (user_id, token_hash, family_id, user_agent, ip, expires_at, rotate_count)
         values (?, ?, ?, ?, ?, ?, ?)
         returning id, expires_at`
      )
      .get(
        existing.user_id,
        sha256Hex(newRefreshToken),
        familyId,
        meta.userAgent ?? existing.user_agent,
        meta.ip ?? existing.ip,
        plusSeconds(REFRESH_TTL_SEC),
        existing.rotate_count + 1
      ) as { id: string; expires_at: string };

    db.prepare('update sessions set revoked_at = ?, replaced_by = ? where id = ?').run(
      nowIso(),
      row.id,
      existing.id
    );

    return {
      sessionId: row.id,
      familyId,
      refreshToken: newRefreshToken,
      accessToken: signAccessToken({ sub: existing.user_id, sid: row.id }),
      accessExpiresAt: plusSeconds(ACCESS_TOKEN_TTL_SEC),
      refreshExpiresAt: row.expires_at,
    };
  });

  return { ok: true, tokens: rotate(), reusedFrom: null };
}

/** Gắn access + refresh cookie. Refresh cookie bị giới hạn Path. */
export function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  res.append(
    'Set-Cookie',
    serializeCookie(ACCESS_COOKIE, tokens.accessToken, {
      path: '/',
      maxAgeSec: ACCESS_TOKEN_TTL_SEC,
      httpOnly: true,
      sameSite: 'Lax',
    })
  );
  res.append(
    'Set-Cookie',
    serializeCookie(REFRESH_COOKIE, tokens.refreshToken, {
      path: refreshCookiePath(),
      maxAgeSec: REFRESH_TTL_SEC,
      httpOnly: true,
      sameSite: 'Lax',
    })
  );
}

export function clearAuthCookies(res: Response): void {
  res.append(
    'Set-Cookie',
    clearCookie(ACCESS_COOKIE, { path: '/', httpOnly: true, sameSite: 'Lax' })
  );
  res.append(
    'Set-Cookie',
    clearCookie(REFRESH_COOKIE, {
      path: refreshCookiePath(),
      httpOnly: true,
      sameSite: 'Lax',
    })
  );
}
