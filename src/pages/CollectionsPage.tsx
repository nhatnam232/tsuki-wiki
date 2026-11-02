import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus, Heart, Loader2, Lock, Plus, Sparkles, Unlock, Users } from 'lucide-react'
import Layout from '@/components/Layout'
import Breadcrumbs from '@/components/Breadcrumbs'
import ReloadLink from '@/components/ReloadLink'
import SEO from '@/components/SEO'
import AuthModal from '@/components/AuthModal'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import { API_READY, collections as collectionsApi } from '@/lib/backend'
import { queryKeys } from '@/lib/queryClient'

type Collection = {
  id: string
  user_id: string
  title: string
  description: string | null
  cover_image: string | null
  is_public: boolean
  slug: string | null
  view_count: number
  like_count: number
  item_count: number
  updated_at: string
  created_at: string
}

type Tab = 'public' | 'mine'

export default function CollectionsPage() {
  const { lang } = useLangContext()
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('public')
  const [authOpen, setAuthOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const { data: collections = [], isLoading } = useQuery({
    queryKey: queryKeys.collectionList(tab),
    enabled: API_READY && (tab === 'public' || Boolean(user)),
    queryFn: async (): Promise<Collection[]> => {
      const res = await collectionsApi.list({ mine: tab === 'mine', limit: 50 })
      return ((res.items ?? []) as unknown as Collection[]).slice()
    },
  })

  const { data: myLikes = new Set<string>() } = useQuery({
    queryKey: ['my-collection-likes', user?.id],
    enabled: Boolean(user && API_READY),
    queryFn: async (): Promise<Set<string>> => {
      if (!user) return new Set()
      const res = await collectionsApi.likedIds()
      return new Set(res.ids ?? [])
    },
  })

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      if (!user) throw new Error('not signed in')
      const res = await collectionsApi.create({ title, is_public: true })
      return res.collection as unknown as Collection
    },
    onSuccess: () => {
      setNewTitle('')
      setCreating(false)
      qc.invalidateQueries({ queryKey: queryKeys.collectionList('mine') })
      toast.success(lang === 'vi' ? 'Đã tạo bộ sưu tập' : 'Collection created')
    },
    onError: (err: any) => {
      toast.error(lang === 'vi' ? 'Tạo thất bại' : 'Create failed', err.message)
    },
  })

  const toggleLike = useMutation({
    mutationFn: async ({ id, liked }: { id: string; liked: boolean }) => {
      if (!user) throw new Error('not signed in')
      if (liked) {
        await collectionsApi.unlike(id)
      } else {
        await collectionsApi.like(id)
      }
    },
    onMutate: async ({ id, liked }) => {
      const key = queryKeys.collectionList(tab)
      const myLikesKey = ['my-collection-likes', user?.id]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Collection[]>(key) ?? []
      const prevLikes = qc.getQueryData<Set<string>>(myLikesKey) ?? new Set()
      qc.setQueryData<Collection[]>(
        key,
        prev.map((c) =>
          c.id === id
            ? { ...c, like_count: Math.max(0, c.like_count + (liked ? -1 : 1)) }
            : c,
        ),
      )
      const newLikes = new Set(prevLikes)
      if (liked) newLikes.delete(id)
      else newLikes.add(id)
      qc.setQueryData(myLikesKey, newLikes)
      return { prev, prevLikes, key, myLikesKey }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      qc.setQueryData(ctx.key, ctx.prev)
      qc.setQueryData(ctx.myLikesKey, ctx.prevLikes)
    },
  })

  return (
    <Layout>
      <SEO
        title={lang === 'vi' ? 'Bộ sưu tập' : 'Collections'}
        description={
          lang === 'vi'
            ? 'Khám phá và tạo bộ sưu tập anime để chia sẻ với cộng đồng.'
            : 'Discover and create themed anime collections shared by the community.'
        }
      />

      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Breadcrumbs
          crumbs={[{ name: lang === 'vi' ? 'Bộ sưu tập' : 'Collections' }]}
        />

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
              <BookmarkPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text">
                {lang === 'vi' ? 'Bộ Sưu Tập' : 'Collections'}
              </h1>
              <p className="text-sm text-text-muted">
                {lang === 'vi'
                  ? 'Tạo danh sách anime theo chủ đề và chia sẻ với fan khác'
                  : 'Curate themed anime lists and share them with other fans'}
              </p>
            </div>
          </div>

          {user ? (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg shadow-primary/30 hover:bg-primary-hover"
            >
              <Plus className="h-4 w-4" />
              {lang === 'vi' ? 'Tạo bộ mới' : 'New collection'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className="rounded-full border border-border px-4 py-2 text-sm text-text hover:border-primary"
            >
              {lang === 'vi' ? 'Đăng nhập để tạo' : 'Sign in to create'}
            </button>
          )}
        </div>

        {/* Inline create */}
        {creating && (
          <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <p className="mb-2 text-xs font-medium text-primary">
              {lang === 'vi' ? 'Tên bộ sưu tập' : 'Collection title'}
            </p>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={
                  lang === 'vi'
                    ? 'VD: Top 10 Isekai có main bá đạo'
                    : 'e.g. Top 10 Isekai with overpowered MC'
                }
                maxLength={100}
                className="flex-1 rounded-xl border border-border bg-background px-4 py-2 text-sm text-text focus:border-primary focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim().length >= 3) {
                    void createMutation.mutateAsync(newTitle.trim())
                  }
                }}
              />
              <button
                type="button"
                disabled={createMutation.isPending || newTitle.trim().length < 3}
                onClick={() => void createMutation.mutateAsync(newTitle.trim())}
                className="inline-flex items-center gap-1 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {lang === 'vi' ? 'Tạo' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 inline-flex gap-1 rounded-xl border border-border bg-card p-1">
          <button
            onClick={() => setTab('public')}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'public' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'Cộng đồng' : 'Community'}
          </button>
          <button
            onClick={() => {
              if (!user) {
                setAuthOpen(true)
                return
              }
              setTab('mine')
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'mine' ? 'bg-primary text-white' : 'text-text-muted hover:text-text'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'Của tôi' : 'Mine'}
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 py-16 text-center">
            <BookmarkPlus className="mb-3 h-12 w-12 text-text-muted/40" />
            <h3 className="mb-1 text-lg font-bold text-text">
              {lang === 'vi' ? 'Chưa có bộ nào' : 'No collections yet'}
            </h3>
            <p className="text-sm text-text-muted">
              {tab === 'mine'
                ? lang === 'vi' ? 'Bấm "Tạo bộ mới" để bắt đầu' : 'Click "New collection" to start'
                : lang === 'vi' ? 'Hãy là người đầu tiên tạo bộ sưu tập!' : 'Be the first to publish a list!'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((c) => {
              const liked = myLikes.has(c.id)
              return (
                <article
                  key={c.id}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
                >
                  <ReloadLink
                    to={`/collections/${c.slug ?? c.id}`}
                    className="block aspect-[16/9] overflow-hidden bg-gradient-to-br from-primary/30 via-fuchsia-500/20 to-pink-500/20"
                  >
                    {c.cover_image ? (
                      <img
                        src={c.cover_image}
                        alt={c.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <BookmarkPlus className="h-12 w-12 text-white/30" />
                      </div>
                    )}
                  </ReloadLink>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <ReloadLink
                        to={`/collections/${c.slug ?? c.id}`}
                        className="line-clamp-2 text-base font-bold text-text hover:text-primary"
                      >
                        {c.title}
                      </ReloadLink>
                      {c.is_public ? (
                        <Unlock className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-muted">{c.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                      <span>{c.item_count} {lang === 'vi' ? 'anime' : 'anime'}</span>
                      <button
                        type="button"
                        disabled={!user}
                        onClick={() => {
                          if (!user) return setAuthOpen(true)
                          void toggleLike.mutateAsync({ id: c.id, liked })
                        }}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
                          liked
                            ? 'bg-rose-500/15 text-rose-400'
                            : 'hover:bg-surface hover:text-text'
                        }`}
                        aria-pressed={liked}
                      >
                        <Heart className={`h-3 w-3 ${liked ? 'fill-current' : ''}`} />
                        {c.like_count}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </Layout>
  )
}
