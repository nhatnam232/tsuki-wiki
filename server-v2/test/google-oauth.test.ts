/**
 * Google OAuth test — KHÔNG gọi mạng ngoài: stub `globalThis.fetch` cho JWKS +
 * token endpoint, ký id_token bằng RSA key sinh tại chỗ.
 * Nhờ vậy verify được cả chữ ký RS256, aud/iss/exp, upsert user, link theo email.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signRsa } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.OAUTH_REDIRECT_URI = 'http://127.0.0.1:9999/api/auth/google/callback';
process.env.SITE_URL = 'http://localhost:5173';
process.env.JWT_SECRET = 'oauth-test-secret-0123456789abcdef0123456789';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
const KID = 'test-kid-1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function makeIdToken(claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      ...claims,
    })
  );
  const signature = b64url(signRsa('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey));
  return `${header}.${payload}.${signature}`;
}

interface StubState {
  idToken: string;
  calls: string[];
}

function stubFetch(state: StubState): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Chỉ chặn endpoint Google; request của test tới server local phải đi tiếp.
    if (!url.includes('googleapis.com') && !url.includes('accounts.google.com')) {
      return original(input as string, init);
    }

    state.calls.push(url);

    if (url.includes('certs')) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'RS256' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('oauth2.googleapis.com/token')) {
      assert.equal(init?.method, 'POST');
      const body = String(init?.body ?? '');
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code_verifier=/);
      return new Response(JSON.stringify({ id_token: state.idToken }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

interface Harness {
  base: string;
  db: Db;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-oauth-test-'));
  const db = openDb({ path: join(dir, 'app.db') });
  const app = createApp({ db, disableRateLimit: true });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    db,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Bắt đầu flow: gọi /start, trả về {stateCookie, state, location}. */
async function beginFlow(base: string): Promise<{
  stateCookie: string;
  state: string;
  location: string;
  challenge: string;
}> {
  const res = await fetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const setCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const stateCookie = (setCookie.find((c) => c.startsWith('tsuki_oauth_state=')) ?? '').split(';')[0] ?? '';

  const url = new URL(location);
  const state = url.searchParams.get('state') ?? '';
  const challenge = url.searchParams.get('code_challenge') ?? '';

  assert.equal(res.status, 302);
  assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), location);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), process.env.OAUTH_REDIRECT_URI);
  assert.ok(challenge.length > 20, 'thiếu PKCE code_challenge');

  return { stateCookie, state, location, challenge };
}

test('oauth start: 302 sang Google với PKCE S256 + state + cookie HttpOnly', async () => {
  const h = await startHarness();
  try {
    const { stateCookie, state } = await beginFlow(h.base);
    assert.ok(stateCookie.startsWith('tsuki_oauth_state='), 'phải set state cookie');
    const raw = await (await fetch(`${h.base}/api/auth/google/start`, { redirect: 'manual' })).headers
      .getSetCookie?.();
    const cookieLine = (raw ?? []).find((c) => c.startsWith('tsuki_oauth_state=')) ?? '';
    assert.match(cookieLine, /HttpOnly/);
    assert.match(cookieLine, /Path=\/api\/auth\/google/);
    assert.match(cookieLine, /SameSite=Lax/);
    assert.ok(state.length > 10);
  } finally {
    await h.close();
  }
});

test('oauth callback: user mới → tạo users(google_sub) + profiles + set cookie, 302 về site', async () => {
  const h = await startHarness();
  const state: StubState = { idToken: makeIdToken({ sub: 'g-sub-1', email: 'new@example.com', email_verified: true, name: 'G New' }), calls: [] };
  const restore = stubFetch(state);
  try {
    const flow = await beginFlow(h.base);
    const res = await fetch(
      `${h.base}/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(flow.state)}`,
      { redirect: 'manual', headers: { cookie: flow.stateCookie } }
    );

    assert.equal(res.status, 302, `kỳ vọng 302, nhận ${res.status}`);
    assert.equal(res.headers.get('location'), 'http://localhost:5173');

    const cookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    assert.ok(cookies.some((c) => c.startsWith('tsuki_at=')), 'thiếu access cookie');
    assert.ok(cookies.some((c) => c.startsWith('tsuki_rt=')), 'thiếu refresh cookie');

    const user = h.db
      .prepare('select id, google_sub, email, email_verified, name from users where email = ?')
      .get('new@example.com') as { id: string; google_sub: string; email_verified: number };
    assert.equal(user.google_sub, 'g-sub-1');
    assert.equal(user.email_verified, 1);

    const profile = h.db.prepare('select username from profiles where id = ?').get(user.id) as {
      username: string;
    };
    assert.equal(profile.username, 'new');

    assert.ok(state.calls.some((u) => u.includes('certs')), 'phải verify id_token bằng JWKS');
  } finally {
    restore();
    await h.close();
  }
});

