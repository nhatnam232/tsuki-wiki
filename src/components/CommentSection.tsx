import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowBigDown,
  ArrowBigUp,
  ChevronDown,
  ChevronUp,
  Flag,
  ImagePlus,
  Loader2,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Send,
  Share2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { API_READY, comments as commentsApi, connectRealtime, mediaUrl, uploadMedia } from '@/lib/backend'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import AuthModal from './AuthModal'
import EmptyComments from './EmptyComments'
import MarkdownToolbar, { applyMarkdownShortcut } from './MarkdownToolbar'
import UserAvatar from './UserAvatar'
import {
  BadgeRow,
  canDeleteComment,
  computeAutoBadges,
  isModerator,
  mergeBadges,
  type BadgeId,
} from '@/lib/badges'
import { MarkdownText } from '@/lib/markdown'


type EntityType = 'anime' | 'character'

type AuthorProfile = {
  display_name: string | null
  avatar_url: string | null
  username: string | null
  created_at?: string | null
  badges?: string[] | null
  comments_count?: number | null
  library_count?: number | null
  reviews_count?: number | null
}

type CommentRecord = {
  id: string
  user_id: string
  entity_type: EntityType
  entity_id: number
  parent_id: string | null
  body: string
  image_url: string | null
  is_deleted: boolean
  created_at: string
}

type CommentRow = CommentRecord & {
  author?: AuthorProfile | null
  upvotes: number
  downvotes: number
  myVote: -1 | 0 | 1
}

type Props = {
  entityType: EntityType
  entityId: number
}

const COLLAPSE_THRESHOLD = 320 // characters

