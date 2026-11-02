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

test('CF gate: REQUIRE_CF_HEADER=1 → thiếu cf-connecting-ip bị 403, có thì 200', async () => {
  const { db, dir, close } = fresh();
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    process.env.REQUIRE_CF_HEADER = '1';
    const blocked = await fetch(`${base}/api/health`);
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as { error: string }).error, 'cloudflare_required');

    const throughCf = await fetch(`${base}/api/health`, { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    assert.equal(throughCf.status, 200);

    delete process.env.REQUIRE_CF_HEADER;
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'tắt env → không chặn');
  } finally {
    delete process.env.REQUIRE_CF_HEADER;
    await new Promise<void>((r) => server.close(() => r()));
    void dir;
    close();
  }
});
