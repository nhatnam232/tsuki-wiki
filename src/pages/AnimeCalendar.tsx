import { useEffect, useMemo, useState } from 'react'
import { Calendar, Clock, Star, Tv, AlertCircle, RefreshCw } from 'lucide-react'
import Layout from '@/components/Layout'
import ReloadLink from '@/components/ReloadLink'
import Breadcrumbs from '@/components/Breadcrumbs'
import { useLangContext } from '@/providers/LangProvider'
import { fetchAnimeSchedule } from '@/lib/api'


// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleAnime {
  id: number
  title: string
  cover_image: string
  broadcast_day: string
  broadcast_time: string | null
  episodes: number | null
  status: string
  studio_name: string
  score: number | null
  season: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAYS_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật']

// Map JS getDay() (0=Sun) to our DAYS_EN index (0=Mon)
const JS_DAY_TO_IDX: Record<number, number> = {
  1: 0, // Mon
  2: 1, // Tue
  3: 2, // Wed
  4: 3, // Thu
  5: 4, // Fri
  6: 5, // Sat
  0: 6, // Sun
}

// ─── Mock data (replace with real API call when backend is ready) ──────────────

const MOCK_SCHEDULE: ScheduleAnime[] = [
  { id: 52991, title: 'Sousou no Frieren', cover_image: 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg', broadcast_day: 'Friday', broadcast_time: '23:00', episodes: 28, status: 'Finished', studio_name: 'Madhouse', score: 9.01, season: 'Fall 2023' },
  { id: 51009, title: 'Jujutsu Kaisen Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1792/138022l.jpg', broadcast_day: 'Thursday', broadcast_time: '23:30', episodes: 23, status: 'Finished', studio_name: 'MAPPA', score: 8.66, season: 'Summer 2023' },
  { id: 54492, title: 'Dungeon Meshi', cover_image: 'https://cdn.myanimelist.net/images/anime/1711/142478l.jpg', broadcast_day: 'Friday', broadcast_time: '00:00', episodes: 24, status: 'Finished', studio_name: 'Trigger', score: 8.71, season: 'Winter 2024' },
  { id: 55701, title: 'Mushoku Tensei II Part 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1028/141399l.jpg', broadcast_day: 'Sunday', broadcast_time: '22:00', episodes: 12, status: 'Finished', studio_name: 'Studio Bind', score: 8.72, season: 'Fall 2023' },
  { id: 53887, title: 'Oshi no Ko Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1812/134736l.jpg', broadcast_day: 'Wednesday', broadcast_time: '23:00', episodes: 13, status: 'Ongoing', studio_name: 'Doga Kobo', score: 8.20, season: 'Summer 2024' },
  { id: 57334, title: 'Dandadan', cover_image: 'https://cdn.myanimelist.net/images/anime/1498/146659l.jpg', broadcast_day: 'Tuesday', broadcast_time: '23:30', episodes: 12, status: 'Finished', studio_name: 'Science SARU', score: 8.55, season: 'Fall 2024' },
  { id: 58426, title: 'Solo Leveling Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1823/148723l.jpg', broadcast_day: 'Saturday', broadcast_time: '00:00', episodes: 13, status: 'Ongoing', studio_name: 'A-1 Pictures', score: 8.10, season: 'Winter 2025' },
  { id: 57334, title: 'Blue Lock Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1498/146659l.jpg', broadcast_day: 'Monday', broadcast_time: '22:30', episodes: 13, status: 'Ongoing', studio_name: 'Eight Bit', score: 8.30, season: 'Fall 2024' },
  { id: 58001, title: 'Kaijuu 8-gou Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1823/148723l.jpg', broadcast_day: 'Saturday', broadcast_time: '23:00', episodes: 12, status: 'Upcoming', studio_name: 'Production I.G', score: null, season: 'Spring 2025' },
  { id: 59001, title: 'Spy x Family Season 3', cover_image: 'https://cdn.myanimelist.net/images/anime/1015/138006l.jpg', broadcast_day: 'Sunday', broadcast_time: '23:00', episodes: 13, status: 'Upcoming', studio_name: 'WIT Studio', score: null, season: 'Spring 2025' },
  { id: 60001, title: 'Chainsaw Man Season 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1792/138022l.jpg', broadcast_day: 'Wednesday', broadcast_time: '00:00', episodes: 12, status: 'Upcoming', studio_name: 'MAPPA', score: null, season: 'Summer 2025' },
  { id: 61001, title: 'Vinland Saga Season 3', cover_image: 'https://cdn.myanimelist.net/images/anime/1711/142478l.jpg', broadcast_day: 'Thursday', broadcast_time: '22:00', episodes: 24, status: 'Upcoming', studio_name: 'MAPPA', score: null, season: 'Fall 2025' },
  { id: 62001, title: 'Re:Zero Season 3 Part 2', cover_image: 'https://cdn.myanimelist.net/images/anime/1028/141399l.jpg', broadcast_day: 'Tuesday', broadcast_time: '23:00', episodes: 13, status: 'Ongoing', studio_name: 'White Fox', score: 8.40, season: 'Winter 2025' },
  { id: 63001, title: 'Overlord V', cover_image: 'https://cdn.myanimelist.net/images/anime/1812/134736l.jpg', broadcast_day: 'Monday', broadcast_time: '23:30', episodes: 13, status: 'Upcoming', studio_name: 'Madhouse', score: null, season: 'Spring 2025' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ScheduleAnimeItemProps {
  anime: ScheduleAnime
  isToday: boolean
}

function ScheduleAnimeItem({ anime, isToday }: ScheduleAnimeItemProps) {
  const statusColor =
    anime.status === 'Ongoing'
      ? 'bg-green-500/20 text-green-300 border-green-500/30'
      : anime.status === 'Upcoming'
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        : 'bg-gray-700/50 text-gray-400 border-gray-600/30'

  return (
    <ReloadLink
      to={`/anime/${anime.id}`}
      className={`group flex items-center gap-3 rounded-xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        isToday
          ? 'border-primary/40 bg-primary/5 hover:border-primary/70 hover:bg-primary/10'
          : 'border-gray-800 bg-card hover:border-gray-600 hover:bg-gray-800/60'
      }`}
    >
      {/* Cover */}
      <div className="relative h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg">
        <img
          src={anime.cover_image}
          alt={anime.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 text-sm font-semibold leading-tight text-white transition-colors group-hover:text-primary">
          {anime.title}
        </h4>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {anime.broadcast_time && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3 w-3" />
              {anime.broadcast_time}
            </span>
          )}
          {anime.score !== null && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Star className="h-3 w-3 fill-current" />
              {anime.score.toFixed(1)}
            </span>
          )}
          {anime.episodes && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Tv className="h-3 w-3" />
              {anime.episodes} eps
            </span>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusColor}`}>
            {anime.status}
          </span>
          {anime.studio_name && (
            <span className="truncate text-[10px] text-gray-500">{anime.studio_name}</span>
          )}
        </div>
      </div>
    </ReloadLink>
  )
}

interface ScheduleDayColumnProps {
  dayLabel: string
  dayKey: string
  animeList: ScheduleAnime[]
  isToday: boolean
}

function ScheduleDayColumn({ dayLabel, dayKey: _dayKey, animeList, isToday }: ScheduleDayColumnProps) {
  return (
    <div
      className={`flex flex-col rounded-2xl border transition-all ${
        isToday
          ? 'border-primary/50 bg-primary/5 shadow-[0_0_20px_rgba(124,58,237,0.15)]'
          : 'border-gray-800 bg-card/50'
      }`}
    >
      {/* Day Header */}
      <div
        className={`flex items-center justify-between rounded-t-2xl px-4 py-3 ${
          isToday
            ? 'bg-primary/20 border-b border-primary/30'
            : 'bg-gray-800/50 border-b border-gray-700/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-gray-200'}`}>
            {dayLabel}
          </span>
          {isToday && (
            <span className="animate-pulse rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
              TODAY
            </span>
          )}
        </div>
        <span className={`text-xs font-medium ${isToday ? 'text-primary/80' : 'text-gray-500'}`}>
          {animeList.length} anime
        </span>
      </div>

      {/* Anime List */}
      <div className="flex flex-col gap-2 p-3">
        {animeList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Calendar className="mb-2 h-8 w-8 text-gray-700" />
            <p className="text-xs text-gray-600">No anime scheduled</p>
          </div>
        ) : (
          animeList.map((anime) => (
            <ScheduleAnimeItem key={anime.id} anime={anime} isToday={isToday} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnimeCalendar() {
  const { t, lang } = useLangContext()
  const [schedule, setSchedule] = useState<ScheduleAnime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'ongoing' | 'upcoming'>('all')

  // Detect today's day index (0=Mon, 6=Sun)
  const todayIdx = JS_DAY_TO_IDX[new Date().getDay()] ?? 0

  const dayLabels = lang === 'vi' ? DAYS_VI : DAYS_EN

  const loadSchedule = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchAnimeSchedule()
      if (res.success && Array.isArray(res.data) && res.data.length > 0) {
        setSchedule(res.data as ScheduleAnime[])
      } else {
        // Empty week (rare) — fall back to mock so the grid is not blank.
        setSchedule(MOCK_SCHEDULE)
      }
    } catch (err) {
      console.error('[AnimeCalendar] Failed to load schedule', err)
      // Soft-fail: still show mock data so the page is usable.
      setSchedule(MOCK_SCHEDULE)
      setError(t.loadError)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSchedule()
    window.scrollTo(0, 0)
  }, [])

  // Group anime by day, applying status filter
  const scheduleByDay = useMemo(() => {
    const filtered =
      filterStatus === 'all'
        ? schedule
        : schedule.filter((a) =>
            filterStatus === 'ongoing'
              ? a.status === 'Ongoing'
              : a.status === 'Upcoming',
          )

    return DAYS_EN.map((day) =>
      filtered
        .filter((a) => a.broadcast_day === day)
        .sort((a, b) => {
          if (!a.broadcast_time) return 1
          if (!b.broadcast_time) return -1
          return a.broadcast_time.localeCompare(b.broadcast_time)
        }),
    )
  }, [schedule, filterStatus])

  const totalOngoing = schedule.filter((a) => a.status === 'Ongoing').length
  const totalUpcoming = schedule.filter((a) => a.status === 'Upcoming').length

  // ── Skeleton ──
  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto max-w-[1600px] px-4 py-8">
          <div className="mb-8 h-8 w-48 animate-pulse rounded-lg bg-card" />
          <div className="mb-6 h-12 w-full animate-pulse rounded-xl bg-card" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-gray-800 bg-card">
                <div className="h-12 rounded-t-2xl bg-gray-800" />
                <div className="space-y-3 p-3">
                  {Array.from({ length: 2 }).map((_, j) => (
                    <div key={j} className="flex gap-3">
                      <div className="h-16 w-12 flex-shrink-0 rounded-lg bg-gray-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-full rounded bg-gray-800" />
                        <div className="h-3 w-2/3 rounded bg-gray-800" />
                        <div className="h-3 w-1/2 rounded bg-gray-800" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Layout>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <AlertCircle className="h-12 w-12 text-red-400" />
          <p className="text-center text-gray-400">{error}</p>
          <button
            onClick={() => void loadSchedule()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
          >
            <RefreshCw className="h-4 w-4" />
            {t.retry}
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="container mx-auto max-w-[1600px] px-4 py-8">
        {/* Breadcrumbs */}
        <Breadcrumbs
          crumbs={[{ name: lang === 'vi' ? 'Lịch phát sóng' : 'Anime Calendar' }]}
        />

        {/* Page Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-3xl font-bold text-white">
                {lang === 'vi' ? 'Lịch Phát Sóng' : 'Anime Calendar'}
              </h1>
            </div>
            <p className="text-gray-400">
              {lang === 'vi'
                ? 'Lịch phát sóng anime hàng tuần. Hôm nay được highlight tự động.'
                : 'Weekly anime broadcast schedule. Today is automatically highlighted.'}
            </p>
          </div>

          {/* Stats */}
          <div className="flex gap-3">
            <div className="rounded-xl border border-gray-800 bg-card px-4 py-2 text-center">
              <div className="text-xs text-gray-400">{lang === 'vi' ? 'Đang chiếu' : 'Ongoing'}</div>
              <div className="text-xl font-bold text-green-400">{totalOngoing}</div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-card px-4 py-2 text-center">
              <div className="text-xs text-gray-400">{lang === 'vi' ? 'Sắp chiếu' : 'Upcoming'}</div>
              <div className="text-xl font-bold text-amber-400">{totalUpcoming}</div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-card px-4 py-2 text-center">
              <div className="text-xs text-gray-400">{lang === 'vi' ? 'Tổng cộng' : 'Total'}</div>
              <div className="text-xl font-bold text-white">{schedule.length}</div>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-gray-800 bg-card p-2">
          <span className="px-2 text-sm text-gray-400">
            {lang === 'vi' ? 'Lọc:' : 'Filter:'}
          </span>
          {(
            [
              { key: 'all', label: lang === 'vi' ? 'Tất cả' : 'All' },
              { key: 'ongoing', label: lang === 'vi' ? 'Đang chiếu' : 'Ongoing' },
              { key: 'upcoming', label: lang === 'vi' ? 'Sắp chiếu' : 'Upcoming' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilterStatus(opt.key)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
                filterStatus === opt.key
                  ? 'bg-primary text-white shadow-md'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}

          {/* Today indicator */}
          <div className="ml-auto flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-sm font-medium text-primary">
              {lang === 'vi' ? `Hôm nay: ${dayLabels[todayIdx]}` : `Today: ${DAYS_EN[todayIdx]}`}
            </span>
          </div>
        </div>

        {/* Calendar Grid - 7 columns */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {DAYS_EN.map((dayKey, idx) => (
            <ScheduleDayColumn
              key={dayKey}
              dayLabel={dayLabels[idx]}
              dayKey={dayKey}
              animeList={scheduleByDay[idx]}
              isToday={idx === todayIdx}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-6 rounded-xl border border-gray-800 bg-card/50 px-6 py-4">
          <span className="text-sm text-gray-500">
            {lang === 'vi' ? 'Chú thích:' : 'Legend:'}
          </span>
          <div className="flex items-center gap-2">
            <span className="inline-block rounded-full border border-green-500/30 bg-green-500/20 px-2 py-0.5 text-xs text-green-300">
              Ongoing
            </span>
            <span className="text-xs text-gray-400">
              {lang === 'vi' ? 'Đang phát sóng' : 'Currently airing'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block rounded-full border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
              Upcoming
            </span>
            <span className="text-xs text-gray-400">
              {lang === 'vi' ? 'Sắp phát sóng' : 'Coming soon'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block rounded-full border border-gray-600/30 bg-gray-700/50 px-2 py-0.5 text-xs text-gray-400">
              Finished
            </span>
            <span className="text-xs text-gray-400">
              {lang === 'vi' ? 'Đã kết thúc' : 'Completed'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="text-xs text-primary font-medium">TODAY</span>
            </div>
            <span className="text-xs text-gray-400">
              {lang === 'vi' ? 'Ngày hôm nay' : 'Current day'}
            </span>
          </div>
        </div>

        {/* Data source note */}
        <p className="mt-4 text-center text-xs text-gray-600">
          {lang === 'vi'
            ? '* Lịch phát sóng dựa trên giờ JST (Nhật Bản). Dữ liệu từ MyAnimeList.'
            : '* Broadcast times are in JST (Japan Standard Time). Data sourced from MyAnimeList.'}
        </p>
      </div>
    </Layout>
  )
}
