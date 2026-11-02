/**
 * Cookie serialize/parse tối giản (không cài `cookie`/`cookie-parser`).
 *
 * Mặc định `Secure` = true. Dev chạy http://localhost có thể set
 * `COOKIE_SECURE=false` để trình duyệt chịu gửi cookie; test thì tự gắn
 * header Cookie thủ công nên không phụ thuộc flag này.
 */
export interface CookieOptions {
  path?: string;
  maxAgeSec?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  domain?: string;
}

export function isSecureDefault(): boolean {
  return process.env.COOKIE_SECURE !== 'false';
}

/** Giá trị cookie hợp lệ: chỉ ASCII in, không dấu `;`, `,`, khoảng trắng. */
function assertCookieSafe(name: string, value: string): void {
  if (!/^[A-Za-z0-9_\-.]{1,64}$/.test(name)) throw new Error(`cookie name không hợp lệ: ${name}`);
  if (!/^[A-Za-z0-9\-._~%+/=]*$/.test(value)) throw new Error(`cookie value không hợp lệ cho ${name}`);
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieSafe(name, value);

  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSec))}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false && isSecureDefault()) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

/** Xoá cookie: value rỗng + Max-Age=0, PHẢI cùng Path với lúc set. */
export function clearCookie(name: string, options: CookieOptions = {}): string {
  return serializeCookie(name, '', { ...options, maxAgeSec: 0 });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const chunk of header.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq < 1) continue;
    const key = chunk.slice(0, eq).trim();
    const raw = chunk.slice(eq + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/** Đọc 1 cookie từ header `Cookie` của request (không cần middleware). */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return parseCookies(cookieHeader)[name];
}
