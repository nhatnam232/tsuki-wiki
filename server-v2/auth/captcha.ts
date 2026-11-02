/**
 * hCaptcha server-side verification.
 *
 * Supabase enforced captcha on its own auth endpoints; self-hosting means we
 * have to verify it ourselves, otherwise the widget in the UI is pure friction
 * for humans while bots can call /api/auth/* directly.
 *
 * Behaviour:
 * - `HCAPTCHA_SECRET` unset  -> not enforced (logged once), so local dev and
 *   tests keep working without an account.
 * - secret set, token missing -> 400 `captcha_required`
 * - verification fails        -> 400 `captcha_failed`
 * - upstream unreachable      -> 400 `captcha_unavailable` (fail closed)
 */
export interface CaptchaResult {
  ok: boolean
  reason?: 'disabled' | 'captcha_required' | 'captcha_failed' | 'captcha_unavailable'
}

let warnedDisabled = false

export function captchaEnabled(): boolean {
  return Boolean(process.env.HCAPTCHA_SECRET)
}

/**
 * Production must not silently run without captcha (that is exactly how the
 * migration re-opened registration). Same precedent as jwt.ts, which throws
 * when JWT_SECRET is missing in production. Escape hatch: CAPTCHA_DISABLED=1.
 */
export function assertCaptchaConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env.HCAPTCHA_SECRET) return
  if (env.CAPTCHA_DISABLED === '1') {
    process.stderr.write('[captcha] disabled on purpose (CAPTCHA_DISABLED=1)\n')
    return
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('HCAPTCHA_SECRET is required in production (set CAPTCHA_DISABLED=1 to opt out)')
  }
  process.stderr.write('[captcha] HCAPTCHA_SECRET not set - captcha not enforced (non-production)\n')
}

export async function verifyCaptcha(token: unknown, remoteIp?: string): Promise<CaptchaResult> {
  const secret = process.env.HCAPTCHA_SECRET
  if (!secret) {
    if (!warnedDisabled) {
      warnedDisabled = true
      process.stderr.write('[captcha] HCAPTCHA_SECRET not set - login/register captcha is NOT enforced\n')
    }
    return { ok: true, reason: 'disabled' }
  }

  const response = typeof token === 'string' ? token.trim() : ''
  if (!response) return { ok: false, reason: 'captcha_required' }

  try {
    const params = new URLSearchParams({ secret, response })
    if (remoteIp) params.set('remoteip', remoteIp)
    const res = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean }
    return data.success ? { ok: true } : { ok: false, reason: 'captcha_failed' }
  } catch {
    return { ok: false, reason: 'captcha_unavailable' }
  }
}
