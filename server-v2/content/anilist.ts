/**
 * AniList GraphQL adapter — sole upstream data source for Anime Wiki.
 *
 * Migration notes (replaces Jikan/MyAnimeList):
 *   - Public IDs we hand to the frontend are now AniList IDs (anime,
 *     character, studio). They are stable, GraphQL-only, and never 404 once
 *     created.
 *   - One GraphQL round-trip fetches anime + characters + recommendations +
 *     relations + statistics, dramatically faster than the previous 4 REST
 *     calls to Jikan.
 *   - In-memory cache + stale-while-revalidate keeps cold requests fast.
 */

const ANILIST_ENDPOINT = 'https://graphql.anilist.co'
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000
const DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const STALE_WHILE_REVALIDATE_MS = 24 * 60 * 60 * 1000

type CacheEntry = { expiresAt: number; staleUntil: number; value: unknown }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  ttlMs = DEFAULT_CACHE_TTL_MS,
  retries = 2,
): Promise<T> {
  const key = JSON.stringify({ query, variables })
  const now = Date.now()
  const cached = cache.get(key)

  if (cached) {
    if (cached.expiresAt > now) return cached.value as T
    if (cached.staleUntil > now) {
      if (!inflight.has(key)) {
        const refresh = gql<T>(query, variables, ttlMs, retries).catch(() => undefined)
        inflight.set(key, refresh as Promise<unknown>)
        refresh.finally(() => {
          if (inflight.get(key) === (refresh as Promise<unknown>)) inflight.delete(key)
        })
      }
      return cached.value as T
    }
  }

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

    if (response.status === 429 && retries > 0) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '1')
      await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000)
      inflight.delete(key)
      return gql<T>(query, variables, ttlMs, retries - 1)
    }

    if (response.status === 404) {
      const err = new Error('Resource not found') as Error & { status?: number }
      err.status = 404
      throw err
    }

    if (!response.ok) {
      if (cached?.value) return cached.value as T
      const text = await response.text()
      throw new Error(text || `AniList request failed with ${response.status}`)
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string; status?: number }> }
    if (json.errors?.length) {
      // AniList returns 200 + errors[] when an entity isn't found
      const notFound = json.errors.some((e) => /not.?found/i.test(e.message) || e.status === 404)
      if (notFound) {
        const err = new Error(json.errors[0].message) as Error & { status?: number }
        err.status = 404
        throw err
      }
      if (cached?.value) return cached.value as T
      throw new Error(json.errors.map((e) => e.message).join('; '))
    }

    const fresh = json.data as T
    const freshUntil = Date.now() + ttlMs
    cache.set(key, {
      expiresAt: freshUntil,
      staleUntil: freshUntil + STALE_WHILE_REVALIDATE_MS,
      value: fresh,
    })
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
// Mapping helpers
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
    // Public ID is now the AniList media ID (stable, never 404 once created).
    id: media.id,
    mal_id: media.idMal ?? null, // kept for external link to MAL only
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
  }
}

