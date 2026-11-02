import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
// Type tối thiểu thay cho client Supabase cũ (đã loại bỏ).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type SessionUser = {
  id: string
  email?: string | null
  created_at?: string
  last_sign_in_at?: string | null
  user_metadata?: Record<string, any>
  app_metadata?: Record<string, any>
  [key: string]: any
}
export type Session = { user: SessionUser } | null
type User = SessionUser
import { API_READY, auth as authApi, profiles as profilesApi, uploadMedia } from '@/lib/backend'

export type Profile = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  cover_url: string | null
  gender: 'male' | 'female' | 'other' | 'prefer_not_to_say' | null
  birthday: string | null
  spotify_url: string | null
  bio: string | null
  created_at?: string | null
  badges?: string[] | null
  comments_count?: number | null
  library_count?: number | null
  reviews_count?: number | null
}


type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  signInWithGoogle: () => Promise<void>
  signInWithEmail: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<{ error?: string }>
  signUpWithEmail: (
    email: string,
    password: string,
    displayName?: string,
    captchaToken?: string,
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>
  refreshProfile: () => Promise<void>
  updateProfile: (updates: {
    username?: string | null
    display_name?: string | null
    avatar_url?: string | null
    cover_url?: string | null
    gender?: Profile['gender']
    birthday?: string | null
    spotify_url?: string | null
    bio?: string | null
  }) => Promise<{ error?: string }>
  uploadAvatar: (file: File) => Promise<{ error?: string; url?: string }>
  uploadCover: (file: File) => Promise<{ error?: string; url?: string }>
  removeCover: () => Promise<{ error?: string }>
  signOut: () => Promise<void>
}


const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function fetchProfile(_userId: string): Promise<Profile | null> {
  try {
    const res = await profilesApi.me()
    return (res.profile as unknown as Profile) ?? null
  } catch {
    return null
  }
}

async function ensureProfileRow(_user: User) {
  // server-v2 tạo profiles row ngay trong register/OAuth callback → không cần upsert.
  return
  void _user

}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    const currentUser = session?.user
    if (!currentUser) {
      setProfile(null)
      return
    }

    await ensureProfileRow(currentUser)
    const nextProfile = await fetchProfile(currentUser.id)
    setProfile(nextProfile)
  }, [session?.user])

  useEffect(() => {
    if (!API_READY) {
      setLoading(false)
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const me = await authApi.me()
        if (cancelled) return
        setSession(me as never)
        setProfile((me as unknown as { profile: Profile | null }).profile ?? null)
      } catch {
        // access token hết hạn → thử refresh (refresh cookie path /api/auth)
        try {
          const refreshed = await authApi.refresh()
          if (!cancelled) setSession(refreshed as never)
        } catch {
          if (!cancelled) { setSession(null); setProfile(null) }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }

  }, [])

  const signInWithGoogle = useCallback(async () => {
    window.location.href = authApi.googleStartUrl()
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string, captchaToken?: string) => {
    void captchaToken
    try {
      await authApi.login(email, password)
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'login_failed' }
    }
  }, [])

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string, _captchaToken?: string) => {
      void displayName
      try {
        await authApi.register(email, password, email.split('@')[0] ?? 'user')
        return { needsConfirmation: false }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'register_failed' }
      }
    },
    [],
  )

  const updateProfile = useCallback(
    async (updates: {
      username?: string | null
      display_name?: string | null
      avatar_url?: string | null
      cover_url?: string | null
      gender?: Profile['gender']
      birthday?: string | null
      spotify_url?: string | null
      bio?: string | null
    }) => {

      const currentUser = session?.user
      if (!currentUser) return { error: 'You need to sign in first.' }

      try {
        await profilesApi.updateMe(updates as never)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'update_failed' }
      }


      await refreshProfile()
      return {}
    },
    [profile?.avatar_url, profile?.display_name, refreshProfile, session?.user],
  )

  const uploadAvatar = useCallback(
    async (file: File) => {
      const currentUser = session?.user
      if (!currentUser) return { error: 'You need to sign in first.' }
      if (!file.type.startsWith('image/')) return { error: 'Please choose an image file.' }
      if (file.size > 2 * 1024 * 1024) return { error: 'Avatar must be 2 MB or smaller.' }


      let url: string
      try {
        url = await uploadMedia('avatars', file)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Upload failed' }
      }
      const updateResult = await updateProfile({ avatar_url: url })
      if (updateResult.error) return updateResult

      return { url }
    },
    [session?.user, updateProfile],
  )

  /**
   * Upload a banner / cover image (1500×500 recommended) to the `covers`
   * bucket. Larger size limit than avatar (5 MB) since covers are wider.
   */
  const uploadCover = useCallback(
    async (file: File) => {
      const currentUser = session?.user
      if (!currentUser) return { error: 'You need to sign in first.' }
      if (!file.type.startsWith('image/')) return { error: 'Please choose an image file.' }
      if (file.size > 5 * 1024 * 1024) return { error: 'Cover must be 5 MB or smaller.' }


      let url: string
      try {
        url = await uploadMedia('covers', file)
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Upload failed' }
      }
      const updateResult = await updateProfile({ cover_url: url })
      if (updateResult.error) return updateResult

      return { url }
    },
    [session?.user, updateProfile],
  )

  /** Clear the user's cover image (sets cover_url back to null). */
  const removeCover = useCallback(async () => {
    return updateProfile({ cover_url: null })
  }, [updateProfile])

  const signOut = useCallback(async () => {
    // Trigger CSS fade-out so the transition feels intentional, not janky.
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('is-signing-out')
    }
    await authApi.logout()
    setProfile(null)
    // Tiny delay to let the fade animation breathe, then hard-reload to wipe
    // any lingering React Query cache, ToS modal state, etc.
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        window.location.assign('/')
      }, 350)
    }
  }, [])


  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      loading,
      configured: API_READY,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      refreshProfile,
      updateProfile,
      uploadAvatar,
      uploadCover,
      removeCover,
      signOut,
    }),
    [
      loading,
      profile,
      refreshProfile,
      session,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      signUpWithEmail,
      updateProfile,
      uploadAvatar,
      uploadCover,
      removeCover,
    ],
  )


  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
