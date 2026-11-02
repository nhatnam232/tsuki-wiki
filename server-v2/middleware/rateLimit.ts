/**
 * Rate limit in-memory (sliding window) — KHÔNG cần Redis, KHÔNG cài dep.
 *
 * Phạm vi: 1 process. Nếu chạy nhiều instance sau này thì phải chuyển sang
 * Redis/Upstash; ghi rõ ở đây để không hiểu nhầm là limit toàn cụm.
 *
 * Key mặc định: `req.ip` (Express). CHỈ bật `TRUST_PROXY=1` khi app nằm sau
 * reverse proxy nằm trong allowlist của mình — nếu không client tự gửi
 * X-Forwarded-For sẽ spoof được IP và né rate limit.
 */
import type { Request, Response, RequestHandler } from 'express';

export interface RateLimitOptions {
  /** Tên bucket, dùng để tách bộ đếm giữa các route. */
  name: string;
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  /** Trả 429 hay chỉ log (mặc định 429). */
  enabled?: boolean;
}

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

function pruneAll(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

// Dọn định kỳ thay vì prune O(N) mỗi request; unref để không giữ process sống.
const sweeper = setInterval(() => pruneAll(Date.now(), 15 * 60 * 1000), 60_000);
sweeper.unref();

/** Xoá toàn bộ bộ đếm — chỉ dùng trong test. */
export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const keyGenerator = options.keyGenerator ?? ((req: Request) => req.ip ?? 'unknown');

  return (req: Request, res: Response, next: () => void) => {
    if (options.enabled === false) return next();

    const now = Date.now();
    const key = `${options.name}:${keyGenerator(req)}`;

    // Guard cứng trên hot path: KHÔNG prune O(N) (60k key → mỗi request quét hết).
    // Vượt trần thì clear rẻ (mất counter cũ — chấp nhận được, tránh DoS CPU);
    // sweeper 60s vẫn dọn các key hết hạn.
    if (buckets.size > MAX_KEYS) buckets.clear();

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    bucket.hits = bucket.hits.filter((t) => now - t < options.windowMs);

    if (bucket.hits.length >= options.max) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        success: false,
        error: 'rate_limited',
        message: 'Quá nhiều yêu cầu, thử lại sau',
        retryAfterSec,
      });
      return;
    }

    bucket.hits.push(now);
    next();
  };
}

/** Đọc số từ env, fallback khi thiếu/không hợp lệ. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
