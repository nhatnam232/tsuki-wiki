/** Admin auth: rotate-password (cron secret) + verify-password (mod+) + audit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.JWT_SECRET = 'admin-test-secret-0123456789abcdef0123456789';
process.env.TRUSTED_PROXIES = '127.0.0.1';
process.env.CRON_SECRET = 'test-cron-secret-0123456789abcdef0123456789';

import { createApp } from '../app';
import { openDb, type Db } from '../db/index';
import { invalidateRoleCache } from '../middleware/requireAuth';
import { resetRateLimits } from '../middleware/rateLimit';

interface H { base: string; db: Db; close: () => Promise<void> }

async function harness(): Promise<H> {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-admin-'));
  const db = openDb({ path: join(dir, 'app.db') });
  resetRateLimits();
  const app = createApp({ db, disableRateLimit: false });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    db,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function setCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return h.getSetCookie ? h.getSetCookie() : [];
}

async function registerAndLogin(base: string, email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'S3cret-password!' }),
  });
  assert.equal(res.status, 201);
  const access = setCookies(res).find((c) => c.startsWith('tsuki_at='));
  assert.ok(access);
  return (access as string).split(';')[0] as string;
}

function makeMod(db: Db, email: string): void {
  const user = db.prepare('select id from users where email = ?').get(email) as { id: string };
  db.prepare('update profiles set badges = ? where id = ?').run('["mod"]', user.id);
  process.env.ROLE_CACHE_TTL_MS = '0';
  invalidateRoleCache();
}

test('rotate-password: GET + POST với x-cron-secret đúng → 200, mật khẩu CSPRNG', async () => {
  const h = await harness();
  try {
    const get = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET as string, 'x-forwarded-proto': 'https' },
    });
    assert.equal(get.status, 200);
    const body1 = (await get.json()) as { password: string; validForDate: string };
    assert.ok(body1.password.length >= 20, 'mật khẩu phải >= 20 ký tự');
    assert.match(body1.validForDate, /^\d{4}-\d{2}-\d{2}$/);

    const post = await fetch(`${h.base}/api/admin/rotate-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'x-forwarded-proto': 'https' },
    });
    assert.equal(post.status, 200, 'POST + Bearer cũng phải 200');
    const body2 = (await post.json()) as { password: string };
    assert.notEqual(body1.password, body2.password, 'mỗi lần rotate phải sinh mật khẩu mới');

    const stored = h.db
      .prepare('select password_hash from admin_passwords order by created_at desc limit 1')
      .get() as { password_hash: string };
    assert.match(stored.password_hash, /^scrypt\$/, 'phải lưu hash scrypt, không plaintext');
    assert.equal(stored.password_hash.includes(body2.password), false);
  } finally {
    await h.close();
  }
});

test('rotate-password: thiếu/sai secret → 401; x-vercel-cron-signature + UA vercel-cron → 401', async () => {
  const h = await harness();
  try {
    const noSecret = await fetch(`${h.base}/api/admin/rotate-password`);
    assert.equal(noSecret.status, 401);

    const wrong = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: { 'x-cron-secret': 'sai-secret' },
    });
    assert.equal(wrong.status, 401);

    const legacy = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: {
        'x-vercel-cron-signature': 'x',
        'x-cron-secret': process.env.CRON_SECRET as string,
      },
    });
    assert.equal(legacy.status, 401, 'x-vercel-cron-signature phải bị từ chối');

    const cronUa = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: {
        'user-agent': 'vercel-cron/1.0',
        'x-cron-secret': process.env.CRON_SECRET as string,
      },
    });
    assert.equal(cronUa.status, 401, 'UA vercel-cron/* phải bị từ chối');
  } finally {
    await h.close();
  }
});

test('verify-password: chưa đăng nhập → 401; user thường → 403', async () => {
  const h = await harness();
  try {
    const anon = await fetch(`${h.base}/api/admin/verify-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'x' }),
    });
    assert.equal(anon.status, 401, 'chưa đăng nhập → 401');

    const cookie = await registerAndLogin(h.base, 'plain@example.com');
    const normal = await fetch(`${h.base}/api/admin/verify-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: 'x' }),
    });
    assert.equal(normal.status, 403, 'user thường (không badge) → 403');
  } finally {
    await h.close();
  }
});

test('verify-password: mod + mật khẩu đúng → 200 và ghi audit success', async () => {
  const h = await harness();
  try {
    const cookie = await registerAndLogin(h.base, 'mod@example.com');
    makeMod(h.db, 'mod@example.com');

    const rotate = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET as string, 'x-forwarded-proto': 'https' },
    });
    const { password } = (await rotate.json()) as { password: string };

    const res = await fetch(`${h.base}/api/admin/verify-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { valid: boolean }).valid, true);

    const audit = h.db
      .prepare("select reason from audit_logs where target_type = 'admin_password' order by created_at desc limit 1")
      .get() as { reason: string };
    assert.equal(audit.reason, 'success');
  } finally {
    await h.close();
  }
});

test('verify-password: sai mật khẩu → 401, audit failed, KHÔNG ghi plaintext', async () => {
  const h = await harness();
  try {
    const cookie = await registerAndLogin(h.base, 'mod2@example.com');
    makeMod(h.db, 'mod2@example.com');

    const secret = 'plaintext-must-not-be-logged-123';
    const res = await fetch(`${h.base}/api/admin/verify-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: secret }),
    });
    assert.equal(res.status, 401);

    const row = h.db
      .prepare("select reason, target_id from audit_logs where target_type = 'admin_password' order by created_at desc limit 1")
      .get() as { reason: string; target_id: string };
    assert.equal(row.reason, 'failed');

    const dump = h.db.prepare('select * from audit_logs').all();
    assert.equal(JSON.stringify(dump).includes(secret), false, 'audit không được chứa mật khẩu');
  } finally {
    await h.close();
  }
});

test('verify-password: rate limit 5/phút/user → lần thứ 6 bị 429', async () => {
  const h = await harness();
  try {
    const cookie = await registerAndLogin(h.base, 'mod3@example.com');
    makeMod(h.db, 'mod3@example.com');

    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await fetch(`${h.base}/api/admin/verify-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ password: `wrong-${i}` }),
      });
      codes.push(res.status);
    }
    assert.deepEqual(codes.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(codes[5], 429, `lần 6 phải 429, thực tế ${codes.join(',')}`);
  } finally {
    await h.close();
  }
});

test('requireRole("mod") là mod-OR-ABOVE: badge owner-only / admin-only vẫn 200 (không tự khoá admin)', async () => {
  const h = await harness();
  try {
    const rotate = await fetch(`${h.base}/api/admin/rotate-password`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET as string, 'x-forwarded-proto': 'https' },
    });
    const { password } = (await rotate.json()) as { password: string };

    for (const badge of ['owner', 'admin']) {
      const email = `${badge}@example.com`;
      const cookie = await registerAndLogin(h.base, email);
      const user = h.db.prepare('select id from users where email = ?').get(email) as { id: string };
      h.db.prepare('update profiles set badges = ? where id = ?').run(JSON.stringify([badge]), user.id);
      process.env.ROLE_CACHE_TTL_MS = '0';
      invalidateRoleCache();

      const res = await fetch(`${h.base}/api/admin/verify-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ password }),
      });
      assert.equal(res.status, 200, `badge "${badge}" phải qua được requireRole('mod')`);
    }
  } finally {
    await h.close();
  }
});

test('rate limit verify-password theo USER (không theo IP): A bị 429 không ảnh hưởng B', async () => {
  const h = await harness();
  try {
    const cookieA = await registerAndLogin(h.base, 'a@example.com');
    const cookieB = await registerAndLogin(h.base, 'b@example.com');
    makeMod(h.db, 'a@example.com');
    makeMod(h.db, 'b@example.com');

    const call = (cookie: string) =>
      fetch(`${h.base}/api/admin/verify-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ password: 'wrong' }),
      });

    for (let i = 0; i < 5; i += 1) assert.equal((await call(cookieA)).status, 401);
    assert.equal((await call(cookieA)).status, 429, 'A: lần 6 → 429');

    // B cùng IP (127.0.0.1) nhưng khác user → vẫn phải được gọi
    assert.equal((await call(cookieB)).status, 401, 'B không được bị ảnh hưởng bởi A');
  } finally {
    await h.close();
  }
});

test('GET /api/admin/cron-secret: chỉ owner (mod/admin đều 403), ghi audit cron_secret_read', async () => {
  const h = await harness();
  try {
    const plain = await registerAndLogin(h.base, 'o0@example.com');
    const m = await registerAndLogin(h.base, 'o1@example.com');
    const ad = await registerAndLogin(h.base, 'o2@example.com');
    const ow = await registerAndLogin(h.base, 'o3@example.com');
    const setBadge = (email: string, badge: string) => {
      const id = (h.db.prepare('select id from users where email = ?').get(email) as { id: string }).id;
      h.db.prepare('update profiles set badges = ? where id = ?').run(JSON.stringify(badge ? [badge] : []), id);
    };
    setBadge('o1@example.com', 'mod');
    setBadge('o2@example.com', 'admin');
    setBadge('o3@example.com', 'owner');
    process.env.ROLE_CACHE_TTL_MS = '0';
    invalidateRoleCache();

    assert.equal((await fetch(`${h.base}/api/admin/cron-secret`)).status, 401, 'anon 401');
    assert.equal((await fetch(`${h.base}/api/admin/cron-secret`, { headers: { cookie: plain } })).status, 403, 'user thường 403');
    assert.equal((await fetch(`${h.base}/api/admin/cron-secret`, { headers: { cookie: m } })).status, 403, 'mod 403');
    assert.equal((await fetch(`${h.base}/api/admin/cron-secret`, { headers: { cookie: ad } })).status, 403, 'admin 403');

    const owner = await fetch(`${h.base}/api/admin/cron-secret`, { headers: { cookie: ow } });
    assert.equal(owner.status, 200, 'owner 200');
    const body = (await owner.json()) as { secret: string; source: string };
    assert.ok(body.secret.length >= 32, 'secret >= 32 ký tự');
    assert.equal(body.source, 'env');

    const log = h.db.prepare("select action from audit_logs where action='cron_secret_read'").get() as { action: string };
    assert.equal(log?.action, 'cron_secret_read', 'phải ghi audit cron_secret_read');
  } finally { await h.close(); }
});

test('rotate-password: có webhook → không trả plaintext; không webhook → trả plaintext + warning', async () => {
  const h = await harness();
  const saved = process.env.ADMIN_PASSWORD_WEBHOOK;
  const originalFetch = globalThis.fetch;
  try {
    // nhánh KHÔNG webhook
    delete process.env.ADMIN_PASSWORD_WEBHOOK;
    const noHook = await fetch(`${h.base}/api/admin/rotate-password`, { headers: { 'x-cron-secret': process.env.CRON_SECRET as string, 'x-forwarded-proto': 'https' } });
    const noHookBody = (await noHook.json()) as { password?: string; warning?: string };
    assert.equal(noHook.status, 200);
    assert.ok(noHookBody.password, 'không webhook → phải trả plaintext cho owner');
    assert.equal(noHookBody.warning, 'plaintext_over_tls_only');

    // HTTP + không webhook → 409 tls_required_for_plaintext
    const before = h.db.prepare('select count(*) c from admin_passwords').get() as { c: number };
    const httpOnly = await fetch(`${h.base}/api/admin/rotate-password`, { headers: { 'x-cron-secret': process.env.CRON_SECRET as string } });
    const httpBody = (await httpOnly.json()) as { error?: string; password?: string; rotated?: boolean };
    assert.equal(httpOnly.status, 409, 'HTTP không webhook phải 409');
    assert.equal(httpBody.error, 'tls_required_for_plaintext');
    assert.equal(httpBody.rotated, false, '409 phải trả rotated:false');
    assert.equal(httpBody.password, undefined, 'không được trả plaintext qua HTTP');
    const after = h.db.prepare('select count(*) c from admin_passwords').get() as { c: number };
    assert.equal(after.c, before.c, 'DB KHÔNG được đổi khi 409 (không mất mật khẩu)');

    // nhánh CÓ webhook (stub fetch để không gọi Discord thật)
    process.env.ADMIN_PASSWORD_WEBHOOK = 'https://discord.test/webhook';
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://discord.test/')) {
        calls.push(url);
        return new Response('ok', { status: 200 });
      }
      return originalFetch(input as string, init);
    }) as typeof fetch;

    const withHook = await originalFetch(`${h.base}/api/admin/rotate-password`, { headers: { 'x-cron-secret': process.env.CRON_SECRET as string, 'x-forwarded-proto': 'https' } });
    const withHookBody = (await withHook.json()) as { password?: string; rotated?: boolean; webhook_sent?: boolean };
    globalThis.fetch = originalFetch;

    assert.equal(withHook.status, 200);
    assert.equal(withHookBody.password, undefined, 'có webhook → KHÔNG được trả plaintext');
    assert.equal(withHookBody.rotated, true);
    assert.equal(withHookBody.webhook_sent, true);
    assert.equal(calls.length, 1, 'phải POST tới webhook');
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.ADMIN_PASSWORD_WEBHOOK;
    else process.env.ADMIN_PASSWORD_WEBHOOK = saved;
    await h.close();
  }
});
