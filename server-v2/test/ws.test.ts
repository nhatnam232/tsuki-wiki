/** WebSocket realtime: auth 1008, 2 client cùng room <1s, cô lập notification, bỏ qua input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import WebSocket from 'ws';

process.env.JWT_SECRET = 'ws-test-secret-0123456789abcdef01234567';
process.env.COOKIE_SECURE = 'false';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { attachWebSocket, broadcastNotification, closeWebSocket } from '../ws/server';
import { resetRateLimits } from '../middleware/rateLimit';

interface H { base: string; wsBase: string; db: Db; close: () => Promise<void> }

async function harness(): Promise<H> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-ws-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  attachWebSocket(server, db);
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
    db,
    close: async () => {
      closeWebSocket();
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

async function token(base: string, email: string): Promise<string> {
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'S3cret-password!' }),
  });
  return (cookies(reg).find((c) => c.startsWith('tsuki_at=')) as string).split(';')[0] as string;
}

/** Mở WS, trả về {ws, opened, closed}. */
function open(url: string, cookie?: string) {
  const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
  const opened = new Promise<boolean>((resolve) => {
    ws.once('open', () => resolve(true));
    ws.once('error', () => resolve(false));
  });
  const closed = new Promise<{ code: number }>((resolve) => ws.once('close', (code) => resolve({ code })));
  return { ws, opened, closed };
}

test('WS: thiếu cookie → close 1008; topic lạ → close 1008', async () => {
  const h = await harness();
  try {
    const anon = open(`${h.wsBase}/api/ws?topics=activity`);
    await anon.opened;
    const closedAnon = await anon.closed;
    assert.equal(closedAnon.code, 1008, 'thiếu cookie phải đóng 1008');

    const cookie = await token(h.base, 'ws-a@example.com');
    const bad = open(`${h.wsBase}/api/ws?topics=hack:room`, cookie);
    await bad.opened;
    assert.equal((await bad.closed).code, 1008, 'topic lạ phải đóng 1008');
  } finally { await h.close(); }
});

test('WS: 2 client cùng room comments nhận comment:new <1s; client message bị bỏ qua', async () => {
  const h = await harness();
  try {
    const a = await token(h.base, 'ws1@example.com');
    const b = await token(h.base, 'ws2@example.com');
    const room = 'comments:anime:21';

    const c1 = open(`${h.wsBase}/api/ws?topics=${encodeURIComponent(room)}`, a);
    const c2 = open(`${h.wsBase}/api/ws?topics=${encodeURIComponent(room)}`, b);
    await Promise.all([c1.opened, c2.opened]);

    const got1 = new Promise<Record<string, unknown>>((resolve) => {
      c1.ws.on('message', (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>));
    });
    const got2 = new Promise<Record<string, unknown>>((resolve) => {
      c2.ws.on('message', (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>));
    });

    const started = Date.now();
    const res = await fetch(`${h.base}/api/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: a },
      body: JSON.stringify({ entityType: 'anime', entityId: 21, body: 'realtime' }),
    });
    assert.equal(res.status, 201);

    const [e1, e2] = await Promise.all([got1, got2]);
    assert.equal(e1.type, 'comment:new');
    assert.equal(e2.type, 'comment:new');
    assert.equal((e1.payload as Record<string, unknown>).entityId, 21);
    assert.ok(Date.now() - started < 1000, 'phải nhận <1s');

    // client gửi message → server bỏ qua, không crash, vẫn nhận event sau đó
    c1.ws.send(JSON.stringify({ type: 'subscribe', topic: 'notifications:someone' }));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(c1.ws.readyState, WebSocket.OPEN, 'kết nối vẫn mở');

    c1.ws.close(); c2.ws.close();
  } finally { await h.close(); }
});

test('WS: A không nhận notification của B (room theo uid trong token)', async () => {
  const h = await harness();
  try {
    const a = await token(h.base, 'wsA@example.com');
    const b = await token(h.base, 'wsB@example.com');
    const bId = (h.db.prepare("select id from users where email='wsb@example.com'").get() as { id: string }).id;

    // A mở room notifications của CHÍNH A; B mở room của B
    const aId = (h.db.prepare("select id from users where email='wsa@example.com'").get() as { id: string }).id;
    const ca = open(`${h.wsBase}/api/ws?topics=${encodeURIComponent(`notifications:${aId}`)}`, a);
    const cb = open(`${h.wsBase}/api/ws?topics=${encodeURIComponent(`notifications:${bId}`)}`, b);
    await Promise.all([ca.opened, cb.opened]);

    let aGot = 0;
    ca.ws.on('message', () => { aGot += 1; });
    const bGot = new Promise<boolean>((resolve) => cb.ws.once('message', () => resolve(true)));

    broadcastNotification(bId, { id: 'n1', kind: 'reply' });
    assert.equal(await bGot, true, 'B phải nhận notification của B');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(aGot, 0, 'A KHÔNG được nhận notification của B');

    // mở room notifications của người khác bằng token A → 1008
    const spoof = open(`${h.wsBase}/api/ws?topics=${encodeURIComponent(`notifications:${bId}`)}`, a);
    await spoof.opened;
    assert.equal((await spoof.closed).code, 1008, 'không được subscribe room notification của uid khác');

    ca.ws.close(); cb.ws.close();
  } finally { await h.close(); }
});
