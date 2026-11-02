/**
 * Unit test cho lớp crypto tự viết (zero-dependency): scrypt password + JWT HS256.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'unit-test-secret-0123456789abcdef0123456789abcdef';

import {
  SCRYPT_PARAMS,
  hashPassword,
  needsRehash,
  validatePasswordPolicy,
  verifyPassword,
} from '../crypto/password';
import { ACCESS_TOKEN_TTL_SEC, signAccessToken, verifyAccessToken } from '../crypto/jwt';

test('password: hash đúng format scrypt$N$r$p$salt$hash + verify đúng/sai', async () => {
  const stored = await hashPassword('correct horse battery staple');

  const parts = stored.split('$');
  assert.equal(parts.length, 6, 'format phải có 6 phần');
  assert.equal(parts[0], 'scrypt');
  assert.equal(Number(parts[1]), SCRYPT_PARAMS.N);
  assert.equal(Number(parts[2]), SCRYPT_PARAMS.r);
  assert.equal(Number(parts[3]), SCRYPT_PARAMS.p);
  assert.ok(Buffer.from(parts[4], 'base64').length >= 16, 'salt >= 16 byte');

  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('sai-mat-khau', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('password: salt ngẫu nhiên → 2 hash khác nhau nhưng cùng verify được', async () => {
  const a = await hashPassword('same-password-123');
  const b = await hashPassword('same-password-123');
  assert.notEqual(a, b, 'salt phải ngẫu nhiên');
  assert.equal(await verifyPassword('same-password-123', a), true);
  assert.equal(await verifyPassword('same-password-123', b), true);
});

test('password: hash hỏng/không phải scrypt → false, không throw', async () => {
  for (const bad of [
    null,
    undefined,
    '',
    'plaintext',
    'bcrypt$12$abc',
    'scrypt$x$y$z$AAAA$BBBB',
    'scrypt$16384$8$1$!!!$???',
    'scrypt$0$8$1$AAAA$BBBB',
  ]) {
    assert.equal(await verifyPassword('anything', bad as string | null), false, `bad=${String(bad)}`);
  }
});

test('password: needsRehash đúng khi tham số yếu hơn hiện hành', async () => {
  const current = await hashPassword('x'.repeat(12));
  assert.equal(needsRehash(current), false);

  const weak = 'scrypt$4096$8$1$c2FsdHNhbHQ=$aGFzaGhhc2g=';
  assert.equal(needsRehash(weak), true);
  assert.equal(needsRehash('not-a-hash'), true);
  assert.equal(needsRehash(null), true);
});

test('password policy: min 8 / max 200 ký tự', () => {
  assert.equal(validatePasswordPolicy('1234567'), 'password_too_short');
  assert.equal(validatePasswordPolicy('12345678'), null);
  assert.equal(validatePasswordPolicy('a'.repeat(201)), 'password_too_long');
  assert.equal(validatePasswordPolicy(undefined), 'password_invalid');
});

test('jwt: sign → verify giữ đúng sub/sid và TTL 15 phút', () => {
  const now = 1_700_000_000;
  const token = signAccessToken({ sub: 'user-1', sid: 'sess-1' }, { now });

  const result = verifyAccessToken(token, { now: now + 1 });
  assert.equal(result.valid, true);
  if (!result.valid) return;

  assert.equal(result.payload.sub, 'user-1');
  assert.equal(result.payload.sid, 'sess-1');
  assert.equal(result.payload.iat, now);
  assert.equal(result.payload.exp, now + ACCESS_TOKEN_TTL_SEC);
  assert.equal(ACCESS_TOKEN_TTL_SEC, 900);
});

test('jwt: sửa 1 byte chữ ký → invalid', () => {
  const token = signAccessToken({ sub: 'u', sid: 's' });
  const parts = token.split('.');
  // Sửa BYTE thật: ký tự base64url cuối chỉ mang 2 bit nên đổi nó có thể
  // không đổi byte nào (bài học từ test flaky đầu tiên).
  const sigBytes = Buffer.from(parts[2] as string, 'base64url');
  sigBytes[0] = (sigBytes[0] ?? 0) ^ 0xff;
  const tampered = `${parts[0]}.${parts[1]}.${sigBytes.toString('base64url')}`;

  const result = verifyAccessToken(tampered);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, 'bad_signature');
});

test('jwt: đổi payload (leo thang sub) → invalid', () => {
  const token = signAccessToken({ sub: 'user-a', sid: 'sess-a' });
  const [header, , signature] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'admin', sid: 'sess-a', iat: 1, exp: 9_999_999_999 })
  ).toString('base64url');

  const result = verifyAccessToken(`${header}.${forgedPayload}.${signature}`);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, 'bad_signature');
});

test('jwt: token hết hạn → reason=expired', () => {
  const now = 1_700_000_000;
  const token = signAccessToken({ sub: 'u', sid: 's' }, { now });
  const result = verifyAccessToken(token, { now: now + ACCESS_TOKEN_TTL_SEC + 1 });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, 'expired');
});

test('jwt: alg:none bị từ chối (không nhận token không ký)', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'x', sid: 'y', iat: 1, exp: 9_999_999_999 })
  ).toString('base64url');

  const result = verifyAccessToken(`${header}.${payload}.`);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, 'bad_algorithm');
});

test('jwt: sai secret → invalid; token rác → malformed', () => {
  const token = signAccessToken({ sub: 'u', sid: 's' }, { secret: 'a'.repeat(40) });
  const wrongSecret = verifyAccessToken(token, { secret: 'b'.repeat(40) });
  assert.equal(wrongSecret.valid, false);
  if (!wrongSecret.valid) assert.equal(wrongSecret.reason, 'bad_signature');

  for (const junk of ['', 'abc', 'a.b.c', 'a.b']) {
    const result = verifyAccessToken(junk);
    assert.equal(result.valid, false);
  }
});
