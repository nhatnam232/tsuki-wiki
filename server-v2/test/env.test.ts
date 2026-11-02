/** Test loader .env zero-dep + fallback SERVER_PORT (Pterodactyl). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvFile, parseEnvFile, resolvePort } from '../lib/env';

test('parseEnvFile: KEY=VALUE, comment, export, quote, giá trị rỗng', () => {
  const parsed = parseEnvFile(
    [
      '# comment',
      '',
      'PORT=4101',
      'export DB_PATH=./data/app.db',
      'A="có khoảng trắng"',
      "B='single'",
      'C=',
      'D=a=b=c',
      '  E = spaced  ',
      'not a line',
      '# F=1',
    ].join('\n')
  );

  assert.equal(parsed.PORT, '4101');
  assert.equal(parsed.DB_PATH, './data/app.db');
  assert.equal(parsed.A, 'có khoảng trắng');
  assert.equal(parsed.B, 'single');
  assert.equal(parsed.C, '');
  assert.equal(parsed.D, 'a=b=c', 'dấu = trong value phải giữ nguyên');
  assert.equal(parsed.E, 'spaced');
  assert.equal(parsed.F, undefined, 'dòng bị comment không được parse');
  assert.equal(parsed['not a line'], undefined);
});

test('loadEnvFile: file thiếu → bỏ qua, không throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-env-'));
  try {
    const result = loadEnvFile(join(dir, 'khong-ton-tai.env'));
    assert.equal(result.loaded, false);
    assert.equal(result.path, null);
    assert.deepEqual(result.applied, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnvFile: nạp biến mới nhưng KHÔNG override env đã có', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tsuki-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, 'TSV2_NEW_KEY=from-file\nTSV2_EXISTING=from-file\n');

  process.env.TSV2_EXISTING = 'from-process';
  delete process.env.TSV2_NEW_KEY;

  try {
    const result = loadEnvFile(file);
    assert.equal(result.loaded, true);
    assert.equal(process.env.TSV2_NEW_KEY, 'from-file');
    assert.equal(process.env.TSV2_EXISTING, 'from-process', 'env thật phải thắng .env');
    assert.deepEqual(result.applied, ['TSV2_NEW_KEY']);
    assert.deepEqual(result.skipped, ['TSV2_EXISTING']);
  } finally {
    delete process.env.TSV2_NEW_KEY;
    delete process.env.TSV2_EXISTING;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePort: PORT → SERVER_PORT → 4000, giá trị rác rơi về 4000', () => {
  const saved = { PORT: process.env.PORT, SERVER_PORT: process.env.SERVER_PORT };
  try {
    delete process.env.PORT;
    delete process.env.SERVER_PORT;
    assert.equal(resolvePort(), 4000, 'không có env → 4000');

    process.env.SERVER_PORT = '25200';
    assert.equal(resolvePort(), 25200, 'Pterodactyl SERVER_PORT phải được dùng');

    process.env.PORT = '4101';
    assert.equal(resolvePort(), 4101, 'PORT ưu tiên hơn SERVER_PORT');

    process.env.PORT = 'abc';
    delete process.env.SERVER_PORT;
    assert.equal(resolvePort(), 4000, 'giá trị không hợp lệ → 4000');

    process.env.PORT = '70000';
    assert.equal(resolvePort(), 4000, 'ngoài range → 4000');
  } finally {
    if (saved.PORT === undefined) delete process.env.PORT;
    else process.env.PORT = saved.PORT;
    if (saved.SERVER_PORT === undefined) delete process.env.SERVER_PORT;
    else process.env.SERVER_PORT = saved.SERVER_PORT;
  }
});
