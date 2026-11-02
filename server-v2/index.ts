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
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = resolvePort(); // PORT → SERVER_PORT (Pterodactyl) → 4000
const HOST = process.env.HOST || undefined; // HOST=127.0.0.1 khi chạy sau cloudflared nội bộ

/**
 * Chạy Cloudflare Tunnel *bên trong* container (TUNNEL_TOKEN có trong env).
 *
 * Lý do: khi cloudflared chạy ngoài container, origin phải tin IP public của
 * host tunnel (`TRUSTED_PROXIES`) — IP đó có thể đổi và mọi request từ host đó
 * đều được tin. Chạy trong container thì peer luôn là 127.0.0.1, app bind
 * loopback nên port allocation không còn truy cập được từ internet.
 */
let tunnel: ChildProcess | null = null;
function startTunnel(): void {
  const token = process.env.TUNNEL_TOKEN;
  if (!token) return;
  tunnel = spawn('/bin/sh', ['-c', 'chmod +x ./cloudflared 2>/dev/null; exec ./cloudflared tunnel run'], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  tunnel.on('exit', (code) => {
    process.stderr.write(`[tunnel] cloudflared exited code=${code}\n`);
    tunnel = null;
  });
}

function main(): void {
  const db = getDb(); // mở DB + chạy migration ngay khi boot (fail-fast nếu schema lỗi)

  process.stderr.write(
    `[server-v2] db=${currentDbPath()} wal=${isWalEnabled(db)} node=${process.version}` +
      ` env=${envLoadResult.loaded ? envLoadResult.path : 'none'}` +
      ` keys=${envLoadResult.applied.join(',') || '-'}\n`
  );

  const app = createApp({ db });
  const onListening = () => {
    process.stderr.write(`[server-v2] listening on ${HOST ?? '0.0.0.0'}:${PORT}\n`);
  };
  const server = HOST ? app.listen(PORT, HOST, onListening) : app.listen(PORT, onListening);

  attachWebSocket(server, db);
  startMalWorker(db);
  startTunnel();

  const shutdown = (signal: string): void => {
    process.stderr.write(`[server-v2] ${signal} received, shutting down\n`);
    closeWebSocket();
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
