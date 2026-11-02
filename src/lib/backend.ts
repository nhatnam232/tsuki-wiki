/**
 * Client for the self-hosted backend (server-v2).
 *
 * Replaces the legacy hosted backend client for data/auth/storage/realtime.
 * carries the HttpOnly session cookies (`credentials: 'include'`), so no token
 * ever touches frontend JS.
 *
 * `VITE_API_URL` must include the `/api` suffix, e.g.
 * `https://api.animewiki.eu.cc/api`. Unset = same-origin `/api`.
 */

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'
const MEDIA_BASE = API_BASE.replace(/\/api$/, '')

/** Backend tự viết đã sẵn sàng (Supabase đã bị loại bỏ). */
export const API_READY = true

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  get unauthorized(): boolean {
    return this.status === 401
  }

  get forbidden(): boolean {
    return this.status === 403
  }

  get notFound(): boolean {
    return this.status === 404
  }
}

type Query = Record<string, string | number | boolean | undefined | null>

const withQuery = (path: string, query?: Query): string => {
  if (!query) return path
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value))
  })
  const qs = params.toString()
  return qs ? path + '?' + qs : path
}

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Query,
): Promise<T> => {
  const res = await fetch(API_BASE + withQuery(path, query), {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 204) return undefined as T

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : 'http_' + res.status
    throw new ApiError(res.status, code)
  }
  return data as T
}

const get = <T>(path: string, query?: Query): Promise<T> => request<T>('GET', path, undefined, query)
const post = <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body)
const patch = <T>(path: string, body?: unknown): Promise<T> => request<T>('PATCH', path, body)
const del = <T>(path: string, query?: Query): Promise<T> => request<T>('DELETE', path, undefined, query)

/* ── auth ─────────────────────────────────────────────────────────── */

export type SessionUser = {
  id: string
  email: string
  name: string | null
  picture: string | null
  email_verified: boolean
  created_at: string
  last_login_at: string | null
}

export type Profile = {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  cover_url: string | null
  bio: string | null
  gender: string | null
  birthday?: string | null
  spotify_url: string | null
  badges: string[]
}

export const auth = {
  login: (email: string, password: string, captchaToken?: string) =>
    post<{ success: boolean; user: SessionUser }>('/auth/login', {
      email,
      password,
      ...(captchaToken ? { captchaToken } : {}),
    }),
  register: (email: string, password: string, username: string, captchaToken?: string) =>
    post<{ success: boolean; user: SessionUser }>('/auth/register', {
      email,
      password,
      username,
      ...(captchaToken ? { captchaToken } : {}),
    }),
  logout: () => post<{ success: boolean }>('/auth/logout'),
  refresh: () => post<{ success: boolean; user: SessionUser }>('/auth/refresh'),
  me: () => get<{ success: boolean; user: SessionUser; profile: Profile | null }>('/auth/me'),
  googleStartUrl: (): string => API_BASE + '/auth/google/start',
}

/* ── profiles ─────────────────────────────────────────────────────── */

export const profiles = {
  byUsername: (username: string) =>
    get<{ success: boolean; profile: Profile }>('/profiles/' + encodeURIComponent(username)),
  me: () => get<{ success: boolean; profile: Profile }>('/profiles/me'),
  updateMe: (
    fields: Partial<Pick<Profile, 'display_name' | 'bio' | 'gender' | 'birthday' | 'spotify_url'>>,
  ) => patch<{ success: boolean; profile: Profile }>('/profiles/me', fields),
}

/* ── media (storage replacement) ──────────────────────────────────── */

export const mediaUrl = (pathOrUrl: string | null | undefined): string | null => {
  if (!pathOrUrl) return null
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl
  return MEDIA_BASE + (pathOrUrl.startsWith('/') ? pathOrUrl : '/' + pathOrUrl)
}

export const BUCKETS = ['avatars', 'covers', 'comment-images'] as const
export type Bucket = (typeof BUCKETS)[number]

export const uploadMedia = async (bucket: Bucket, file: File): Promise<string> => {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(API_BASE + '/media/' + bucket, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : 'upload_failed'
    throw new ApiError(res.status, code)
  }
  return String(data.path)
}

/* ── library / favorites ──────────────────────────────────────────── */

export type LibraryStatus = 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped'

