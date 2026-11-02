/**
 * POST /api/media/:bucket — upload ảnh.
 *
 * Nhận 2 kiểu body (để không phải thêm dependency multipart):
 *   1. RAW: body = binary, `content-type: image/*`, `x-filename: avatar.jpg`  ← khuyến nghị
 *   2. multipart/form-data 1 part tên `file` (tương thích src/lib/backend.ts hiện tại)
 *
 * Giới hạn: bucket ∈ {avatars,covers,comment-images}; chỉ image/jpeg|png|webp; ≤ 5 MB.
 * Lưu: MEDIA_DIR/<bucket>/<uid>/<timestamp>-<rand>.<ext>; trả /media/<bucket>/<uid>/<file>.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { Request, Response, Router } from 'express';
import express from 'express';
import { mediaDir } from './routes';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const BUCKETS = new Set(['avatars', 'covers', 'comment-images']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Chỉ giữ phần tên file an toàn (chống ../, null byte, đường dẫn tuyệt đối). */
export function safeFilename(raw: unknown, fallbackExt: string): string {
  const name = typeof raw === 'string' ? raw : '';
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '');
  const ext = extname(cleaned).toLowerCase();
  if (ext && ext.length <= 6) return cleaned;
  // No usable extension: keep the sanitised stem (e.g. "../../.env" -> "env")
  // and append the server-chosen extension instead of discarding the name.
  return cleaned ? `${cleaned}${fallbackExt}` : `upload${fallbackExt}`;
}

interface ParsedBody { buffer: Buffer; mime: string; filename?: string }

function parseMultipart(body: Buffer, contentType: string): ParsedBody | null {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2]?.trim();
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  const start = body.indexOf(delimiter);
  if (start < 0) return null;

  const headerEnd = body.indexOf('\r\n\r\n', start);
  if (headerEnd < 0) return null;

  const headers = body.subarray(start, headerEnd).toString('utf8');
  const next = body.indexOf(delimiter, headerEnd);
  if (next < 0) return null;

  // bỏ \r\n cuối part
  const data = body.subarray(headerEnd + 4, next - 2);
  const mime = /content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? '';
  const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
  return { buffer: data, mime, filename };
}

export function createUploadRouter(): Router {
  const router = express.Router();

  router.post('/:bucket', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), (req: Request, res: Response) => {
    const bucket = String(req.params.bucket ?? '');
    if (!BUCKETS.has(bucket)) {
      res.status(400).json({ success: false, error: 'invalid_bucket' });
      return;
    }

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (raw.length === 0) {
      res.status(400).json({ success: false, error: 'empty_body' });
      return;
    }
    if (raw.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ success: false, error: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES });
      return;
    }

    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    const parsed = contentType.startsWith('multipart/form-data')
      ? parseMultipart(raw, contentType)
      : { buffer: raw, mime: contentType.split(';')[0]?.trim() ?? '', filename: req.headers['x-filename'] as string | undefined };

    if (!parsed) {
      res.status(400).json({ success: false, error: 'invalid_multipart' });
      return;
    }

    const mime = parsed.mime.split(';')[0]?.trim() ?? '';
    const ext = EXT_BY_MIME[mime];
    if (!ext) {
      res.status(415).json({ success: false, error: 'unsupported_media_type', allowed: Object.keys(EXT_BY_MIME) });
      return;
    }

    // Tên file do server sinh (timestamp + random) → client không điều khiển path.
    const fileName = `${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'unauthorized' });
      return;
    }

    const root = resolve(mediaDir(), bucket, userId);
    const target = join(root, fileName);
    if (!target.startsWith(resolve(mediaDir(), bucket) + sep)) {
      res.status(400).json({ success: false, error: 'invalid_path' });
      return;
    }

    mkdirSync(root, { recursive: true });
    writeFileSync(target, parsed.buffer);

    res.status(200).json({ success: true, path: `/media/${bucket}/${userId}/${fileName}`, bytes: parsed.buffer.length });
  });

  return router;
}
