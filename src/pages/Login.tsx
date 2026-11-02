import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from 'lucide-react'
import Layout from '@/components/Layout'
import SEO from '@/components/SEO'
import SocialLinks from '@/components/SocialLinks'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'

type Mode = 'signin' | 'signup'

/**
 * Standalone /login page (replaces the previous modal-only flow).
 *
 *   • Solves "tôi muốn login nó chuyển hướng ra trang login luôn thay vì ở
 *     lại và hcaptcha vẫn chưa hiện" — the captcha is now mounted at the top
 *     of a full page, so it always renders.
 *   • Honors a `?next=/some/path` redirect after successful sign-in.
 *   • Same logic as AuthModal so the modal can keep working in places where
 *     redirecting away would interrupt the user (e.g. comment box).
 */
export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, configured, user } = useAuth()
  const { t, lang } = useLangContext()

  const params = new URLSearchParams(location.search)
  const initialMode = (params.get('mode') === 'signup' ? 'signup' : 'signin') as Mode
  const nextPath = params.get('next') || '/'

  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  // Already signed in? bounce to ?next= or homepage
  useEffect(() => {
    if (user) {
      navigate(nextPath, { replace: true })
    }
  }, [user, nextPath, navigate])


  const handleGoogle = async () => {
    setError(null)
    try {
      setLoading(true)
      await signInWithGoogle()
      // OAuth redirects, so nothing else to do here.
    } catch (e: any) {
      setError(e?.message || t.googleSignInFailed)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (mode === 'signin') {
        const res = await signInWithEmail(email, password)
        if (res.error) setError(res.error)
        else navigate(nextPath, { replace: true })
      } else {
        const res = await signUpWithEmail(
          email,
          password,
          displayName || undefined,
        )
        if (res.error) setError(res.error)
        else if (res.needsConfirmation) setEmailSent(true)
        else navigate(nextPath, { replace: true })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <SEO
        title={mode === 'signin' ? `${t.signIn} • Anime Wiki` : `${t.createAccount} • Anime Wiki`}
        description={mode === 'signin' ? t.authSigninSubtitle : t.authSignupSubtitle}
        noIndex
      />

      <div className="container mx-auto grid min-h-[calc(100vh-12rem)] place-items-center px-4 py-12">
        <div className="grid w-full max-w-5xl gap-10 md:grid-cols-2">
          {/* Marketing column */}
          <aside className="hidden flex-col justify-between rounded-3xl bg-gradient-to-br from-primary via-primary-hover to-primary-dark p-8 text-white shadow-2xl md:flex keep-white-on-light">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'Cộng đồng anime đang chờ bạn' : 'Anime community awaits'}
              </span>
              <h1 className="mt-4 text-3xl font-bold leading-tight md:text-4xl">
                {mode === 'signin' ? t.welcomeBack : t.createAccount}
              </h1>
              <p className="mt-3 max-w-sm text-sm text-white/85">
                {lang === 'vi'
                  ? 'Lưu yêu thích, tham gia thảo luận, đóng góp chỉnh sửa, lên cấp huy hiệu — tất cả miễn phí.'
                  : 'Save favorites, join discussions, contribute edits, level up your badges — all free.'}
              </p>
            </div>
            <div className="space-y-4">
              <ul className="space-y-2 text-sm">
                {[
                  lang === 'vi' ? '30,000+ anime với điểm số cộng đồng' : '30,000+ anime with community scores',
                  lang === 'vi' ? 'Đồng bộ thư viện cá nhân' : 'Sync your personal library',
                  lang === 'vi' ? 'Bộ sưu tập, so sánh, lịch chiếu' : 'Collections, compare, schedule',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span className="text-white/90">{item}</span>
                  </li>
                ))}
              </ul>
              <SocialLinks />
            </div>
          </aside>

          {/* Form column */}
          <div className="rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-8">
            {emailSent ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
                <h2 className="mb-2 text-xl font-bold text-text">{t.checkInbox}</h2>
                <p className="text-sm text-text-muted">{t.checkInboxMessage(email)}</p>
                <button
                  onClick={() => navigate('/', { replace: true })}
                  className="mt-6 w-full rounded-lg bg-primary py-2 font-medium text-white hover:bg-primary-hover"
                >
                  {t.gotIt}
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold text-text">
                    {mode === 'signin' ? t.welcomeBack : t.createAccount}
                  </h2>
                  <p className="mt-1 text-sm text-text-muted">
                    {mode === 'signin' ? t.authSigninSubtitle : t.authSignupSubtitle}
                  </p>
                </div>

                {!configured && (
                  <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                    {t.authNotConfigured}
                  </div>
                )}


                <button
                  onClick={handleGoogle}
                  disabled={loading || !configured}
                  className="mb-4 flex w-full items-center justify-center gap-3 rounded-lg border border-gray-700 bg-white py-2.5 font-medium text-gray-800 transition hover:bg-gray-100 disabled:opacity-50"
                >
                  <GoogleIcon className="h-5 w-5" />
                  {t.continueWithGoogle}
                </button>

                <div className="mb-4 flex items-center gap-3 text-xs uppercase text-text-muted">
                  <div className="h-px flex-1 bg-border" />
                  {t.orEmail}
                  <div className="h-px flex-1 bg-border" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {mode === 'signup' && (
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t.displayName}
                        className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-sm text-text placeholder-text-muted focus:border-primary focus:outline-none"
                      />
                    </div>
                  )}
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-sm text-text placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.passwordPlaceholder}
                      className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-sm text-text placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !configured}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="h-4 w-4" />
                    )}
                    {mode === 'signin' ? t.signIn : t.createAccountAction}
                  </button>
                </form>

                <div className="mt-4 text-center text-sm text-text-muted">
                  {mode === 'signin' ? (
                    <>
                      {t.noAccount}{' '}
                      <button
                        onClick={() => {
                          setMode('signup')
                          setError(null)
                        }}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.signUp}
                      </button>
                    </>
                  ) : (
                    <>
                      {t.alreadyHaveAccount}{' '}
                      <button
                        onClick={() => {
                          setMode('signin')
                          setError(null)
                        }}
                        className="font-medium text-primary hover:underline"
                      >
                        {t.signIn}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}

function GoogleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.2-1.7 3.5-5.5 3.5-3.31 0-6-2.74-6-6.1s2.69-6.1 6-6.1c1.89 0 3.15.8 3.87 1.5l2.64-2.55C16.9 2.77 14.66 2 12 2 6.98 2 2.95 6.02 2.95 11s4.03 9 9.05 9c5.23 0 8.7-3.67 8.7-8.84 0-.6-.07-1.06-.16-1.52H12z"
      />
    </svg>
  )
}
