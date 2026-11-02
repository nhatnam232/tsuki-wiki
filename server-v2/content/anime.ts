import express, { Request, Response } from 'express'
import { getAnimeDetails, getAnimeList, getFeaturedAnime, rotationSeed } from './provider.js'
import type { RotationPeriod } from './provider.js'

type CacheItem = { data: any; expires: number; staleUntil: number }
const store = new Map<string, CacheItem>()
// How long a stale entry is still OK to serve while we refresh in the background.
const STALE_SECONDS = 24 * 60 * 60

function getCache(key: string): { data: any; stale: boolean } | null {
  const item = store.get(key)
  if (!item) return null
  const now = Date.now()
  if (now < item.expires) return { data: item.data, stale: false }
  if (now < item.staleUntil) return { data: item.data, stale: true }
  return null
}

function setCache(key: string, data: any, ttlSeconds = 600) {
  const now = Date.now()
  store.set(key, {
    data,
    expires: now + ttlSeconds * 1000,
    staleUntil: now + (ttlSeconds + STALE_SECONDS) * 1000,
  })
}

const refreshing = new Set<string>()
function refreshInBackground(key: string, ttlSeconds: number, loader: () => Promise<any>) {
  if (refreshing.has(key)) return
  refreshing.add(key)
  loader()
    .then((fresh) => {
      if (fresh !== undefined && fresh !== null) setCache(key, fresh, ttlSeconds)
    })
    .catch(() => {
      /* keep stale cache in place */
    })
    .finally(() => refreshing.delete(key))
}

const router = express.Router()

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Number.parseInt(req.query.page as string, 10) || 1
    const limit = Number.parseInt(req.query.limit as string, 10) || 20
    const minScore = Number.parseFloat(req.query.min_score as string)
    const maxScore = Number.parseFloat(req.query.max_score as string)

    const key = `anime:${JSON.stringify(req.query)}`
    const load = () =>
      getAnimeList({
        page,
        limit,
        genre: req.query.genre as string,
        status: req.query.status as string,
        sort: req.query.sort as string,
        min_score: Number.isNaN(minScore) ? undefined : minScore,
        max_score: Number.isNaN(maxScore) ? undefined : maxScore,
      })

    const cached = getCache(key)
    if (cached) {
      if (cached.stale) refreshInBackground(key, 1800, load)
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
      return res.json({ success: true, ...cached.data })
    }

    const result = await load()
    setCache(key, result, 1800)
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
    return res.json({ success: true, ...result })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

/**
 * Rotating spotlight.
 *
 * The cache key embeds the rotation bucket (day or week number). Without it
 * the cached payload and the shuffle seed would fall out of step and the hero
 * would keep serving yesterday's picks for up to an hour past midnight.
 */
router.get('/featured', async (req: Request, res: Response) => {
  try {
    const period: RotationPeriod = req.query.period === 'weekly' ? 'weekly' : 'daily'
    const key = `featured:${period}:${rotationSeed(period)}`
    const load = () => getFeaturedAnime(5, period)

    const cached = getCache(key)
    if (cached) {
      if (cached.stale) refreshInBackground(key, 3600, load)
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
      return res.json({ success: true, data: cached.data })
    }

    const data = await load()
    setCache(key, data, 3600)
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.json({ success: true, data })
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10)

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid anime id' })
    }

    const key = `anime:${id}`
    const load = () => getAnimeDetails(id)
    const cached = getCache(key)
    if (cached) {
      if (cached.stale) refreshInBackground(key, 21600, load)
      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800')
      return res.json({ success: true, data: cached.data })
    }

    const data = await load()

    if (!data) {
      return res.status(404).json({ success: false, error: 'Anime not found' })
    }

    setCache(key, data, 21600)
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800')
    return res.json({ success: true, data })
  } catch (error: any) {
    console.error(`[anime/:id] failed for ${req.params.id}:`, error?.message || error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
