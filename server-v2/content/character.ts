import express, { Request, Response } from 'express'
import { getCharacterDetails, getTopCharacters } from './provider.js'
import type { CharacterGender } from './provider.js'

const router = express.Router()

type CacheItem = { data: any; expires: number }
const store = new Map<string, CacheItem>()
const TOP_TTL_MS = 12 * 60 * 60 * 1000

const VALID_GENDERS: CharacterGender[] = ['male', 'female', 'other', 'all']

/**
 * Top characters by AniList favourites, optionally filtered by gender.
 *
 * MUST stay registered above `/:id`. Express matches in order, so if this sits
 * below it then "top" is parsed as an :id param and every request 400s.
 */
router.get('/top', async (req: Request, res: Response) => {
  try {
    const genderParam = String(req.query.gender ?? 'all').toLowerCase()
    const gender = (
      VALID_GENDERS.includes(genderParam as CharacterGender) ? genderParam : 'all'
    ) as CharacterGender

    const limitRaw = Number.parseInt(String(req.query.limit ?? '50'), 10)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50

    const scanRaw = Number.parseInt(String(req.query.scan_pages ?? '4'), 10)
    const scanPages = Number.isFinite(scanRaw) ? Math.min(Math.max(scanRaw, 1), 10) : 4

    const key = `characters:top:${gender}:${limit}:${scanPages}`
    const hit = store.get(key)
    if (hit && hit.expires > Date.now()) {
      res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=604800')
      return res.json({ success: true, ...hit.data })
    }

    const result = await getTopCharacters({ gender, limit, scanPages })
    store.set(key, { data: result, expires: Date.now() + TOP_TTL_MS })

    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=604800')
    return res.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[character/top] failed:', error?.message ?? error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid character id' })
    }

    const data = await getCharacterDetails(id)

    if (!data) {
      return res.status(404).json({ success: false, error: 'Character not found' })
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=604800')
    return res.json({
      success: true,
      data,
    })
  } catch (error: any) {
    // Forward upstream "not found" as a 404 instead of 500 so the client can
    // render the proper "character not found" UI rather than a generic error.
    if (error?.status === 404 || /404/.test(error?.message ?? '')) {
      return res.status(404).json({ success: false, error: 'Character not found' })
    }
    console.error(`[character/:id] failed for ${req.params.id}:`, error?.message ?? error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