export type LibraryEntry = {
  id: string
  user_id: string
  anime_id: number
  anime_title: string | null
  anime_cover: string | null
  anime_episodes: number | null
  status: LibraryStatus
  current_episode: number
  score: number | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type FavoriteEntry = {
  anime_id: number
  anime_title: string | null
  anime_cover: string | null
}

export const library = {
  list: (status?: LibraryStatus) =>
    get<{ success: boolean; items: LibraryEntry[] }>('/library', { status }),
  upsert: (entry: Partial<LibraryEntry> & { anime_id: number }) =>
    post<{ success: boolean; item: LibraryEntry }>('/library', entry),
  update: (animeId: number, fields: Partial<LibraryEntry>) =>
    patch<{ success: boolean; item: LibraryEntry }>('/library/' + animeId, fields),
  get: (animeId: number) =>
    get<{ success: boolean; item: LibraryEntry }>('/library/' + animeId),
  remove: (animeId: number) => del<{ success: boolean }>('/library/' + animeId),
  stats: () => get<{ success: boolean; stats: Record<string, number> }>('/library/stats'),
}

export const favorites = {
  /** Tổng lượt favorite công khai của 1 anime (GET /api/favorites/count). */
  count: (animeId: number) =>
    get<{ success: boolean; anime_id: number; count: number }>(
      '/favorites/count?anime_id=' + encodeURIComponent(String(animeId)),
    ),
  list: () => get<{ success: boolean; items: FavoriteEntry[] }>('/favorites'),
  add: (anime: { anime_id: number; anime_title?: string; anime_cover?: string }) =>
    post<{ success: boolean }>('/favorites', anime),
  remove: (animeId: number) => del<{ success: boolean }>('/favorites/' + animeId),
}

/* ── comments ─────────────────────────────────────────────────────── */

export type Comment = {
  id: string
  user_id: string
  entity_type: string
  entity_id: number
  parent_id: string | null
  body: string
  image_url: string | null
  is_deleted: number
  created_at: string
  updated_at: string
  username?: string | null
  display_name?: string | null
  avatar_url?: string | null
}

export type CommentCounts = { up: number; down: number }

export const comments = {
  list: (entityType: string, entityId: number, opts: { limit?: number; offset?: number } = {}) =>
    get<{ success: boolean; items: Comment[]; limit: number; offset: number }>('/comments', {
      entity_type: entityType,
      entity_id: entityId,
      limit: opts.limit,
      offset: opts.offset,
    }),
  create: (input: {
    entity_type: string
    entity_id: number
    body: string
    parent_id?: string | null
    image_url?: string | null
  }) => post<{ success: boolean; comment: Comment }>('/comments', input),
  update: (id: string, body: string) =>
    patch<{ success: boolean; comment: Comment }>('/comments/' + id, { body }),
  remove: (id: string) => del<{ success: boolean }>('/comments/' + id),
  vote: (id: string, value: 1 | -1) =>
    post<{ success: boolean; counts: CommentCounts }>('/comments/' + id + '/vote', { value }),
  unvote: (id: string) =>
    del<{ success: boolean; counts: CommentCounts }>('/comments/' + id + '/vote'),
  votes: (ids: string[]) =>
    get<{ success: boolean; items: Array<{ comment_id: string; up: number; down: number }> }>(
      '/comments/votes',
      { ids: ids.join(',') },
    ),
}

/* ── collections ──────────────────────────────────────────────────── */

export type Collection = {
  id: string
  user_id: string
  slug: string
  title: string
  description: string | null
  is_public: number
  like_count: number
  item_count: number
  created_at: string
  updated_at: string
}

export const collections = {
  list: (opts: { mine?: boolean; limit?: number; offset?: number } = {}) =>
    get<{ success: boolean; items: Collection[] }>('/collections', {
      mine: opts.mine,
      limit: opts.limit,
      offset: opts.offset,
    }),
  get: (idOrSlug: string) =>
    get<{ success: boolean; collection: Collection; items: unknown[] }>(
      '/collections/' + encodeURIComponent(idOrSlug),
    ),
  create: (input: { title: string; description?: string; is_public?: boolean; slug?: string }) =>
    post<{ success: boolean; collection: Collection }>('/collections', input),
  update: (
    id: string,
    fields: Partial<Pick<Collection, 'title' | 'description' | 'is_public' | 'slug'>>,
  ) => patch<{ success: boolean; collection: Collection }>('/collections/' + id, fields),
  remove: (id: string) => del<{ success: boolean }>('/collections/' + id),
  addItem: (id: string, animeId: number) =>
    post<{ success: boolean }>('/collections/' + id + '/items', { anime_id: animeId }),
  removeItem: (id: string, animeId: number) =>
    del<{ success: boolean }>('/collections/' + id + '/items/' + animeId),
  likedIds: () => get<{ success: boolean; ids: string[] }>('/collections/liked'),
  like: (id: string) =>
    post<{ success: boolean; like_count: number }>('/collections/' + id + '/like'),
  unlike: (id: string) =>
    del<{ success: boolean; like_count: number }>('/collections/' + id + '/like'),
}

/* ── misc resources ───────────────────────────────────────────────── */

export const reactions = {
  set: (animeId: number, reaction: string) =>
    post<{ success: boolean }>('/anime/' + animeId + '/reaction', { reaction }),
  clear: (animeId: number) => del<{ success: boolean }>('/anime/' + animeId + '/reaction'),
  counts: (animeId: number) =>
    get<{ success: boolean; items: Array<{ reaction: string; total: number }> }>(
      '/anime/' + animeId + '/reactions',
    ),
}

export const reviews = {
  list: (animeId: number) =>
    get<{ success: boolean; items: unknown[] }>('/anime/' + animeId + '/reviews'),
  create: (animeId: number, input: { rating: number; body: string }) =>
    post<{ success: boolean; review: unknown }>('/anime/' + animeId + '/reviews', input),
  remove: (id: string) => del<{ success: boolean }>('/reviews/' + id),
}

export const notifications = {
  list: (opts: { unread?: boolean; limit?: number } = {}) =>
    get<{ success: boolean; items: unknown[] }>('/notifications', {
      unread: opts.unread,
      limit: opts.limit,
    }),
  markRead: (id: string) => patch<{ success: boolean }>('/notifications/' + id, { read: true }),
  remove: (id: string) => del<{ success: boolean }>('/notifications/' + id),
}

export const editSuggestions = {
  create: (input: {
    anime_id: number
    field: string
    content_after: string
    content_before?: string | null
    reason?: string | null
  }) => post<{ success: boolean; suggestion: unknown }>('/edit-suggestions', input),
  mine: () => get<{ success: boolean; items: unknown[] }>('/edit-suggestions'),
  pending: () => get<{ success: boolean; items: unknown[] }>('/edit-suggestions', { scope: 'mod' }),
  review: (id: string, status: 'approved' | 'rejected', note?: string) =>
    patch<{ success: boolean }>('/edit-suggestions/' + id, { status, note }),
}

export const compareHistory = {
  list: () => get<{ success: boolean; items: unknown[] }>('/compare-history'),
  save: (animeIds: number[]) =>
    post<{ success: boolean }>('/compare-history', { anime_ids: animeIds }),
  remove: (id: string) => del<{ success: boolean }>('/compare-history/' + id),
}

export const quests = {
  list: () => get<{ success: boolean; items: unknown[] }>('/quests'),
  progress: () => get<{ success: boolean; items: unknown[] }>('/quests/progress'),
}

export const activity = {
  feed: (scope: 'public' | 'mine' = 'public', opts: { limit?: number; before?: string | null } = {}) =>
    get<{ success: boolean; items: unknown[]; limit: number }>('/activity', {
      scope,
      limit: opts.limit,
      before: opts.before ?? undefined,
    }),
}

/** Cached season metadata (genres/cover/score) used for recommendations. */
export const animeSeasons = {
  byIds: (ids: number[]) =>
    get<{ success: boolean; items: Array<Record<string, unknown>> }>('/anime-seasons', {
      ids: ids.slice(0, 50).join(','),
    }),
}

/* ── realtime (WebSocket) ─────────────────────────────────────────── */

export type RealtimeTopic =
  | `comments:${string}:${number}`
  | `notifications:${string}`
  | 'activity'

export type RealtimeEvent = {
  type: string
  room: string
  payload: unknown
}

/**
 * Opens the backend WebSocket. Auth rides on the session cookie, so the caller
 * must be logged in before connecting. Returns a disposer; the socket retries
 * with backoff until disposed.
 */
export const connectRealtime = (
  topics: RealtimeTopic[],
  onEvent: (event: RealtimeEvent) => void,
): (() => void) => {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return () => {}

  const base = MEDIA_BASE || window.location.origin
  const url = new URL(base.replace(/^http/, 'ws') + '/api/ws')
  url.searchParams.set('topics', topics.join(','))

  let socket: WebSocket | null = null
  let retry = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    if (disposed) return
    socket = new WebSocket(url.toString())
    socket.onopen = () => {
      retry = 0
    }
    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data) as RealtimeEvent)
      } catch {
        /* ignore malformed frames */
      }
    }
    socket.onclose = () => {
      socket = null
      if (disposed) return
      retry = Math.min(retry + 1, 6)
      timer = setTimeout(open, 500 * 2 ** retry)
    }
  }
  open()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    socket?.close()
  }
}


/* ── admin (thay supabase.rpc) ────────────────────────────────────── */

export const admin = {
  verifyPassword: (password: string) =>
    post<{ success: boolean; valid: boolean; validForDate: string }>('/admin/verify-password', {
      password,
    }),
  rotatePassword: () =>
    post<{ success: boolean; rotated?: boolean; password?: string; warning?: string; webhook_sent?: boolean }>(
      '/admin/rotate-password',
      {},
    ),
}
