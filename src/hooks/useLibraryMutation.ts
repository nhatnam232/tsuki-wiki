import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { library as libraryApi, type LibraryEntry as ApiLibraryEntry } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { queryKeys } from '@/lib/queryClient'

export type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped' | 'on_hold'

export type LibraryEntry = {
  id?: string
  user_id?: string
  anime_id: number
  anime_title: string
  anime_cover: string | null
  anime_episodes: number | null
  status: WatchStatus
  current_episode?: number
  score?: number | null
  notes?: string | null
  updated_at?: string
}

const API_ENABLED = true

/** Entire library for the signed-in user (React Query cached). */
function useLibraryQuery() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.myLibrary(user?.id ?? 'anon'),
    enabled: Boolean(user && API_ENABLED),
    staleTime: 30_000,
    // AddToLibraryButton writes through the API without touching this cache, so
    // re-opening /library must re-read to show the latest status changes.
    refetchOnMount: 'always',
    queryFn: async (): Promise<LibraryEntry[]> => {
      if (!user) return []
      const res = await libraryApi.list()
      return (res.items as ApiLibraryEntry[]).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        anime_id: row.anime_id,
        anime_title: row.anime_title ?? '',
        anime_cover: row.anime_cover,
        anime_episodes: row.anime_episodes,
        status: row.status as WatchStatus,
        current_episode: row.current_episode,
        score: row.score,
        notes: row.notes,
        updated_at: row.updated_at,
      }))
    },
  })
}

/**
 * Single entry lookup for "is this anime in my library?", derived from the
 * cached library list so re-mounting the button costs no extra request.
 */
export function useLibraryEntry(animeId: number) {
  const { user } = useAuth()
  const query = useLibraryQuery()
  const entry = query.data?.find((row) => row.anime_id === animeId) ?? null
  return {
    data: entry,
    isLoading: Boolean(user) && query.isLoading,
    isFetched: query.isFetched,
  }
}

/** Whole-library list, sorted by recent updates. Used by PersonalLibrary page. */
export function useLibraryList() {
  return useLibraryQuery()
}

/**
 * Optimistic upsert: the UI flips status instantly while the request flies.
 * Rolls back the previous entry if the request fails.
 */
export function useUpsertLibraryEntry() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: LibraryEntry) => {
      if (!user) throw new Error('not signed in')
      const res = await libraryApi.upsert({
        anime_id: input.anime_id,
        anime_title: input.anime_title,
        anime_cover: input.anime_cover,
        anime_episodes: input.anime_episodes,
        status: input.status,
        ...(input.current_episode !== undefined ? { current_episode: input.current_episode } : {}),
        ...(input.score !== undefined ? { score: input.score } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      })
      return res.item as ApiLibraryEntry
    },
    onMutate: async (input) => {
      if (!user) return
      const listKey = queryKeys.myLibrary(user.id)
      await qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<LibraryEntry[]>(listKey) ?? []
      const optimistic: LibraryEntry = {
        ...input,
        user_id: user.id,
        updated_at: new Date().toISOString(),
      }
      const without = prevList.filter((e) => e.anime_id !== input.anime_id)
      qc.setQueryData<LibraryEntry[]>(listKey, [optimistic, ...without])
      return { prevList, listKey }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      qc.setQueryData(ctx.listKey, ctx.prevList)
    },
    onSettled: () => {
      if (!user) return
      qc.invalidateQueries({ queryKey: queryKeys.myLibrary(user.id) })
    },
  })
}

/** Optimistic delete from library. */
export function useRemoveLibraryEntry() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (animeId: number) => {
      if (!user) throw new Error('not signed in')
      await libraryApi.remove(animeId)
    },
    onMutate: async (animeId) => {
      if (!user) return
      const listKey = queryKeys.myLibrary(user.id)
      await qc.cancelQueries({ queryKey: listKey })
      const prevList = qc.getQueryData<LibraryEntry[]>(listKey) ?? []
      qc.setQueryData<LibraryEntry[]>(
        listKey,
        prevList.filter((e) => e.anime_id !== animeId),
      )
      return { prevList, listKey }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      qc.setQueryData(ctx.listKey, ctx.prevList)
    },
    onSettled: () => {
      if (!user) return
      qc.invalidateQueries({ queryKey: queryKeys.myLibrary(user.id) })
    },
  })
}
