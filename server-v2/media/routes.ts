/** GET /media/<bucket>/<key> — static file từ MEDIA_DIR, chống path traversal. */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Request, Response, Router } from 'express';
import express from 'express';

const BUCKETS = new Set(['avatars', 'covers', 'comment-images']);
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export function mediaDir(): string {
  return resolve(process.env.MEDIA_DIR ?? './media');
}

export function createMediaRouter(): Router {
  const router = express.Router();
  const root = mediaDir();

  router.get('*', (req: Request, res: Response) => {
    // Express 4: wildcard là '*', đọc req.path (bỏ dấu '/' đầu)
    const raw = req.path.replace(/^\/+/, '');
    const decoded = (() => {
      try { return decodeURIComponent(raw); } catch { return raw; }
    })();

    if (!decoded || decoded.includes('..') || decoded.includes('\0') || raw.includes('\0')) {
      res.status(403).json({ success: false, error: 'forbidden_path' });
      return;
    }

    const segments = decoded.split('/').filter(Boolean);
    if (segments.length < 2 || !BUCKETS.has(segments[0] as string)) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }

    const target = resolve(root, decoded);
    if (target !== root && !target.startsWith(root + sep)) {
      res.status(403).json({ success: false, error: 'forbidden_path' });
      return;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }

    const ext = extname(target).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Stream lỗi (file bị xoá giữa chừng, EACCES...) phải được bắt, nếu không
    // 'error' unhandled sẽ kill process.
    const stream = createReadStream(target);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).json({ success: false, error: 'read_error' });
      else res.destroy();
    });
    stream.pipe(res);
  });

  return router;
}
