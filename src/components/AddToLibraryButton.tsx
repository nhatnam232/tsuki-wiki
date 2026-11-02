import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookmarkPlus, Check, ChevronDown, Loader2, Trash2, X } from 'lucide-react'
import { API_READY, library } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { useToast } from '@/providers/ToastProvider'
import { useLangContext } from '@/providers/LangProvider'
import {
  AwCompletedIcon,
  AwDroppedIcon,
  AwOnHoldIcon,
  AwPlanToWatchIcon,
  AwWatchingIcon,
} from '@/components/AwIcons'
import type { ComponentType } from 'react'

type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped' | 'on_hold'

type Props = {
  animeId: number
  animeTitle: string
  animeCover?: string | null
  animeEpisodes?: number | null
  onAuthRequired?: () => void
}

const STATUS_OPTIONS: Array<{
  key: WatchStatus
  en: string
  vi: string
  dot: string
  ring: string
  Icon: ComponentType<{ className?: string }>
}> = [
  { key: 'plan_to_watch', en: 'Plan to Watch', vi: 'Muốn xem', dot: 'bg-purple-400', ring: 'ring-purple-400/40', Icon: AwPlanToWatchIcon },
  { key: 'watching',      en: 'Watching',      vi: 'Đang xem',  dot: 'bg-blue-400',   ring: 'ring-blue-400/40',   Icon: AwWatchingIcon },
  { key: 'completed',     en: 'Completed',     vi: 'Đã xem',    dot: 'bg-green-400',  ring: 'ring-green-400/40',  Icon: AwCompletedIcon },
  { key: 'on_hold',       en: 'On Hold',       vi: 'Tạm dừng',  dot: 'bg-amber-400',  ring: 'ring-amber-400/40',  Icon: AwOnHoldIcon },
  { key: 'dropped',       en: 'Dropped',       vi: 'Đã bỏ',     dot: 'bg-red-400',    ring: 'ring-red-400/40',    Icon: AwDroppedIcon },
]

