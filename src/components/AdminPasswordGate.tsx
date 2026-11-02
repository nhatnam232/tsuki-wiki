import { useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/AuthProvider'
import { useLangContext } from '@/providers/LangProvider'
import { isAdmin, isModerator } from '@/lib/badges'
import { DISCORD_INVITE } from '@/components/SocialLinks'

const TOKEN_STORAGE_KEY = 'anm-admin-gate-ok'

type Props = {
  children: React.ReactNode
}

/**
 * 2-factor gate for the Admin Dashboard:
 *   1. Must be signed in with mod/admin/owner badge (enforced in DB anyway).
 *   2. Must enter today's daily-rotated admin password.
 *
 * The plaintext password is announced on Discord (dsc.gg/animewiki) once a
 * day. Once the user enters it correctly, we cache a tiny "ok" flag in
 * sessionStorage that auto-expires when the tab is closed.
 *
 * For admin/owner, an extra "Generate today's password" button calls the
 * `rotate_admin_password()` RPC directly so:
 *   • You can bootstrap the gate without configuring a webhook (first-time setup).
 *   • You can recover if you missed the Discord notification.
 *   • The plaintext is shown EXACTLY ONCE, then cleared from React state.
 *
 * The DB function `rotate_admin_password()` enforces the actual permission
 * check (only owner/admin badges are allowed), so even mods seeing the
 * button will get a clear error message rather than locking real owners out.
 */
export default function AdminPasswordGate({ children }: Props) {
  const { user, profile } = useAuth()
  const { lang } = useLangContext()
  const [unlocked, setUnlocked] = useState(false)
  const [candidate, setCandidate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)

  // Restore prior session unlock if the cached marker is from today.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
      if (!raw) return
      const cached = JSON.parse(raw) as { date: string; uid: string }
      const today = new Date().toISOString().slice(0, 10)
      if (cached.date === today && cached.uid === user?.id) {
        setUnlocked(true)
      }
    } catch { /* storage blocked */ }
  }, [user?.id])

  if (!user) {
    return (
      <div className="container mx-auto max-w-md px-4 py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-text-muted" />
        <h2 className="mt-3 text-xl font-semibold text-text">
          {lang === 'vi' ? 'Cần đăng nhập' : 'Sign-in required'}
        </h2>
      </div>
    )
  }

  // Hide rather than soft-deny when the viewer isn't even mod (defense in depth):
  if (!isModerator(profile)) {
    return (
      <div className="container mx-auto max-w-md px-4 py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-red-400" />
        <h2 className="mt-3 text-xl font-semibold text-text">
          {lang === 'vi' ? 'Không có quyền truy cập' : 'Access denied'}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          {lang === 'vi'
            ? 'Trang này chỉ dành cho mod/admin/owner.'
            : 'This page is restricted to mods/admins/owners.'}
        </p>
      </div>
    )
  }

  if (unlocked) return <>{children}</>

  const canGenerate = isAdmin(profile)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('verify_admin_password', { candidate })
      if (error) throw error
      if (data === true) {
        const today = new Date().toISOString().slice(0, 10)
        try {
          sessionStorage.setItem(
            TOKEN_STORAGE_KEY,
            JSON.stringify({ date: today, uid: user.id }),
          )
        } catch { /* storage blocked */ }
        setUnlocked(true)
      } else {
        setError(
          lang === 'vi'
            ? 'Mật khẩu không đúng. Hãy kiểm tra Discord (dsc.gg/animewiki) hoặc nhờ admin/owner sinh lại.'
            : 'Wrong password. Check Discord (dsc.gg/animewiki) or ask an admin/owner to regenerate.',
        )
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed')
    } finally {
      setLoading(false)
      setCandidate('')
    }
  }

  const handleGenerate = async () => {
    if (!supabase) return
    if (!canGenerate) return
    setError(null)
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('rotate_admin_password')
      if (error) throw error
      if (typeof data === 'string' && data.length > 0) {
        setGeneratedPassword(data)
      } else {
        setError(lang === 'vi' ? 'Không nhận được mật khẩu mới' : 'Did not receive a new password')
      }
    } catch (err: any) {
      setError(err?.message || 'Rotate failed')
    } finally {
      setGenerating(false)
    }
  }

  const copyToClipboard = (text: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="container mx-auto max-w-md px-4 py-16">
      <div className="rounded-3xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-text">
              {lang === 'vi' ? 'Cổng quản trị' : 'Admin Gate'}
            </h1>
            <p className="text-xs text-text-muted">
              {lang === 'vi' ? (
                <>
                  Mật khẩu hôm nay được gửi qua{' '}
                  <a
                    href={DISCORD_INVITE}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Discord (dsc.gg/animewiki)
                  </a>
                </>
              ) : (
                <>
                  Today&apos;s password is announced on{' '}
                  <a
                    href={DISCORD_INVITE}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Discord (dsc.gg/animewiki)
                  </a>
                </>
              )}
            </p>
          </div>
        </div>

        {/* Plaintext-once panel — shown right after the admin clicks Generate */}
        {generatedPassword && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <KeyRound className="h-3.5 w-3.5" />
              {lang === 'vi' ? 'Mật khẩu hôm nay' : 'Today\'s password'}
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="flex-1 break-all rounded bg-emerald-950/30 px-2 py-1 font-mono text-base tracking-wider">
                {generatedPassword}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(generatedPassword)}
                className="flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs hover:bg-emerald-500/30"
              >
                <Copy className="h-3 w-3" />
                {lang === 'vi' ? 'Sao chép' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-emerald-200/70">
              {lang === 'vi'
                ? 'Mật khẩu chỉ hiện 1 lần — hãy lưu lại hoặc nhập ngay bên dưới.'
                : 'Shown once — save it or paste it into the box below right now.'}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              autoFocus
              type="password"
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              placeholder={lang === 'vi' ? 'Mật khẩu admin hôm nay' : 'Today\'s admin password'}
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-3 text-sm font-mono tracking-widest text-text focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || candidate.length < 8}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {lang === 'vi' ? 'Mở khoá' : 'Unlock'}
          </button>
        </form>

        {/* Admin/Owner escape hatch — also serves as the "first time setup"
            button when no password exists yet in the database. */}
        {canGenerate && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-xs text-amber-200">
              {lang === 'vi'
                ? '⚠️ Admin/Owner: nếu đây là lần đầu thiết lập, hoặc bạn lỡ thông báo Discord, bấm để sinh mật khẩu hôm nay (sẽ ghi đè mật khẩu cũ nếu có).'
                : '⚠️ Admin/Owner: if this is the first setup, or you missed the Discord announcement, click to generate today\'s password (overwrites any existing one).'}
            </p>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="flex w-full items-center justify-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {lang === 'vi' ? 'Sinh mật khẩu hôm nay' : 'Generate today\'s password'}
            </button>
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
          {lang === 'vi'
            ? 'Mật khẩu reset mỗi ngày lúc 00:00 UTC. Mỗi lần thử đều được ghi log audit_logs. Phiên unlock chỉ tồn tại trong tab hiện tại.'
            : 'Password rotates daily at 00:00 UTC. Every attempt is recorded in audit_logs. The unlock state lives only in this tab.'}
        </p>
      </div>
    </div>
  )
}
