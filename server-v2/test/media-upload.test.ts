/** Upload media (raw + multipart), favorites count, library get-by-id. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'up-secret-0123456789abcdef0123456789';
process.env.TRUSTED_PROXIES = '127.0.0.1';
process.env.COOKIE_SECURE = 'false';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { resetRateLimits } from '../middleware/rateLimit';
import { MAX_UPLOAD_BYTES, safeFilename } from '../media/upload';

interface H { base: string; db: Db; dir: string; close: () => Promise<void> }
async function harness(): Promise<H> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-up-'));
  process.env.MEDIA_DIR = join(dir, 'media');
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, db, dir, close: async () => {
    await new Promise<void>((r) => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true });
  } };
}
function cookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return h.getSetCookie ? h.getSetCookie() : [];
}
async function login(base: string, email: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'S3cret-password!' }) });
  return (cookies(reg).find((c) => c.startsWith('tsuki_at=')) as string).split(';')[0] as string;
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('upload raw body: 200 + path tồn tại + GET /media/... 200', async () => {
  const h = await harness();
  try {
    const cookie = await login(h.base, 'up1@example.com');
    const res = await fetch(`${h.base}/api/media/avatars`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png', 'x-filename': '../../etc/passwd.png' },
      body: PNG,
    });
    assert.equal(res.status, 200, `kỳ vọng 200, nhận ${res.status}`);
    const body = (await res.json()) as { path: string };
    assert.match(body.path, /^\/media\/avatars\/[0-9a-f-]{36}\/\d+-[0-9a-f]{8}\.png$/);
    assert.equal(body.path.includes('..'), false, 'filename client không được dùng');

    const file = await fetch(`${h.base}${body.path}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
  } finally { await h.close(); }
});

test('upload multipart (tương thích backend.ts) → 200', async () => {
  const h = await harness();
  try {
    const cookie = await login(h.base, 'up2@example.com');
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
    const res = await fetch(`${h.base}/api/media/covers`, { method: 'POST', headers: { cookie }, body: form });
    assert.equal(res.status, 200, `multipart phải 200, nhận ${res.status}`);
    const body = (await res.json()) as { path: string };
    assert.match(body.path, /^\/media\/covers\//);
    assert.equal((await fetch(`${h.base}${body.path}`)).status, 200);
  } finally { await h.close(); }
});

test('upload: sai MIME → 415, quá 5MB → 413, thiếu auth → 401, bucket lạ → 400', async () => {
  const h = await harness();
  try {
    const cookie = await login(h.base, 'up3@example.com');
    const gif = await fetch(`${h.base}/api/media/avatars`, {
      method: 'POST', headers: { cookie, 'content-type': 'image/gif' }, body: Buffer.from('GIF89a'),
    });
    assert.equal(gif.status, 415);

    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1024, 1);
    const tooBig = await fetch(`${h.base}/api/media/avatars`, {
      method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: big,
    });
    assert.equal(tooBig.status, 413);

    const noAuth = await fetch(`${h.base}/api/media/avatars`, {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG,
    });
    assert.equal(noAuth.status, 401);

    const badBucket = await fetch(`${h.base}/api/media/secrets`, {
      method: 'POST', headers: { cookie, 'content-type': 'image/png' }, body: PNG,
    });
    assert.equal(badBucket.status, 400);

    assert.equal(safeFilename('../../.env', '.png'), 'env.png');
    assert.equal(safeFilename('a/../../b.jpg', '.png'), 'b.jpg');
    assert.equal(safeFilename(null, '.png'), 'upload.png');
  } finally { await h.close(); }
});

test('GET /api/favorites/count public + GET /api/library/:animeId owner', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'fc1@example.com');
    const b = await login(h.base, 'fc2@example.com');

    await fetch(`${h.base}/api/favorites`, { method: 'POST', headers: { cookie: a, 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 42 }) });
    await fetch(`${h.base}/api/favorites`, { method: 'POST', headers: { cookie: b, 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 42 }) });

    const count = await fetch(`${h.base}/api/favorites/count?anime_id=42`);
    assert.equal(count.status, 200, 'count public');
    assert.equal(((await count.json()) as { count: number }).count, 2);

    assert.equal((await fetch(`${h.base}/api/library/7`, { headers: { cookie: a } })).status, 404, 'chưa có → 404');
    await fetch(`${h.base}/api/library`, { method: 'POST', headers: { cookie: a, 'content-type': 'application/json' }, body: JSON.stringify({ animeId: 7, animeTitle: 'X' }) });
    const one = await fetch(`${h.base}/api/library/7`, { headers: { cookie: a } });
    assert.equal(one.status, 200);
    const item = ((await one.json()) as { item: { anime_id: number } }).item;
    assert.equal(item.anime_id, 7);
    assert.equal((await fetch(`${h.base}/api/library/7`)).status, 401, 'anon 401');

    // B không thấy entry của A
    assert.equal((await fetch(`${h.base}/api/library/7`, { headers: { cookie: b } })).status, 404);
  } finally { await h.close(); }
});
