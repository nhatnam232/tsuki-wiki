/**
 * AniList extras — rotating spotlight + character leaderboards.
 *
 * Kept separate from `anilist.ts` so the core read path (list / detail /
 * search / season) stays untouched. Owns a small private gql+cache helper
 * instead of exporting internals from `anilist.ts`.
 *
 * The mapping helpers below are deliberately duplicated from `anilist.ts` and
 * must stay shape-compatible: the frontend hero consumes the same object
 * shape from both modules. Add a field to `mapMedia` there, mirror it here.
 */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co'

// The trending pool is cheap to keep warm for an hour; the *selection* out of
// that pool is what rotates daily, so a short TTL here is fine.
const FEATURED_TTL_MS = 60 * 60 * 1000
const CHARACTER_TTL_MS = 12 * 60 * 60 * 1000

// Bigger pool = more day-to-day variety, but the trending tail gets obscure
// past ~50.
const FEATURED_POOL_SIZE = 40

// AniList caps perPage at 50, so each scan page costs exactly one request.
const CHARACTER_PAGE_SIZE = 50
const CHARACTER_SCAN_PAGES = 4

type CacheEntry = { expiresAt: number; value: unknown }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  ttlMs: number,
): Promise<T> {
  const key = JSON.stringify({ query, variables })
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value as T

  // Collapse concurrent identical requests into a single upstream call.
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const p = (async () => {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
      // Expired data beats an error page.
      if (hit) return hit.value as T
      throw new Error(`AniList request failed with ${response.status}`)
    }

    const json = (await response.json()) as {
      data?: T
      errors?: Array<{ message: string }>
    }

    if (json.errors?.length) {
      if (hit) return hit.value as T
      throw new Error(json.errors.map((e) => e.message).join('; '))
    }

    const fresh = json.data as T
    cache.set(key, { expiresAt: Date.now() + ttlMs, value: fresh })
    return fresh
  })()

  inflight.set(key, p)
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export type RotationPeriod = 'daily' | 'weekly'

// Vercel runs on UTC. Without this offset the spotlight would flip at 07:00
// Vietnam time instead of midnight, which reads as a bug to actual users.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000

/**
 * Stable integer that changes once per rotation window: days since epoch for
 * 'daily', weeks since epoch for 'weekly'. Used as both the shuffle seed and
 * part of the cache key, so the two can never disagree.
 */
export function rotationSeed(period: RotationPeriod = 'daily', now = Date.now()): number {
  const days = Math.floor((now + VN_OFFSET_MS) / 86_400_000)
  return period === 'weekly' ? Math.floor(days / 7) : days
}

/** mulberry32 — small, fast, well-distributed seeded PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic sample. Same seed always yields the same picks, so every
 * visitor sees an identical spotlight all day and the CDN can cache it. No
 * randomness at request time.
 */
function seededPick<T>(items: T[], count: number, seed: number): T[] {
  const pool = [...items]
  const rand = mulberry32(seed)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

// ---------------------------------------------------------------------------
// Mapping helpers (mirror of anilist.ts — keep in sync)
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  RELEASING: 'Ongoing',
  FINISHED: 'Finished',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'Hiatus',
}

