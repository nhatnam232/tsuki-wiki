/**
 * Loader `.env` zero-dependency (không cài `dotenv`).
 *
 * Pterodactyl không cho export env qua shell/panel → `.env` cạnh bundle là
 * đường DUY NHẤT để nạp JWT_SECRET / CRON_SECRET / DB_PATH / SITE_URL.
 *
 * Quy tắc:
 *   - `KEY=VALUE`, bỏ qua dòng trống và dòng bắt đầu bằng `#`.
 *   - Cho phép tiền tố `export `.
 *   - Bỏ quote đơn/kép bao ngoài; `\n` trong quote kép được hiểu là xuống dòng.
 *   - KHÔNG override biến đã có trong `process.env` (env thật luôn thắng file).
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type EnvMap = Record<string, string>;

/** Parse nội dung file .env (thuần, không side-effect → dễ test). */
export function parseEnvFile(content: string): EnvMap {
  const out: EnvMap = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq < 1) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1);
        if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
    }
    out[key] = value;
  }

  return out;
}

function moduleDir(): string | null {
  try {
    if (typeof __dirname === 'string' && __dirname.length > 0) return __dirname;
  } catch {
    /* ESM */
  }
  return null;
}

/** Tìm file .env: ENV_FILE → cwd/.env → cạnh module → thư mục cha của module. */
export function findEnvFile(): string | null {
  const fromEnv = process.env.ENV_FILE;
  const candidates: string[] = [];
  if (fromEnv) candidates.push(isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv));
  candidates.push(join(process.cwd(), '.env'));

  const dir = moduleDir();
  if (dir) {
    candidates.push(join(dir, '.env'));
    candidates.push(join(dir, '..', '.env'));
  }

  for (const candidate of candidates) {
    const abs = resolve(candidate);
    if (existsSync(abs)) return abs;
  }
  return null;
}

export interface LoadResult {
  loaded: boolean;
  path: string | null;
  applied: string[];
  skipped: string[];
}

export function loadEnvFile(path?: string): LoadResult {
  const file = path ?? findEnvFile();
  if (!file || !existsSync(file)) return { loaded: false, path: null, applied: [], skipped: [] };

  const parsed = parseEnvFile(readFileSync(file, 'utf8'));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      skipped.push(key); // env thật thắng
      continue;
    }
    process.env[key] = value;
    applied.push(key);
  }

  return { loaded: true, path: file, applied, skipped };
}

/**
 * PORT theo thứ tự: PORT → SERVER_PORT (Pterodactyl inject) → 4000.
 */
export function resolvePort(): number {
  const raw = process.env.PORT || process.env.SERVER_PORT || '4000';
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4000;
}

// Side-effect: nạp .env ngay khi module này được import (đặt import ĐẦU TIÊN
// trong `index.ts` để chạy trước mọi module đọc process.env lúc load).
export const envLoadResult: LoadResult = loadEnvFile();
