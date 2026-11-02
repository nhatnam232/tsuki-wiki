/**
 * MAL sync worker tối giản: pending → processing → completed/failed.
 * Claim bằng 1 câu UPDATE ... RETURNING (atomic, 1 worker/row).
 * Chạy setInterval 60s .unref(); tắt bằng MAL_WORKER=0.
 * Không gọi mạng thật trong test (inject `fetchImpl`).
 */
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';

export interface MalJob {
  id: string;
  user_id: string;
  mal_username: string;
  status: string;
  attempts: number;
}

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const MAL_API = 'https://api.myanimelist.net/v2/users';

export function claimJob(db: Db): MalJob | null {
  const row = db
    .prepare(`update mal_sync_jobs
                 set status = 'processing', started_at = ?, attempts = attempts + 1
               where id = (select id from mal_sync_jobs where status = 'pending' order by created_at limit 1)
               returning id, user_id, mal_username, status, attempts`)
    .get(nowIso()) as MalJob | undefined;
  return row ?? null;
}

export interface ProcessResult { id: string; status: 'completed' | 'failed'; imported: number; error?: string }

export async function processJob(
  db: Db,
  job: MalJob,
  options: { fetchImpl?: FetchLike; maxAttempts?: number } = {}
): Promise<ProcessResult> {
  const fetcher = options.fetchImpl ?? ((globalThis.fetch as unknown) as FetchLike);
  const maxAttempts = options.maxAttempts ?? 3;

  try {
    const response = await fetcher(`${MAL_API}/${encodeURIComponent(job.mal_username)}/animelist?limit=100`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`MAL HTTP ${response.status}`);

    const body = (await response.json()) as { data?: unknown[] };
    const imported = Array.isArray(body.data) ? body.data.length : 0;

    db.prepare(`update mal_sync_jobs set status = 'completed', total_imported = ?, completed_at = ?, error_message = null where id = ?`)
      .run(imported, nowIso(), job.id);
    return { id: job.id, status: 'completed', imported };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finalStatus = job.attempts >= maxAttempts ? 'failed' : 'pending';
    db.prepare('update mal_sync_jobs set status = ?, error_message = ?, completed_at = ? where id = ?')
      .run(finalStatus, message.slice(0, 500), finalStatus === 'failed' ? nowIso() : null, job.id);
    return { id: job.id, status: finalStatus === 'failed' ? 'failed' : 'failed', imported: 0, error: message };
  }
}

export function startMalWorker(db: Db, intervalMs = 60_000): NodeJS.Timeout | null {
  if (process.env.MAL_WORKER === '0') return null;
  const timer = setInterval(() => {
    const job = claimJob(db);
    if (!job) return;
    void processJob(db, job).catch((err: unknown) => {
      process.stderr.write(`[mal] job ${job.id} lỗi: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
