/**
 * HTTP integration test cho auth (dựng server thật trên port ngẫu nhiên + fetch).
 * Không dùng supertest (zero-dependency).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'integration-test-secret-0123456789abcdef012345';
process.env.COOKIE_SECURE = 'true';

import express from 'express';
import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { requireAuth, requireRole, invalidateRoleCache } from '../middleware/requireAuth';
import { resetRateLimits } from '../middleware/rateLimit';

interface Harness {
  base: string;
  db: Db;
  close: () => Promise<void>;
}

interface StartOptions {
  rateLimit?: boolean;
}

async function startHarness(options: StartOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-auth-test-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();

  const app = createApp({ db, disableRateLimit: options.rateLimit !== true });
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

function setCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

/** Cookie jar tối giản: lưu theo tên, bỏ qua Path (test không mô phỏng browser). */
class CookieJar {
  private store = new Map<string, string>();

  ingest(res: Response): void {
    for (const line of setCookies(res)) {
      const pair = line.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') this.store.delete(name);
      else this.store.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.store.get(name);
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  cookies: string[];
}

async function request(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; jar?: CookieJar; headers?: Record<string, string> } = {}
): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.jar) {
    const cookie = init.jar.header();
    if (cookie) headers.cookie = cookie;
  }

  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });

  const rawCookies = setCookies(res);
  if (init.jar) init.jar.ingest(res);

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }

  return { status: res.status, body, headers: res.headers, cookies: rawCookies };
}

const EMAIL = 'tester@example.com';
const PASSWORD = 'S3cret-password!';

async function registerUser(base: string, jar: CookieJar, email = EMAIL) {
  return request(base, '/api/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name: 'Tester' },
    jar,
  });
}

test('POST /api/auth/register → 201, set cookie, tạo users + profiles', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    const res = await registerUser(h.base, jar);

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    const user = res.body.user as Record<string, unknown>;
    assert.equal(user.email, EMAIL);
    assert.equal(user.email_verified, false, 'đăng ký password chưa verify email');
    assert.equal(user.password_hash, undefined, 'response KHÔNG được chứa password_hash');
    assert.equal(jar.get('tsuki_at') !== undefined, true, 'phải có access cookie');
    assert.equal(jar.get('tsuki_rt') !== undefined, true, 'phải có refresh cookie');

    const row = h.db
      .prepare('select email, password_hash from users where lower(email) = ?')
      .get(EMAIL) as { email: string; password_hash: string };
    assert.equal(row.password_hash.startsWith('scrypt$'), true, 'DB phải lưu hash scrypt');
    assert.equal(row.password_hash.includes(PASSWORD), false, 'không được lưu plaintext');

    const profile = h.db.prepare('select username from profiles where id = ?').get(user.id) as {
      username: string;
    };
    assert.equal(profile.username, 'tester', 'phải tạo profiles row');
  } finally {
    await h.close();
  }
});

test('POST /api/auth/register: email trùng → 409, email sai/ngắn → 400', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    assert.equal((await registerUser(h.base, jar)).status, 201);

    const dup = await registerUser(h.base, new CookieJar());
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'email_taken');

    const badEmail = await request(h.base, '/api/auth/register', {
      method: 'POST',
      body: { email: 'khong-phai-email', password: PASSWORD },
    });
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.body.error, 'invalid_email');

    const shortPw = await request(h.base, '/api/auth/register', {
      method: 'POST',
      body: { email: 'khac@example.com', password: '123' },
    });
    assert.equal(shortPw.status, 400);
    assert.equal(shortPw.body.error, 'password_too_short');
  } finally {
    await h.close();
  }
});

test('POST /api/auth/login: cookie đủ HttpOnly + Secure + SameSite=Lax + Path', async () => {
  const h = await startHarness();
  try {
    await registerUser(h.base, new CookieJar());

    const jar = new CookieJar();
    const res = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
      jar,
    });

    assert.equal(res.status, 200);
    const access = res.cookies.find((c) => c.startsWith('tsuki_at='));
    const refresh = res.cookies.find((c) => c.startsWith('tsuki_rt='));
    assert.ok(access, 'thiếu access cookie');
    assert.ok(refresh, 'thiếu refresh cookie');

    assert.match(access, /HttpOnly/);
    assert.match(access, /Secure/);
    assert.match(access, /SameSite=Lax/);
    assert.match(access, /Path=\/;/);
    assert.match(access, /Max-Age=900/);

    assert.match(refresh, /HttpOnly/);
    assert.match(refresh, /Secure/);
    assert.match(refresh, /SameSite=Lax/);
    assert.match(refresh, /Path=\/api\/auth/);
    assert.match(refresh, /Max-Age=2592000/);
  } finally {
    await h.close();
  }
});

test('POST /api/auth/login: sai mật khẩu / email lạ → 401 (không lộ email tồn tại)', async () => {
  const h = await startHarness();
  try {
    await registerUser(h.base, new CookieJar());

    const wrongPw = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: 'sai-mat-khau' },
    });
    assert.equal(wrongPw.status, 401);
    assert.equal(wrongPw.body.error, 'invalid_credentials');

    const unknown = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'khong-ton-tai@example.com', password: PASSWORD },
    });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error, 'invalid_credentials');
  } finally {
    await h.close();
  }
});

