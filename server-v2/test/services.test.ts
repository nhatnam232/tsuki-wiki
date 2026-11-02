/** Notification service + MAL worker + CF header gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'svc-secret-0123456789abcdef0123456789';
process.env.COOKIE_SECURE = 'false';

import { openDb, type Db } from '../db/index';
import { createApp } from '../app';
import { notifyUser } from '../services/notifications';
import { claimJob, processJob, startMalWorker } from '../services/malWorker';
import { resetRateLimits } from '../middleware/rateLimit';

function fresh(): { db: Db; dir: string; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-svc-'));
  const db = openDb({ path: join(dir, 'app.db') });
  db.prepare('insert into users (id,email) values (?,?)').run('uA', 'a@x.io');
  db.prepare('insert into users (id,email) values (?,?)').run('uB', 'b@x.io');
  db.prepare('insert into profiles (id,username) values (?,?)').run('uA', 'a');
  db.prepare('insert into profiles (id,username) values (?,?)').run('uB', 'b');
  return { db, dir, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('notification: ghi row, bỏ self-notify, idempotent theo (user,kind,link)', () => {
  const { db, close } = fresh();
  try {
    const first = notifyUser(db, { userId: 'uB', kind: 'reply', body: 'x', link: 'comment:1', actorId: 'uA' });
    assert.equal(first.created, true);
    const dup = notifyUser(db, { userId: 'uB', kind: 'reply', body: 'x', link: 'comment:1', actorId: 'uA' });
    assert.equal(dup.created, false);
    assert.equal(dup.reason, 'duplicate');

    const self = notifyUser(db, { userId: 'uA', kind: 'reply', body: 'x', link: 'comment:2', actorId: 'uA' });
    assert.equal(self.created, false);
    assert.equal(self.reason, 'self_notify');

    const count = (db.prepare('select count(*) c from notifications').get() as { c: number }).c;
    assert.equal(count, 1, 'duplicate + self-notify không tạo row');
  } finally { close(); }
});

test('MAL worker: claim atomic, completed khi fetch OK, failed sau maxAttempts', async () => {
  const { db, close } = fresh();
  try {
    db.prepare(`insert into mal_sync_jobs (id,user_id,mal_username,status,created_at) values ('j1','uA','maluser','pending',?)`)
      .run(new Date().toISOString());

    const claimed = claimJob(db);
    assert.equal(claimed?.id, 'j1');
    assert.equal(claimed?.status, 'processing');
    assert.equal(claimed?.attempts, 1);
    assert.equal(claimJob(db), null, 'chỉ claim 1 lần (status đã processing)');

    const okFetch = (async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 1 }, { id: 2 }] }) })) as never;
    const done = await processJob(db, claimed!, { fetchImpl: okFetch });
    assert.equal(done.status, 'completed');
    assert.equal(done.imported, 2);
    const row = db.prepare("select status, total_imported, attempts from mal_sync_jobs where id='j1'").get() as
      { status: string; total_imported: number; attempts: number };
    assert.deepEqual(row, { status: 'completed', total_imported: 2, attempts: 1 });

    // job lỗi → về pending (còn lượt) rồi failed khi vượt maxAttempts
    db.prepare(`insert into mal_sync_jobs (id,user_id,mal_username,status,created_at) values ('j2','uA','bad','pending',?)`)
      .run(new Date().toISOString());
    const bad = claimJob(db)!;
    const failFetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as never;
    const r1 = await processJob(db, bad, { fetchImpl: failFetch, maxAttempts: 1 });
    assert.equal(r1.status, 'failed');
    const row2 = db.prepare("select status, attempts, error_message from mal_sync_jobs where id='j2'").get() as
      { status: string; attempts: number; error_message: string };
    assert.equal(row2.status, 'failed');
    assert.match(row2.error_message, /MAL HTTP 500/);
  } finally { close(); }
});

test('MAL worker: MAL_WORKER=0 tắt timer, mặc định bật và unref', () => {
  const { db, close } = fresh();
  try {
    process.env.MAL_WORKER = '0';
    assert.equal(startMalWorker(db), null, 'MAL_WORKER=0 → không chạy');
    delete process.env.MAL_WORKER;
    const timer = startMalWorker(db, 60_000);
    assert.ok(timer, 'mặc định phải bật');
    assert.equal(typeof timer.hasRef === 'function' && timer.hasRef(), false, 'timer phải unref');
    clearInterval(timer as NodeJS.Timeout);
  } finally { close(); }
});

test('trusted proxy: spoof header KHÔNG vượt được gate (socket IP quyết định)', async () => {
  const { db, dir, close } = fresh();
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    process.env.TRUSTED_PROXIES = '116.66.214.191';
    const spoof = await fetch(`${base}/api/health`, { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' } });
    assert.equal(spoof.status, 403, 'socket IP 127.0.0.1 không nằm trong TRUSTED_PROXIES → 403');
    assert.equal(((await spoof.json()) as { error: string }).error, 'untrusted_proxy');

    process.env.TRUSTED_PROXIES = '127.0.0.1';
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'socket IP tin cậy → 200');

    process.env.TRUSTED_PROXIES = '10.0.0.0/8';
    assert.equal((await fetch(`${base}/api/health`)).status, 403, 'CIDR không khớp → 403');
    process.env.TRUSTED_PROXIES = '127.0.0.0/8';
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'CIDR khớp → 200');

    process.env.ALLOW_DIRECT = '1';
    process.env.TRUSTED_PROXIES = '116.66.214.191';
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'ALLOW_DIRECT=1 → bỏ qua');
    delete process.env.ALLOW_DIRECT;
    delete process.env.TRUSTED_PROXIES;
    assert.equal(
      (await fetch(`${base}/api/health`)).status,
      403,
      'allowlist rỗng = fail-closed (không đoán proxy tin cậy)'
    );
  } finally {
    delete process.env.TRUSTED_PROXIES;
    delete process.env.ALLOW_DIRECT;
    await new Promise<void>((r) => server.close(() => r()));
    void dir;
    close();
  }
});


test('/api/health/deep chỉ owner: anon 401, user thường 403, owner 200', async () => {
  process.env.TRUSTED_PROXIES = '127.0.0.1';
  const { db, close } = fresh();
  process.env.JWT_SECRET = 'svc-secret-0123456789abcdef0123456789';
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/api/health/deep`)).status, 401, 'anon 401');

    db.prepare(`update profiles set badges='["mod"]' where id='uA'`).run();
    const { signAccessToken } = await import('../crypto/jwt');
    const sess = db.prepare(`insert into sessions (id,user_id,token_hash,expires_at) values ('sA','uA','h1',?) returning id`)
      .get(new Date(Date.now() + 3600_000).toISOString()) as { id: string };
    const modToken = signAccessToken({ sub: 'uA', sid: sess.id });
    assert.equal((await fetch(`${base}/api/health/deep`, { headers: { cookie: `tsuki_at=${modToken}` } })).status, 403, 'mod 403');

    db.prepare(`update profiles set badges='["owner"]' where id='uA'`).run();
    const { invalidateRoleCache } = await import('../middleware/requireAuth');
    invalidateRoleCache();
    const owner = await fetch(`${base}/api/health/deep`, { headers: { cookie: `tsuki_at=${modToken}` } });
    assert.equal(owner.status, 200, 'owner 200');
    const body = (await owner.json()) as Record<string, unknown>;
    assert.equal(body.wal, true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    close();
  }
});

test('rateLimit: 60k key không làm request cuối chậm (không prune O(N) hot path)', async () => {
  const { rateLimit } = await import('../middleware/rateLimit');
  const limiter = rateLimit({ name: 'perf', windowMs: 60_000, max: 5, keyGenerator: (req) => String(req.headers['x-k'] ?? 'k') });
  const req = { headers: { 'x-k': 'k' }, ip: '127.0.0.1' } as never;
  let status = 0;
  let ended = false;
  const res = {
    setHeader: () => undefined,
    status: (code: number) => { status = code; return res; },
    json: () => { ended = true; return res; },
  } as never;

  const { resetRateLimits } = await import('../middleware/rateLimit');
  resetRateLimits();
  // nhồi 60k key trực tiếp qua limiter với key khác nhau
  for (let i = 0; i < 60_000; i += 1) {
    (req as { headers: Record<string, string> }).headers['x-k'] = `k${i}`;
    limiter(req, res, () => undefined);
  }
  (req as { headers: Record<string, string> }).headers['x-k'] = 'final';
  const started = Date.now();
  limiter(req, res, () => undefined);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 50, `request cuối phải < 50ms, thực tế ${elapsed}ms`);
  void status; void ended;
});