export default function CommentSection({ entityType, entityId }: Props) {
  const { user, profile } = useAuth()
  const { t, lang } = useLangContext()
  const toast = useToast()
  const [rows, setRows] = useState<CommentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [pendingImage, setPendingImage] = useState<File | null>(null)
  const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const viewerIsMod = isModerator(profile)


  const onPickImage = (file: File | null) => {
    if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview)
    setPendingImage(file)
    setPendingImagePreview(file ? URL.createObjectURL(file) : null)
  }

  useEffect(
    () => () => {
      if (pendingImagePreview) URL.revokeObjectURL(pendingImagePreview)
    },
    [pendingImagePreview],
  )

  const formatWhen = (iso: string) => {
    const d = new Date(iso)
    const diff = (Date.now() - d.getTime()) / 1000
    if (diff < 60) return t.justNow
    if (diff < 3600) return t.minutesAgo(Math.floor(diff / 60))
    if (diff < 86400) return t.hoursAgo(Math.floor(diff / 3600))
    if (diff < 7 * 86400) return t.daysAgo(Math.floor(diff / 86400))
    return d.toLocaleDateString()
  }

  const load = useCallback(async () => {
    if (!API_READY) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await commentsApi.list(entityType, entityId, { limit: 500 })
      const items = (res.items ?? []) as Array<Record<string, unknown>>
      const mapped: CommentRow[] = items.map((raw) => {
        const author: AuthorProfile | null = raw.username || raw.display_name || raw.avatar_url
          ? {
              display_name: (raw.display_name as string | null) ?? null,
              avatar_url: (raw.avatar_url as string | null) ?? null,
              username: (raw.username as string | null) ?? null,
              created_at: null,
              badges: [],
              comments_count: 0,
              library_count: 0,
              reviews_count: 0,
            }
          : null
        return {
          id: String(raw.id),
          user_id: String(raw.user_id),
          entity_type: String(raw.entity_type) as EntityType,
          entity_id: Number(raw.entity_id),
          parent_id: (raw.parent_id as string | null) ?? null,
          body: String(raw.body ?? ''),
          image_url: mediaUrl((raw.image_url as string | null) ?? null),
          is_deleted: Boolean(raw.is_deleted),
          created_at: String(raw.created_at),
          author,
          upvotes: Number(raw.upvotes ?? 0),
          downvotes: Number(raw.downvotes ?? 0),
          myVote: ((raw.my_vote ?? 0) as -1 | 0 | 1),
        }
      })
      setRows(mapped)
    } catch (err) {
      console.warn('[comments] load failed', err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [entityId, entityType, user])

  useEffect(() => {
    void load()
  }, [load])

  // Realtime updates for this entity's comment room.
  useEffect(() => {
    if (!API_READY) return
    const dispose = connectRealtime([`comments:${entityType}:${entityId}`], (event) => {
      if (event.type.startsWith('comment:')) void load()
    })
    return () => dispose()
  }, [entityId, entityType, load])

  const tree = useMemo(() => {
    const byParent = new Map<string | null, CommentRow[]>()
    rows.forEach((r) => {
      const list = byParent.get(r.parent_id) ?? []
      list.push(r)
      byParent.set(r.parent_id, list)
    })
    // Sort top-level by score desc, replies by created asc.
    byParent.forEach((list, key) => {
      if (key === null) {
        list.sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes))
      }
    })
    return byParent
  }, [rows])

  const submit = async (text: string, parent: string | null = null, attachImage = false) => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    const trimmed = text.trim()
    if (!trimmed && !(attachImage && pendingImage)) return

    setSubmitting(true)

    let imageUrl: string | null = null
    if (attachImage && pendingImage) {
      try {
        imageUrl = mediaUrl(await uploadMedia('comment-images', pendingImage))
      } catch (err) {
        setSubmitting(false)
        toast.error(
          lang === 'vi' ? 'Tải ảnh thất bại' : 'Image upload failed',
          err instanceof Error ? err.message : 'upload_failed',
        )
        return
      }
    }

    let error: unknown = null
    try {
      await commentsApi.create({
        entity_type: entityType,
        entity_id: entityId,
        parent_id: parent,
        body: trimmed.slice(0, 2000),
        image_url: imageUrl,
      })
    } catch (err) {
      error = err
    }
    setSubmitting(false)

    if (error) {
      toast.error(
        lang === 'vi' ? 'Đăng bình luận thất bại' : 'Failed to post comment',
        error instanceof Error ? error.message : 'create_failed',
      )
      return
    }
    if (parent) {
      setReplyTo(null)
      setReplyBody('')
      toast.success(lang === 'vi' ? 'Đã đăng phản hồi' : 'Reply posted')
    } else {
      setBody('')
      onPickImage(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      toast.success(lang === 'vi' ? 'Đã đăng bình luận' : 'Comment posted')
    }
    void load()
  }

  const remove = async (id: string) => {
    if (!user) return
    try {
      await commentsApi.remove(id)
    } catch (err) {
      toast.error(
        lang === 'vi' ? 'Xóa bình luận thất bại' : 'Failed to delete comment',
        err instanceof Error ? err.message : 'delete_failed',
      )
      return
    }
    toast.info(lang === 'vi' ? 'Đã xóa bình luận' : 'Comment deleted')
    void load()
  }

  const vote = async (commentId: string, value: -1 | 1) => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    // Optimistic update.
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== commentId) return r
        const wasUp = r.myVote === 1
        const wasDown = r.myVote === -1
        const isToggle = r.myVote === value
        const next = isToggle ? 0 : value
        return {
          ...r,
          myVote: next as -1 | 0 | 1,
          upvotes: r.upvotes + (next === 1 ? 1 : 0) - (wasUp ? 1 : 0),
          downvotes: r.downvotes + (next === -1 ? 1 : 0) - (wasDown ? 1 : 0),
        }
      }),
    )

    const current = rows.find((r) => r.id === commentId)
    const isToggle = current?.myVote === value
    try {
      if (isToggle) await commentsApi.unvote(commentId)
      else await commentsApi.vote(commentId, value)
    } catch (err) {
      console.warn('[comments] vote failed', err)
      void load()
    }
  }

  const share = async (id: string) => {
    const url = `${window.location.origin}${window.location.pathname}#comment-${id}`
    try {
      if (navigator.share) {
        await navigator.share({ url, title: 'Anime Wiki comment' })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success(lang === 'vi' ? 'Đã sao chép link' : 'Link copied')
      }
    } catch {
      /* user cancelled */
    }
  }

  const renderNode = (node: CommentRow, depth = 0) => {
    const children = tree.get(node.id) ?? []
    return (
      <CommentItem
        key={node.id}
        node={node}
        depth={depth}
        children={children}
        currentUserId={user?.id ?? null}
        viewerIsMod={viewerIsMod}
        replyOpen={replyTo === node.id}

        replyBody={replyBody}
        submitting={submitting}
        formatWhen={formatWhen}
        onToggleReply={() => {
          setReplyTo(replyTo === node.id ? null : node.id)
          setReplyBody('')
        }}
        onChangeReplyBody={setReplyBody}
        onSubmitReply={() => void submit(replyBody, node.id)}
        onDelete={() => remove(node.id)}
        onVote={(v) => void vote(node.id, v)}
        onShare={() => void share(node.id)}
        renderNode={renderNode}
      />
    )
  }

  const topLevel = tree.get(null) ?? []

  if (!API_READY) {
    return (
      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold text-white">
          <MessageSquare className="h-6 w-6 text-primary" /> {t.comments}
        </h2>
        <div className="rounded-xl border border-gray-800 bg-card p-6 text-sm text-gray-400">
          {t.commentsDisabled}
        </div>
      </section>
    )
  }

  return (
    <section className="mb-10">
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold text-white">
        <MessageSquare className="h-6 w-6 text-primary" /> {t.comments}
        <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-medium text-primary">
          {rows.length}
        </span>
      </h2>

      {/* Composer (Glassmorphism) */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-4 shadow-xl backdrop-blur-xl">
        {user ? (
          <div className="flex gap-3">
            <UserAvatar
              src={profile?.avatar_url || user.user_metadata?.avatar_url}
              name={profile?.display_name || user.email || 'U'}
              badges={mergeBadges(
                computeAutoBadges({
                  createdAt: profile?.created_at ?? user.created_at,
                  commentsCount: profile?.comments_count ?? 0,
                  libraryCount: profile?.library_count ?? 0,
                  reviewsCount: profile?.reviews_count ?? 0,
                }),
                profile?.badges,
              )}
              size={40}
            />
            <div className="flex-1">

              <textarea
                ref={composerRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => applyMarkdownShortcut(e, body, setBody)}
                placeholder={t.commentPlaceholder}
                rows={3}
                maxLength={2000}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-[15px] leading-relaxed text-white placeholder-gray-500 backdrop-blur transition-all focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {/* Markdown formatting toolbar — bold, italic, spoiler */}
              <div className="mt-2">
                <MarkdownToolbar
                  textareaRef={composerRef}
                  value={body}
                  onChange={setBody}
                />
              </div>

              {pendingImagePreview && (
                <div className="relative mt-2 inline-block">
                  <img
                    src={pendingImagePreview}
                    alt="preview"
                    className="max-h-40 rounded-xl border border-white/10"
                  />
                  <button
                    type="button"
                    onClick={() => onPickImage(null)}
                    className="absolute -right-2 -top-2 rounded-full bg-black/80 p-1 text-gray-200 transition-colors hover:text-white"
                    aria-label="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs ${body.length > 1800 ? 'text-amber-400' : 'text-gray-500'}`}
                  >
                    {body.length}/2000
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 transition-all hover:border-primary/40 hover:text-primary"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {lang === 'vi' ? 'Ảnh' : 'Image'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null
                      if (file && file.size > 5 * 1024 * 1024) {
                        toast.error(lang === 'vi' ? 'Ảnh tối đa 5MB' : 'Max image size is 5MB')
                        e.target.value = ''
                        return
                      }
                      onPickImage(file)
                    }}
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => void submit(body, null, true)}
                  disabled={submitting || (!body.trim() && !pendingImage)}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary via-fuchsia-500 to-pink-500 px-5 py-1.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all hover:shadow-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t.post}
                </motion.button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-gray-300">{t.signInToComment}</span>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setAuthOpen(true)}
              className="rounded-full bg-gradient-to-r from-primary via-fuchsia-500 to-pink-500 px-5 py-1.5 text-sm font-semibold text-white shadow-lg shadow-primary/30"
            >
              {t.signIn}
            </motion.button>
          </div>
        )}
      </div>

      {/* Thread */}
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex animate-pulse gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3"
              >
                <div className="h-9 w-9 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-white/10" />
                  <div className="h-3 w-full rounded bg-white/10" />
                  <div className="h-3 w-2/3 rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        ) : topLevel.length === 0 ? (
          <EmptyComments />
        ) : (

          <AnimatePresence initial={false}>
            {topLevel.map((c) => renderNode(c))}
          </AnimatePresence>
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </section>
  )
}

