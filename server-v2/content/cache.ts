/**
 * Tiered cache helper for the Anime Wiki API.
 *
 * Layer 1: Per-process Map (instant; lost on cold start of Vercel function).
 * Layer 2: Upstash Redis (shared across cold starts + regions, optional).
 *
 * Falls back gracefully when env vars are missing — local dev still works
 * without any Redis instance.
 *
 * Usage:
 *   const data = await cacheGet<MyShape>('key', { ttl: 600 }, async () => {
 *     return fetch(...).then(r => r.json())
 *   })
 */

type RedisLike = {
  get: (key: string) => Promise<string | null>
  set: (
    key: string,
    value: string,
    opts?: { ex?: number },
  ) => Promise<unknown>
  del: (key: string) => Promise<unknown>
}

let redis: RedisLike | null = null

async function loadRedis(): Promise<RedisLike | null> {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    const mod = await import('@upstash/redis')
    redis = new mod.Redis({ url, token }) as unknown as RedisLike
    return redis
  } catch (err) {
    console.warn('[cache] Failed to init Upstash Redis:', (err as Error).message)
    return null
  }
}

// In-memory layer for hot reads inside a single function instance.
type MemEntry = { value: unknown; expiresAt: number }
const mem = new Map<string, MemEntry>()

type Options = {
  /** seconds */
  ttl?: number
  /** namespace prefix to avoid key collisions across deployments */
  prefix?: string
}

const DEFAULT_TTL_S = 600

function nsKey(key: string, prefix?: string) {
  return prefix ? `${prefix}:${key}` : key
}

/**
 * Read from cache or call `loader()` to populate it. The loader return value
 * is cached for `ttl` seconds (default 10 minutes).
 */
export async function cacheGet<T>(
  key: string,
  options: Options,
  loader: () => Promise<T>,
): Promise<T> {
  const fullKey = nsKey(key, options.prefix)
  const ttl = options.ttl ?? DEFAULT_TTL_S
  const now = Date.now()

  // L1
  const memHit = mem.get(fullKey)
  if (memHit && memHit.expiresAt > now) return memHit.value as T

  // L2
  const r = await loadRedis()
  if (r) {
    try {
      const raw = await r.get(fullKey)
      if (raw) {
        const value = JSON.parse(raw) as T
        // Re-warm L1 with the remaining (best-effort) TTL.
        mem.set(fullKey, { value, expiresAt: now + ttl * 1000 })
        return value
      }
    } catch (err) {
      console.warn(`[cache] Redis GET failed for ${fullKey}:`, (err as Error).message)
    }
  }

  // Miss — load fresh value.
  const fresh = await loader()
  const expiresAt = now + ttl * 1000
  mem.set(fullKey, { value: fresh, expiresAt })
  if (r) {
    try {
      await r.set(fullKey, JSON.stringify(fresh), { ex: ttl })
    } catch (err) {
      console.warn(`[cache] Redis SET failed for ${fullKey}:`, (err as Error).message)
    }
  }
  return fresh
}

/** Invalidate a key in both layers. */
export async function cacheDel(key: string, prefix?: string): Promise<void> {
  const fullKey = nsKey(key, prefix)
  mem.delete(fullKey)
  const r = await loadRedis()
  if (r) {
    try {
      await r.del(fullKey)
    } catch {
      /* ignore */
    }
  }
}

/** True when at least one cache backend is configured. */
export function isCacheConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}
