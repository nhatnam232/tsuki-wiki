import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
  Edit3,
  Loader2,
  LogIn,
  Plus,
  Search,
  Star,
  Trash2,
  Tv,
  X,
  AlertCircle,
} from 'lucide-react'
import Layout from '@/components/Layout'
import Breadcrumbs from '@/components/Breadcrumbs'
import AuthModal from '@/components/AuthModal'
import ReloadLink from '@/components/ReloadLink'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { API_READY, library as libraryApi } from '@/lib/backend'

// ─── Types ────────────────────────────────────────────────────────────────────

type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped' | 'on_hold'

interface LibraryEntry {
  id: string
  anime_id: number
  anime_title: string
  anime_cover: string | null
  anime_episodes: number | null
  status: WatchStatus
  current_episode: number
  score: number | null
  notes: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

interface EntryModalState {
  open: boolean
  entry: LibraryEntry | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  WatchStatus,
  { labelEn: string; labelVi: string; color: string; bg: string; border: string; dot: string }
> = {
  watching: {
    labelEn: 'Watching',
    labelVi: 'Đang xem',
    color: 'text-blue-300',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    dot: 'bg-blue-400',
  },
  completed: {
    labelEn: 'Completed',
    labelVi: 'Đã xem',
    color: 'text-green-300',
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    dot: 'bg-green-400',
  },
  plan_to_watch: {
    labelEn: 'Plan to Watch',
    labelVi: 'Muốn xem',
    color: 'text-purple-300',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
    dot: 'bg-purple-400',
  },
  dropped: {
    labelEn: 'Dropped',
    labelVi: 'Đã bỏ',
    color: 'text-red-300',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    dot: 'bg-red-400',
  },
  on_hold: {
    labelEn: 'On Hold',
    labelVi: 'Tạm dừng',
    color: 'text-amber-300',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    dot: 'bg-amber-400',
  },
}

const ALL_STATUSES: WatchStatus[] = ['watching', 'completed', 'plan_to_watch', 'dropped', 'on_hold']

// ─── Helper ───────────────────────────────────────────────────────────────────

function getStatusLabel(status: WatchStatus, lang: string) {
  const cfg = STATUS_CONFIG[status]
  return lang === 'vi' ? cfg.labelVi : cfg.labelEn
}

function ProgressBar({ current, total }: { current: number; total: number | null }) {
  if (!total || total === 0) return null
  const pct = Math.min(100, Math.round((current / total) * 100))
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{current}/{total} eps</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-purple-400 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── Entry Edit Modal ─────────────────────────────────────────────────────────

interface EntryModalProps {
  entry: LibraryEntry | null
  onClose: () => void
  onSave: (updated: Partial<LibraryEntry>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  lang: string
}

function EntryModal({ entry, onClose, onSave, onDelete, lang }: EntryModalProps) {
  const [status, setStatus] = useState<WatchStatus>(entry?.status ?? 'plan_to_watch')
  const [currentEp, setCurrentEp] = useState(String(entry?.current_episode ?? 0))
  const [score, setScore] = useState(String(entry?.score ?? ''))
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!entry) return null

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      status,
      current_episode: Math.max(0, parseInt(currentEp, 10) || 0),
      score: score ? Math.min(10, Math.max(1, parseInt(score, 10))) : null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    onClose()
  }

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    await onDelete(entry.id)
    setDeleting(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-gray-700 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-gray-800 p-5">
          {entry.anime_cover && (
            <img
              src={entry.anime_cover}
              alt={entry.anime_title}
              className="h-20 w-14 flex-shrink-0 rounded-lg object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-bold text-white">{entry.anime_title}</h3>
            <p className="mt-1 text-xs text-gray-400">
              {lang === 'vi' ? 'Chỉnh sửa thông tin theo dõi' : 'Edit tracking info'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          {/* Status */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {lang === 'vi' ? 'Trạng thái' : 'Status'}
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_STATUSES.map((s) => {
                const cfg = STATUS_CONFIG[s]
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                      status === s
                        ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                        : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
                    {getStatusLabel(s, lang)}
                    {status === s && <Check className="ml-auto h-3 w-3" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Progress */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {lang === 'vi' ? 'Tiến độ (tập)' : 'Progress (episodes)'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max={entry.anime_episodes ?? 9999}
                value={currentEp}
                onChange={(e) => setCurrentEp(e.target.value)}
                className="w-24 rounded-lg border border-gray-700 bg-background px-3 py-2 text-center text-sm text-white focus:border-primary focus:outline-none"
              />
              <span className="text-gray-500">/</span>
              <span className="text-sm text-gray-400">
                {entry.anime_episodes ?? '?'} {lang === 'vi' ? 'tập' : 'eps'}
              </span>
            </div>
            {entry.anime_episodes && (
              <ProgressBar
                current={parseInt(currentEp, 10) || 0}
                total={entry.anime_episodes}
              />
            )}
          </div>

          {/* Score */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {lang === 'vi' ? 'Điểm của bạn (1-10)' : 'Your Score (1-10)'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="10"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                placeholder="—"
                className="w-24 rounded-lg border border-gray-700 bg-background px-3 py-2 text-center text-sm text-white focus:border-primary focus:outline-none"
              />
              {score && (
                <div className="flex items-center gap-1 text-yellow-400">
                  {Array.from({ length: Math.min(10, parseInt(score, 10) || 0) }).map((_, i) => (
                    <Star key={i} className="h-3 w-3 fill-current" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {lang === 'vi' ? 'Ghi chú' : 'Notes'}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={lang === 'vi' ? 'Ghi chú cá nhân...' : 'Personal notes...'}
              className="w-full resize-none rounded-lg border border-gray-700 bg-background px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-gray-600">{notes.length}/500</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-800 px-5 py-4">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
              confirmDelete
                ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                : 'text-gray-500 hover:bg-gray-800 hover:text-red-400'
            }`}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {confirmDelete
              ? lang === 'vi' ? 'Xác nhận xóa?' : 'Confirm delete?'
              : lang === 'vi' ? 'Xóa' : 'Remove'}
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              {lang === 'vi' ? 'Hủy' : 'Cancel'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {lang === 'vi' ? 'Lưu' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Library Card ─────────────────────────────────────────────────────────────

interface LibraryCardProps {
  entry: LibraryEntry
  lang: string
  onEdit: (entry: LibraryEntry) => void
}

function LibraryCard({ entry, lang, onEdit }: LibraryCardProps) {
  const cfg = STATUS_CONFIG[entry.status]

  return (
    <div className="group relative flex gap-3 rounded-xl border border-gray-800 bg-card p-3 transition-all duration-200 hover:border-gray-600 hover:shadow-lg">
      {/* Cover */}
      <ReloadLink to={`/anime/${entry.anime_id}`} className="flex-shrink-0">
        <div className="relative h-24 w-16 overflow-hidden rounded-lg">
          {entry.anime_cover ? (
            <img
              src={entry.anime_cover}
              alt={entry.anime_title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-800">
              <Tv className="h-6 w-6 text-gray-600" />
            </div>
          )}
        </div>
      </ReloadLink>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <ReloadLink to={`/anime/${entry.anime_id}`}>
          <h4 className="line-clamp-2 text-sm font-semibold leading-tight text-white transition-colors hover:text-primary">
            {entry.anime_title}
          </h4>
        </ReloadLink>

        {/* Status badge */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.border} ${cfg.color}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
            {getStatusLabel(entry.status, lang)}
          </span>
          {entry.score !== null && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <Star className="h-3 w-3 fill-current" />
              {entry.score}/10
            </span>
          )}
        </div>

        {/* Progress */}
        <ProgressBar current={entry.current_episode} total={entry.anime_episodes} />

        {/* Notes preview */}
        {entry.notes && (
          <p className="mt-1.5 line-clamp-1 text-[10px] italic text-gray-500">
            "{entry.notes}"
          </p>
        )}
      </div>

      {/* Edit button */}
      <button
        onClick={() => onEdit(entry)}
        className="absolute right-2 top-2 rounded-lg p-1.5 text-gray-600 opacity-0 transition-all hover:bg-gray-700 hover:text-white group-hover:opacity-100"
        title={lang === 'vi' ? 'Chỉnh sửa' : 'Edit'}
      >
        <Edit3 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

interface StatsBarProps {
  entries: LibraryEntry[]
  lang: string
}

function StatsBar({ entries, lang }: StatsBarProps) {
  const stats = useMemo(() => {
    const counts: Record<WatchStatus, number> = {
      watching: 0, completed: 0, plan_to_watch: 0, dropped: 0, on_hold: 0,
    }
    let totalEps = 0
    let scoredCount = 0
    let scoreSum = 0

    entries.forEach((e) => {
      counts[e.status]++
      totalEps += e.current_episode
      if (e.score !== null) {
        scoredCount++
        scoreSum += e.score
      }
    })

    return {
      counts,
      totalEps,
      avgScore: scoredCount > 0 ? (scoreSum / scoredCount).toFixed(1) : null,
    }
  }, [entries])

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
      <div className="rounded-xl border border-gray-800 bg-card p-3 text-center">
        <div className="text-xs text-gray-400">{lang === 'vi' ? 'Tổng' : 'Total'}</div>
        <div className="mt-1 text-2xl font-bold text-white">{entries.length}</div>
      </div>
      {ALL_STATUSES.map((s) => {
        const cfg = STATUS_CONFIG[s]
        return (
          <div key={s} className={`rounded-xl border p-3 text-center ${cfg.bg} ${cfg.border}`}>
            <div className={`text-xs ${cfg.color}`}>{getStatusLabel(s, lang)}</div>
            <div className={`mt-1 text-2xl font-bold ${cfg.color}`}>{stats.counts[s]}</div>
          </div>
        )
      })}
      <div className="rounded-xl border border-gray-800 bg-card p-3 text-center">
        <div className="text-xs text-gray-400">{lang === 'vi' ? 'Điểm TB' : 'Avg Score'}</div>
        <div className="mt-1 flex items-center justify-center gap-1 text-2xl font-bold text-yellow-400">
          {stats.avgScore ?? '—'}
          {stats.avgScore && <Star className="h-4 w-4 fill-current" />}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PersonalLibrary() {
  const { lang } = useLangContext()
  const { user, loading: authLoading } = useAuth()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [modal, setModal] = useState<EntryModalState>({ open: false, entry: null })
  const [activeTab, setActiveTab] = useState<WatchStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'updated' | 'title' | 'score'>('updated')
  const [sortOpen, setSortOpen] = useState(false)

  // ── Load library from Supabase ──
  const loadLibrary = useCallback(async () => {
    if (!user || !API_READY) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await libraryApi.list()
      setEntries(((res.items ?? []) as unknown as LibraryEntry[]).slice())
    } catch (err: any) {
      console.error('[PersonalLibrary] load failed', err)
      // Friendly hint when the table doesn't exist yet (RLS-blocked or not migrated).
      const code = (err as { code?: string })?.code
      const friendly =
        lang === 'vi'
          ? `Không thể tải thư viện (${code ?? 'lỗi'}). ${err instanceof Error ? err.message : ''}`
          : `Failed to load library (${code ?? 'error'}). ${err instanceof Error ? err.message : ''}`
      setError(friendly)
    } finally {
      setLoading(false)
    }
  }, [user, lang])

  useEffect(() => {
    if (!authLoading) void loadLibrary()
    window.scrollTo(0, 0)
  }, [authLoading, loadLibrary])

  // ── CRUD operations ──
  const handleSave = async (entryId: string, updates: Partial<LibraryEntry>) => {
    if (!user) return
    const target = entries.find((e) => e.id === entryId)
    if (!target) return
    try {
      await libraryApi.update(target.anime_id, {
        ...(updates.status ? { status: updates.status } : {}),
        ...(updates.current_episode !== undefined ? { current_episode: updates.current_episode } : {}),
        ...(updates.score !== undefined ? { score: updates.score } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
      })
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...updates } : e)))
    } catch (err) {
      console.warn('[PersonalLibrary] save failed', err)
    }
  }

  const handleDelete = async (entryId: string) => {
    if (!user) return
    const target = entries.find((e) => e.id === entryId)
    if (!target) return
    try {
      await libraryApi.remove(target.anime_id)
      setEntries((prev) => prev.filter((e) => e.id !== entryId))
    } catch (err) {
      console.warn('[PersonalLibrary] delete failed', err)
    }
  }

  // ── Filtered & sorted entries ──
  const displayedEntries = useMemo(() => {
    let result = entries

    // Tab filter
    if (activeTab !== 'all') {
      result = result.filter((e) => e.status === activeTab)
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((e) => e.anime_title.toLowerCase().includes(q))
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'title') return a.anime_title.localeCompare(b.anime_title)
      if (sortBy === 'score') {
        if (a.score === null) return 1
        if (b.score === null) return -1
        return b.score - a.score
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

    return result
  }, [entries, activeTab, searchQuery, sortBy])

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    ALL_STATUSES.forEach((s) => {
      counts[s] = entries.filter((e) => e.status === s).length
    })
    return counts
  }, [entries])

  const sortLabels: Record<string, string> = {
    updated: lang === 'vi' ? 'Cập nhật gần nhất' : 'Recently Updated',
    title: lang === 'vi' ? 'Tên A-Z' : 'Title A-Z',
    score: lang === 'vi' ? 'Điểm cao nhất' : 'Highest Score',
  }

  // ── Auth loading ──
  if (authLoading) {
    return (
      <Layout>
        <div className="container mx-auto max-w-6xl px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 rounded-lg bg-card" />
            <div className="grid grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-card" />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-32 rounded-xl bg-card" />
              ))}
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  // ── Not logged in ──
  if (!user) {
    return (
      <Layout>
        <div className="container mx-auto max-w-2xl px-4 py-20">
          <div className="rounded-3xl border border-gray-800 bg-card p-10 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/20">
              <BookOpen className="h-10 w-10 text-primary" />
            </div>
            <h1 className="mb-3 text-3xl font-bold text-white">
              {lang === 'vi' ? 'Thư Viện Cá Nhân' : 'Personal Library'}
            </h1>
            <p className="mb-8 text-gray-400">
              {lang === 'vi'
                ? 'Đăng nhập để theo dõi tiến độ xem anime, lưu danh sách và đánh giá cá nhân.'
                : 'Sign in to track your anime progress, save your watchlist, and rate anime.'}
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => setAuthOpen(true)}
                className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-white hover:bg-primary-hover"
              >
                <LogIn className="h-5 w-5" />
                {lang === 'vi' ? 'Đăng nhập ngay' : 'Sign In'}
              </button>
              <ReloadLink
                to="/"
                className="rounded-full border border-gray-700 px-6 py-3 font-medium text-gray-300 hover:border-primary hover:text-white"
              >
                {lang === 'vi' ? 'Về trang chủ' : 'Back to Home'}
              </ReloadLink>
            </div>
          </div>
          <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
      </Layout>
    )
  }

  // ── API not configured ──
  if (!API_READY) {
    return (
      <Layout>
        <div className="container mx-auto max-w-2xl px-4 py-20">
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-yellow-100">
            {lang === 'vi'
              ? 'API chưa được cấu hình. Tính năng thư viện cá nhân chưa khả dụng.'
              : 'API is not configured. Personal library feature is unavailable.'}
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
            onClick={() => void loadLibrary()}
            className="rounded-lg bg-primary px-4 py-2 text-white hover:bg-primary-hover"
          >
            {lang === 'vi' ? 'Thử lại' : 'Retry'}
          </button>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="container mx-auto max-w-6xl px-4 py-8">
        {/* Breadcrumbs */}
        <Breadcrumbs
          crumbs={[{ name: lang === 'vi' ? 'Thư viện cá nhân' : 'My Library' }]}
        />

        {/* Page Header */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                {lang === 'vi' ? 'Thư Viện Cá Nhân' : 'My Library'}
              </h1>
              <p className="text-sm text-gray-400">
                {lang === 'vi' ? 'Quản lý danh sách anime của bạn' : 'Manage your anime watchlist'}
              </p>
            </div>
          </div>

          <ReloadLink
            to="/search"
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            {lang === 'vi' ? 'Thêm anime' : 'Add Anime'}
          </ReloadLink>
        </div>

        {/* Stats */}
        {entries.length > 0 && <StatsBar entries={entries} lang={lang} />}

        {/* Controls: Search + Sort */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'vi' ? 'Tìm trong thư viện...' : 'Search library...'}
              className="w-full rounded-xl border border-gray-700 bg-card py-2 pl-9 pr-4 text-sm text-white placeholder-gray-600 focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-gray-500 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Sort dropdown */}
          <div className="relative">
            <button
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-2 rounded-xl border border-gray-700 bg-card px-4 py-2 text-sm text-gray-300 hover:border-gray-600"
            >
              {sortLabels[sortBy]}
              <ChevronDown className={`h-4 w-4 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-gray-700 bg-card shadow-xl">
                {Object.entries(sortLabels).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => { setSortBy(key as typeof sortBy); setSortOpen(false) }}
                    className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-gray-800 ${
                      sortBy === key ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    {label}
                    {sortBy === key && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Status Tabs */}
        <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-gray-800 bg-card p-1">
          {/* All tab */}
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              activeTab === 'all'
                ? 'bg-primary text-white shadow-md'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {lang === 'vi' ? 'Tất cả' : 'All'}
            <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-xs">
              {tabCounts.all}
            </span>
          </button>

          {ALL_STATUSES.map((s) => {
            const cfg = STATUS_CONFIG[s]
            return (
              <button
                key={s}
                onClick={() => setActiveTab(s)}
                className={`flex-shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === s
                    ? `${cfg.bg} ${cfg.color} shadow-md`
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                {getStatusLabel(s, lang)}
                <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-xs">
                  {tabCounts[s]}
                </span>
              </button>
            )
          })}
        </div>

        {/* Loading skeleton */}
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-xl border border-gray-800 bg-card p-3">
                <div className="flex gap-3">
                  <div className="h-24 w-16 flex-shrink-0 rounded-lg bg-gray-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-full rounded bg-gray-800" />
                    <div className="h-3 w-2/3 rounded bg-gray-800" />
                    <div className="h-2 w-full rounded bg-gray-800" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : displayedEntries.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-800 bg-card/50 py-20 text-center">
            <BookOpen className="mb-4 h-16 w-16 text-gray-700" />
            <h3 className="mb-2 text-xl font-bold text-white">
              {searchQuery
                ? lang === 'vi' ? 'Không tìm thấy kết quả' : 'No results found'
                : activeTab === 'all'
                  ? lang === 'vi' ? 'Thư viện trống' : 'Your library is empty'
                  : lang === 'vi' ? `Không có anime nào trong mục "${getStatusLabel(activeTab, lang)}"` : `No anime in "${getStatusLabel(activeTab, lang)}"`}
            </h3>
            <p className="mb-6 text-gray-500">
              {searchQuery
                ? lang === 'vi' ? 'Thử từ khóa khác' : 'Try a different keyword'
                : lang === 'vi'
                  ? 'Khám phá anime và thêm vào thư viện của bạn'
                  : 'Browse anime and add them to your library'}
            </p>
            {!searchQuery && (
              <ReloadLink
                to="/search"
                className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
              >
                <Search className="h-4 w-4" />
                {lang === 'vi' ? 'Khám phá anime' : 'Browse Anime'}
              </ReloadLink>
            )}
          </div>
        ) : (
          /* Library grid */
          <>
            <p className="mb-3 text-sm text-gray-500">
              {lang === 'vi'
                ? `Hiển thị ${displayedEntries.length} / ${entries.length} anime`
                : `Showing ${displayedEntries.length} of ${entries.length} anime`}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {displayedEntries.map((entry) => (
                <LibraryCard
                  key={entry.id}
                  entry={entry}
                  lang={lang}
                  onEdit={(e) => setModal({ open: true, entry: e })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Edit Modal */}
      {modal.open && modal.entry && (
        <EntryModal
          entry={modal.entry}
          lang={lang}
          onClose={() => setModal({ open: false, entry: null })}
          onSave={(updates) => handleSave(modal.entry!.id, updates)}
          onDelete={handleDelete}
        />
      )}

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </Layout>
  )
}
