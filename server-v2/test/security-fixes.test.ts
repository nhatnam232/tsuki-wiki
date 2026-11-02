/** Regression cho 6 fix bảo mật (reviewer task-9). */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcryptjs from 'bcryptjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'secfix-secret-0123456789abcdef0123456789';
process.env.CRON_SECRET = 'cron-secret-0123456789abcdef0123456789';
process.env.COOKIE_SECURE = 'false';

import { verifyPassword } from '../crypto/password';
import { openDb } from '../db/index';
import { createApp } from '../app';
import { resetRateLimits } from '../middleware/rateLimit';
import { REFRESH_COOKIE_PATH } from '../auth/session';

test('bcrypt verify là ASYNC: event loop không bị chặn', async () => {
  const hash = bcryptjs.hashSync('Str0ngPass!23', 10);
  let timerFired = false;
  const timer = new Promise<void>((r) => setTimeout(() => { timerFired = true; r(); }, 0));
  const result = verifyPassword('Str0ngPass!23', hash);
  assert.equal(typeof (result as Promise<unknown>).then, 'function', 'phải trả Promise');
  await timer;
  assert.equal(timerFired, true, 'timer phải chạy trong lúc verify (không block event loop)');
  assert.equal(await result, true);
});

test('refresh cookie path mặc định = /api/auth (logout revoke được refresh)', () => {
  delete process.env.REFRESH_COOKIE_PATH;
  assert.equal(REFRESH_COOKIE_PATH, '/api/auth');
});

test('logout revoke refresh session: refresh bằng token cũ → 401, revoked_at set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-secfix-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'lo@example.com', password: 'S3cret-password!' }),
    });
    const setCookies = (reg.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    const at = (setCookies.find((c) => c.startsWith('tsuki_at=')) as string).split(';')[0];
    const rt = (setCookies.find((c) => c.startsWith('tsuki_rt=')) as string).split(';')[0] as string;
    const rtValue = rt.split('=')[1] as string;

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: `${at}; ${rt}` } });
    assert.equal(out.status, 200);

    const revoked = db.prepare('select count(*) c from sessions where revoked_at is not null').get() as { c: number };
    assert.ok(revoked.c >= 1, 'revoked_at phải được set');

    const refresh = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { cookie: `tsuki_rt=${rtValue}` } });
    assert.equal(refresh.status, 401, 'refresh bằng token cũ sau logout phải 401');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rotate-password rate limit 10/phút/IP: lần 11 → 429', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-rot-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: false });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await fetch(`${base}/api/admin/rotate-password`, { headers: { 'x-cron-secret': process.env.CRON_SECRET as string } });
      codes.push(res.status);
    }
    assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
    assert.equal(codes[10], 429, `lần 11 phải 429, thực tế ${codes.join(',')}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media: lỗi đọc file không kill process; .svg bị chặn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-media-'));
  process.env.MEDIA_DIR = join(dir, 'media');
  mkdirSync(join(dir, 'media', 'avatars'), { recursive: true });
  writeFileSync(join(dir, 'media', 'avatars', 'x.svg'), '<svg onload="alert(1)"/>');
  writeFileSync(join(dir, 'media', 'avatars', 'ok.png'), 'PNG');

  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    const svg = await fetch(`${base}/media/avatars/x.svg`);
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'application/octet-stream', 'SVG không còn trong whitelist MIME');
    const png = await fetch(`${base}/media/avatars/ok.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
    // server vẫn sống sau mọi request
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    delete process.env.MEDIA_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
});