test('GET /api/auth/me: 200 khi có cookie, 401 khi thiếu, 401 khi JWT bị sửa', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    await registerUser(h.base, jar);

    const ok = await request(h.base, '/api/auth/me', { jar });
    assert.equal(ok.status, 200);
    const user = ok.body.user as Record<string, unknown>;
    assert.equal(user.email, EMAIL);
    assert.equal((ok.body.badges as string[]).length, 0);
    assert.equal(user.password_hash, undefined);

    const anonymous = await request(h.base, '/api/auth/me');
    assert.equal(anonymous.status, 401);

    const token = jar.get('tsuki_at') as string;
    const parts = token.split('.');
    const sigBytes = Buffer.from(parts[2] as string, 'base64url');
    sigBytes[0] = (sigBytes[0] ?? 0) ^ 0xff; // đổi 1 byte thật, không đổi ký tự base64 cuối
    const forged = `${parts[0]}.${parts[1]}.${sigBytes.toString('base64url')}`;
    const tampered = await request(h.base, '/api/auth/me', {
      headers: { cookie: `tsuki_at=${forged}` },
    });
    assert.equal(tampered.status, 401, 'JWT sửa 1 ký tự phải 401');
  } finally {
    await h.close();
  }
});

test('POST /api/auth/refresh: rotate token, dùng lại token cũ → 401 + revoke cả family', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    await registerUser(h.base, jar);
    const oldRefresh = jar.get('tsuki_rt') as string;

    const rotated = await request(h.base, '/api/auth/refresh', { method: 'POST', jar });
    assert.equal(rotated.status, 200);
    const newRefresh = jar.get('tsuki_rt') as string;
    assert.notEqual(newRefresh, oldRefresh, 'refresh token phải đổi sau rotate');

    // access token mới dùng được
    assert.equal((await request(h.base, '/api/auth/me', { jar })).status, 200);

    // replay token cũ → 401 reuse
    const replayJar = new CookieJar();
    replayJar.set('tsuki_rt', oldRefresh);
    const replay = await request(h.base, '/api/auth/refresh', { method: 'POST', jar: replayJar });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error, 'refresh_reuse_detected');

    // family bị revoke → token mới cũng chết
    const afterReuse = await request(h.base, '/api/auth/refresh', { method: 'POST', jar });
    assert.equal(afterReuse.status, 401, 'sau reuse, toàn bộ family phải bị revoke');

    const revokedCount = (
      h.db.prepare('select count(*) as c from sessions where revoked_at is not null').get() as {
        c: number;
      }
    ).c;
    assert.ok(revokedCount >= 2, `phải revoke >= 2 session, thực tế ${revokedCount}`);
  } finally {
    await h.close();
  }
});

test('POST /api/auth/logout: 200, revoke session (revoked_at set) → me 401', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    await registerUser(h.base, jar);

    const sessionId = (
      h.db.prepare('select id from sessions order by created_at desc limit 1').get() as {
        id: string;
      }
    ).id;

    const out = await request(h.base, '/api/auth/logout', { method: 'POST', jar });
    assert.equal(out.status, 200);

    const row = h.db
      .prepare('select revoked_at from sessions where id = ?')
      .get(sessionId) as { revoked_at: string | null };
    assert.equal(typeof row.revoked_at, 'string', 'revoked_at phải được set');

    // cookie bị clear: request tiếp theo không còn cookie hợp lệ
    const afterLogout = await request(h.base, '/api/auth/me', { jar });
    assert.equal(afterLogout.status, 401);

    // dùng lại access token cũ (jar đã bị xoá cookie nên set tay)
    const stale = await request(h.base, '/api/auth/me', {
      headers: { cookie: `tsuki_at=${jar.get('tsuki_at') ?? ''}` },
    });
    assert.equal(stale.status, 401, 'session đã revoke → access token cũ phải 401');
  } finally {
    await h.close();
  }
});

test('GET /api/auth/google/start: 503 oauth_not_configured khi thiếu env', async () => {
  const h = await startHarness();
  const saved = {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
  };
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    const res = await request(h.base, '/api/auth/google/start');
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'oauth_not_configured');

    const callback = await request(h.base, '/api/auth/google/callback?code=x&state=y');
    assert.equal(callback.status, 503);
    assert.equal(callback.body.error, 'oauth_not_configured');
  } finally {
    if (saved.id !== undefined) process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret !== undefined) process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    await h.close();
  }
});

test('rate limit: 10 lần login / cửa sổ → request thứ 11 bị 429', async () => {
  const h = await startHarness({ rateLimit: true });
  try {
    await registerUser(h.base, new CookieJar());

    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await request(h.base, '/api/auth/login', {
        method: 'POST',
        body: { email: EMAIL, password: 'sai-mat-khau' },
      });
      codes.push(res.status);
      if (res.status === 429) {
        assert.equal(res.body.error, 'rate_limited');
        assert.ok(res.headers.get('retry-after'), '429 phải có Retry-After');
      }
    }

    assert.deepEqual(codes.slice(0, 10), [401, 401, 401, 401, 401, 401, 401, 401, 401, 401]);
    assert.equal(codes[10], 429, `request 11 phải 429, thực tế ${codes.join(',')}`);
  } finally {
    await h.close();
  }
});

