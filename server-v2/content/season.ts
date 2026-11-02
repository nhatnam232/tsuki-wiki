import express, { Request, Response } from 'express'
import { getSeasonAnime } from './provider.js'

const store = new Map<string, { data: any; expires: number }>()

function getCache(key: string) {
  const item = store.get(key)
  if (!item || Date.now() > item.expires) return null
  return item.data
}

function setCache(key: string, data: any, ttlSeconds = 1800) {
  store.set(key, { data, expires: Date.now() + ttlSeconds * 1000 })
}

const router = express.Router()

const VALID_SEASONS = new Set(['winter', 'spring', 'summer', 'fall'])

router.get('/', async (req: Request, res: Response) => {
  try {
    const seasonRaw = String(req.query.season || '').toLowerCase()
    const yearRaw = Number.parseInt(req.query.year as string, 10)
    const limit = Number.parseInt(req.query.limit as string, 10) || 40
    const sort = (req.query.sort as string) || 'score'

    const now = new Date()
    const month = now.getMonth() + 1
    const defaultSeason =
      month <= 3 ? 'winter' : month <= 6 ? 'spring' : month <= 9 ? 'summer' : 'fall'

    const season = VALID_SEASONS.has(seasonRaw) ? seasonRaw : defaultSeason
    const year = Number.isFinite(yearRaw) && yearRaw > 1900 ? yearRaw : now.getFullYear()

    const key = `season:${season}:${year}:${sort}:${limit}`
    const cached = getCache(key)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
      return res.json({ success: true, ...cached })
    }

    const result = await getSeasonAnime({ season, year, sort, limit })
    setCache(key, result, 1800)
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400')
    return res.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[season] failed:', error?.message || error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
