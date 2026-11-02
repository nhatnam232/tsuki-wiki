/**
 * server-v2 — Express app.
 *
 * Phase 0 / Slice 1: health.
 * Phase 0 / Slice 2: auth (email+password, JWT cookie, refresh rotation, Google OAuth).
 *
 * Thứ tự middleware: security headers → CORS whitelist → JSON body → routes →
 * 404 JSON → error handler.
 */
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from './db/index';
import { basename } from 'node:path';
import { currentDbPath, getDb, isWalEnabled, ping } from './db/index';
import { createAuthRouter } from './auth/routes';
import { requireAuth, requireRole } from './middleware/requireAuth';
import { createAdminRouter } from './admin/routes';
import { mountContentRoutes } from './content/index';
import { createCoreRouter } from './routes/core';
import { createExtrasRouter } from './routes/extras';
import { createMediaRouter } from './media/routes';
import { createUploadRouter } from './media/upload';
import { corsWhitelist, requireSameOrigin, requireTrustedProxy, resolveClientIp, securityHeaders, trustedProxies } from './middleware/security';

export interface AppDeps {
  /** Cho phép test inject DB riêng (mặc định lấy singleton). */
  db?: Db;
  /** false → không kiểm tra DB (không dùng cho production). */
  checkDb?: boolean;
  /** Tắt rate limit cho auth (test cần nhiều request). */
  disableRateLimit?: boolean;
}

export function createApp(deps: AppDeps = {}): express.Express {
  const app = express();
  const checkDb = deps.checkDb !== false;
  const db = deps.db ?? getDb();

  app.disable('x-powered-by');
  // trust proxy: ưu tiên TRUSTED_PROXIES (IP/CIDR), giữ TRUST_PROXY=1 cho config cũ.
  const proxies = trustedProxies();
  // NEVER let Express parse X-Forwarded-For: Cloudflare Tunnel forwards a
  // client-supplied XFF unchanged, so trusting it lets anyone rotate rate-limit
  // buckets with one header. resolveClientIp() derives the client IP from the
  // socket peer + cf-connecting-ip instead.
  app.set('trust proxy', false);
  void proxies;

  app.use(securityHeaders);
  app.use(resolveClientIp);
  app.use(requireTrustedProxy);
  app.use(corsWhitelist);
  app.use(express.json({ limit: '100kb' }));

  // Health: 200 + {success:true, message:'ok', db:true} khi `select 1` chạy được.
  app.get('/api/health', (_req: Request, res: Response) => {
    if (!checkDb) {
      res.status(200).json({ success: true, message: 'ok', db: false });
      return;
    }
    try {
      const ok = ping(db);
      res.status(ok ? 200 : 503).json({ success: ok, message: ok ? 'ok' : 'db_unavailable', db: ok });
    } catch (err) {
      res.status(503).json({
        success: false,
        message: 'db_unavailable',
        db: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Health sâu (node/dbFile/uptime) → chỉ owner xem, không public.
  app.get('/api/health/deep', requireAuth(db), requireRole('owner'), (_req: Request, res: Response) => {
    try {
      const ok = ping(db);
      res.status(ok ? 200 : 503).json({
        success: ok,
        db: ok,
        wal: isWalEnabled(db),
        dbFile: basename(currentDbPath()),
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
      });
    } catch (err) {
      res.status(503).json({ success: false, db: false, error: String(err) });
    }
  });

  // Auth — CSRF same-origin guard đặt trước router cho mọi method ghi.
  app.use('/api/auth', requireSameOrigin, createAuthRouter(db, { disableRateLimit: deps.disableRateLimit }));

  // Admin — cron secret / badge mod+.
  app.use(
    '/api/admin',
    requireSameOrigin,
    createAdminRouter(db, { disableRateLimit: deps.disableRateLimit })
  );

  // Phase 1a — REST 8 bảng lõi + media tĩnh.
  app.use('/api', requireSameOrigin, createCoreRouter(db, { disableRateLimit: deps.disableRateLimit }));
  app.use('/api', requireSameOrigin, createExtrasRouter(db));
  // Upload phải mount TRƯỚC router static /media và cần auth.
  app.use('/api/media', requireSameOrigin, requireAuth(db), createUploadRouter());
  app.use('/media', createMediaRouter());

  // Content API (AniList/Jikan proxying, translation, wikipedia import).
  mountContentRoutes(app);

  // 404 JSON cho mọi path /api/* chưa mount.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'not_found' });
  });

  // Error handler JSON; không leak stack khi NODE_ENV=production.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // body-parser errors (payload too large, bad content-type) carry their own
    // status; without this they surfaced as 500 and clients could not tell an
    // oversized upload from a server bug.
    const status = Number((err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode
      ?? 500);
    const code = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    const body: Record<string, unknown> = {
      success: false,
      error: code === 413 ? 'payload_too_large' : code === 415 ? 'unsupported_media_type' : 'internal_error',
    };
    if (process.env.NODE_ENV !== 'production' && err instanceof Error) {
      body.detail = err.message;
      body.stack = err.stack;
    }
    res.status(code).json(body);
  });

  return app;
}
