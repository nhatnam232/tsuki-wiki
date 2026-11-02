import { useEffect, useState } from 'react'
import {
  BookmarkPlus,
  CheckCircle2,
  Heart,
  PlusCircle,
  RefreshCw,
  Star,
  Users,
} from 'lucide-react'
import Layout from '@/components/Layout'
import SEO from '@/components/SEO'
import UserAvatar from '@/components/UserAvatar'
import ReloadLink from '@/components/ReloadLink'
import { API_READY, activity as activityApi, connectRealtime } from '@/lib/backend'
import { useLangContext } from '@/providers/LangProvider'
import type { BadgeId } from '@/lib/badges'

type ActivityRow = {
  id: string
  user_id: string
  kind: 'library_add' | 'library_complete' | 'review_post' | 'collection_create' | 'comment_post' | 'badge_earned' | 'edit_approved'
  anime_id: number | null
  anime_title: string | null
  anime_cover: string | null
  collection_id: string | null
  badge_id: string | null
  meta: Record<string, any> | null
  created_at: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  badges: BadgeId[] | null
}

const PAGE_SIZE = 30

/**
 * Public live activity feed — "User A vừa hoàn thành Naruto", "User B vừa
 * tạo bộ sưu tập Isekai mới", … Powered by the `activity_feed_enriched` view.
 *
 * Realtime subscribes to INSERTs so new activity appears without refresh,
 * giving the site that "đang sống" feel the user requested.
 */
export default function ActivityFeed() {
  const { lang } = useLangContext()
  const [items, setItems] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (reset = false) => {
    if (!API_READY) {
      setError(lang === 'vi' ? 'API chưa cấu hình.' : 'API not configured.')
      setLoading(false)
      return
    }
    if (reset) setRefreshing(true)
    else setLoading(true)
    try {
      const cursor = reset ? null : items[items.length - 1]?.created_at
      const res = await activityApi.feed('public', { limit: PAGE_SIZE, before: cursor })
      const rows = (res.items ?? []) as ActivityRow[]
      setItems((prev) => (reset ? rows : [...prev, ...rows]))
      setHasMore(rows.length === PAGE_SIZE)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load(true)

    if (!API_READY) return undefined

    // Realtime: prepend new public activities as they arrive.
    const dispose = connectRealtime(['activity'], (event) => {
      if (event.type === 'activity:new') void load(true)
    })

    return () => { dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Layout>
      <SEO
        title={lang === 'vi' ? 'Hoạt động cộng đồng' : 'Community Activity'}
        description={lang === 'vi'
          ? 'Xem cộng đồng đang xem, hoàn thành và sưu tầm anime nào ngay lúc này.'
          : 'See what the community is watching, completing, and curating right now.'}
      />

      <div className="container mx-auto max-w-3xl px-4 py-8">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-text">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Users className="h-5 w-5" />
              </span>
              {lang === 'vi' ? 'Hoạt động cộng đồng' : 'Community Activity'}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {lang === 'vi'
                ? 'Sự kiện mới nhất từ tất cả thành viên — tự động cập nhật.'
                : 'Latest events from all members — updates live.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {lang === 'vi' ? 'Làm mới' : 'Refresh'}
          </button>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : loading && items.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-card/60" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-text-muted/50" />
            <p className="mt-3 text-sm text-text-muted">
              {lang === 'vi'
                ? 'Chưa có hoạt động nào. Hãy là người đầu tiên thêm anime vào thư viện!'
                : 'No activity yet. Be the first to add anime to your library!'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <ActivityItem key={item.id} item={item} lang={lang} />
            ))}
          </ul>
        )}

        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void load(false)}
              disabled={loading}
              className="rounded-full border border-border bg-card px-5 py-2 text-sm text-text transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {loading ? '…' : lang === 'vi' ? 'Tải thêm' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </Layout>
  )
}