test('oauth callback: cùng sub đăng nhập lần 2 → không tạo user trùng', async () => {
  const h = await startHarness();
  const state: StubState = { idToken: makeIdToken({ sub: 'g-sub-2', email: 'dup@example.com', email_verified: true }), calls: [] };
  const restore = stubFetch(state);
  try {
    for (let i = 0; i < 2; i += 1) {
      const flow = await beginFlow(h.base);
      const res = await fetch(
        `${h.base}/api/auth/google/callback?code=fake&state=${encodeURIComponent(flow.state)}`,
        { redirect: 'manual', headers: { cookie: flow.stateCookie } }
      );
      assert.equal(res.status, 302);
    }
    const count = (
      h.db.prepare('select count(*) as c from users where google_sub = ?').get('g-sub-2') as {
        c: number;
      }
    ).c;
    assert.equal(count, 1, 'không được tạo user trùng theo google_sub');

    const sessions = (
      h.db.prepare('select count(*) as c from sessions').get() as { c: number }
    ).c;
    assert.equal(sessions, 2, 'mỗi lần login tạo 1 session riêng (không share refresh token)');
  } finally {
    restore();
    await h.close();
  }
});

test('oauth callback: email_verified=false → 403, không tạo user', async () => {
  const h = await startHarness();
  const state: StubState = { idToken: makeIdToken({ sub: 'g-sub-3', email: 'unverified@example.com', email_verified: false }), calls: [] };
  const restore = stubFetch(state);
  try {
    const flow = await beginFlow(h.base);
    const res = await fetch(
      `${h.base}/api/auth/google/callback?code=fake&state=${encodeURIComponent(flow.state)}`,
      { redirect: 'manual', headers: { cookie: flow.stateCookie } }
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'email_not_verified');

    const count = (
      h.db.prepare('select count(*) as c from users').get() as { c: number }
    ).c;
    assert.equal(count, 0, 'không được tạo user khi email chưa verify');
  } finally {
    restore();
    await h.close();
  }
});

test('oauth callback: state sai → 400 invalid_oauth_state (chống CSRF)', async () => {
  const h = await startHarness();
  const state: StubState = { idToken: makeIdToken({ sub: 'g-sub-4', email: 'csrf@example.com', email_verified: true }), calls: [] };
  const restore = stubFetch(state);
  try {
    const flow = await beginFlow(h.base);
    const res = await fetch(`${h.base}/api/auth/google/callback?code=fake&state=sai-state`, {
      redirect: 'manual',
      headers: { cookie: flow.stateCookie },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'invalid_oauth_state');
    assert.equal(state.calls.filter((u) => u.includes('token')).length, 0, 'không được đổi code khi state sai');
  } finally {
    restore();
    await h.close();
  }
});

test('oauth callback: tài khoản password chưa verify cùng email → 409, không chiếm tài khoản', async () => {
  const h = await startHarness();
  try {
    // đăng ký bằng password trước → email_verified = 0
    await fetch(`${h.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'victim@example.com', password: 'S3cret-password!' }),
    });

    const state: StubState = {
      idToken: makeIdToken({ sub: 'g-sub-5', email: 'victim@example.com', email_verified: true }),
      calls: [],
    };
    const restore = stubFetch(state);
    try {
      const flow = await beginFlow(h.base);
      const res = await fetch(
        `${h.base}/api/auth/google/callback?code=fake&state=${encodeURIComponent(flow.state)}`,
        { redirect: 'manual', headers: { cookie: flow.stateCookie } }
      );
      assert.equal(res.status, 409);
      const body = (await res.json()) as { error: string };
      assert.equal(body.error, 'account_unverified_conflict');

      const row = h.db
        .prepare('select google_sub from users where email = ?')
        .get('victim@example.com') as { google_sub: string | null };
      assert.equal(row.google_sub, null, 'không được gắn google_sub vào tài khoản chưa verify');
    } finally {
      restore();
    }
  } finally {
    await h.close();
  }
});
