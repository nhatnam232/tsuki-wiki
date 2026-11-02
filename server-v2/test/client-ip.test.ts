import test from 'node:test'
import assert from 'node:assert/strict'
import type { Request } from 'express'
import { resolveClientIp } from '../middleware/security'

function fakeReq(remoteAddress: string, headers: Record<string, string>): Request {
  return { socket: { remoteAddress }, headers } as unknown as Request
}

function run(req: Request): Request {
  resolveClientIp(req, {} as never, () => undefined)
  return req
}

test('client ip: untrusted peer ignores spoofed x-forwarded-for', () => {
  process.env.TRUSTED_PROXIES = '116.66.214.191'
  delete process.env.ALLOW_DIRECT
  const req = run(fakeReq('203.0.113.5', { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' }))
  assert.equal(req.clientIp, '203.0.113.5', 'must fall back to the socket address')
})

test('client ip: untrusted peer ignores cf-connecting-ip', () => {
  process.env.TRUSTED_PROXIES = '116.66.214.191'
  const req = run(fakeReq('198.51.100.9', { 'cf-connecting-ip': '9.9.9.9' }))
  assert.equal(req.clientIp, '198.51.100.9')
})

test('client ip: trusted tunnel peer uses cf-connecting-ip', () => {
  process.env.TRUSTED_PROXIES = '127.0.0.1'
  const req = run(fakeReq('::ffff:127.0.0.1', { 'cf-connecting-ip': '11.22.33.44', 'x-forwarded-for': 'spoof' }))
  assert.equal(req.clientIp, '11.22.33.44')
})

test('client ip: empty allowlist is fail-closed (socket wins)', () => {
  delete process.env.TRUSTED_PROXIES
  delete process.env.ALLOW_DIRECT
  const req = run(fakeReq('203.0.113.7', { 'cf-connecting-ip': '1.1.1.1' }))
  assert.equal(req.clientIp, '203.0.113.7')
})

test('https: untrusted peer cannot fake x-forwarded-proto', () => {
  process.env.TRUSTED_PROXIES = '116.66.214.191'
  const req = run(fakeReq('203.0.113.8', { 'x-forwarded-proto': 'https' }))
  assert.equal(req.isHttps, false)
})

test('https: trusted peer with x-forwarded-proto https counts as TLS', () => {
  process.env.TRUSTED_PROXIES = '127.0.0.1'
  const req = run(fakeReq('127.0.0.1', { 'x-forwarded-proto': 'https' }))
  assert.equal(req.isHttps, true)
})