test('requireRole: user thường 403, có badge mod 200, badge owner thoả mọi mức', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    const reg = await registerUser(h.base, jar);
    const userId = (reg.body.user as { id: string }).id;

    const mini = express();
    mini.get('/mod', requireAuth(h.db), requireRole('mod'), (_req, res) => {
      res.json({ ok: true });
    });
    const server: Server = await new Promise((resolve) => {
      const s = mini.listen(0, '127.0.0.1', () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      const denied = await request(base, '/mod', { jar });
      assert.equal(denied.status, 403, 'không có badge → 403');
      assert.equal(denied.body.error, 'forbidden');

      process.env.ROLE_CACHE_TTL_MS = '0';
      h.db.prepare('update profiles set badges = ? where id = ?').run('["mod"]', userId);
      invalidateRoleCache();

      const allowed = await request(base, '/mod', { jar });
      assert.equal(allowed.status, 200, 'badge mod → 200');

      h.db.prepare('update profiles set badges = ? where id = ?').run('[]', userId);
      invalidateRoleCache();
      const revoked = await request(base, '/mod', { jar });
      assert.equal(revoked.status, 403, 'badge bị revoke → 403 ngay (cache=0)');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delete process.env.ROLE_CACHE_TTL_MS;
    }
  } finally {
    await h.close();
  }
});

test('POST /api/auth/signup (alias) + logout idempotent khi không có cookie', async () => {
  const h = await startHarness();
  try {
    const jar = new CookieJar();
    const res = await request(h.base, '/api/auth/signup', {
      method: 'POST',
      body: { email: 'alias@example.com', password: PASSWORD },
      jar,
    });
    assert.equal(res.status, 201);

    const out1 = await request(h.base, '/api/auth/logout', { method: 'POST' });
    assert.equal(out1.status, 200, 'logout không cookie vẫn 200 (idempotent)');
    const out2 = await request(h.base, '/api/auth/logout', { method: 'POST', jar });
    assert.equal(out2.status, 200);
    assert.equal((await request(h.base, '/api/auth/me', { jar })).status, 401);
  } finally {
    await h.close();
  }
});

test('cookies: Secure tắt được bằng COOKIE_SECURE=false (chỉ cho dev http)', async () => {
  const h = await startHarness();
  process.env.COOKIE_SECURE = 'false';
  try {
    const jar = new CookieJar();
    await registerUser(h.base, jar);
    const res = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
      jar: new CookieJar(),
    });
    const access = res.cookies.find((c) => c.startsWith('tsuki_at=')) as string;
    assert.equal(/;\s*Secure/.test(access), false, 'COOKIE_SECURE=false → không có Secure');
    assert.match(access, /HttpOnly/);
    assert.match(access, /SameSite=Lax/);
  } finally {
    process.env.COOKIE_SECURE = 'true';
    await h.close();
  }
});

test('login với hash bcrypt legacy → 200 và rehash sang scrypt trong DB; sai mật khẩu → 401, hash giữ nguyên', async () => {
  const h = await startHarness();
  try {
    const bcryptjs = (await import('bcryptjs')).default;
    const legacyHash = bcryptjs.hashSync('Str0ngPass!23', 10);

    // Tạo user "legacy" trực tiếp trong DB (giả lập dữ liệu migrate từ Supabase)
    const id = 'legacy-user-1';
    h.db.prepare('insert into users (id, email, provider, password_hash) values (?,?,?,?)').run(
      id, 'legacy@example.com', 'email', legacyHash
    );
    h.db.prepare('insert into profiles (id, username) values (?,?)').run(id, 'legacy');

    // Sai mật khẩu trước → 401 và hash vẫn là bcrypt
    const bad = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy@example.com', password: 'sai-mat-khau' },
    });
    assert.equal(bad.status, 401);
    const before = h.db.prepare('select password_hash from users where id = ?').get(id) as {
      password_hash: string;
    };
    assert.match(before.password_hash, /^\$2[aby]\$/, 'sai mật khẩu không được đổi hash');

    // Đúng mật khẩu → 200 + rehash scrypt
    const ok = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy@example.com', password: 'Str0ngPass!23' },
    });
    assert.equal(ok.status, 200);

    const after = h.db
      .prepare('select password_hash, password_updated_at from users where id = ?')
      .get(id) as { password_hash: string; password_updated_at: string | null };
    assert.match(after.password_hash, /^scrypt\$16384\$8\$1\$/, 'phải rehash sang scrypt');
    assert.ok(after.password_updated_at, 'password_updated_at phải được set');

    // Login lần 2 bằng scrypt vẫn OK
    const again = await request(h.base, '/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy@example.com', password: 'Str0ngPass!23' },
    });
    assert.equal(again.status, 200);
  } finally {
    await h.close();
  }
});
