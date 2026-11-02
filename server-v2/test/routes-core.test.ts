/** Phase 1a — allow/deny cho 8 bảng lõi + media traversal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'core-routes-secret-0123456789abcdef012345';
process.env.COOKIE_SECURE = 'false';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { invalidateRoleCache } from '../middleware/requireAuth';
import { resetRateLimits } from '../middleware/rateLimit';

interface H { base: string; db: Db; dir: string; close: () => Promise<void> }

async function harness(): Promise<H> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-core-'));
  process.env.MEDIA_DIR = join(dir, 'media');
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`, db, dir,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function cookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return h.getSetCookie ? h.getSetCookie() : [];
}

async function login(base: string, email: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'S3cret-password!' }),
  });
  assert.equal(reg.status, 201);
  const c = cookies(reg).find((x) => x.startsWith('tsuki_at='));
  return (c as string).split(';')[0] as string;
}

function req(base: string, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`${base}${path}`, {
    method: init.method ?? 'GET', headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

test('profiles: public GET, PATCH chỉ chủ; username không tồn tại → 404', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'alice@example.com');
    const b = await login(h.base, 'bob@example.com');

    const pub = await req(h.base, '/api/profiles/alice');
    assert.equal(pub.status, 200, 'profile public phải đọc được khi chưa login');
    const body = await j(pub);
    const profile = body.profile as Record<string, unknown>;
    assert.equal(profile.username, 'alice');
    assert.equal(profile.badges !== undefined, true);
    assert.equal(profile.password_hash, undefined);
    assert.equal(profile.email, undefined, 'không trả email ở endpoint public');

    const anon = await req(h.base, '/api/profiles/me');
    assert.equal(anon.status, 401);

    const patched = await req(h.base, '/api/profiles/me', { method: 'PATCH', cookie: a, body: { display_name: 'Alice A' } });
    assert.equal(patched.status, 200);

    // B không sửa được profile của A (chỉ có /me → sửa chính mình)
    const bPatch = await req(h.base, '/api/profiles/me', { method: 'PATCH', cookie: b, body: { display_name: 'Bob B' } });
    assert.equal(bPatch.status, 200);
    const aRow = h.db.prepare("select display_name from profiles where username='alice'").get() as { display_name: string };
    assert.equal(aRow.display_name, 'Alice A');

    assert.equal((await req(h.base, '/api/profiles/khong-ton-tai')).status, 404);
  } finally { await h.close(); }
});

test('favorites: own-only, anon 401, A không thấy favorite của B', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a2@example.com');
    const b = await login(h.base, 'b2@example.com');

    assert.equal((await req(h.base, '/api/favorites', { method: 'POST', body: { animeId: 21 } })).status, 401);
    assert.equal((await req(h.base, '/api/favorites', { method: 'POST', cookie: a, body: { animeId: 21, animeTitle: 'OP' } })).status, 201);

    const bList = await j(await req(h.base, '/api/favorites', { cookie: b }));
    assert.equal((bList.items as unknown[]).length, 0, 'B không thấy favorite của A');
    const aList = await j(await req(h.base, '/api/favorites', { cookie: a }));
    assert.equal((aList.items as unknown[]).length, 1);

    // B xoá favorite của A (theo animeId) → không có gì để xoá
    assert.equal((await req(h.base, '/api/favorites/21', { method: 'DELETE', cookie: b })).status, 404);
    assert.equal((await req(h.base, '/api/favorites/21', { method: 'DELETE', cookie: a })).status, 200);
  } finally { await h.close(); }
});

test('user_library: upsert (user_id,anime_id), stats chỉ của mình', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a3@example.com');
    const b = await login(h.base, 'b3@example.com');

    const first = await req(h.base, '/api/library', { method: 'POST', cookie: a, body: { animeId: 5, animeTitle: 'Naruto', status: 'watching' } });
    assert.equal(first.status, 201);
    const second = await req(h.base, '/api/library', { method: 'POST', cookie: a, body: { animeId: 5, animeTitle: 'Naruto', status: 'completed' } });
    assert.equal(second.status, 201, 'upsert không được tạo row thứ 2');
    const count = (h.db.prepare('select count(*) c from user_library').get() as { c: number }).c;
    assert.equal(count, 1, 'unique(user_id, anime_id) → chỉ 1 row');

    const stats = await j(await req(h.base, '/api/library/stats', { cookie: a }));
    const s = stats.stats as Record<string, number>;
    assert.equal(s.total_anime, 1);
    assert.equal(s.completed_count, 1);

    const bStats = await j(await req(h.base, '/api/library/stats', { cookie: b }));
    assert.equal((bStats.stats as Record<string, unknown>).total_anime ?? 0, 0, 'B không thấy stats của A');

    // counter library_count do trigger
    const counter = h.db.prepare("select library_count c from profiles where username='a3'").get() as { c: number };
    assert.equal(counter.c, 1);
  } finally { await h.close(); }
});

test('comments: list public, tạo cần auth, A không xoá comment của B, mod xoá được', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a4@example.com');
    const b = await login(h.base, 'b4@example.com');

    const created = await req(h.base, '/api/comments', { method: 'POST', cookie: a, body: { entityType: 'anime', entityId: 21, body: 'hay quá' } });
    assert.equal(created.status, 201);
    const commentId = ((await j(created)).comment as { id: string }).id;

    assert.equal((await req(h.base, '/api/comments', { method: 'POST', body: { entityType: 'anime', entityId: 21, body: 'x' } })).status, 401);

    const list = await j(await req(h.base, '/api/comments?entityType=anime&entityId=21'));
    assert.equal((list.items as unknown[]).length, 1, 'list public khi chưa login');

    assert.equal((await req(h.base, `/api/comments/${commentId}`, { method: 'DELETE', cookie: b })).status, 403, 'B không xoá comment của A');

    // mod xoá được comment của A
    const bId = (h.db.prepare("select id from users where email='b4@example.com'").get() as { id: string }).id;
    h.db.prepare("update profiles set badges='[\"mod\"]' where id=?").run(bId);
    process.env.ROLE_CACHE_TTL_MS = '0';
    invalidateRoleCache();

    assert.equal((await req(h.base, `/api/comments/${commentId}`, { method: 'DELETE', cookie: b })).status, 200, 'mod xoá được');
    const after = h.db.prepare('select is_deleted from comments where id=?').get(commentId) as { is_deleted: number };
    assert.equal(after.is_deleted, 1, 'soft delete');

    // người thường gọi endpoint mod → 403
    const aId = (h.db.prepare("select id from users where email='a4@example.com'").get() as { id: string }).id;
    h.db.prepare("update profiles set badges='[]' where id=?").run(aId);
    invalidateRoleCache();
    assert.equal((await req(h.base, '/api/mod/comments/deleted', { cookie: a })).status, 403);
    assert.equal((await req(h.base, '/api/mod/comments/deleted', { cookie: b })).status, 200);
  } finally { await h.close(); }
});

test('comment_votes: vote ±1, sửa vote, bỏ vote; value khác ±1 → 400', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a5@example.com');
    const c = await req(h.base, '/api/comments', { method: 'POST', cookie: a, body: { entityType: 'anime', entityId: 1, body: 'x' } });
    const id = ((await j(c)).comment as { id: string }).id;

    assert.equal((await req(h.base, `/api/comments/${id}/vote`, { method: 'POST', cookie: a, body: { value: 5 } })).status, 400);
    assert.equal((await req(h.base, `/api/comments/${id}/vote`, { method: 'POST', cookie: a, body: { value: 1 } })).status, 200);
    let counts = (await j(await req(h.base, `/api/comments/${id}/votes`))).counts as Record<string, number>;
    assert.equal(counts.score, 1);
    counts = (await j(await req(h.base, `/api/comments/${id}/vote`, { method: 'POST', cookie: a, body: { value: -1 } }))).counts as never ?? counts;
    const after = (await j(await req(h.base, `/api/comments/${id}/votes`))).counts as Record<string, number>;
    assert.equal(after.score, -1, 'đổi vote ghi đè, không cộng dồn');
    assert.equal((await req(h.base, `/api/comments/${id}/vote`, { method: 'DELETE', cookie: a })).status, 200);
  } finally { await h.close(); }
});

test('collections: private của A → B 404 ở detail/items; B không sửa; mod delete được', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a6@example.com');
    const b = await login(h.base, 'b6@example.com');

    const created = await req(h.base, '/api/collections', { method: 'POST', cookie: a, body: { title: 'Bộ sưu tập riêng', isPublic: false } });
    assert.equal(created.status, 201);
    const colId = ((await j(created)).collection as { id: string }).id;

    assert.equal((await req(h.base, `/api/collections/${colId}`, { cookie: b })).status, 404, 'private: B không đọc được');
    assert.equal((await req(h.base, `/api/collections/${colId}`, { cookie: a })).status, 200);
    assert.equal((await req(h.base, `/api/collections/${colId}/items`, { cookie: b })).status, 404);

    // B không thêm item vào collection của A
    assert.equal((await req(h.base, `/api/collections/${colId}/items`, { method: 'POST', cookie: b, body: { animeId: 1 } })).status, 404, 'canWriteCollection chặn');
    assert.equal((await req(h.base, `/api/collections/${colId}/items`, { method: 'POST', cookie: a, body: { animeId: 1 } })).status, 201);

    const items = await j(await req(h.base, `/api/collections/${colId}/items`, { cookie: a }));
    assert.equal((items.items as unknown[]).length, 1);
    const counter = h.db.prepare('select item_count c from collections where id=?').get(colId) as { c: number };
    assert.equal(counter.c, 1, 'counter item_count do trigger');

    const bList = await j(await req(h.base, '/api/collections', { cookie: b }));
    assert.equal((bList.items as unknown[]).length, 0, 'list của B không chứa collection private của A');

    assert.equal((await req(h.base, `/api/collections/${colId}`, { method: 'PATCH', cookie: b, body: { title: 'hack' } })).status, 404);
    assert.equal((await req(h.base, `/api/collections/${colId}`, { method: 'DELETE', cookie: b })).status, 403);

    const bId = (h.db.prepare("select id from users where email='b6@example.com'").get() as { id: string }).id;
    h.db.prepare("update profiles set badges='[\"admin\"]' where id=?").run(bId);
    process.env.ROLE_CACHE_TTL_MS = '0';
    invalidateRoleCache();
    assert.equal((await req(h.base, `/api/collections/${colId}`, { method: 'DELETE', cookie: b })).status, 200, 'admin xoá được collection người khác');
  } finally { await h.close(); }
});

test('collection_likes: like/unlike, counter do trigger', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'a7@example.com');
    const b = await login(h.base, 'b7@example.com');
    const c = await req(h.base, '/api/collections', { method: 'POST', cookie: a, body: { title: 'Công khai', isPublic: true } });
    const id = ((await j(c)).collection as { id: string }).id;

    assert.equal((await req(h.base, `/api/collections/${id}/like`, { method: 'POST', cookie: b })).status, 200);
    assert.equal((await req(h.base, `/api/collections/${id}/like`, { method: 'POST', cookie: b })).status, 200, 'like 2 lần không nhân đôi');
    assert.equal((h.db.prepare('select like_count l from collections where id=?').get(id) as { l: number }).l, 1);
    assert.equal((await req(h.base, `/api/collections/${id}/like`, { method: 'DELETE', cookie: b })).status, 200);
    assert.equal((h.db.prepare('select like_count l from collections where id=?').get(id) as { l: number }).l, 0);
    assert.equal((await req(h.base, `/api/collections/${id}/like`, { method: 'POST' })).status, 401);
  } finally { await h.close(); }
});

test('media: file thật 200 + content-type, traversal bị chặn', async () => {
  const h = await harness();
  try {
    const mediaRoot = join(h.dir, 'media');
    mkdirSync(join(mediaRoot, 'avatars'), { recursive: true });
    writeFileSync(join(mediaRoot, 'avatars', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(h.dir, '.env'), 'SECRET=should-not-leak\n');

    const good = await req(h.base, '/media/avatars/a.png');
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('content-type'), 'image/png');
    assert.match(good.headers.get('cache-control') ?? '', /max-age=86400, immutable/);

    for (const path of ['/media/../.env', '/media/avatars/..%2f..%2f.env', '/media/..%2f.env', '/media/other/a.png']) {
      const res = await req(h.base, path);
      assert.ok([403, 404].includes(res.status), `${path} phải bị chặn, nhận ${res.status}`);
      const text = await res.text();
      assert.equal(text.includes('should-not-leak'), false, 'không được rò nội dung .env');
    }

    assert.equal((await req(h.base, '/media/avatars/khong-ton-tai.png')).status, 404);
  } finally { await h.close(); }
});
