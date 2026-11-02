/**
 * Admin routes (Phase 0 bổ sung) — thay các RPC SECURITY DEFINER của Supabase.
 *
 *   GET  /api/admin/rotate-password   cron: rotate mật khẩu admin trong ngày
 *   POST /api/admin/rotate-password   (cùng handler — task-6 yêu cầu cả 2 verb)
 *   POST /api/admin/verify-password   user có badge mod+ : verify mật khẩu ngày
 *
 * Bảo vệ: rotate-password chỉ bằng cron secret (x-cron-secret / Bearer).
 *         verify-password bằng session user + badge mod/admin/owner.
 * Mật khẩu sinh bằng CSPRNG (`crypto.randomBytes`), hash scrypt, lưu `admin_passwords`.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db/index';
import { hashPassword, verifyPassword } from '../crypto/password';
import { nowIso, todayIso } from '../lib/time';
import { requireAuth, requireRole } from '../middleware/requireAuth';
import { requireCronSecret } from '../middleware/requireCronSecret';
import { envInt, rateLimit } from '../middleware/rateLimit';
import { notifyDiscord } from '../services/webhook';
import { getCronSecret } from '../services/cronSecret';

export interface AdminRouterOptions {
  disableRateLimit?: boolean;
}

const PASSWORD_BYTES = 16; // 128 bit → 22 ký tự base64url
const RETENTION_DAYS = 7;

function audit(
  db: Db,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    ip?: string | null;
    userAgent?: string | null;
  }
): void {
  db.prepare(
    `insert into audit_logs (actor_id, action, target_type, target_id, reason, ip, user_agent)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.actorId,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.reason,
    entry.ip ?? null,
    entry.userAgent ?? null
  );
}

export function createAdminRouter(db: Db, options: AdminRouterOptions = {}): Router {
  const router = express.Router();
  const rateDisabled = options.disableRateLimit === true;

  const rotateHandler = (req: Request, res: Response): void => {
    void (async () => {
      const password = (await import('node:crypto')).randomBytes(PASSWORD_BYTES).toString('base64url');
      const passwordHash = await hashPassword(password);
      const today = todayIso();

      db.transaction(() => {
        db.prepare(
          `insert into admin_passwords (password_hash, valid_for_date, created_at)
           values (?, ?, ?)
           on conflict (valid_for_date) do update
             set password_hash = excluded.password_hash, created_at = excluded.created_at`
        ).run(passwordHash, today, nowIso());

        db.prepare(
          "delete from admin_passwords where valid_for_date < date('now', ?)"
        ).run(`-${RETENTION_DAYS} days`);

        audit(db, {
          actorId: null,
          action: 'login',
          targetType: 'admin_password_rotate',
          targetId: today,
          reason: 'cron',
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });
      })();

      // Có webhook → gửi Discord, KHÔNG trả plaintext qua HTTP.
      // Không có webhook → trả plaintext nhưng cảnh báo chỉ dùng qua TLS.
      // Cả 2 nhánh đều KHÔNG log plaintext.
      const webhookConfigured = Boolean(process.env.ADMIN_PASSWORD_WEBHOOK);
      const webhookSent = webhookConfigured
        ? await notifyDiscord(`Admin password ${today} rotated`, `Mật khẩu mới: ||${password}||`)
        : false;

      const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
      if (!webhookConfigured && !isHttps) {
        // Không có webhook + HTTP: plaintext bay qua mạng → từ chối, không trả password.
        res.status(409).json({ success: false, error: 'tls_required_for_plaintext', rotated: true, validForDate: today });
        return;
      }

      if (webhookConfigured) {
        res.status(200).json({ success: true, validForDate: today, rotated: true, webhook_sent: webhookSent });
        return;
      }
      res.status(200).json({
        success: true, validForDate: today, rotated: true, password,
        warning: 'plaintext_over_tls_only',
      });
    })().catch(() => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'rotate_failed' });
    });
  };

  // Rate limit theo IP cho cả GET+POST (chống dò cron secret / rotate flood).
  const rotateLimiter = rateLimit({
    name: 'admin:rotate',
    windowMs: envInt('ADMIN_ROTATE_WINDOW_MS', 60_000),
    max: envInt('ADMIN_ROTATE_MAX', 10),
    keyGenerator: (req) => req.ip ?? 'unknown',
    enabled: !rateDisabled,
  });

  router.get('/rotate-password', rotateLimiter, requireCronSecret(db), rotateHandler);
  router.post('/rotate-password', rotateLimiter, requireCronSecret(db), rotateHandler);

  router.post(
    '/verify-password',
    // 1) xác thực trước → 401 nếu chưa đăng nhập
    requireAuth(db),
    // 2) rate limit THEO USER (5/phút) — sau requireAuth để có req.auth.userId
    rateLimit({
      name: 'admin:verify-password',
      windowMs: envInt('ADMIN_VERIFY_WINDOW_MS', 60 * 1000),
      max: envInt('ADMIN_VERIFY_MAX', 5),
      keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'unknown',
      enabled: !rateDisabled,
    }),
    // 3) 403 nếu không đủ badge mod+
    requireRole('mod'),
    (req: Request, res: Response) => {
      void (async () => {
        const auth = req.auth;
        if (!auth) {
          res.status(401).json({ success: false, error: 'unauthorized' });
          return;
        }

        const body = (req.body ?? {}) as { password?: unknown };
        const candidate = typeof body.password === 'string' ? body.password : '';
        const today = todayIso();

        const row = db
          .prepare('select password_hash from admin_passwords where valid_for_date = ?')
          .get(today) as { password_hash: string } | undefined;

        const valid = candidate.length > 0 && row ? await verifyPassword(candidate, row.password_hash) : false;

        audit(db, {
          actorId: auth.userId,
          action: 'login',
          targetType: 'admin_password',
          targetId: today,
          reason: valid ? 'success' : 'failed',
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });

        if (!valid) {
          res.status(401).json({ success: false, error: 'invalid_password' });
          return;
        }
        res.status(200).json({ success: true, valid: true, validForDate: today });
      })().catch(() => {
        if (!res.headersSent) res.status(500).json({ success: false, error: 'verify_failed' });
      });
    }
  );

  // Operator lấy cron secret đang dùng (thay vì mở SQLite CLI).
  // requireRole('owner') là hierarchical nhưng chỉ owner badge thoả.
  router.get('/cron-secret', requireAuth(db), requireRole('owner'), (req: Request, res: Response) => {
    const secret = getCronSecret(db);
    audit(db, {
      actorId: req.auth?.userId ?? null,
      action: 'cron_secret_read',
      targetType: 'system_secrets',
      targetId: 'cron_secret',
      reason: process.env.CRON_SECRET ? 'env' : 'db',
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(200).json({ success: true, source: process.env.CRON_SECRET ? 'env' : 'db', secret });
  });

  return router;
}
