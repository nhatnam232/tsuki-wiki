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