// ─── Single comment item ─────────────────────────────────────────────────────

type ItemProps = {
  node: CommentRow
  depth: number
  children: CommentRow[]
  currentUserId: string | null
  /** Whether the viewer can moderate (delete) any comment, not just their own. */
  viewerIsMod?: boolean
  replyOpen: boolean
  replyBody: string
  submitting: boolean
  formatWhen: (iso: string) => string
  onToggleReply: () => void
  onChangeReplyBody: (s: string) => void
  onSubmitReply: () => void
  onDelete: () => void
  onVote: (v: -1 | 1) => void
  onShare: () => void
  /** Use any here to avoid pulling React types into export — we only render the result. */
  renderNode: (n: CommentRow, depth?: number) => any
}

function CommentItem({
  node,
  depth,
  children,
  currentUserId,
  viewerIsMod = false,
  replyOpen,
  replyBody,
  submitting,
  formatWhen,
  onToggleReply,
  onChangeReplyBody,
  onSubmitReply,
  onDelete,
  onVote,
  onShare,
  renderNode,
}: ItemProps) {
  const { t, lang } = useLangContext()
  const toast = useToast()
  const [moreOpen, setMoreOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const tooLong = node.body.length > COLLAPSE_THRESHOLD
  const visibleBody = !expanded && tooLong ? node.body.slice(0, COLLAPSE_THRESHOLD) + '…' : node.body

  const authorName = node.author?.display_name || node.author?.username || t.anonymous
  const avatar = node.author?.avatar_url
  const isOwn = currentUserId === node.user_id
  const score = node.upvotes - node.downvotes

  // Compute author badges once for both inline display + ring color.
  const authorBadgeIds: BadgeId[] = mergeBadges(
    computeAutoBadges({
      createdAt: node.author?.created_at,
      commentsCount: node.author?.comments_count ?? 0,
      libraryCount: node.author?.library_count ?? 0,
      reviewsCount: node.author?.reviews_count ?? 0,
    }),
    node.author?.badges ?? [],
  )

  const canDelete = canDeleteComment(
    { id: currentUserId ?? undefined, badges: viewerIsMod ? ['mod'] : [] },
    node.user_id,
  )
  const showAdminDelete = canDelete && !isOwn


  return (
    <motion.div
      id={`comment-${node.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`group relative ${
        depth > 0
          ? 'ml-3 border-l-2 border-white/10 pl-4 sm:ml-5 sm:pl-5'
          : ''
      }`}
    >
      <div
        className={`relative flex gap-3 rounded-2xl p-3 transition-colors hover:bg-white/[0.04] ${
          isOwn ? 'bg-primary/[0.06]' : 'bg-white/[0.02]'
        }`}
      >
        {/* Vote rail (Reddit style) */}
        <div className="flex flex-col items-center gap-0.5 pt-1 text-xs">
          <button
            onClick={() => onVote(1)}
            className={`rounded-md p-0.5 transition-colors ${
              node.myVote === 1 ? 'text-emerald-400' : 'text-gray-400 hover:text-emerald-300'
            }`}
            aria-label="Upvote"
          >
            <ArrowBigUp
              className={`h-5 w-5 ${node.myVote === 1 ? 'fill-current' : ''}`}
              strokeWidth={1.8}
            />
          </button>
          <span
            className={`min-w-[1.5rem] text-center font-semibold tabular-nums ${
              score > 0
                ? 'text-emerald-400'
                : score < 0
                  ? 'text-red-400'
                  : 'text-gray-500'
            }`}
          >
            {score}
          </span>
          <button
            onClick={() => onVote(-1)}
            className={`rounded-md p-0.5 transition-colors ${
              node.myVote === -1 ? 'text-red-400' : 'text-gray-400 hover:text-red-300'
            }`}
            aria-label="Downvote"
          >
            <ArrowBigDown
              className={`h-5 w-5 ${node.myVote === -1 ? 'fill-current' : ''}`}
              strokeWidth={1.8}
            />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          {/* Header — avatar with badge-tinted ring */}
          <div className="flex items-center gap-2 text-sm">
            <UserAvatar
              src={avatar}
              name={authorName}
              badges={authorBadgeIds}
              size={28}
            />
            <span className="truncate font-semibold text-primary">{authorName}</span>
            {isOwn && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {lang === 'vi' ? 'Bạn' : 'you'}
              </span>
            )}
            <BadgeRow ids={authorBadgeIds} lang={lang} max={2} size="xs" />
            <span className="ml-auto text-xs text-gray-500" suppressHydrationWarning>
              {formatWhen(node.created_at)}
            </span>
          </div>

          {/* Body — full markdown rendering with spoiler/bold/italic support */}
          <div className="mt-1.5 break-words text-[15px] leading-relaxed text-gray-100">
            <MarkdownText className="">{visibleBody}</MarkdownText>
          </div>

          {tooLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Thu gọn' : 'Show less'}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Hiện thêm' : 'Show more'}
                </>
              )}
            </button>
          )}
          {node.image_url && (
            <a
              href={node.image_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block overflow-hidden rounded-xl border border-white/10"
            >
              <img
                src={node.image_url}
                alt="comment attachment"
                className="max-h-80 max-w-full object-contain"
                loading="lazy"
              />
            </a>
          )}

          {/* Action bar */}
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-400">
            <button
              onClick={onToggleReply}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${
                replyOpen
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-white/5 hover:text-primary'
              }`}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {t.reply}
            </button>
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 hover:bg-white/5 hover:text-primary"
            >
              <Share2 className="h-3.5 w-3.5" />
              {lang === 'vi' ? 'Chia sẻ' : 'Share'}
            </button>
          </div>

          {/* Reply box */}
          <AnimatePresence initial={false}>
            {replyOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="mt-2 flex gap-2"
              >
                <textarea
                  value={replyBody}
                  onChange={(e) => onChangeReplyBody(e.target.value)}
                  placeholder={t.replyPlaceholder}
                  rows={2}
                  autoFocus
                  className="flex-1 resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[15px] text-white placeholder-gray-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={onSubmitReply}
                  disabled={submitting || !replyBody.trim()}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-start rounded-xl bg-gradient-to-r from-primary via-fuchsia-500 to-pink-500 text-white shadow shadow-primary/30 disabled:opacity-40"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Hover-only "more" menu */}
        <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          <AnimatePresence>
            {moreOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 text-sm shadow-xl backdrop-blur"
              >
                {isOwn && (
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      onDelete()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-red-300 hover:bg-red-500/15"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t.delete}
                  </button>
                )}
                {/* Admin/Mod can delete other users' comments — backed by RLS
                    `is_mod_or_above()` so it's safe even if the UI is bypassed. */}
                {showAdminDelete && (
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      if (
                        window.confirm(
                          lang === 'vi'
                            ? 'Xóa bình luận này với tư cách quản trị viên?'
                            : 'Delete this comment as a moderator?',
                        )
                      ) {
                        onDelete()
                      }
                    }}
                    className="flex w-full items-center gap-2 border-t border-white/5 px-3 py-2 text-rose-300 hover:bg-rose-500/15"
                    title={t.adminDelete}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t.adminDelete}
                  </button>
                )}
                {!isOwn && (
                  <button
                    onClick={() => {
                      setMoreOpen(false)
                      if (window.confirm(t.reportConfirm)) {
                        toast.success(t.reportSent)
                      }
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-gray-200 hover:bg-white/10"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    {lang === 'vi' ? 'Báo cáo' : 'Report'}
                  </button>
                )}

              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Children */}
      {children.length > 0 && (
        <div className="mt-1 space-y-1">
          {children.map((child) => renderNode(child, depth + 1))}
        </div>
      )}
    </motion.div>
  )
}