function ActivityItem({ item, lang }: { item: ActivityRow; lang: 'vi' | 'en' }) {
  const name = item.display_name || item.username || (lang === 'vi' ? 'Thành viên' : 'A member')
  const profileLink = `/profile/${item.user_id}`

  const { Icon, tone, message, link } = describe(item, lang)

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <ReloadLink to={profileLink} className="flex-shrink-0">
        <UserAvatar src={item.avatar_url} name={name} badges={item.badges ?? []} size={40} />
      </ReloadLink>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <ReloadLink to={profileLink} className="font-semibold text-text hover:text-primary">
            {name}
          </ReloadLink>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full ${tone}`}>
            <Icon className="h-3 w-3" />
          </span>
          <time className="ml-auto flex-shrink-0 text-xs text-text-muted">{relativeTime(item.created_at, lang)}</time>
        </div>
        <p className="mt-0.5 text-sm text-text-muted">{message}</p>

        {link && item.anime_cover && (
          <ReloadLink
            to={link}
            className="mt-2 inline-flex items-center gap-3 rounded-xl bg-background/60 p-2 text-xs transition-colors hover:bg-surface"
          >
            <img
              src={item.anime_cover}
              alt={item.anime_title ?? ''}
              className="h-12 w-9 rounded object-cover"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
            />
            <span className="font-medium text-text">{item.anime_title}</span>
          </ReloadLink>
        )}
      </div>
    </li>
  )
}

function describe(item: ActivityRow, lang: 'vi' | 'en') {
  switch (item.kind) {
    case 'library_add':
      return {
        Icon: BookmarkPlus,
        tone: 'bg-emerald-500/20 text-emerald-400',
        message: lang === 'vi' ? 'vừa thêm vào thư viện' : 'added to their library',
        link: item.anime_id ? `/anime/${item.anime_id}` : null,
      }
    case 'library_complete':
      return {
        Icon: CheckCircle2,
        tone: 'bg-blue-500/20 text-blue-400',
        message: lang === 'vi' ? 'vừa hoàn thành' : 'completed',
        link: item.anime_id ? `/anime/${item.anime_id}` : null,
      }
    case 'collection_create':
      return {
        Icon: PlusCircle,
        tone: 'bg-purple-500/20 text-purple-400',
        message: lang === 'vi'
          ? `tạo bộ sưu tập "${item.meta?.title ?? '…'}"`
          : `created collection "${item.meta?.title ?? '…'}"`,
        link: item.collection_id ? `/collections#${item.collection_id}` : null,
      }
    case 'review_post':
      return {
        Icon: Star,
        tone: 'bg-yellow-500/20 text-yellow-400',
        message: lang === 'vi' ? 'vừa đăng review' : 'posted a review',
        link: item.anime_id ? `/anime/${item.anime_id}` : null,
      }
    case 'comment_post':
      return {
        Icon: Heart,
        tone: 'bg-pink-500/20 text-pink-400',
        message: lang === 'vi' ? 'vừa bình luận' : 'left a comment',
        link: item.anime_id ? `/anime/${item.anime_id}` : null,
      }
    case 'badge_earned':
      return {
        Icon: Star,
        tone: 'bg-amber-500/20 text-amber-400',
        message: lang === 'vi' ? `vừa đạt huy hiệu "${item.badge_id}"` : `earned "${item.badge_id}" badge`,
        link: null,
      }
    case 'edit_approved':
      return {
        Icon: CheckCircle2,
        tone: 'bg-cyan-500/20 text-cyan-400',
        message: lang === 'vi' ? 'có chỉnh sửa được duyệt' : 'had an edit approved',
        link: item.anime_id ? `/anime/${item.anime_id}` : null,
      }
    default:
      return {
        Icon: Heart,
        tone: 'bg-text-muted/20 text-text-muted',
        message: '…',
        link: null,
      }
  }
}

function relativeTime(iso: string, lang: 'vi' | 'en'): string {
  const date = new Date(iso)
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return lang === 'vi' ? 'vừa xong' : 'just now'
  if (diff < 3600) return lang === 'vi' ? `${Math.floor(diff / 60)} phút trước` : `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return lang === 'vi' ? `${Math.floor(diff / 3600)} giờ trước` : `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return lang === 'vi' ? `${Math.floor(diff / 86400)} ngày trước` : `${Math.floor(diff / 86400)}d ago`
  return date.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US')
}
