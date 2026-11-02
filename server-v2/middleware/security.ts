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
 * Chỉ nhận request từ proxy đáng tin — dựa trên IP SOCKET, không phải header
 * (header `cf-connecting-ip` client tự gửi được → không dùng để quyết định).
 *
 * `TRUSTED_PROXIES` = "116.66.214.191,10.0.0.0/8" (IP hoặc CIDR, phẩy phân tách).
 * `ALLOW_DIRECT=1` để bỏ qua (dev local).
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export function ipMatches(remote: string, rule: string): boolean {
  const ip = remote.replace(/^::ffff:/, '');
  const trimmed = rule.trim();
  if (!trimmed) return false;

  const [base, bitsRaw] = trimmed.split('/');
  if (bitsRaw === undefined) return ip === (base ?? '');
  const bits = Number(bitsRaw);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base ?? '');
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function trustedProxies(): string[] {
  return (process.env.TRUSTED_PROXIES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isTrustedProxy(remoteAddress: string | undefined): boolean {
  const rules = trustedProxies();
  // Fail-closed: no allowlist means "no peer is a proxy" (dev override:
  // ALLOW_DIRECT=1). Keeping this in sync with resolveClientIp() matters - a
  // mismatch here is what re-opened the XFF bypass on 2026-11-02.
  if (process.env.ALLOW_DIRECT === '1') return true;
  if (rules.length === 0) return false;
  if (!remoteAddress) return false;
  return rules.some((rule) => ipMatches(remoteAddress, rule));
}

export function requireTrustedProxy(req: Request, res: Response, next: NextFunction): void {
  if (isTrustedProxy(req.socket.remoteAddress)) return next();
  res.status(403).json({ success: false, error: 'untrusted_proxy' });
}

/** @deprecated giữ để không vỡ config cũ; không còn là lớp bảo vệ thật. */
export function requireCloudflare(_req: Request, _res: Response, next: NextFunction): void {
  next();
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

/**
 * Client IP + HTTPS detection that does NOT trust `X-Forwarded-For`.
 *
 * Express's `trust proxy` walks the XFF chain, but Cloudflare Tunnel forwards a
 * client-supplied XFF unchanged, so a spoofed value becomes `req.ip` and every
 * rate-limit bucket can be dodged with one header. Instead:
 *
 *   peer in TRUSTED_PROXIES -> use `cf-connecting-ip` (Cloudflare overwrites it
 *                              at the edge; a direct client cannot influence it)
 *   peer not trusted        -> use the kernel socket address, ignore all headers
 *
 * `trust proxy` is therefore disabled in app.ts.
 */
declare module 'express-serve-static-core' {
  interface Request {
    clientIp?: string
    isHttps?: boolean
  }
}

export function resolveClientIp(req: Request, _res: Response, next: NextFunction): void {
  const peer = req.socket.remoteAddress ?? ''
  // Fail-closed: an empty allowlist means "no proxy is trusted", so headers are
  // never used to derive the client IP (dev override: ALLOW_DIRECT=1).
  const trusted =
    process.env.ALLOW_DIRECT === '1' || (trustedProxies().length > 0 && isTrustedProxy(peer))
  const cfIp = req.headers['cf-connecting-ip']

  if (trusted && typeof cfIp === 'string' && cfIp.trim()) {
    req.clientIp = cfIp.trim()
  } else {
    req.clientIp = peer.replace(/^::ffff:/, '') || 'unknown'
  }

  const proto = req.headers['x-forwarded-proto']
  const cfVisitor = req.headers['cf-visitor']
  const forwardedHttps =
    (typeof proto === 'string' && proto.split(',')[0]?.trim() === 'https') ||
    (typeof cfVisitor === 'string' && cfVisitor.includes('https'))
  // Only honour forwarding headers when the peer is a trusted proxy AND the
  // socket itself is not already TLS.
  req.isHttps = req.secure || (trusted && forwardedHttps)

  next()
}

/** Client IP resolved by `resolveClientIp` (falls back to Express's value). */
export function clientIpOf(req: Request): string {
  return req.clientIp ?? req.ip ?? 'unknown'
}

/** True when the request reached us over TLS (directly or via a trusted proxy). */
export function isHttpsRequest(req: Request): boolean {
  return req.isHttps === true
}
