/** Phase 1b — 9 bảng còn lại + JSON array (badges). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'extras-secret-0123456789abcdef0123456789';
process.env.COOKIE_SECURE = 'false';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { invalidateRoleCache } from '../middleware/requireAuth';
import { resetRateLimits } from '../middleware/rateLimit';

interface H { base: string; db: Db; close: () => Promise<void> }
async function harness(): Promise<H> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-extras-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, db, close: async () => {
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
  assert.equal(reg.status, 201);
  return (cookies(reg).find((c) => c.startsWith('tsuki_at=')) as string).split(';')[0] as string;
}
function req(base: string, path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`${base}${path}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

test('B1: profile trả badges là ARRAY (không phải string "[]")', async () => {
  const h = await harness();
  try {
    const cookie = await login(h.base, 'badge@example.com');
    const id = (h.db.prepare("select id from users where email='badge@example.com'").get() as { id: string }).id;
    h.db.prepare("update profiles set badges='[\"mod\",\"active\"]' where id=?").run(id);
    invalidateRoleCache();

    const res = await req(h.base, '/api/profiles/badge');
    const profile = (await j(res)).profile as Record<string, unknown>;
    assert.equal(Array.isArray(profile.badges), true, 'badges phải là array');
    assert.deepEqual(profile.badges, ['mod', 'active']);

    const me = (await j(await req(h.base, '/api/profiles/me', { cookie }))).profile as Record<string, unknown>;
    assert.equal(Array.isArray(me.badges), true);
  } finally { await h.close(); }
});

test('anime_reactions: upsert theo (user,anime), counts đúng', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'rx@example.com');
    assert.equal((await req(h.base, '/api/anime/7/reaction', { method: 'POST', cookie: a, body: { reaction: 'heart' } })).status, 200);
    assert.equal((await req(h.base, '/api/anime/7/reaction', { method: 'POST', cookie: a, body: { reaction: 'cry' } })).status, 200);
    const counts = (await j(await req(h.base, '/api/anime/7/reactions'))).counts as Record<string, number>;
    assert.equal(counts.total_count, 1, 'upsert không nhân đôi');
    assert.equal(counts.cry_count, 1);
    assert.equal(counts.heart_count, 0);
    assert.equal((await req(h.base, '/api/anime/7/reaction', { method: 'POST', body: { reaction: 'heart' } })).status, 401);
    assert.equal((await req(h.base, '/api/anime/7/reaction', { method: 'POST', cookie: a, body: { reaction: 'sai' } })).status, 400);
  } finally { await h.close(); }
});

test('anime_reviews: owner tạo/xoá, counter reviews_count do trigger, người khác 403', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'rv1@example.com');
    const b = await login(h.base, 'rv2@example.com');
    const created = await req(h.base, '/api/anime/9/reviews', { method: 'POST', cookie: a, body: { body: 'hay' } });
    assert.equal(created.status, 201);
    const id = ((await j(created)).review as { id: string }).id;
    assert.equal((h.db.prepare("select reviews_count c from profiles where username='rv1'").get() as { c: number }).c, 1);
    assert.equal((await req(h.base, `/api/reviews/${id}`, { method: 'DELETE', cookie: b })).status, 403);
    assert.equal((await req(h.base, `/api/reviews/${id}`, { method: 'DELETE', cookie: a })).status, 200);
    assert.equal((h.db.prepare("select reviews_count c from profiles where username='rv1'").get() as { c: number }).c, 0);
  } finally { await h.close(); }
});

test('notifications: chỉ đọc/sửa của mình, không có route POST', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'nt1@example.com');
    const b = await login(h.base, 'nt2@example.com');
    const aId = (h.db.prepare("select id from users where email='nt1@example.com'").get() as { id: string }).id;
    h.db.prepare("insert into notifications (id,user_id,kind,body,created_at) values ('n1',?,'system','hi',?)").run(aId, new Date().toISOString());

    assert.equal((await req(h.base, '/api/notifications')).status, 401);
    assert.equal(((await j(await req(h.base, '/api/notifications', { cookie: a }))).items as unknown[]).length, 1);
    assert.equal(((await j(await req(h.base, '/api/notifications', { cookie: b }))).items as unknown[]).length, 0, 'B không thấy của A');
    assert.equal((await req(h.base, '/api/notifications/n1', { method: 'PATCH', cookie: b })).status, 404);
    assert.equal((await req(h.base, '/api/notifications/n1', { method: 'PATCH', cookie: a })).status, 200);
    const rows = await j(await req(h.base, '/api/notifications', { cookie: a }));
    assert.ok(((rows.items as Record<string, unknown>[])[0] as { read_at: string }).read_at);
    assert.equal((await req(h.base, '/api/notifications', { method: 'POST', cookie: a, body: {} })).status, 404, 'không có POST route');
  } finally { await h.close(); }
});

test('audit_logs: self xem của mình, mod xem tất cả, user thường 403', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'au1@example.com');
    const m = await login(h.base, 'au2@example.com');
    const aId = (h.db.prepare("select id from users where email='au1@example.com'").get() as { id: string }).id;
    const mId = (h.db.prepare("select id from users where email='au2@example.com'").get() as { id: string }).id;
    h.db.prepare("insert into audit_logs (actor_id, action, target_type, target_id) values (?,'login','x','1')").run(aId);
    h.db.prepare("update profiles set badges='[\"mod\"]' where id=?").run(mId);
    invalidateRoleCache();

    assert.equal((await req(h.base, '/api/audit-logs', { cookie: a })).status, 403);
    assert.equal((await req(h.base, '/api/audit-logs', { cookie: m })).status, 200);
    assert.equal(((await j(await req(h.base, '/api/audit-logs/mine', { cookie: a }))).items as unknown[]).length, 1);
  } finally { await h.close(); }
});

test('edit_suggestions: POST user → pending (hoặc auto_approved nếu badge trusted), mod PATCH → audit', async () => {
  const h = await harness();
  try {
    const u = await login(h.base, 'es1@example.com');
    const m = await login(h.base, 'es2@example.com');
    const uId = (h.db.prepare("select id from users where email='es1@example.com'").get() as { id: string }).id;
    const mId = (h.db.prepare("select id from users where email='es2@example.com'").get() as { id: string }).id;
    h.db.prepare("update profiles set badges='[\"mod\"]' where id=?").run(mId);
    invalidateRoleCache();

    const created = await req(h.base, '/api/edit-suggestions', { method: 'POST', cookie: u, body: { animeId: 3, field: 'title', contentAfter: 'Mới' } });
    assert.equal(created.status, 201);
    const sug = (await j(created)).suggestion as Record<string, unknown>;
    assert.equal(sug.status, 'pending');
    assert.equal((await req(h.base, '/api/edit-suggestions', { cookie: u })).status, 403, 'user thường không list mod');
    assert.equal((await req(h.base, '/api/edit-suggestions', { cookie: m })).status, 200);

    // trusted badge → auto approve
    h.db.prepare("update profiles set badges='[\"top_fan\"]' where id=?").run(uId);
    invalidateRoleCache();
    const auto = await req(h.base, '/api/edit-suggestions', { method: 'POST', cookie: u, body: { animeId: 4, field: 'title', contentAfter: 'Auto' } });
    assert.equal((await j(auto)).autoApproved, true);

    const patched = await req(h.base, `/api/edit-suggestions/${sug.id}`, { method: 'PATCH', cookie: m, body: { status: 'approved' } });
    assert.equal(patched.status, 200);
    const logs = h.db.prepare("select count(*) c from audit_logs where action='approve_edit'").get() as { c: number };
    assert.equal(logs.c, 1, 'phải ghi audit approve_edit');
  } finally { await h.close(); }
});

test('compare_history: anime_ids trả ARRAY, owner-only, validate mảng', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'ch1@example.com');
    const b = await login(h.base, 'ch2@example.com');
    assert.equal((await req(h.base, '/api/compare-history', { method: 'POST', cookie: a, body: { animeIds: [1, 2, 3] } })).status, 201);
    assert.equal((await req(h.base, '/api/compare-history', { method: 'POST', cookie: a, body: { animeIds: ['x'] } })).status, 400);
    const list = await j(await req(h.base, '/api/compare-history', { cookie: a }));
    const item = (list.items as Record<string, unknown>[])[0] as { anime_ids: unknown; id: string };
    assert.equal(Array.isArray(item.anime_ids), true, 'anime_ids phải là array');
    assert.deepEqual(item.anime_ids, [1, 2, 3]);
    assert.equal(((await j(await req(h.base, '/api/compare-history', { cookie: b }))).items as unknown[]).length, 0);
    assert.equal((await req(h.base, `/api/compare-history/${item.id}`, { method: 'DELETE', cookie: b })).status, 404);
    assert.equal((await req(h.base, `/api/compare-history/${item.id}`, { method: 'DELETE', cookie: a })).status, 200);
  } finally { await h.close(); }
});

test('quests public + progress self; activity public/self; translation-cache + mal-sync không route', async () => {
  const h = await harness();
  try {
    const a = await login(h.base, 'qu@example.com');
    const quests = await j(await req(h.base, '/api/quests'));
    assert.equal((quests.items as unknown[]).length, 6, 'public thấy 6 quest seed');

    await req(h.base, '/api/library', { method: 'POST', cookie: a, body: { animeId: 1, animeTitle: 'A', status: 'watching' } });
    const progress = await j(await req(h.base, '/api/quests/progress', { cookie: a }));
    assert.ok((progress.items as unknown[]).length >= 1, 'quest progress sau khi thêm library');
    assert.equal((await req(h.base, '/api/quests/progress')).status, 401);

    assert.equal((await req(h.base, '/api/activity')).status, 200, 'activity public 200');
    assert.equal((await req(h.base, '/api/activity?scope=mine')).status, 401);
    assert.equal((await req(h.base, '/api/activity?scope=mine', { cookie: a })).status, 200);

    assert.equal((await req(h.base, '/api/translation-cache')).status, 404);
    assert.equal((await req(h.base, '/api/mal-sync')).status, 404);
  } finally { await h.close(); }
});

test('contract: snake_case và camelCase đều tạo parent reply → có notification', async () => {
  const h = await harness();
  try {
    const b = await login(h.base, 'cB@example.com');
    const a = await login(h.base, 'cA@example.com');
    const bId = (h.db.prepare("select id from users where email='cb@example.com'").get() as { id: string }).id;

    const parent = await req(h.base, '/api/comments', { method: 'POST', cookie: b, body: { entityType: 'anime', entity_id: 7, body: 'parent' } });
    const parentId = ((await j(parent)).comment as { id: string }).id;

    // snake_case
    const snake = await req(h.base, '/api/comments', {
      method: 'POST', cookie: a,
      body: { entity_type: 'anime', entity_id: 7, body: 'snake reply', parent_id: parentId, image_url: null },
    });
    assert.equal(snake.status, 201);
    const snakeComment = (await j(snake)).comment as { parent_id: string | null };
    assert.equal(snakeComment.parent_id, parentId, 'parent_id snake_case phải được lưu');

    // camelCase
    const camel = await req(h.base, '/api/comments', {
      method: 'POST', cookie: a,
      body: { entityType: 'anime', entityId: 7, body: 'camel reply', parentId },
    });
    assert.equal(camel.status, 201);
    assert.equal(((await j(camel)).comment as { parent_id: string | null }).parent_id, parentId);

    const notes = h.db.prepare('select count(*) c from notifications where user_id = ? and kind = ?').get(bId, 'reply') as { c: number };
    assert.equal(notes.c, 2, 'cả 2 kiểu payload đều phải tạo notification cho B');
  } finally { await h.close(); }
});