const SEASON_MAP: Record<string, string> = {
  WINTER: 'Winter',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

function pickTitle(title: any) {
  return title?.english || title?.romaji || title?.userPreferred || title?.native || 'Unknown Title'
}

function mapMedia(media: any) {
  if (!media) return null

  const studio = (media.studios?.nodes ?? [])[0] || (media.studios?.edges?.[0]?.node ?? null)
  const score = typeof media.averageScore === 'number' ? media.averageScore / 10 : 0
  const seasonStr =
    media.season && media.seasonYear
      ? `${SEASON_MAP[media.season] || media.season} ${media.seasonYear}`
      : media.startDate?.year
        ? String(media.startDate.year)
        : 'Unknown'

  return {
    id: media.id,
    mal_id: media.idMal ?? null,
    title: pickTitle(media.title),
    title_jp: media.title?.native || '',
    cover_image:
      media.coverImage?.extraLarge ||
      media.coverImage?.large ||
      media.coverImage?.medium ||
      '',
    banner_image: media.bannerImage || media.coverImage?.extraLarge || '',
    score,
    episodes: media.episodes ?? 0,
    status: STATUS_MAP[media.status] || media.status || 'Unknown',
    season: seasonStr,
    synopsis: (media.description || '').replace(/<[^>]+>/g, '').trim() || 'Synopsis unavailable.',
    studio_id: studio?.id ?? null,
    studio_name: studio?.name || 'Unknown',
    created_year: media.startDate?.year ?? media.seasonYear ?? null,
    genres: media.genres ?? [],
    popularity: media.popularity ?? null,
    members: media.popularity ?? 0,
    type: media.format || 'Unknown',
    rating: media.isAdult ? 'R+' : 'PG-13',
    source: media.source || 'Unknown',
    // Spotlight-only extra: lets the UI badge *why* this is here today.
    trending: media.trending ?? null,
  }
}

const MEDIA_FRAGMENT = `
  id
  idMal
  title { romaji english native userPreferred }
  coverImage { large extraLarge medium }
  bannerImage
  averageScore
  popularity
  trending
  episodes
  status
  format
  source
  isAdult
  season
  seasonYear
  startDate { year month day }
  endDate { year month day }
  genres
  description(asHtml: false)
  studios(isMain: true) { nodes { id name } }
`

// ---------------------------------------------------------------------------
// Spotlight
// ---------------------------------------------------------------------------

/**
 * Rotating "hot right now" spotlight.
 *
 * Replaces the old all-time SCORE_DESC top 5, which never changed and
 * duplicated the score grid rendered directly beneath the hero.
 */
export async function getFeaturedAnime(limit = 5, period: RotationPeriod = 'daily') {
  const query = `
    query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, sort: [TRENDING_DESC], isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `

  const data = await gql<any>(query, { perPage: FEATURED_POOL_SIZE }, FEATURED_TTL_MS)
  const pool = (data?.Page?.media ?? []).map(mapMedia).filter(Boolean) as any[]
  if (pool.length === 0) return []

  // A hero slide with no wide banner looks broken, so prefer entries that have
  // real artwork — but never starve the carousel over it.
  const withBanner = pool.filter((m) => Boolean(m.banner_image))
  const source = withBanner.length >= limit ? withBanner : pool

  return seededPick(source, Math.min(limit, source.length), rotationSeed(period))
}

// ---------------------------------------------------------------------------
// Character leaderboard
// ---------------------------------------------------------------------------

export type CharacterGender = 'male' | 'female' | 'other' | 'all'

const CHARACTER_FRAGMENT = `
  id
  name { full native }
  image { large medium }
  favourites
  gender
  age
  media(perPage: 5, sort: [POPULARITY_DESC]) {
    nodes {
      id
      type
      title { romaji english native userPreferred }
      coverImage { large extraLarge }
    }
  }
`

/**
 * AniList `gender` is a free-text string. In practice it is almost always
 * Male / Female, but it can be anything ("Non-binary", "Unknown", null), so
 * everything unrecognised is bucketed as 'other' rather than guessed.
 */
function normalizeGender(raw: unknown): 'male' | 'female' | 'other' {
  const g = String(raw ?? '').trim().toLowerCase()
  if (g === 'male') return 'male'
  if (g === 'female') return 'female'
  return 'other'
}

function mapCharacterSummary(c: any) {
  // Characters are attached to manga too; the card links to an anime page, so
  // pick the most popular ANIME appearance and skip the rest.
  const anime = (c.media?.nodes ?? []).find((n: any) => n?.type === 'ANIME') ?? null

  return {
    id: c.id,
    name: c.name?.full || 'Unknown',
    name_native: c.name?.native || '',
    image: c.image?.large || c.image?.medium || '',
    favorites: c.favourites ?? 0,
    gender: normalizeGender(c.gender),
    gender_raw: c.gender || null,
    age: c.age || null,
    from_anime: anime
      ? {
          id: anime.id,
          title: pickTitle(anime.title),
          cover_image: anime.coverImage?.extraLarge || anime.coverImage?.large || '',
        }
      : null,
  }
}

/**
 * Top characters ranked by AniList favourites, optionally split by gender.
 *
 * AniList exposes no gender argument on the character query, so there is no
 * way to ask for "top females" directly. Instead we scan the first N pages of
 * the global FAVOURITES_DESC list and bucket client-side. With the default
 * 4 pages we look at 200 characters, which comfortably yields 50+ of each of
 * the two main buckets.
 *
 * Note this ranks by popularity only — AniList publishes no appearance or
 * rating metric for characters, and neither does any other public anime API.
 */
export async function getTopCharacters(
  params: { gender?: CharacterGender; limit?: number; scanPages?: number } = {},
) {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100)
  const scanPages = Math.min(Math.max(params.scanPages ?? CHARACTER_SCAN_PAGES, 1), 10)
  const wanted: CharacterGender = params.gender ?? 'all'

  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { currentPage hasNextPage }
        characters(sort: [FAVOURITES_DESC]) {
          ${CHARACTER_FRAGMENT}
        }
      }
    }
  `

  // Pages are independent, so fetch them together. Worst case this is 10
  // requests against a ~90/min budget, and results are cached for 12h.
  const pages = await Promise.all(
    Array.from({ length: scanPages }, (_, i) =>
      gql<any>(query, { page: i + 1, perPage: CHARACTER_PAGE_SIZE }, CHARACTER_TTL_MS).catch(
        () => null,
      ),
    ),
  )

  const seen = new Set<number>()
  const all = pages
    .flatMap((p) => p?.Page?.characters ?? [])
    .filter((c: any) => {
      // Page boundaries can shift between requests and repeat an entry.
      if (!c?.id || seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
    .map(mapCharacterSummary)
    .sort((a, b) => b.favorites - a.favorites)

  const filtered = wanted === 'all' ? all : all.filter((c) => c.gender === wanted)

  return {
    data: filtered.slice(0, limit).map((c, idx) => ({ ...c, rank: idx + 1 })),
    gender: wanted,
    total: filtered.length,
    scanned: all.length,
  }
}
