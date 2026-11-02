/**
 * Xác thực request cron bằng shared secret.
 *
 * Nhận DUY NHẤT 1 trong 2:
 *   - header `x-cron-secret: <secret>`
 *   - `Authorization: Bearer <secret>`
 *
 * TỪ CHỐI TUYỆT ĐỐI:
 *   - `x-vercel-cron-signature` (header cũ, không còn dùng)
 *   - User-Agent bắt đầu bằng `vercel-cron`
 * → 401, kể cả khi các header đó đi kèm payload hợp lệ.
 */
import type { Request, Response, RequestHandler } from 'express';
import type { Db } from '../db/index';
import { getCronSecret, safeEqualString } from '../services/cronSecret';

const FORBIDDEN_HEADERS = ['x-vercel-cron-signature'] as const;

function unauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'unauthorized' });
}

export function requireCronSecret(db: Db): RequestHandler {
  return (req: Request, res: Response, next: () => void) => {
    for (const header of FORBIDDEN_HEADERS) {
      if (req.headers[header] !== undefined) return unauthorized(res);
    }

    const userAgent = String(req.headers['user-agent'] ?? '');
    if (userAgent.toLowerCase().startsWith('vercel-cron')) return unauthorized(res);

    let candidate = '';
    const headerSecret = req.headers['x-cron-secret'];
    if (typeof headerSecret === 'string' && headerSecret.length > 0) {
      candidate = headerSecret;
    } else {
      const authorization = req.headers.authorization;
      if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        candidate = authorization.slice('Bearer '.length).trim();
      }
    }

    if (candidate.length === 0) return unauthorized(res);

    const expected = getCronSecret(db);
    if (!safeEqualString(candidate, expected)) return unauthorized(res);

    next();
  };
}
