/** hCaptcha server-side verification (stubbed fetch, no network). */
import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyCaptcha, captchaEnabled } from '../auth/captcha'

const realFetch = globalThis.fetch

function stubFetch(impl: () => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch
}

test('captcha: disabled when HCAPTCHA_SECRET unset', async () => {
  delete process.env.HCAPTCHA_SECRET
  assert.equal(captchaEnabled(), false)
  const r = await verifyCaptcha(undefined)
  assert.equal(r.ok, true)
  assert.equal(r.reason, 'disabled')
})

test('captcha: enabled requires a token', async () => {
  process.env.HCAPTCHA_SECRET = 'test-secret'
  assert.equal(captchaEnabled(), true)
  const r = await verifyCaptcha('')
  assert.deepEqual(r, { ok: false, reason: 'captcha_required' })
})

test('captcha: upstream success', async () => {
  process.env.HCAPTCHA_SECRET = 'test-secret'
  stubFetch(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
  const r = await verifyCaptcha('token-abc', '1.2.3.4')
  assert.equal(r.ok, true)
})

test('captcha: upstream failure', async () => {
  process.env.HCAPTCHA_SECRET = 'test-secret'
  stubFetch(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
  const r = await verifyCaptcha('token-abc')
  assert.deepEqual(r, { ok: false, reason: 'captcha_failed' })
})

test('captcha: upstream unreachable fails closed', async () => {
  process.env.HCAPTCHA_SECRET = 'test-secret'
  stubFetch(async () => {
    throw new Error('network down')
  })
  const r = await verifyCaptcha('token-abc')
  assert.deepEqual(r, { ok: false, reason: 'captcha_unavailable' })
})

test.after(() => {
  globalThis.fetch = realFetch
  delete process.env.HCAPTCHA_SECRET
})

/* ── integration: routes reject requests without a captcha token ───────── */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

test('captcha: login/register return 400 captcha_required when secret is set', async () => {
  globalThis.fetch = realFetch // undo stub from the previous case
  process.env.TRUSTED_PROXIES = '127.0.0.1'
  process.env.JWT_SECRET = 'captcha-it-0123456789abcdef0123456789'
  process.env.HCAPTCHA_SECRET = 'it-secret'
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-cap-'))
  const { createApp } = await import('../app')
  const { openDb } = await import('../db/index')
  const { resetRateLimits } = await import('../middleware/rateLimit')
  const db = openDb({ path: join(dir, 'app.db') })
  resetRateLimits()
  const app = createApp({ db, disableRateLimit: true })
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s))
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'probe@example.invalid', password: 'whatever123' }),
    })
    assert.equal(login.status, 400)
    assert.equal(((await login.json()) as { error: string }).error, 'captcha_required')

    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.invalid', password: 'Str0ngPass!23', username: 'n' }),
    })
    assert.equal(reg.status, 400)
    assert.equal(((await reg.json()) as { error: string }).error, 'captcha_required')
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
    db.close()
    rmSync(dir, { recursive: true, force: true })
    delete process.env.HCAPTCHA_SECRET
    delete process.env.TRUSTED_PROXIES
  }
})


test('captcha: production boot refuses to start without a secret', async () => {
  const { assertCaptchaConfigured } = await import('../auth/captcha')
  assert.throws(
    () => assertCaptchaConfigured({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    /HCAPTCHA_SECRET is required/,
  )
  assert.doesNotThrow(() =>
    assertCaptchaConfigured({ NODE_ENV: 'production', CAPTCHA_DISABLED: '1' } as NodeJS.ProcessEnv),
  )
  assert.doesNotThrow(() =>
    assertCaptchaConfigured({ NODE_ENV: 'production', HCAPTCHA_SECRET: 's' } as NodeJS.ProcessEnv),
  )
  assert.doesNotThrow(() => assertCaptchaConfigured({ NODE_ENV: 'development' } as NodeJS.ProcessEnv))
})
