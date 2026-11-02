/**
 * GET /api/schedule
 * Returns the airing schedule for the current week, grouped by ISO weekday.
 *
 * Implementation: queries AniList GraphQL `Page.airingSchedules` filtered by a
 * UNIX timestamp range covering this week (Mon → Sun in the user's locale).
 * Fold each entry up to its parent media so each anime appears once per
 * weekday with the earliest airing time.
 */

import express, { Request, Response } from 'express'

const router = express.Router()
const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

const cache = new Map<string, { data: any; expires: number }>()

function getCache(key: string) {
  const item = cache.get(key)
  if (!item || Date.now() > item.expires) return null
  return item.data
}
function setCache(key: string, data: any, ttlSeconds = 1800) {
  cache.set(key, { data, expires: Date.now() + ttlSeconds * 1000 })
}

const QUERY = `
  query ($start: Int, $end: Int, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: [TIME]) {
        airingAt
        episode
        media {
          id
          idMal
          title { romaji english native }
          coverImage { large extraLarge }
          format
          status
          episodes
          averageScore
          isAdult
          season
          seasonYear
          studios(isMain: true) { nodes { name } }
        }
      }
    }
  }
`

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

router.get('/', async (req: Request, res: Response) => {
  try {
    // Build the time window for "this week".
    // Default = upcoming 7 days starting from now.
    const now = Math.floor(Date.now() / 1000)
    const sevenDays = 7 * 24 * 60 * 60

    const startQ = Number.parseInt(req.query.start as string, 10)
    const endQ = Number.parseInt(req.query.end as string, 10)

    const start = Number.isFinite(startQ) ? startQ : now - 24 * 60 * 60
    const end = Number.isFinite(endQ) ? endQ : start + sevenDays + 24 * 60 * 60

    const cacheKey = `schedule:${start}:${end}`
    const cached = getCache(cacheKey)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
      return res.json({ success: true, data: cached })
    }

    // Pull up to 3 pages (~150 entries) — enough for a week of releases.
    const all: any[] = []
    for (let page = 1; page <= 3; page++) {
      const r = await fetch(ANILIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { start, end, page, perPage: 50 } }),
      })
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`AniList ${r.status}: ${txt.slice(0, 200)}`)
      }
      const json: any = await r.json()
      const schedules = json?.data?.Page?.airingSchedules ?? []
      all.push(...schedules)
      if (!json?.data?.Page?.pageInfo?.hasNextPage) break
    }

    // De-dup by media.id, keeping the earliest airing entry, and shape for client.
    const map = new Map<number, any>()
    for (const s of all) {
      const m = s.media
      if (!m) continue
      const existing = map.get(m.id)
      if (existing && existing.airingAt <= s.airingAt) continue
      const date = new Date(s.airingAt * 1000)
      const studio = m.studios?.nodes?.[0]?.name ?? 'Unknown'
      map.set(m.id, {
        id: m.id,
        mal_id: m.idMal ?? null,
        title: m.title?.english || m.title?.romaji || m.title?.native || 'Unknown',
        cover_image: m.coverImage?.extraLarge || m.coverImage?.large || '',
        airingAt: s.airingAt,
        episode: s.episode,
        broadcast_day: DAYS[date.getUTCDay()],
        broadcast_time: date.toISOString().slice(11, 16),
        episodes: m.episodes ?? null,
        status:
          m.status === 'RELEASING'
            ? 'Ongoing'
            : m.status === 'NOT_YET_RELEASED'
              ? 'Upcoming'
              : m.status === 'FINISHED'
                ? 'Finished'
                : m.status ?? 'Unknown',
        studio_name: studio,
        score: typeof m.averageScore === 'number' ? m.averageScore / 10 : null,
        season:
          m.season && m.seasonYear
            ? `${m.season.charAt(0) + m.season.slice(1).toLowerCase()} ${m.seasonYear}`
            : null,
        format: m.format,
        isAdult: !!m.isAdult,
      })
    }

    const data = Array.from(map.values()).sort((a, b) => a.airingAt - b.airingAt)
    setCache(cacheKey, data, 900)
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600')
    return res.json({ success: true, data })
  } catch (error: any) {
    console.error('[schedule] failed:', error?.message || error)
    return res.status(500).json({ success: false, error: error.message })
  }
})

export default router
