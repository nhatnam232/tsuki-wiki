import { useEffect, useState } from 'react'
import { API_READY, favorites as favoritesApi } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import { useFavoritesStore, type AnimeFavorite } from '@/store/useFavoritesStore'

export type LikableAnime = AnimeFavorite

/**
 * Unified like/favorite hook:
 * - Guests: localStorage via zustand store (instant, offline-friendly)
 * - Logged-in users: row in `favorites` via the backend API (synced, public counter)
 *
 * On sign-in we push any guest favourites up to the API (best-effort).
 */
export function useAnimeLike(anime: LikableAnime | null | undefined) {
  const { user } = useAuth()
  const { lang } = useLangContext()
  const toast = useToast()
  const { favorites, addFavorite, removeFavorite, isFavorite } = useFavoritesStore()
  const [serverLiked, setServerLiked] = useState<boolean | null>(null)
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const animeId = anime?.id ?? null

  // Load public count + whether this user already liked it.
  useEffect(() => {
    if (!API_READY || !animeId) return
    let cancelled = false

    favoritesApi
      .count(animeId)
      .then((res) => {
        if (!cancelled) setCount(res.count ?? 0)
      })
      .catch(() => {
        if (!cancelled) setCount(0)
      })

    if (!user) {
      setServerLiked(null)
      return () => {
        cancelled = true
      }
    }

    favoritesApi
      .list()
      .then((res) => {
        if (cancelled) return
        setServerLiked((res.items ?? []).some((row) => row.anime_id === animeId))
      })
      .catch(() => {
        if (!cancelled) setServerLiked(false)
      })

    return () => {
      cancelled = true
    }
  }, [animeId, user])

  // On sign-in, push local favourites up (best-effort, one-shot).
  useEffect(() => {
    if (!user || !API_READY || favorites.length === 0) return
    const syncedKey = `anm-synced-${user.id}`
    if (localStorage.getItem(syncedKey)) return

    Promise.all(
      favorites.map((f) =>
        favoritesApi
          .add({ anime_id: f.id, anime_title: f.title, anime_cover: f.cover_image ?? undefined })
          .catch(() => null),
      ),
    ).then(() => localStorage.setItem(syncedKey, '1'))
  }, [user, favorites])

  const liked = user ? serverLiked === true : isFavorite(animeId ?? -1)

  const toggle = async () => {
    if (!anime) return
    if (!user) {
      if (isFavorite(anime.id)) {
        removeFavorite(anime.id)
        toast.info(lang === 'vi' ? 'Đã bỏ yêu thích' : 'Removed from favorites', anime.title)
      } else {
        addFavorite(anime)
        toast.success(lang === 'vi' ? 'Đã lưu vào yêu thích' : 'Saved to favorites', anime.title)
      }
      return
    }
    if (busy) return
    setBusy(true)
    try {
      if (serverLiked) {
        await favoritesApi.remove(anime.id)
        setServerLiked(false)
        setCount((c) => (typeof c === 'number' ? Math.max(0, c - 1) : c))
        toast.info(lang === 'vi' ? 'Đã bỏ yêu thích' : 'Removed from favorites', anime.title)
      } else {
        await favoritesApi.add({
          anime_id: anime.id,
          anime_title: anime.title,
          anime_cover: anime.cover_image ?? undefined,
        })
        setServerLiked(true)
        setCount((c) => (typeof c === 'number' ? c + 1 : c))
        toast.success(lang === 'vi' ? 'Đã lưu vào yêu thích' : 'Saved to favorites', anime.title)
      }
    } catch (err) {
      toast.error(
        lang === 'vi' ? 'Không thể cập nhật yêu thích' : 'Could not update favorite',
        err instanceof Error ? err.message : 'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return {
    liked,
    toggle,
    busy,
    count,
    requiresAuth: !user && API_READY,
  }
}
