/**
 * server-v2 — entrypoint (Phase 0 / Slice 1).
 *
 * Trách nhiệm: mở DB (migration tự chạy), bind Express vào PORT, shutdown sạch.
 * App/routes nằm ở `app.ts` để test import được mà không listen.
 */
import { envLoadResult, resolvePort } from './lib/env'; // PHẢI import đầu tiên: nạp .env trước
import { createApp } from './app';
import { closeDb, currentDbPath, getDb, isWalEnabled } from './db/index';
import { attachWebSocket, closeWebSocket } from './ws/server';
import { startMalWorker } from './services/malWorker';
import { assertCaptchaConfigured } from './auth/captcha';
import { appendFileSync } from 'node:fs';

/**
 * Crash forensics: the 12:03 outage left no trace because the process died
 * silently. Log the reason (stderr + data/crash.log) before exiting so the next
 * incident is diagnosable from the panel console.
 */
function logCrash(kind: string, err: unknown): void {
  const detail =
    err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  const line = `[${new Date().toISOString()}] ${kind}: ${detail}\n`;
  process.stderr.write(`[server-v2] ${line}`);
  try {
    appendFileSync(process.env.CRASH_LOG_PATH ?? './data/crash.log', line);
  } catch {
    /* logging must never throw */
  }
}
process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason);
});
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = resolvePort(); // PORT → SERVER_PORT (Pterodactyl) → 4000
// Bind loopback by default when the tunnel runs in-process: the public
// allocation must never be reachable directly. Explicit HOST still wins.
const HOST = process.env.HOST || (process.env.TUNNEL_TOKEN ? '127.0.0.1' : undefined);
const EXPECT_LOOPBACK = Boolean(process.env.TUNNEL_TOKEN) && HOST === '127.0.0.1';

/**
 * Chạy Cloudflare Tunnel *bên trong* container (TUNNEL_TOKEN có trong env).
 *
 * Lý do: khi cloudflared chạy ngoài container, origin phải tin IP public của
 * host tunnel (`TRUSTED_PROXIES`) — IP đó có thể đổi và mọi request từ host đó
 * đều được tin. Chạy trong container thì peer luôn là 127.0.0.1, app bind
 * loopback nên port allocation không còn truy cập được từ internet.
 */
let tunnel: ChildProcess | null = null;
let tunnelStopping = false;
let tunnelBackoff = 1000;

/**
 * Supervise cloudflared: if it dies the whole site is unreachable (the app only
 * listens on loopback), so restart with capped exponential backoff.
 */
function startTunnel(): void {
  const token = process.env.TUNNEL_TOKEN;
  if (!token) return;
  tunnel = spawn('/bin/sh', ['-c', 'chmod +x ./cloudflared 2>/dev/null; exec ./cloudflared tunnel run'], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  tunnel.on('exit', (code, signal) => {
    tunnel = null;
    if (tunnelStopping) return;
    process.stderr.write(
      `[tunnel] cloudflared exited code=${code} signal=${signal ?? '-'}, restarting in ${tunnelBackoff}ms\n`
    );
    const delay = tunnelBackoff;
    tunnelBackoff = Math.min(tunnelBackoff * 2, 30_000);
    setTimeout(() => {
      if (!tunnelStopping) startTunnel();
    }, delay).unref();
  });
  // A process that stayed up for a while resets the backoff.
  setTimeout(() => {
    if (tunnel) tunnelBackoff = 1000;
  }, 60_000).unref();
}

function main(): void {
  assertCaptchaConfigured(); // fail-fast: production must not run without captcha
  const db = getDb(); // mở DB + chạy migration ngay khi boot (fail-fast nếu schema lỗi)

  process.stderr.write(
    `[server-v2] db=${currentDbPath()} wal=${isWalEnabled(db)} node=${process.version}` +
      ` env=${envLoadResult.loaded ? envLoadResult.path : 'none'}` +
      ` keys=${envLoadResult.applied.join(',') || '-'}\n`
  );

  const app = createApp({ db });
  const onListening = () => {
    process.stderr.write(`[server-v2] listening on ${HOST ?? '0.0.0.0'}:${PORT}\n`);
    if (!EXPECT_LOOPBACK && process.env.NODE_ENV === 'production') {
      process.stderr.write(
        '[server-v2] WARNING: TUNNEL_TOKEN set but not bound to 127.0.0.1 - the allocation port is publicly reachable\n'
      );
    }
  };
  const server = HOST ? app.listen(PORT, HOST, onListening) : app.listen(PORT, onListening);

  attachWebSocket(server, db);
  startMalWorker(db);
  startTunnel();

  const shutdown = (signal: string): void => {
    process.stderr.write(`[server-v2] ${signal} received, shutting down\n`);
    closeWebSocket();
    tunnelStopping = true;
    tunnel?.kill('SIGTERM');
    server.close(() => {
      try {
        closeDb();
      } finally {
        process.exit(0);
      }
    });
    // Không treo mãi nếu còn connection lạc.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
