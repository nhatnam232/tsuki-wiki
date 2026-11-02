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

const PORT = resolvePort(); // PORT → SERVER_PORT (Pterodactyl) → 4000

function main(): void {
  const db = getDb(); // mở DB + chạy migration ngay khi boot (fail-fast nếu schema lỗi)

  process.stderr.write(
    `[server-v2] db=${currentDbPath()} wal=${isWalEnabled(db)} node=${process.version}` +
      ` env=${envLoadResult.loaded ? envLoadResult.path : 'none'}` +
      ` keys=${envLoadResult.applied.join(',') || '-'}\n`
  );

  const app = createApp({ db });
  const server = app.listen(PORT, () => {
    process.stderr.write(`[server-v2] listening on :${PORT}\n`);
  });

  attachWebSocket(server, db);
  startMalWorker(db);

  const shutdown = (signal: string): void => {
    process.stderr.write(`[server-v2] ${signal} received, shutting down\n`);
    closeWebSocket();
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