export default function AddToLibraryButton({
  animeId,
  animeTitle,
  animeCover,
  animeEpisodes,
  onAuthRequired,
}: Props) {
  const { user } = useAuth()
  const { lang } = useLangContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<WatchStatus | 'remove' | null>(null)
  const [currentStatus, setCurrentStatus] = useState<WatchStatus | null>(null)
  const [open, setOpen] = useState(false)

  const label = (opt: (typeof STATUS_OPTIONS)[number]) => (lang === 'vi' ? opt.vi : opt.en)
  const activeOpt = currentStatus ? STATUS_OPTIONS.find((o) => o.key === currentStatus) : null

  // Body-scroll lock + ESC close while modal open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Initial fetch.
  useEffect(() => {
    if (!user || !API_READY) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    library
      .get(animeId)
      .then((res) => {
        if (cancelled) return
        setCurrentStatus(((res.item as { status?: WatchStatus })?.status) ?? null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if ((err as { status?: number })?.status !== 404) {
          console.warn('[AddToLibrary] read failed', err)
        }
        setCurrentStatus(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [animeId, user])

  const setStatus = async (status: WatchStatus) => {
    if (!user) {
      onAuthRequired?.()
      return
    }
    if (!API_READY) return
    setBusyKey(status)
    const previous = currentStatus
    setCurrentStatus(status)

    const error = await library
      .upsert({
        anime_id: animeId,
        anime_title: animeTitle,
        anime_cover: animeCover ?? null,
        anime_episodes: animeEpisodes ?? null,
        status,
      })
      .then(() => null)
      .catch((err: unknown) => err as { code?: string; message?: string })
    setBusyKey(null)
    setOpen(false)

    if (error) {
      setCurrentStatus(previous)
      console.error('[AddToLibrary] upsert failed', error)
      const friendly =
        lang === 'vi'
          ? error.code === '42P01'
            ? 'Bảng user_library chưa tồn tại trên backend.'
            : `Không thể lưu vào thư viện (${error.code ?? 'lỗi'})`
          : error.code === '42P01'
            ? 'Table user_library does not exist on the backend.'
            : `Could not save to library (${error.code ?? 'error'})`
      toast.error(friendly, error.message)
      return
    }
    const opt = STATUS_OPTIONS.find((o) => o.key === status)!
    toast.success(
      previous
        ? lang === 'vi' ? 'Đã cập nhật trạng thái' : 'Library status updated'
        : lang === 'vi' ? 'Đã thêm vào thư viện' : 'Added to library',
      `${animeTitle} · ${label(opt)}`,
    )
  }

  const removeFromLibrary = async () => {
    if (!user || !currentStatus) return
    setBusyKey('remove')
    const previous = currentStatus
    setCurrentStatus(null)
    const error = await library
      .remove(animeId)
      .then(() => null)
      .catch((err: unknown) => err as { message?: string })
    setBusyKey(null)
    setOpen(false)
    if (error) {
      setCurrentStatus(previous)
      toast.error(
        lang === 'vi' ? 'Không thể gỡ khỏi thư viện' : 'Could not remove from library',
        error.message,
      )
      return
    }
    toast.info(lang === 'vi' ? 'Đã gỡ khỏi thư viện' : 'Removed from library', animeTitle)
  }

  // Not signed in → big CTA.
  if (!user) {
    return (
      <button
        onClick={() => onAuthRequired?.()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-all hover:shadow-emerald-500/50"
      >
        <BookmarkPlus className="h-4 w-4" />
        {lang === 'vi' ? 'Thêm vào thư viện' : 'Add to Library'}
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700 bg-background/40 py-2.5 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {lang === 'vi' ? 'Đang tải...' : 'Loading...'}
      </div>
    )
  }

  // Signed in: single CTA button → opens centered modal popup so it can never
  // be clipped by parent overflow / hero banner z-index conflicts.
  const isAdded = currentStatus !== null
  return (
    <>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(true)}
        disabled={busyKey !== null}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-60 ${
          isAdded
            ? 'border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
            : 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50'
        }`}
      >
        {busyKey ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isAdded ? (
          <Check className="h-4 w-4" />
        ) : (
          <BookmarkPlus className="h-4 w-4" />
        )}
        <span>
          {isAdded
            ? `${lang === 'vi' ? 'Đã có trong thư viện' : 'In your library'} · ${activeOpt ? label(activeOpt) : ''}`
            : lang === 'vi'
              ? 'Thêm vào thư viện'
              : 'Add to Library'}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 opacity-70" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[150] flex items-center justify-center px-4 py-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card text-text shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/30">
                    <BookmarkPlus className="h-5 w-5 text-white keep-white-on-light" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-text">
                      {lang === 'vi' ? 'Thư viện cá nhân' : 'My Library'}
                    </h3>
                    <p className="text-xs text-text-muted">{animeTitle}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full border border-border p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Status options — uses custom AW icons (not generic lucide ones)
                  so the brand voice carries through the most-used flow. */}
              <div className="px-3 py-3">
                <p className="px-2 pb-2 text-[11px] uppercase tracking-widest text-text-muted">
                  {lang === 'vi' ? 'Chọn trạng thái theo dõi' : 'Pick a tracking status'}
                </p>
                <ul className="space-y-1">
                  {STATUS_OPTIONS.map((opt) => {
                    const active = opt.key === currentStatus
                    const busy = busyKey === opt.key
                    const Icon = opt.Icon
                    return (
                      <li key={opt.key}>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={() => void setStatus(opt.key)}
                          disabled={busyKey !== null}
                          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all disabled:opacity-50 ${
                            active
                              ? `bg-primary/15 text-primary ring-1 ${opt.ring}`
                              : 'bg-surface text-text hover:bg-surface/80'
                          }`}
                        >
                          <span
                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                              active ? 'bg-primary/20 text-primary' : `${opt.dot}/20 text-text-muted`
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="flex-1 text-left font-medium">{label(opt)}</span>
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : active ? (
                            <Check className="h-4 w-4" />
                          ) : null}
                        </motion.button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* Footer */}
              {isAdded && (
                <div className="border-t border-border px-3 py-3">
                  <button
                    onClick={() => void removeFromLibrary()}
                    disabled={busyKey !== null}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {busyKey === 'remove' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {lang === 'vi' ? 'Gỡ khỏi thư viện' : 'Remove from library'}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
