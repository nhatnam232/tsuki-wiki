import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  BookOpen,
  Camera,
  Heart,
  ImagePlus,
  Loader2,
  Mail,
  Music2,
  PauseCircle,
  PlayCircle,
  Save,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import AuthModal from '@/components/AuthModal'
import ReloadLink from '@/components/ReloadLink'
import SpotifyEmbed from '@/components/SpotifyEmbed'
import UserAvatar from '@/components/UserAvatar'
import QuestsPanel from '@/components/QuestsPanel'
import ProfileSpotifyBadge from '@/components/ProfileSpotifyBadge'
import DatePicker from '@/components/DatePicker'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { useToast } from '@/providers/ToastProvider'
import { useNowPlaying } from '@/providers/NowPlayingProvider'
import { useFavoritesStore } from '@/store/useFavoritesStore'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import {
  BadgeRow,
  computeAutoBadges,
  getStaffRole,
  mergeBadges,
  type BadgeId,
} from '@/lib/badges'
import { localizeWatchStatus } from '@/lib/formatters'

type ServerFavorite = {
  anime_id: number
  anime_title: string | null
  anime_cover: string | null
  created_at: string
}

type LibraryHistoryEntry = {
  anime_id: number
  anime_title: string
  anime_cover: string | null
  status: 'watching' | 'completed' | 'plan_to_watch' | 'dropped' | 'on_hold'
  current_episode: number
  anime_episodes: number | null
  score: number | null
  updated_at: string
}

type ActivityTab =
  | 'favorites'
  | 'watching'
  | 'completed'
  | 'plan_to_watch'
  | 'dropped'
  | 'on_hold'

