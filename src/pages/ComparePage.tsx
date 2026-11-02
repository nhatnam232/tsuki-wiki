import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { GitCompareArrows, Plus, Search, Star, Trophy, Users, X } from 'lucide-react'
import Layout from '@/components/Layout'
import Breadcrumbs from '@/components/Breadcrumbs'
import ReloadLink from '@/components/ReloadLink'
import SEO from '@/components/SEO'
import { fetchAnimeDetails, searchAnime } from '@/lib/api'
import { queryKeys } from '@/lib/queryClient'
import { useLangContext } from '@/providers/LangProvider'
import { localizeSeason, localizeStatus } from '@/lib/formatters'
import { useDebounce } from '@/hooks/useDebounce'

const MAX_SLOTS = 3

/**
 * Side-by-side anime comparison. URL persists via `?ids=21,1535,5114` so users
 * can share their comparison link directly.
 *
 * - Up to 3 slots
 * - Auto highlights the "best" value in each numeric row (score / popularity)
 * - Each slot has an inline search box to add an anime by title
 */
export default function ComparePage() {
  const { lang } = useLangContext()
  const [params, setParams] = useSearchParams()

  // Read ?ids=1,2,3 → number[]
  const idsParam = params.get('ids') ?? ''
  const ids = idsParam
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_SLOTS)

  const setIds = (next: number[]) => {
    const trimmed = next.filter((n) => Number.isFinite(n) && n > 0).slice(0, MAX_SLOTS)
    if (trimmed.length === 0) {
      params.delete('ids')
    } else {
      params.set('ids', trimmed.join(','))
    }
    setParams(params, { replace: true })
  }

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.anime.detail(id),
      queryFn: () => fetchAnimeDetails(id).then((r) => r.data),
      enabled: id > 0,
      staleTime: 5 * 60 * 1000,
    })),
  })

  const animes = queries.map((q) => q.data ?? null)
  const allLoading = queries.length > 0 && queries.every((q) => q.isLoading)
  const numericRows: Array<{
    label: string
    valueOf: (a: any) => number | null
    higherIsBetter?: boolean
    format?: (v: number) => string
  }> = [
    {
      label: lang === 'vi' ? 'Điểm số' : 'Score',
      valueOf: (a) => (typeof a?.score === 'number' ? a.score : null),
      higherIsBetter: true,
      format: (v) => v.toFixed(2),
    },
    {
      label: lang === 'vi' ? 'Hạng' : 'Rank',
      valueOf: (a) => (typeof a?.rank === 'number' ? a.rank : null),
      higherIsBetter: false,
      format: (v) => `#${v}`,
    },
    {
      label: lang === 'vi' ? 'Độ phổ biến' : 'Popularity',
      valueOf: (a) => (typeof a?.popularity === 'number' ? a.popularity : null),
      higherIsBetter: false,
      format: (v) => `#${v}`,
    },
    {
      label: lang === 'vi' ? 'Số tập' : 'Episodes',
      valueOf: (a) => (typeof a?.episodes === 'number' ? a.episodes : null),
      higherIsBetter: true,
      format: (v) => String(v),
    },
    {
      label: lang === 'vi' ? 'Yêu thích' : 'Favorites',
      valueOf: (a) => (typeof a?.favorites === 'number' ? a.favorites : null),
      higherIsBetter: true,
      format: (v) => v.toLocaleString(),
    },
  ]

  const bestIndexFor = (row: typeof numericRows[number]) => {
    const values = animes.map((a) => row.valueOf(a))
    const valid = values.filter((v): v is number => v !== null)
    if (valid.length === 0) return -1
    const best = row.higherIsBetter ? Math.max(...valid) : Math.min(...valid)
    return values.findIndex((v) => v === best)
  }

  const remove = (idx: number) => {
    const next = ids.filter((_, i) => i !== idx)
    setIds(next)
  }

  const add = (id: number) => {
    if (ids.includes(id) || ids.length >= MAX_SLOTS) return
    setIds([...ids, id])
  }

  return (
    <Layout>
      <SEO
        title={lang === 'vi' ? 'So sánh Anime' : 'Compare Anime'}
        description={
          lang === 'vi'
            ? 'So sánh điểm số, studio, lượt yêu thích và nhiều chỉ số khác giữa các bộ anime.'
            : 'Compare score, studio, favorites and other stats between anime side-by-side.'
        }
      />

      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Breadcrumbs
          crumbs={[{ name: lang === 'vi' ? 'So sánh' : 'Compare' }]}
        />

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
            <GitCompareArrows className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-text">
              {lang === 'vi' ? 'So Sánh Anime' : 'Compare Anime'}
            </h1>
            <p className="text-sm text-text-muted">
              {lang === 'vi'
                ? `Chọn tối đa ${MAX_SLOTS} bộ và xem bảng so sánh chi tiết`
                : `Pick up to ${MAX_SLOTS} anime and see a detailed side-by-side`}
            </p>
          </div>
        </div>

        {/* Slot grid */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: MAX_SLOTS }).map((_, idx) => {
            const id = ids[idx]
            const anime = animes[idx]
            const loading = id ? queries[idx]?.isLoading : false
            return (
              <div
                key={idx}
                className="relative flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-border bg-card"
              >
                {!id ? (
                  <SlotPicker
                    onPick={(picked) => add(picked)}
                    excludeIds={ids}
                  />
                ) : loading ? (
                  <div className="flex h-full animate-pulse flex-col p-4">
                    <div className="mb-3 h-40 rounded-xl bg-surface" />
                    <div className="h-4 w-3/4 rounded bg-surface" />
                    <div className="mt-2 h-3 w-1/2 rounded bg-surface" />
                  </div>
                ) : !anime ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-text-muted">
                    <p>{lang === 'vi' ? 'Không thể tải' : 'Failed to load'} #{id}</p>
                    <button
                      onClick={() => remove(idx)}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary"
                    >
                      {lang === 'vi' ? 'Xóa' : 'Remove'}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => remove(idx)}
                      className="absolute right-2 top-2 z-10 rounded-full bg-black/55 p-1.5 text-white transition-colors hover:bg-rose-500/70"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <div className="relative h-44 w-full overflow-hidden">
                      <img
                        src={anime.banner_image || anime.cover_image}
                        alt={anime.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
                    </div>
                    <div className="flex-1 p-4">
                      <ReloadLink to={`/anime/${anime.id}`} className="hover:text-primary">
                        <h3 className="line-clamp-2 text-base font-bold text-text">{anime.title}</h3>
                      </ReloadLink>
                      <p className="mt-1 text-xs text-text-muted">
                        #{anime.id} · {anime.studio_name ?? '—'}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {localizeSeason(anime.season ?? '', lang)} · {localizeStatus(anime.status, lang)}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Comparison table */}
        {animes.filter(Boolean).length >= 2 ? (
          <div className="overflow-hidden rounded-3xl border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/40">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-text-muted">
                    {lang === 'vi' ? 'Chỉ số' : 'Metric'}
                  </th>
                  {animes.map((a, idx) => (
                    <th key={idx} className="px-4 py-3 text-left text-xs font-semibold text-text">
                      {a ? a.title : '—'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {numericRows.map((row) => {
                  const bestIdx = bestIndexFor(row)
                  return (
                    <tr key={row.label} className="hover:bg-surface/30">
                      <td className="px-4 py-3 font-medium text-text-muted">{row.label}</td>
                      {animes.map((a, idx) => {
                        const v = row.valueOf(a)
                        const isBest = idx === bestIdx && v !== null
                        return (
                          <td
                            key={idx}
                            className={`px-4 py-3 ${
                              isBest ? 'font-bold text-emerald-400' : 'text-text'
                            }`}
                          >
                            {v === null ? <span className="text-text-muted/60">—</span> : row.format ? row.format(v) : v}
                            {isBest && (
                              <Trophy className="ml-1 inline h-3 w-3" aria-label="Winner" />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                <tr className="hover:bg-surface/30">
                  <td className="px-4 py-3 font-medium text-text-muted">
                    {lang === 'vi' ? 'Studio' : 'Studio'}
                  </td>
                  {animes.map((a, idx) => (
                    <td key={idx} className="px-4 py-3 text-text">
                      {a?.studio_id ? (
                        <ReloadLink to={`/studio/${a.studio_id}`} className="text-primary hover:underline">
                          {a.studio_name}
                        </ReloadLink>
                      ) : (
                        <span className="text-text-muted/60">—</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr className="hover:bg-surface/30">
                  <td className="px-4 py-3 font-medium text-text-muted">
                    {lang === 'vi' ? 'Phát hành' : 'Aired'}
                  </td>
                  {animes.map((a, idx) => (
                    <td key={idx} className="px-4 py-3 text-text">
                      {a?.aired_string ?? <span className="text-text-muted/60">—</span>}
                    </td>
                  ))}
                </tr>
                <tr className="hover:bg-surface/30">
                  <td className="px-4 py-3 font-medium text-text-muted">
                    {lang === 'vi' ? 'Thể loại' : 'Genres'}
                  </td>
                  {animes.map((a, idx) => (
                    <td key={idx} className="px-4 py-3 text-text">
                      <div className="flex flex-wrap gap-1">
                        {(a?.genres ?? []).slice(0, 4).map((g: string) => (
                          <span
                            key={g}
                            className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-muted"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          !allLoading && (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center text-text-muted">
              <Plus className="mx-auto mb-2 h-10 w-10 text-text-muted/40" />
              <p className="font-semibold text-text">
                {lang === 'vi'
                  ? 'Chọn ít nhất 2 anime để so sánh'
                  : 'Pick at least 2 anime to start comparing'}
              </p>
            </div>
          )
        )}
      </div>
    </Layout>
  )
}

function SlotPicker({
  onPick,
  excludeIds,
}: {
  onPick: (id: number) => void
  excludeIds: number[]
}) {
  const { lang } = useLangContext()
  const [q, setQ] = useState('')
  const debounced = useDebounce(q, 350)
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!debounced.trim() || debounced.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    searchAnime({ q: debounced, limit: 8, sort: 'score' })
      .then((res) => {
        if (cancelled) return
        if (res.success) {
          setResults((res.data ?? []).filter((a: any) => !excludeIds.includes(a.id)))
        } else {
          setResults([])
        }
      })
      .catch(() => setResults([]))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, excludeIds.join(',')])

  return (
    <div className="flex h-full flex-col p-4">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={lang === 'vi' ? 'Tìm anime để thêm...' : 'Search anime to add...'}
          className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm text-text focus:border-primary focus:outline-none"
        />
      </div>
      <div className="mt-3 flex-1 overflow-y-auto">
        {loading ? (
          <p className="py-4 text-center text-xs text-text-muted">
            {lang === 'vi' ? 'Đang tìm...' : 'Searching...'}
          </p>
        ) : results.length === 0 ? (
          <p className="flex h-full items-center justify-center text-xs text-text-muted">
            {q.trim() ? (lang === 'vi' ? 'Không có kết quả' : 'No results') : (lang === 'vi' ? 'Bắt đầu nhập...' : 'Start typing…')}
          </p>
        ) : (
          <ul className="space-y-1">
            {results.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => onPick(a.id)}
                  className="flex w-full items-center gap-2 rounded-lg p-2 text-left transition-colors hover:bg-surface"
                >
                  <img
                    src={a.cover_image}
                    alt=""
                    className="h-10 w-7 flex-shrink-0 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-text">{a.title}</p>
                    <p className="flex items-center gap-1 text-[10px] text-text-muted">
                      {typeof a.score === 'number' && (
                        <>
                          <Star className="h-2.5 w-2.5 fill-current text-yellow-500" />
                          {a.score.toFixed(1)}
                        </>
                      )}
                      {typeof a.popularity === 'number' && (
                        <>
                          <Users className="ml-1 h-2.5 w-2.5" />
                          #{a.popularity}
                        </>
                      )}
                    </p>
                  </div>
                  <Plus className="h-4 w-4 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
