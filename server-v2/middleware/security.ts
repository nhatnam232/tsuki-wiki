/**
 * Security headers + CORS whitelist + same-origin check cho route ghi.
 *
 * Ghi chú: repo chưa có `helmet`/`cors` trong server-v2 và Lead chưa duyệt cài
 * thêm dependency → 3 middleware nhỏ dưới đây thay thế phần cần thiết cho 1 API
 * JSON (không phục vụ HTML nên CSP/COEP ít ý nghĩa). Nếu sau này cần helmet
 * đầy đủ thì xin duyệt rồi thay.
 */
import type { Request, Response, NextFunction } from 'express';

/** Header an toàn cơ bản cho API JSON. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * CORS whitelist. Không set `Access-Control-Allow-Origin` nếu origin không nằm
 * trong `CORS_ORIGINS` (mặc định rỗng ⇒ chỉ same-origin).
 * `credentials: true` để cookie đi kèm — vì vậy TUYỆT ĐỐI không dùng `*`.
 */
export function corsWhitelist(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const list = allowedOrigins();

  if (origin && list.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With, X-CSRF-Token'
    );
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Chặn CSRF ở tầng đơn giản nhất: với request GHI có cookie, nếu trình duyệt
 * gửi `Origin`/`Referer` thì phải khớp whitelist (hoặc same-origin với Host).
 * Request không có Origin (curl, server-to-server, test) được đi tiếp —
 * chúng không mang cookie của nạn nhân nên không phải vector CSRF.
 *
 * Kết hợp với `SameSite=Lax` trên cookie: POST cross-site của trình duyệt sẽ
 * không gửi cookie → lớp thứ hai.
 */
/**
 * Chỉ cho traffic đi qua Cloudflare. Bật bằng REQUIRE_CF_HEADER=1.
 * Lý do: origin IP:port vẫn truy cập trực tiếp được; khi TRUST_PROXY=1 client
 * gửi X-Forwarded-For giả sẽ spoof được IP và né rate limit.
 */
export function requireCloudflare(req: Request, res: Response, next: NextFunction): void {
  if (process.env.REQUIRE_CF_HEADER !== '1') return next();
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) return next();
  res.status(403).json({ success: false, error: 'cloudflare_required' });
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  const list = allowedOrigins();

  const raw = origin ?? (referer ? safeOrigin(referer) : undefined);
  if (!raw) return next();

  if (list.includes(raw)) return next();

  // same-origin: scheme bất kỳ, so khớp host (gồm port)
  try {
    const parsed = new URL(raw);
    if (host && parsed.host === host) return next();
  } catch {
    /* origin hỏng → chặn */
  }

  res.status(403).json({ success: false, error: 'csrf_origin_rejected' });
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