function mapPagination(payload: any, fallbackLimit: number) {
  const info = payload?.pageInfo
  return {
    total: info?.total ?? 0,
    page: info?.currentPage ?? 1,
    limit: info?.perPage ?? fallbackLimit,
    has_next_page: Boolean(info?.hasNextPage),
    last_visible_page: info?.lastPage ?? 1,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MEDIA_FRAGMENT = `
  id
  idMal
  title { romaji english native userPreferred }
  coverImage { large extraLarge medium }
  bannerImage
  averageScore
  popularity
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

export async function getAnimeList(params: {
  page?: number
  limit?: number
  genre?: string
  status?: string
  sort?: string
  min_score?: number
  max_score?: number
}) {
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 50)

  let sort: string[] = ['SCORE_DESC']
  if (params.sort === 'popularity') sort = ['POPULARITY_DESC']
  else if (params.sort === 'newest') sort = ['START_DATE_DESC']

  const status =
    params.status?.toLowerCase() === 'airing'
      ? 'RELEASING'
      : params.status?.toLowerCase() === 'finished' || params.status?.toLowerCase() === 'complete'
        ? 'FINISHED'
        : params.status?.toLowerCase() === 'upcoming'
          ? 'NOT_YET_RELEASED'
          : undefined

  const variables: Record<string, unknown> = { page, perPage: limit, sort, isAdult: false }
  if (params.genre && params.genre !== 'All') variables.genre = params.genre
  if (status) variables.status = status
  if (typeof params.min_score === 'number') variables.minScore = Math.round(params.min_score * 10)
  if (typeof params.max_score === 'number') variables.maxScore = Math.round(params.max_score * 10)

  const query = `
    query ($page: Int, $perPage: Int, $sort: [MediaSort], $isAdult: Boolean,
           $genre: String, $status: MediaStatus, $minScore: Int, $maxScore: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: $sort, isAdult: $isAdult,
              genre: $genre, status: $status,
              averageScore_greater: $minScore, averageScore_lesser: $maxScore) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `

  const data = await gql<any>(query, variables, DEFAULT_CACHE_TTL_MS)
  const page1 = data?.Page
  return {
    data: (page1?.media ?? []).map(mapMedia).filter(Boolean),
    ...mapPagination(page1, limit),
  }
}

export async function getFeaturedAnime(limit = 5) {
  const query = `
    query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, sort: [SCORE_DESC], isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `
  const data = await gql<any>(query, { perPage: limit }, DEFAULT_CACHE_TTL_MS)
  return (data?.Page?.media ?? []).map(mapMedia).filter(Boolean)
}

export async function searchAnime(params: {
  q?: string
  genre?: string
  status?: string
  min_score?: number
  max_score?: number
  sort?: string
  page?: number
  limit?: number
}) {
  const page = params.page ?? 1
  const limit = Math.min(params.limit ?? 20, 50)

  let sort: string[] = ['SCORE_DESC']
  if (params.sort === 'popularity') sort = ['POPULARITY_DESC']
  else if (params.sort === 'newest') sort = ['START_DATE_DESC']

  const status =
    params.status?.toLowerCase() === 'airing'
      ? 'RELEASING'
      : params.status?.toLowerCase() === 'finished' || params.status?.toLowerCase() === 'complete'
        ? 'FINISHED'
        : params.status?.toLowerCase() === 'upcoming'
          ? 'NOT_YET_RELEASED'
          : undefined

  const variables: Record<string, unknown> = { page, perPage: limit, sort, isAdult: false }
  if (params.q?.trim()) variables.search = params.q.trim()
  if (params.genre && params.genre !== 'All') variables.genre = params.genre
  if (status) variables.status = status
  if (typeof params.min_score === 'number') variables.minScore = Math.round(params.min_score * 10)
  if (typeof params.max_score === 'number') variables.maxScore = Math.round(params.max_score * 10)

  const query = `
    query ($page: Int, $perPage: Int, $sort: [MediaSort], $isAdult: Boolean,
           $search: String, $genre: String, $status: MediaStatus,
           $minScore: Int, $maxScore: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: $sort, isAdult: $isAdult,
              search: $search, genre: $genre, status: $status,
              averageScore_greater: $minScore, averageScore_lesser: $maxScore) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `

  const data = await gql<any>(query, variables, DEFAULT_CACHE_TTL_MS)
  const page1 = data?.Page
  return {
    data: (page1?.media ?? []).map(mapMedia).filter(Boolean),
    ...mapPagination(page1, limit),
  }
}

/**
 * Anime detail by AniList id (single round-trip).
 */
export async function getAnimeDetails(id: number) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FRAGMENT}
        duration
        synonyms
        trailer { id site thumbnail }
        externalLinks { id site url type }
        streamingEpisodes { title thumbnail url site }
        nextAiringEpisode { airingAt episode timeUntilAiring }
        rankings { rank type season year allTime context }
        stats { scoreDistribution { score amount } statusDistribution { status amount } }
        relations {
          edges {
            relationType(version: 2)
            node { id idMal type title { romaji english } format }
          }
        }
        characters(perPage: 24, sort: [ROLE, FAVOURITES_DESC]) {
          edges {
            role
            node {
              id
              name { full native }
              image { large medium }
              favourites
            }
            voiceActors(language: JAPANESE) {
              id
              name { full }
              image { large medium }
            }
          }
        }
        recommendations(perPage: 8, sort: [RATING_DESC]) {
          edges {
            node {
              mediaRecommendation {
                id idMal
                title { romaji english native }
                coverImage { large extraLarge }
                bannerImage
                averageScore
                episodes
                status
              }
            }
          }
        }
      }
    }
  `

  let data: any = null
  try {
    data = await gql<any>(query, { id }, DETAIL_CACHE_TTL_MS)
  } catch (err: any) {
    if (err?.status === 404) return null
    throw err
  }
  const media = data?.Media
  if (!media) return null

  const base = mapMedia(media)
  if (!base) return null

  const characters = (media.characters?.edges ?? []).slice(0, 24).map((edge: any) => {
    const va = edge.voiceActors?.[0]
    return {
      id: edge.node?.id,
      name: edge.node?.name?.full,
      image: edge.node?.image?.large || edge.node?.image?.medium || '',
      role: (edge.role ?? 'SUPPORTING')
        .toString()
        .toLowerCase()
        .replace(/^./, (c: string) => c.toUpperCase()),
      favorites: edge.node?.favourites ?? 0,
      voice_actor: va
        ? {
            id: va.id,
            name: va.name?.full || 'Unknown',
            image: va.image?.large || va.image?.medium || '',
          }
        : null,
    }
  })

  const relations = (media.relations?.edges ?? []).map((edge: any) => ({
    relation: (edge.relationType || 'RELATED').toString().replace(/_/g, ' ').toLowerCase(),
    id: edge.node?.id,
    name: pickTitle(edge.node?.title),
    type: (edge.node?.type ?? '').toString().toLowerCase(),
    format: edge.node?.format ?? null,
  }))

  const related_anime = (media.recommendations?.edges ?? [])
    .map((e: any) => e.node?.mediaRecommendation)
    .filter(Boolean)
    .slice(0, 8)
    .map((m: any) => ({
      id: m.id,
      title: pickTitle(m.title),
      cover_image: m.coverImage?.extraLarge || m.coverImage?.large || '',
      banner_image: m.bannerImage || '',
      score: typeof m.averageScore === 'number' ? m.averageScore / 10 : null,
      episodes: m.episodes ?? 0,
      status: STATUS_MAP[m.status] || '',
    }))

  const scoreBreakdown = (media.stats?.scoreDistribution ?? []).map((bucket: any) => ({
    score: bucket.score / 10,
    votes: bucket.amount,
    percentage: 0,
  }))

  const statusDist = Object.fromEntries(
    (media.stats?.statusDistribution ?? []).map((s: any) => [s.status, s.amount]),
  )

  const trailerId = media.trailer && media.trailer.site === 'youtube' ? media.trailer.id : null

  return {
    ...base,
    title_english: media.title?.english || '',
    title_synonyms: media.synonyms ?? [],
    titles: [
      { type: 'Default', title: media.title?.romaji || '' },
      { type: 'English', title: media.title?.english || '' },
      { type: 'Japanese', title: media.title?.native || '' },
    ].filter((t) => t.title),
    background: '',
    aired_string:
      media.startDate?.year && media.endDate?.year
        ? `${media.startDate.year} – ${media.endDate.year}`
        : media.startDate?.year
          ? String(media.startDate.year)
          : '',
    aired_from: media.startDate?.year
      ? `${media.startDate.year}-${String(media.startDate.month ?? 1).padStart(2, '0')}-${String(
          media.startDate.day ?? 1,
        ).padStart(2, '0')}`
      : null,
    aired_to: media.endDate?.year
      ? `${media.endDate.year}-${String(media.endDate.month ?? 1).padStart(2, '0')}-${String(
          media.endDate.day ?? 1,
        ).padStart(2, '0')}`
      : null,
    broadcast: null,
    duration: media.duration ? `${media.duration} min per ep` : 'Unknown',
    rating: base.rating,
    source: media.source || 'Unknown',
    rank: (media.rankings ?? []).find((r: any) => r.type === 'RATED' && r.allTime)?.rank ?? null,
    popularity: media.popularity ?? null,
    members: media.popularity ?? 0,
    favorites: 0,
    scored_by: null,
    score: base.score,
    episodes: base.episodes,
    trailer_url: trailerId ? 'https://www.youtube.com/watch?v=' + trailerId : null,
    trailer_embed: trailerId ? 'https://www.youtube.com/embed/' + trailerId : null,
    trailer_image: media.trailer?.thumbnail || null,
    studio_id: base.studio_id,
    studio_name: base.studio_name,
    studios: (media.studios?.nodes ?? []).map((s: any) => ({ id: s.id, name: s.name, url: null })),
    producers: [],
    licensors: [],
    explicit_genres: [],
    themes_tags: [],
    demographics: [],
    opening_themes: [],
    ending_themes: [],
    external_links: (media.externalLinks ?? []).map((link: any) => ({
      name: link.site || 'Link',
      url: link.url || '#',
    })),
    streaming: (media.externalLinks ?? [])
      .filter((l: any) => l.type === 'STREAMING')
      .map((l: any) => ({ name: l.site, url: l.url })),
    statistics: {
      watching: statusDist.CURRENT ?? null,
      completed: statusDist.COMPLETED ?? null,
      on_hold: statusDist.PAUSED ?? null,
      dropped: statusDist.DROPPED ?? null,
      plan_to_watch: statusDist.PLANNING ?? null,
      total: media.popularity ?? null,
      score_breakdown: scoreBreakdown,
    },
    characters,
    relations,
    related_anime,
  }
}

export async function getSeasonAnime(params: {
  season: string
  year: number
  sort?: string
  limit?: number
}) {
  const limit = Math.min(params.limit ?? 40, 50)
  const seasonUpper = params.season.toUpperCase()

  const query = `
    query ($season: MediaSeason, $year: Int, $perPage: Int, $sort: [MediaSort]) {
      Page(page: 1, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, season: $season, seasonYear: $year, sort: $sort, isAdult: false) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `

  let sort: string[] = ['SCORE_DESC']
  if (params.sort === 'popularity') sort = ['POPULARITY_DESC']
  else if (params.sort === 'newest') sort = ['START_DATE_DESC']

  const data = await gql<any>(
    query,
    { season: seasonUpper, year: params.year, perPage: limit, sort },
    DEFAULT_CACHE_TTL_MS,
  )
  const page = data?.Page
  return {
    data: (page?.media ?? []).map(mapMedia).filter(Boolean),
    ...mapPagination(page, limit),
  }
}

export async function getGenreOptions() {
  const query = `query { GenreCollection }`
  const data = await gql<any>(query, {}, 7 * 24 * 60 * 60 * 1000)
  return ((data?.GenreCollection ?? []) as string[])
    .map((name, idx) => ({ id: idx + 1, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Character detail by AniList id — direct lookup, no fallback chain needed.
 */
export async function getCharacterDetails(id: number) {
  const query = `
    query ($id: Int) {
      Character(id: $id) {
        id
        name { full native alternative }
        image { large medium }
        favourites
        description(asHtml: false)
        media(perPage: 12, sort: [POPULARITY_DESC]) {
          edges {
            characterRole
            node {
              id idMal type
              title { romaji english native }
              coverImage { large extraLarge }
            }
          }
        }
      }
    }
  `
  let data: any = null
  try {
    data = await gql<any>(query, { id }, DETAIL_CACHE_TTL_MS)
  } catch (err: any) {
    if (err?.status === 404) return null
    throw err
  }
  const c = data?.Character
  if (!c) return null

  return {
    id: c.id,
    name: c.name?.full || 'Unknown',
    name_kanji: c.name?.native || '',
    nicknames: c.name?.alternative ?? [],
    image: c.image?.large || c.image?.medium || '',
    favorites: c.favourites ?? 0,
    description: (c.description || '').replace(/<[^>]+>/g, '').trim() || 'Biography unavailable.',
    appears_in: (c.media?.edges ?? [])
      .filter((edge: any) => edge.node?.type === 'ANIME')
      .slice(0, 12)
      .map((edge: any) => ({
        id: edge.node?.id,
        title: pickTitle(edge.node?.title),
        cover_image: edge.node?.coverImage?.extraLarge || edge.node?.coverImage?.large || '',
        role:
          edge.characterRole === 'MAIN'
            ? 'Main'
            : edge.characterRole === 'SUPPORTING'
              ? 'Supporting'
              : edge.characterRole || 'Unknown',
      })),
  }
}

/**
 * Studio detail by AniList id.
 */
export async function getStudioDetails(id: number) {
  const query = `
    query ($id: Int) {
      Studio(id: $id) {
        id
        name
        favourites
        siteUrl
        media(perPage: 24, sort: [POPULARITY_DESC]) {
          nodes {
            ${MEDIA_FRAGMENT}
          }
        }
      }
    }
  `
  let data: any = null
  try {
    data = await gql<any>(query, { id }, DETAIL_CACHE_TTL_MS)
  } catch (err: any) {
    if (err?.status === 404) return null
    throw err
  }
  const s = data?.Studio
  if (!s) return null

  const animeList = (s.media?.nodes ?? []).map(mapMedia).filter(Boolean)
  return {
    id: s.id,
    name: s.name,
    name_jp: '',
    logo: '',
    description: 'Studio profile from AniList.',
    favorites: s.favourites ?? 0,
    established: null,
    count: animeList.length,
    site_url: s.siteUrl,
    anime: animeList,
  }
}