export default function Profile() {
  const { t, lang } = useLangContext()
  const {
    user,
    profile,
    loading,
    configured,
    updateProfile,
    uploadAvatar,
    uploadCover,
    removeCover,
    refreshProfile,
  } = useAuth()
  const toast = useToast()
  const nowPlaying = useNowPlaying()
  const favorites = useFavoritesStore((state) => state.favorites)

  const [authOpen, setAuthOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [gender, setGender] = useState<string>('')
  const [birthday, setBirthday] = useState<string>('')
  const [spotifyUrl, setSpotifyUrl] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActivityTab>('favorites')
  const [serverFavorites, setServerFavorites] = useState<ServerFavorite[]>([])
  const [libraryHistory, setLibraryHistory] = useState<LibraryHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // ── Load history ──
  const loadHistory = useCallback(async () => {
    if (!user || !isSupabaseConfigured) return
    setHistoryLoading(true)
    const [{ data: favData }, { data: libData }] = await Promise.all([
      supabase
        .from('favorites')
        .select('anime_id, anime_title, anime_cover, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('user_library')
        .select('anime_id, anime_title, anime_cover, status, current_episode, anime_episodes, score, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(120),
    ])
    setServerFavorites((favData as ServerFavorite[]) ?? [])
    setLibraryHistory((libData as LibraryHistoryEntry[]) ?? [])
    setHistoryLoading(false)
  }, [user])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    setDisplayName(profile?.display_name || user?.user_metadata?.full_name || '')
    setUsername(profile?.username || '')
    setGender(profile?.gender ?? '')
    setBirthday(profile?.birthday ?? '')
    setSpotifyUrl(profile?.spotify_url ?? '')
    setBio(profile?.bio ?? '')
  }, [profile, user?.user_metadata?.full_name])

  // ── Computed ──
  const avatar = profile?.avatar_url || user?.user_metadata?.avatar_url || null
  const cover = profile?.cover_url ?? null
  const profileFields = [
    Boolean(displayName.trim()),
    Boolean(username.trim()),
    Boolean(avatar),
    Boolean(user?.email),
    Boolean(cover),       // count cover toward completion
    Boolean(bio.trim()),  // count bio too — pushes users toward better profile
  ]
  const completion = Math.round(
    (profileFields.filter(Boolean).length / profileFields.length) * 100,
  )

  const viewerBadges: BadgeId[] = profile
    ? mergeBadges(
        computeAutoBadges({
          createdAt: profile.created_at ?? user?.created_at,
          commentsCount: profile.comments_count ?? 0,
          libraryCount: profile.library_count ?? 0,
          reviewsCount: profile.reviews_count ?? 0,
        }),
        profile.badges,
      )
    : []
  const staffRole = getStaffRole(profile)

  // ── Activity tabs ──
  const activityTabCounts = useMemo(() => {
    const counts: Record<ActivityTab, number> = {
      favorites: serverFavorites.length,
      watching: 0,
      completed: 0,
      plan_to_watch: 0,
      dropped: 0,
      on_hold: 0,
    }
    libraryHistory.forEach((entry) => {
      counts[entry.status as ActivityTab]++
    })
    return counts
  }, [serverFavorites.length, libraryHistory])

  const activityList = useMemo(() => {
    if (activeTab === 'favorites') return null // handled separately (different shape)
    return libraryHistory.filter((e) => e.status === activeTab)
  }, [activeTab, libraryHistory])

  // ── Handlers ──
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)

    const res = await updateProfile({
      display_name: displayName.trim() || null,
      username: username.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || null,
      gender: (gender as any) || null,
      birthday: birthday || null,
      spotify_url: spotifyUrl.trim() || null,
      bio: bio.trim() || null,
    })

    setSaving(false)
    if (res.error) {
      setError(res.error)
      toast.error(lang === 'vi' ? 'Lưu hồ sơ thất bại' : 'Save failed', res.error)
      return
    }

    setMessage(t.profileUpdated)
    toast.success(t.profileUpdated)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    setMessage(null)
    const res = await uploadAvatar(file)
    setUploading(false)
    if (res.error) {
      setError(res.error)
      toast.error(lang === 'vi' ? 'Tải ảnh đại diện thất bại' : 'Avatar upload failed', res.error)
      return
    }
    setMessage(t.avatarUpdated)
    toast.success(t.avatarUpdated)
    e.target.value = ''
  }

  const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingCover(true)
    setError(null)
    setMessage(null)
    const res = await uploadCover(file)
    setUploadingCover(false)
    if (res.error) {
      setError(res.error)
      toast.error(lang === 'vi' ? 'Tải ảnh bìa thất bại' : 'Cover upload failed', res.error)
      return
    }
    setMessage(t.coverUploaded)
    toast.success(t.coverUploaded)
    e.target.value = ''
  }

  const handleRemoveCover = async () => {
    const res = await removeCover()
    if (res.error) {
      toast.error(lang === 'vi' ? 'Xóa ảnh bìa thất bại' : 'Remove cover failed', res.error)
      return
    }
    toast.info(lang === 'vi' ? 'Đã xóa ảnh bìa' : 'Cover removed')
  }

  const handlePlaySpotify = () => {
    if (!profile?.spotify_url) return
    nowPlaying.setTrack({
      url: profile.spotify_url,
      title: profile.display_name ?? profile.username ?? undefined,
      fromUser: profile.username ?? undefined,
    })
    toast.info(
      lang === 'vi' ? 'Đang phát nhạc của bạn' : 'Now playing your track',
      lang === 'vi' ? 'Sẽ tiếp tục phát khi đổi trang' : 'It will keep playing across pages',
    )
  }

  const isCurrentTrack = nowPlaying.track?.url === profile?.spotify_url

  // ── Loading / not-configured / not-signed-in branches ──
  if (!configured) {
    return (
      <Layout>
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-6 text-yellow-100">
            {t.profileUnavailable}
          </div>
        </div>
      </Layout>
    )
  }

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto max-w-4xl px-4 py-16">
          <div className="animate-pulse rounded-3xl border border-border bg-card p-8">
            <div className="mb-6 h-40 w-full rounded-xl bg-surface" />
            <div className="mb-4 h-8 w-48 rounded bg-surface" />
            <div className="h-28 rounded bg-surface" />
          </div>
        </div>
      </Layout>
    )
  }

  if (!user) {
    return (
      <Layout>
        <div className="container mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-3xl border border-border bg-card p-8 text-center">
            <UserRound className="mx-auto mb-4 h-12 w-12 text-primary" />
            <h1 className="text-3xl font-bold text-text">{t.yourProfile}</h1>
            <p className="mt-3 text-text-muted">{t.profileSubtitle}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => setAuthOpen(true)}
                className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                {t.signIn}
              </button>
              <ReloadLink
                to="/"
                className="rounded-full border border-border px-5 py-2 text-sm text-text hover:border-primary"
              >
                {t.backHome}
              </ReloadLink>
            </div>
          </div>
          <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
      </Layout>
    )
  }

  const tabConfig: Array<{
    key: ActivityTab
    label: string
    icon: React.ComponentType<{ className?: string }>
    color: string
  }> = [
    { key: 'favorites',     label: t.activityFavorites,     icon: Heart,    color: 'text-red-400' },
    { key: 'watching',      label: t.activityWatching,      icon: PlayCircle, color: 'text-blue-400' },
    { key: 'completed',     label: t.activityCompleted,     icon: BadgeCheck, color: 'text-green-400' },
    { key: 'plan_to_watch', label: t.activityPlanToWatch,   icon: BookOpen, color: 'text-purple-400' },
    { key: 'on_hold',       label: t.activityOnHold,        icon: PauseCircle, color: 'text-amber-400' },
    { key: 'dropped',       label: t.activityDropped,       icon: Trash2,   color: 'text-rose-400' },
  ]

  return (
    <Layout>
      <div className="container mx-auto max-w-6xl px-4 py-8">
        {/* ─── Cover banner + avatar ─── */}
        <section className="relative mb-24 overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
          <div
            className="relative h-44 w-full overflow-hidden sm:h-56 md:h-64"
            style={
              cover
                ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                : undefined
            }
          >
            {/* Fallback gradient when no cover */}
            {!cover && (
              <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(135deg,rgba(124,58,237,0.55)_0%,rgba(236,72,153,0.45)_50%,rgba(14,165,233,0.55)_100%)]"
              />
            )}
            {/* Subtle dark gradient at bottom for legible buttons */}
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent"
            />

            {/* Floating Spotify badge — anchored to LEFT of the banner so the
                cover edit buttons stay where users expect them on the right.
                Hidden when the user has no Spotify URL set. */}
            {profile?.spotify_url && (
              <div className="absolute left-3 top-3 z-10">
                <ProfileSpotifyBadge
                  spotifyUrl={profile.spotify_url}
                  fromUser={profile.display_name ?? profile.username ?? null}
                />
              </div>
            )}

            {/* Cover edit controls — only shown to the owner */}
            <div className="absolute right-3 top-3 z-10 flex gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={uploadingCover}
                className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/75 disabled:opacity-50"
              >
                {uploadingCover ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {t.changeCover}
              </button>
              {cover && (
                <button
                  type="button"
                  onClick={handleRemoveCover}
                  className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-rose-500/40"
                  title={t.removeCover}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleCoverChange}
              />
            </div>
          </div>

          {/* Avatar overlapping the bottom edge of the cover.
              IMPORTANT: only the avatar gets the negative margin so the
              display-name + @username stay UNDER the banner edge. Putting
              `-mt-14` on the wrapper (old code) pushed the whole text block
              up onto the banner image and made @handle unreadable. */}
          <div className="px-6 pb-6 pt-2 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
                <div className="relative -mt-16 inline-flex sm:-mt-20">
                  <UserAvatar
                    src={avatar}
                    name={displayName || user.email}
                    badges={viewerBadges}
                    size={120}
                    square
                    className="border-4 border-card shadow-2xl"
                  />
                  <label className="absolute bottom-1 right-1 inline-flex cursor-pointer items-center justify-center rounded-full bg-primary p-2 text-white shadow-lg ring-2 ring-card transition-transform hover:scale-110">
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                  </label>
                </div>

                <div className="min-w-0 pt-1">
                  <h1 className="text-2xl font-bold text-text sm:text-3xl">
                    {profile?.display_name || user.user_metadata?.full_name || user.email}
                  </h1>
                  <p className="text-sm font-medium text-text-muted">@{profile?.username || 'user'}</p>
                  {viewerBadges.length > 0 && (
                    <div className="mt-2">
                      <BadgeRow ids={viewerBadges} lang={lang} max={5} size="sm" />
                    </div>
                  )}
                  {staffRole && (
                    <p className="mt-1 text-xs text-text-muted">
                      {lang === 'vi' ? 'Vai trò: ' : 'Role: '}
                      <span className="font-semibold text-primary">
                        {staffRole === 'owner'
                          ? t.ownerLabel
                          : staffRole === 'admin'
                            ? t.adminLabel
                            : t.modLabel}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">{t.favoriteLibrary}</div>
                  <div className="mt-0.5 text-lg font-bold text-text">{serverFavorites.length || favorites.length}</div>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">{t.profileCompletion}</div>
                  <div className="mt-0.5 text-lg font-bold text-text">{completion}%</div>
                </div>
                <div className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">{t.accountStatus}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-base font-semibold text-emerald-400">
                    <BadgeCheck className="h-4 w-4" />
                    {t.accountStatusActive}
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs text-text-muted">{t.coverHint}</p>
          </div>
        </section>

        {/* ─── Edit form + sidebar ─── */}
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="surface-float space-y-4 rounded-3xl border border-border bg-card p-6">
            <div className="space-y-4 text-sm">
              <div>
                <div className="text-text-muted">{t.email}</div>
                <div className="mt-1 flex items-center gap-2 text-text">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="truncate">{user.email}</span>
                </div>
              </div>
              <div>
                <div className="text-text-muted">{t.joined}</div>
                <div className="mt-1 text-text">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString() : t.unknown}
                </div>
              </div>
              <div>
                <div className="text-text-muted">{t.memberIdentity}</div>
                <div className="mt-1 text-text">{profile?.username || t.unknown}</div>
              </div>
            </div>

            {/* Spotify quick-play card — hooks into the global mini-player */}
            {profile?.spotify_url && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-300">
                  <Music2 className="h-3.5 w-3.5" />
                  {t.spotifyMiniLabel}
                </div>
                <button
                  type="button"
                  onClick={isCurrentTrack ? nowPlaying.stop : handlePlaySpotify}
                  className={`flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                    isCurrentTrack
                      ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                      : 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                  }`}
                >
                  {isCurrentTrack ? (
                    <>
                      <PauseCircle className="h-4 w-4" />
                      {lang === 'vi' ? 'Dừng phát' : 'Stop playback'}
                    </>
                  ) : (
                    <>
                      <PlayCircle className="h-4 w-4" />
                      {lang === 'vi' ? 'Phát qua mini player' : 'Play in mini-player'}
                    </>
                  )}
                </button>
              </div>
            )}
          </aside>

          <section className="surface-float rounded-3xl border border-border bg-card p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-text">{t.editProfile}</h2>
              <p className="mt-2 text-sm text-text-muted">{t.updateProfileHint}</p>
            </div>

            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm text-text">{t.displayName}</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={80}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-text">{t.username}</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={30}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
                />
                <p className="mt-2 text-xs text-text-muted">{t.usernameHint}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-text">
                    {lang === 'vi' ? 'Giới tính' : 'Gender'}
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
                  >
                    <option value="">{lang === 'vi' ? 'Không nói' : 'Prefer not to say'}</option>
                    <option value="male">{lang === 'vi' ? 'Nam' : 'Male'}</option>
                    <option value="female">{lang === 'vi' ? 'Nữ' : 'Female'}</option>
                    <option value="other">{lang === 'vi' ? 'Khác' : 'Other'}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-text">
                    {lang === 'vi' ? 'Ngày sinh' : 'Birthday'}
                  </label>
                  {/* Custom themed date-picker — no more native OS chrome */}
                  <DatePicker
                    value={birthday}
                    onChange={setBirthday}
                    max={new Date().toISOString().slice(0, 10)}
                    placeholder={lang === 'vi' ? 'Chọn ngày sinh' : 'Pick your birthday'}
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-text">
                  {lang === 'vi' ? 'Giới thiệu' : 'Bio'}
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder={
                    lang === 'vi'
                      ? 'Giới thiệu vài dòng về bạn...'
                      : 'A few words about you...'
                  }
                  className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-xs text-text-muted">{bio.length}/500</p>
              </div>

              <div>
                <label className="mb-2 block text-sm text-text">
                  {lang === 'vi' ? 'Spotify (URL bài hát/playlist)' : 'Spotify (track or playlist URL)'}
                </label>
                <input
                  type="url"
                  value={spotifyUrl}
                  onChange={(e) => setSpotifyUrl(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/..."
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-text focus:border-primary focus:outline-none"
                />
                {spotifyUrl && (
                  <div className="mt-3">
                    <SpotifyEmbed
                      url={spotifyUrl}
                      title={lang === 'vi' ? 'Xem trước' : 'Preview'}
                    />
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="text-sm font-medium text-text">{t.profileCompletion}</div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
                      style={{ width: `${completion}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-text-muted">{completion}%</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <div className="text-sm font-medium text-text">{t.favoriteLibrary}</div>
                  <p className="mt-2 text-2xl font-bold text-text">
                    {serverFavorites.length || favorites.length}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">{t.publicPresence}</p>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </div>
              )}
              {message && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t.saveChanges}
              </button>
            </form>
          </section>
        </div>

        {/* ─── Activity history with status tabs ─── */}
        <section className="surface-float mt-8 rounded-3xl border border-border bg-card p-6">
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-text">
              {lang === 'vi' ? 'Lịch sử hoạt động' : 'Activity history'}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {lang === 'vi'
                ? 'Quản lý anime theo từng trạng thái xem'
                : 'Browse your anime grouped by watch status'}
            </p>
          </div>

          {/* Status tabs */}
          <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1">
            {tabConfig.map((tab) => {
              const TabIcon = tab.icon
              const count = activityTabCounts[tab.key]
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    activeTab === tab.key
                      ? 'bg-primary text-white shadow-md'
                      : `${tab.color} hover:bg-surface hover:text-text`
                  }`}
                >
                  <TabIcon className="h-4 w-4" />
                  {tab.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${
                    activeTab === tab.key ? 'bg-white/20' : 'bg-surface'
                  }`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {historyLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[3/4] animate-pulse rounded-xl border border-border bg-background/60"
                />
              ))}
            </div>
          ) : activeTab === 'favorites' ? (
            serverFavorites.length === 0 ? (
              <EmptyHistory
                icon={<Heart className="h-10 w-10 text-text-muted/40" />}
                title={lang === 'vi' ? 'Chưa có anime yêu thích' : 'No favorites yet'}
                hint={lang === 'vi' ? 'Nhấn nút ❤️ trên trang anime để lưu lại' : 'Tap the ❤️ button on any anime page to save it here'}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {serverFavorites.map((fav) => (
                  <ReloadLink
                    key={fav.anime_id}
                    to={`/anime/${fav.anime_id}`}
                    className="group overflow-hidden rounded-xl border border-border bg-background/50 transition-all hover:-translate-y-0.5 hover:border-primary/50"
                  >
                    <div className="relative aspect-[3/4] overflow-hidden">
                      {fav.anime_cover ? (
                        <img
                          src={fav.anime_cover}
                          alt={fav.anime_title ?? ''}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-text-muted/40">
                          <Heart className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2">
                        <p className="line-clamp-2 text-xs font-semibold text-white">
                          {fav.anime_title ?? 'Untitled'}
                        </p>
                      </div>
                    </div>
                  </ReloadLink>
                ))}
              </div>
            )
          ) : !activityList || activityList.length === 0 ? (
            <>
              {/* Show quests panel here too so the empty state still gives the
                  user something to do (gamification CTA). */}
              <div className="mb-4">
                <QuestsPanel />
              </div>
              <EmptyHistory
                icon={<BookOpen className="h-10 w-10 text-text-muted/40" />}
                title={t.noActivityForStatus(localizeWatchStatus(activeTab, lang))}
                hint={lang === 'vi' ? 'Thêm anime vào thư viện từ trang chi tiết' : 'Add anime to your library from any anime page'}
              />
            </>
          ) : (
            <div className="space-y-2">
              {activityList.map((entry) => (
                <ReloadLink
                  key={entry.anime_id}
                  to={`/anime/${entry.anime_id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-2.5 transition-all hover:border-primary/40"
                >
                  {entry.anime_cover ? (
                    <img
                      src={entry.anime_cover}
                      alt=""
                      className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-14 w-10 flex-shrink-0 items-center justify-center rounded-md bg-surface text-text-muted/40">
                      <BookOpen className="h-4 w-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold text-text">
                      {entry.anime_title}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                      {entry.anime_episodes ? (
                        <span>{entry.current_episode}/{entry.anime_episodes} {lang === 'vi' ? 'tập' : 'eps'}</span>
                      ) : (
                        <span>{entry.current_episode} {lang === 'vi' ? 'tập' : 'eps'}</span>
                      )}
                      {entry.score !== null && (
                        <span className="flex items-center gap-0.5 text-yellow-500">
                          <Star className="h-3 w-3 fill-current" />
                          {entry.score}/10
                        </span>
                      )}
                      <span className="ml-auto text-text-muted/70">
                        {new Date(entry.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </ReloadLink>
              ))}
            </div>
          )}
        </section>

        {/* Always-visible quests panel (sticky reminder of progress) */}
        <div className="mt-8">
          <QuestsPanel />
        </div>
      </div>
    </Layout>
  )
}

function EmptyHistory({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      {icon}
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="text-xs text-text-muted">{hint}</p>
    </div>
  )
}
