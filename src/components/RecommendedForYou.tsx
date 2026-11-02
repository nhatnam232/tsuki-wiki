import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import AnimeCard from './AnimeCard'
import { fetchAnimeList } from '@/lib/api'
import { API_READY, animeSeasons, favorites as favoritesApi, library as libraryApi } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'

type AnimeLite = {
  id: number
  title: string
  cover_image: string
  score?: number | null
  episodes?: number | null
  status?: string
  genres?: string[]
}

type Props = {
  /** Authentication-required modal opener (passed down from page). */
  onAuthRequired?: () => void
}

/**
 * Personalised "Gợi ý dành riêng cho [Tên User]" section for the homepage.
 *
 * Logic:
 *   1. Read the user's library entries (limit 50 most-recent).
 *   2. Aggregate top 3 genres they engage with.
 *   3. Fetch anime in those genres, filter out anything already in their library.
 *   4. Display top 12 by score.
 *
 * Falls back gracefully (returns null) if Supabase isn't configured or the
 * user has no library yet — so the homepage never breaks for guests.
 */
export default function RecommendedForYou({ onAuthRequired }: Props) {
  const { user, profile } = useAuth()
  const { lang } = useLangContext()
  const [recs, setRecs] = useState<AnimeLite[]>([])
  const [loading, setLoading] = useState(false)
  const [topGenres, setTopGenres] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !API_READY) {
      setRecs([])
      return
    }
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        // 1. Pull library + favorites with anime IDs
        const [libraryRes, favRes] = await Promise.all([libraryApi.list(), favoritesApi.list()])

        const seenIds = new Set<number>()
        for (const r of libraryRes.items ?? []) seenIds.add(r.anime_id)
        for (const r of favRes.items ?? []) seenIds.add(r.anime_id)

        if (seenIds.size === 0) {
          if (!cancelled) {
            setRecs([])
            setLoading(false)
          }
          return
        }

        // 2. Build genre histogram from anime_seasons cache (avoids hitting
        //    AniList per-id which is rate-limited).
        const ids = Array.from(seenIds)
        const seasonsRes = await animeSeasons.byIds(ids.slice(0, 30)).catch(() => ({ items: [] }))

        const genreCounts = new Map<string, number>()
        for (const row of (seasonsRes.items ?? []) as Array<{ genres?: string[] }>) {
          for (const g of row.genres ?? []) {
            genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1)
          }
        }
        const topGenresList = [...genreCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([g]) => g)

        if (!cancelled) setTopGenres(topGenresList)

        // 3. If we have top genres, fetch in those; otherwise fallback to "all"
        const targetGenre = topGenresList[0] ?? 'All'
        const res = await fetchAnimeList({ genre: targetGenre, limit: 24, sort: 'score' })

        if (cancelled) return
        if (!res.success) {
          setError(lang === 'vi' ? 'Không tải được gợi ý.' : 'Could not load recommendations.')
          setRecs([])
          return
        }

        // 4. Filter out anything they've already seen
        const filtered = (res.data ?? []).filter((a: AnimeLite) => !seenIds.has(a.id)).slice(0, 12)
        setRecs(filtered)
      } catch (e) {
        console.error('Recommendation fetch failed', e)
        if (!cancelled) setError(lang === 'vi' ? 'Không tải được gợi ý.' : 'Could not load recommendations.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [user, lang])

  const displayName = useMemo(
    () => profile?.display_name || user?.email?.split('@')[0] || (lang === 'vi' ? 'bạn' : 'you'),
    [profile, user, lang],
  )

  // Hide entirely if no signed-in user
  if (!user) return null
  // Hide if loaded but nothing to recommend (typically: empty library)
  if (!loading && recs.length === 0 && !error) return null

  return (
    <section className="container mx-auto max-w-7xl px-4 py-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-text md:text-3xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-hover text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            {lang === 'vi' ? `Gợi ý dành riêng cho ${displayName}` : `Picked just for ${displayName}`}
          </h2>
          {topGenres.length > 0 && (
            <p className="mt-1 text-sm text-text-muted">
              {lang === 'vi' ? 'Dựa trên thể loại bạn hay xem: ' : 'Based on genres you watch most: '}
              <span className="font-medium text-primary">{topGenres.join(' · ')}</span>
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-card/60" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {recs.map((anime) => (
            <AnimeCard key={anime.id} anime={anime as any} onAuthRequired={onAuthRequired} />
          ))}
        </div>
      )}
    </section>
  )
}
