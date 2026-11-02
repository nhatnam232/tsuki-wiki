/**
 * Phase 1b — 9 bảng còn lại có route (matrix §2).
 * translation_cache + mal_sync_jobs: KHÔNG route (service nội bộ).
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';
import { ACTIVITY_JSON, COMPARE_JSON, normalizeRow, normalizeRows } from '../lib/json';
import { optionalAuth, requireAuth, requireRole, type AuthContext } from '../middleware/requireAuth';
import { notifyEditDecision } from '../services/notifications';

type Row = Record<string, unknown>;
const ok = (res: Response, body: Row, status = 200) => res.status(status).json({ success: true, ...body });
const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
const int = (v: unknown): number | null => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isMod = (a: AuthContext | null): boolean =>
  Boolean(a && a.badges.some((b) => b === 'mod' || b === 'admin' || b === 'owner'));
const TRUSTED = ['active', 'top_fan', 'mod', 'admin', 'owner'];

function h(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response): void => {
    void Promise.resolve(fn(req, res)).catch(() => { if (!res.headersSent) fail(res, 500, 'internal_error'); });
  };
}
function audit(db: Db, actorId: string | null, action: string, targetType: string, targetId: string, reason: string): void {
  db.prepare(`insert into audit_logs (actor_id, action, target_type, target_id, reason, created_at)
              values (?,?,?,?,?,?)`).run(actorId, action, targetType, targetId, reason, nowIso());
}

export function createExtrasRouter(db: Db): Router {
  const r = express.Router();
  const authMw = requireAuth(db);
  const optionalMw = optionalAuth(db);

  // ── anime_reactions (upsert UNIQUE user+anime) ──────────────
  r.get('/anime/:animeId/reactions', h((req, res) => {
    const row = db.prepare('select * from anime_reaction_counts where anime_id = ?').get(req.params.animeId);
    ok(res, { counts: row ?? { anime_id: int(req.params.animeId), heart_count: 0, laugh_count: 0, cry_count: 0, total_count: 0 } });
  }));
  r.post('/anime/:animeId/reaction', authMw, h((req, res) => {
    const a = req.auth;
    const animeId = int(req.params.animeId);
    const reaction = str((req.body as Row)?.reaction);
    if (animeId === null || !reaction || !['heart', 'laugh', 'cry'].includes(reaction)) return fail(res, 400, 'invalid_input');
    db.prepare(`insert into anime_reactions (user_id, anime_id, reaction, created_at) values (?,?,?,?)
                on conflict (user_id, anime_id) do update set reaction = excluded.reaction`)
      .run(a?.userId, animeId, reaction, nowIso());
    ok(res, { reaction });
  }));
  r.delete('/anime/:animeId/reaction', authMw, h((req, res) => {
    const info = db.prepare('delete from anime_reactions where user_id = ? and anime_id = ?').run(req.auth?.userId, req.params.animeId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── anime_reviews ──────────────────────────────────────────
  r.get('/anime/:animeId/reviews', h((req, res) => {
    const rows = db.prepare(`select r.*, p.username, p.display_name, p.avatar_url from anime_reviews r
      left join profiles p on p.id = r.user_id
      where r.anime_id = ? and r.is_deleted = 0 order by r.created_at desc limit 50`).all(req.params.animeId);
    ok(res, { items: rows });
  }));
  r.post('/anime/:animeId/reviews', authMw, h((req, res) => {
    const body = str((req.body as Row)?.body);
    if (!body || body.length > 200) return fail(res, 400, 'invalid_body');
    const row = db.prepare(`insert into anime_reviews (user_id, anime_id, body, is_deleted, created_at, updated_at)
      values (?,?,?,0,?,?) returning *`).get(req.auth?.userId, req.params.animeId, body, nowIso(), nowIso());
    ok(res, { review: row }, 201);
  }));
  r.delete('/reviews/:id', authMw, h((req, res) => {
    const row = db.prepare('select user_id from anime_reviews where id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!row) return fail(res, 404, 'not_found');
    if (row.user_id !== req.auth?.userId && !isMod(req.auth ?? null)) return fail(res, 403, 'forbidden');
    db.prepare('update anime_reviews set is_deleted = 1, updated_at = ? where id = ?').run(nowIso(), req.params.id);
    ok(res, { deleted: 1, soft: true });
  }));

  // ── notifications (không POST — service ghi) ───────────────
  r.get('/notifications', authMw, h((req, res) => {
    const rows = db.prepare('select * from notifications where user_id = ? order by created_at desc limit 50').all(req.auth?.userId);
    ok(res, { items: rows });
  }));
  r.patch('/notifications/:id', authMw, h((req, res) => {
    const info = db.prepare('update notifications set read_at = ? where id = ? and user_id = ? and read_at is null')
      .run(nowIso(), req.params.id, req.auth?.userId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { updated: info.changes });
  }));
  r.delete('/notifications/:id', authMw, h((req, res) => {
    const info = db.prepare('delete from notifications where id = ? and user_id = ?').run(req.params.id, req.auth?.userId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── audit_logs (self + mod) ────────────────────────────────
  r.get('/audit-logs/mine', authMw, h((req, res) => {
    ok(res, { items: db.prepare('select * from audit_logs where actor_id = ? order by created_at desc limit 50').all(req.auth?.userId) });
  }));
  r.get('/audit-logs', authMw, requireRole('mod'), h((_req, res) => {
    ok(res, { items: db.prepare('select * from audit_logs order by created_at desc limit 100').all() });
  }));

  // ── anime_edit_suggestions ─────────────────────────────────
  r.post('/edit-suggestions', authMw, h((req, res) => {
    const a = req.auth;
    const body = req.body as Row;
    const animeId = int(body.animeId);
    const field = str(body.field);
    const after = body.contentAfter;
    if (animeId === null || !field || after === undefined) return fail(res, 400, 'invalid_input');
    const trusted = Boolean(a && a.badges.some((b) => TRUSTED.includes(b)));
    const status = trusted ? 'auto_approved' : 'pending';
    const row = db.prepare(`insert into anime_edit_suggestions
      (user_id, anime_id, field, content_before, content_after, reason, status, reviewed_by, reviewed_at, created_at)
      values (?,?,?,?,?,?,?,?,?,?) returning *`)
      .get(a?.userId, animeId, field, body.contentBefore ?? null, String(after), str(body.reason) ?? null,
        status, trusted ? a?.userId : null, trusted ? nowIso() : null, nowIso());
    ok(res, { suggestion: row, autoApproved: trusted }, 201);
  }));
  r.get('/edit-suggestions/mine', authMw, h((req, res) => {
    ok(res, { items: db.prepare('select * from anime_edit_suggestions where user_id = ? order by created_at desc limit 50').all(req.auth?.userId) });
  }));
  r.get('/edit-suggestions', authMw, requireRole('mod'), h((req, res) => {
    const status = str(req.query.status) ?? 'pending';
    ok(res, { items: db.prepare('select * from anime_edit_suggestions where status = ? order by created_at desc limit 100').all(status) });
  }));
  r.patch('/edit-suggestions/:id', authMw, requireRole('mod'), h((req, res) => {
    const decision = str((req.body as Row)?.status);
    if (decision !== 'approved' && decision !== 'rejected') return fail(res, 400, 'invalid_status');
    const sug = db.prepare('select * from anime_edit_suggestions where id = ?').get(req.params.id) as Row | undefined;
    if (!sug) return fail(res, 404, 'not_found');
    const note = str((req.body as Row)?.note);
    const run = db.transaction(() => {
      db.prepare('update anime_edit_suggestions set status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? where id = ?')
        .run(decision, req.auth?.userId, nowIso(), note, req.params.id);
      audit(db, req.auth?.userId ?? null, decision === 'approved' ? 'approve_edit' : 'reject_edit',
        'anime', String(sug.anime_id), note ?? '');
      notifyEditDecision(db, {
        suggestionId: String(sug.id), ownerId: String(sug.user_id), status: decision,
        actorId: req.auth?.userId ?? '', animeId: Number(sug.anime_id),
      });
    });
    run();
    ok(res, { updated: 1, status: decision });
  }));

  // ── compare_history (owner; anime_ids là array) ────────────
  r.get('/compare-history', authMw, h((req, res) => {
    const rows = db.prepare('select * from compare_history where user_id = ? order by created_at desc limit 50').all(req.auth?.userId) as Row[];
    ok(res, { items: normalizeRows(rows, COMPARE_JSON) });
  }));
  r.post('/compare-history', authMw, h((req, res) => {
    const raw = (req.body as Row)?.animeIds;
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 10 || !raw.every((v) => Number.isInteger(v))) {
      return fail(res, 400, 'invalid_anime_ids');
    }
    const row = db.prepare('insert into compare_history (user_id, anime_ids, created_at) values (?,?,?) returning *')
      .get(req.auth?.userId, JSON.stringify(raw), nowIso()) as Row;
    ok(res, { item: normalizeRow(row, COMPARE_JSON) }, 201);
  }));
  r.delete('/compare-history/:id', authMw, h((req, res) => {
    const info = db.prepare('delete from compare_history where id = ? and user_id = ?').run(req.params.id, req.auth?.userId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── quests (public, active) + progress (self, read-only) ───
  r.get('/quests', optionalMw, h((req, res) => {
    const rows = req.auth
      ? db.prepare(`select q.*, p.progress, p.completed_at, p.claimed_at from quests q
          left join user_quest_progress p on p.quest_id = q.id and p.user_id = ?
          where q.is_active = 1 order by q.category, q.id`).all(req.auth.userId)
      : db.prepare('select * from quests where is_active = 1 order by category, id').all();
    ok(res, { items: rows });
  }));
  r.get('/quests/progress', authMw, h((req, res) => {
    ok(res, { items: db.prepare('select * from user_quest_progress where user_id = ? order by updated_at desc').all(req.auth?.userId) });
  }));

  // ── activity_feed (public is_public=1 | self | mod) ────────
  r.get('/activity', optionalMw, h((req, res) => {
    const scope = String(req.query.scope ?? 'public');
    if (scope === 'public') {
      const rows = db.prepare('select * from activity_feed_enriched order by created_at desc limit 50').all() as Row[];
      return ok(res, { items: normalizeRows(rows, ACTIVITY_JSON) });
    }
    if (!req.auth) return fail(res, 401, 'unauthorized');
    const rows = db.prepare('select * from activity_feed where user_id = ? order by created_at desc limit 50')
      .all(req.auth.userId) as Row[];
    ok(res, { items: normalizeRows(rows, ACTIVITY_JSON) });
  }));

  // ── service-facing: translation_cache + mal_sync_jobs (không route) ──
  r.use(['/translation-cache', '/mal-sync', '/mal-sync-jobs'], (_req, res) => fail(res, 404, 'not_found'));

  return r;
}
