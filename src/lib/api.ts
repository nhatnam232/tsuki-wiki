const API_BASE = import.meta.env.VITE_API_URL || '/api'

const toQueryString = (params: Record<string, any> = {}) => {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value))
    }
  })

  return query.toString()
}

const fetchJson = async (path: string, params?: Record<string, any>) => {
  const query = toQueryString(params)
  const res = await fetch(`${API_BASE}${path}${query ? `?${query}` : ''}`)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`) as Error & {
      status?: number
      notFound?: boolean
    }
    error.status = res.status
    error.notFound = res.status === 404
    throw error
  }

  return data
}

const postJson = async (path: string, body: Record<string, any>) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`) as Error & {
      unavailable?: boolean
    }
    error.unavailable = Boolean(data?.unavailable)
    throw error
  }

  return data
}

export const fetchAnimeList = async (params: Record<string, any> = {}) =>
  fetchJson('/anime', params)

export const fetchSeasonAnime = async (params: Record<string, any> = {}) =>
  fetchJson('/season', params)

export const fetchAnimeSchedule = async (params: Record<string, any> = {}) =>
  fetchJson('/schedule', params)

export const fetchFeaturedAnime = async () => fetchJson('/anime/featured')

export const fetchAnimeDetails = async (id: number) => fetchJson(`/anime/${id}`)

export const fetchCharacterDetails = async (id: number) =>
  fetchJson(`/character/${id}`)

// Leaderboard of characters ranked by AniList favourites.
// Params: gender ('male' | 'female' | 'other' | 'all'), limit, scan_pages.
export const fetchTopCharacters = async (params: Record<string, any> = {}) =>
  fetchJson('/character/top', params)

export const fetchStudioDetails = async (id: number) => fetchJson(`/studio/${id}`)

export const searchAnime = async (params: Record<string, any> = {}) =>
  fetchJson('/search', params)

export const fetchSearchFilters = async () => fetchJson('/search/filters')

// ─── Translation ──────────────────────────────────────────────────────────────
// Gọi qua server /api/translate để dùng DeepL (ưu tiên) → LibreTranslate → MyMemory.
// Server tự cache vào Supabase nên mỗi đoạn văn chỉ tốn quota DeepL đúng 1 lần.
export const translateText = async (
  text: string,
  targetLang: 'vi' | 'en',
): Promise<{ success: boolean; data?: { text: string }; unavailable?: boolean }> => {
  const normalized = text.trim()
  if (!normalized) return { success: true, data: { text: '' } }

  try {
    const data = await postJson('/translate', { text: normalized, targetLang })
    return { success: true, data: { text: data.data?.text ?? '' } }
  } catch (err: any) {
    return { success: false, unavailable: Boolean(err?.unavailable) }
  }
}
