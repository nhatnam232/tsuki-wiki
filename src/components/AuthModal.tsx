import { useState } from 'react'
import { CheckCircle2, Loader2, Lock, Mail, User as UserIcon, X } from 'lucide-react'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'

type Mode = 'signin' | 'signup'

type Props = {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}

export default function AuthModal({ open, onClose, initialMode = 'signin' }: Props) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, configured } = useAuth()
  const { t } = useLangContext()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  if (!open) return null

  const reset = () => {
    setEmail('')
    setPassword('')
    setDisplayName('')
    setError(null)
    setEmailSent(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const handleGoogle = async () => {
    setError(null)
    try {
      setLoading(true)
      await signInWithGoogle()
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
        else handleClose()
      } else {
        const res = await signUpWithEmail(email, password, displayName || undefined)
        if (res.error) setError(res.error)
        else if (res.needsConfirmation) setEmailSent(true)
        else handleClose()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-gray-800 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-white"
          aria-label={t.close}
        >
          <X className="h-5 w-5" />
        </button>

        {emailSent ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <h2 className="mb-2 text-xl font-bold text-white">{t.checkInbox}</h2>
            <p className="text-sm text-gray-400">{t.checkInboxMessage(email)}</p>
            <button
              onClick={handleClose}
              className="mt-6 w-full rounded-lg bg-primary py-2 font-medium text-white hover:bg-primary-hover"
            >
              {t.gotIt}
            </button>
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-2xl font-bold text-white">
              {mode === 'signin' ? t.welcomeBack : t.createAccount}
            </h2>
            <p className="mb-6 text-sm text-gray-400">
              {mode === 'signin' ? t.authSigninSubtitle : t.authSignupSubtitle}
            </p>

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

            <div className="mb-4 flex items-center gap-3 text-xs uppercase text-gray-500">
              <div className="h-px flex-1 bg-gray-800" />
              {t.orEmail}
              <div className="h-px flex-1 bg-gray-800" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'signup' && (
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t.displayName}
                    className="w-full rounded-lg border border-gray-700 bg-background py-2 pl-10 pr-3 text-sm text-white placeholder-gray-500 focus:border-primary focus:outline-none"
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-700 bg-background py-2 pl-10 pr-3 text-sm text-white placeholder-gray-500 focus:border-primary focus:outline-none"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.passwordPlaceholder}
                  className="w-full rounded-lg border border-gray-700 bg-background py-2 pl-10 pr-3 text-sm text-white placeholder-gray-500 focus:border-primary focus:outline-none"
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
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === 'signin' ? t.signIn : t.createAccountAction}
              </button>
            </form>

            <div className="mt-4 text-center text-sm text-gray-400">
              {mode === 'signin' ? (
                <>
                  {t.noAccount}{' '}
                  <button
                    onClick={() => {
                      reset()
                      setMode('signup')
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
                      reset()
                      setMode('signin')
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
