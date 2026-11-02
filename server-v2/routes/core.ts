/**
 * Phase 1a — REST cho 8 bảng lõi. Ownership LUÔN lấy từ req.auth.userId
 * (không bao giờ đọc user_id từ body/query). Counters do trigger DB lo.
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';
import { optionalAuth, requireAuth, requireRole, type AuthContext } from '../middleware/requireAuth';
import { bumpQuestProgress } from '../services/quests';
import { PROFILE_JSON, normalizeRow } from '../lib/json';
import { broadcastActivity, broadcastComment } from '../ws/server';

type Row = Record<string, unknown>;
const ok = (res: Response, body: Row, status = 200) => res.status(status).json({ success: true, ...body });
const fail = (res: Response, status: number, error: string) => res.status(status).json({ success: false, error });
const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function page(req: Request): { limit: number; offset: number } {
  const limit = Math.min(50, Math.max(1, int(req.query.limit) ?? 20));
  const offset = Math.max(0, int(req.query.offset) ?? 0);
  return { limit, offset };
}

function auth(req: Request): AuthContext | null {
  return req.auth ?? null;
}

const isMod = (a: AuthContext | null): boolean =>
  Boolean(a && a.badges.some((b) => b === 'mod' || b === 'admin' || b === 'owner'));

/** Bọc async handler để Express 4 không nuốt rejection. */
function h(fn: (req: Request, res: Response) => unknown) {
  return (req: Request, res: Response): void => {
    void Promise.resolve(fn(req, res)).catch(() => {
      if (!res.headersSent) fail(res, 500, 'internal_error');
    });
  };
}

/** Hook sau commit — lỗi không làm fail request. */
function safeHook(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    process.stderr.write(`[hook] ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export function createCoreRouter(db: Db, options: { disableRateLimit?: boolean } = {}): Router {
  const r = express.Router();
  const requireAuthMw = requireAuth(db);
  const optionalAuthMw = optionalAuth(db);
  void options;

  // ── profiles ────────────────────────────────────────────────
  const PUBLIC_PROFILE = `id, username, display_name, avatar_url, cover_url, bio, gender,
    spotify_url, badges, comments_count, library_count, reviews_count, created_at`;

  r.get('/profiles/me', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const row = db.prepare(`select ${PUBLIC_PROFILE} from profiles where id = ?`).get(a?.userId) as Row | undefined;
    if (!row) return fail(res, 404, 'not_found');
    ok(res, { profile: normalizeRow(row, PROFILE_JSON) });
  }));

  r.patch('/profiles/me', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const body = (req.body ?? {}) as Row;
    const allowed = ['display_name', 'bio', 'gender', 'birthday', 'spotify_url', 'avatar_url', 'cover_url'] as const;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const key of allowed) {
      if (body[key] !== undefined) { sets.push(`${key} = ?`); values.push(body[key]); }
    }
    if (sets.length === 0) return fail(res, 400, 'no_fields');
    sets.push('updated_at = ?');
    values.push(nowIso(), a?.userId);
    db.prepare(`update profiles set ${sets.join(', ')} where id = ?`).run(...values);
    const row = db.prepare(`select ${PUBLIC_PROFILE} from profiles where id = ?`).get(a?.userId) as Row;
    ok(res, { profile: normalizeRow(row, PROFILE_JSON) });
  }));

  r.get('/profiles/:username', h((req, res) => {
    const row = db.prepare(`select ${PUBLIC_PROFILE} from profiles where username = ?`)
      .get(req.params.username) as Row | undefined;
    if (!row) return fail(res, 404, 'not_found');
    ok(res, { profile: normalizeRow(row, PROFILE_JSON) });
  }));

  // ── favorites ───────────────────────────────────────────────
  r.get('/favorites', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const rows = db.prepare('select * from favorites where user_id = ? order by created_at desc limit 200')
      .all(a?.userId);
    ok(res, { items: rows });
  }));

  r.post('/favorites', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const body = (req.body ?? {}) as Row;
    const animeId = int(body.animeId ?? body.anime_id);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    db.prepare(`insert into favorites (user_id, anime_id, anime_title, anime_cover, created_at)
                values (?, ?, ?, ?, ?) on conflict (user_id, anime_id) do nothing`)
      .run(a?.userId, animeId, str(body.animeTitle) ?? null, str(body.animeCover) ?? null, nowIso());
    const row = db.prepare('select * from favorites where user_id = ? and anime_id = ?').get(a?.userId, animeId) as Row;
    ok(res, { favorite: row }, 201);
  }));

  r.delete('/favorites/:animeId', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const animeId = int(req.params.animeId);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    const info = db.prepare('delete from favorites where user_id = ? and anime_id = ?').run(a?.userId, animeId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── user_library ────────────────────────────────────────────
  r.get('/library', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const { limit, offset } = page(req);
    const rows = db.prepare(`select * from user_library where user_id = ?
                             order by updated_at desc limit ? offset ?`).all(a?.userId, limit, offset);
    ok(res, { items: rows, limit, offset });
  }));

  r.get('/library/stats', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const row = db.prepare('select * from user_library_stats where user_id = ?').get(a?.userId) as Row | undefined;
    ok(res, { stats: row ?? { user_id: a?.userId, total_anime: 0 } });
  }));

  r.post('/library', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const body = (req.body ?? {}) as Row;
    const animeId = int(body.animeId ?? body.anime_id);
    const title = str(body.animeTitle ?? body.anime_title);
    if (animeId === null || !title) return fail(res, 400, 'invalid_input');
    const status = str(body.status) ?? 'plan_to_watch';
    db.prepare(`insert into user_library (user_id, anime_id, anime_title, anime_cover, anime_episodes,
                 status, current_episode, score, notes, created_at, updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?)
                on conflict (user_id, anime_id) do update set
                  status = excluded.status, current_episode = excluded.current_episode,
                  score = excluded.score, notes = excluded.notes, updated_at = excluded.updated_at`)
      .run(a?.userId, animeId, title, str(body.animeCover) ?? null,
        body.animeEpisodes === undefined ? null : int(body.animeEpisodes), status,
        int(body.currentEpisode) ?? 0, body.score === undefined ? null : int(body.score),
        str(body.notes) ?? null, nowIso(), nowIso());
    const row = db.prepare('select * from user_library where user_id = ? and anime_id = ?').get(a?.userId, animeId) as Row;
    safeHook(() => bumpQuestProgress(db, a!.userId, 'library_count', 1));
    ok(res, { item: row }, 201);
  }));

  r.patch('/library/:animeId', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const animeId = int(req.params.animeId);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    const body = (req.body ?? {}) as Row;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of [['status', 'status'], ['currentEpisode', 'current_episode'], ['score', 'score'], ['notes', 'notes']] as const) {
      if (body[key] !== undefined) { sets.push(`${col} = ?`); values.push(body[key]); }
    }
    if (sets.length === 0) return fail(res, 400, 'no_fields');
    sets.push('updated_at = ?');
    values.push(nowIso(), a?.userId, animeId);
    const info = db.prepare(`update user_library set ${sets.join(', ')} where user_id = ? and anime_id = ?`).run(...values);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    safeHook(() => bumpQuestProgress(db, a!.userId, 'library_updated', 1));
    ok(res, { updated: info.changes });
  }));

  r.delete('/library/:animeId', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const animeId = int(req.params.animeId);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    const info = db.prepare('delete from user_library where user_id = ? and anime_id = ?').run(a?.userId, animeId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── comments ────────────────────────────────────────────────
  const COMMENT_SORT: Record<string, string> = { newest: 'created_at desc', oldest: 'created_at asc' };

  r.get('/comments', optionalAuthMw, h((req, res) => {
    const entityType = str(req.query.entityType) ?? str(req.query.entity_type);
    const entityId = int(req.query.entityId ?? req.query.entity_id);
    if (entityType && !['anime', 'character'].includes(entityType)) return fail(res, 400, 'invalid_entity_type');
    const { limit, offset } = page(req);
    const sort = COMMENT_SORT[String(req.query.sort ?? 'newest')] ?? COMMENT_SORT.newest;
    const a = auth(req);
    const where = ['c.is_deleted = 0'];
    const params: unknown[] = [];
    if (entityType) { where.push('c.entity_type = ?'); params.push(entityType); }
    if (entityId !== null) { where.push('c.entity_id = ?'); params.push(entityId); }
    if (a) { where.push('(c.user_id = ?)'); params.push(a.userId); }
    const rows = db.prepare(`select c.*, p.username, p.display_name, p.avatar_url,
        coalesce(v.upvotes,0) upvotes, coalesce(v.downvotes,0) downvotes, coalesce(v.score,0) score
      from comments c
      left join profiles p on p.id = c.user_id
      left join comment_vote_counts v on v.comment_id = c.id
      where ${where.length > 1 ? where.slice(1).join(' and ') || '1=1' : 'c.is_deleted = 0'}
      order by ${sort} limit ? offset ?`).all(...(where.length > 1 ? params : []), limit, offset);
    ok(res, { items: rows, limit, offset });
  }));

  r.post('/comments', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const body = (req.body ?? {}) as Row;
    const entityType = str(body.entityType ?? body.entity_type);
    const entityId = int(body.entityId ?? body.entity_id);
    const text = str(body.body);
    if (!entityType || !['anime', 'character'].includes(entityType) || entityId === null || !text) {
      return fail(res, 400, 'invalid_input');
    }
    const row = db.prepare(`insert into comments (user_id, entity_type, entity_id, parent_id, body, image_url, is_deleted, created_at, updated_at)
      values (?,?,?,?,?,?,0,?,?) returning *`)
      .get(a?.userId, entityType, entityId, str(body.parentId) ?? null, text, str(body.imageUrl) ?? null, nowIso(), nowIso()) as Row;
    safeHook(() => bumpQuestProgress(db, a!.userId, 'comments_posted', 1));
    safeHook(() => broadcastComment(entityType, entityId, 'new', {
      id: row.id, entityType, entityId, actor: a?.userId ?? null, createdAt: row.created_at,
    }));
    ok(res, { comment: row }, 201);
  }));

  r.patch('/comments/:id', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const row = db.prepare('select user_id from comments where id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!row) return fail(res, 404, 'not_found');
    if (row.user_id !== a?.userId && !isMod(a)) return fail(res, 403, 'forbidden');
    const body = (req.body ?? {}) as Row;
    const text = str(body.body);
    if (!text) return fail(res, 400, 'invalid_body');
    db.prepare('update comments set body = ?, updated_at = ? where id = ?').run(text, nowIso(), req.params.id);
    const meta = db.prepare('select entity_type, entity_id from comments where id = ?').get(req.params.id) as
      { entity_type: string; entity_id: number };
    safeHook(() => broadcastComment(meta.entity_type, meta.entity_id, 'update', {
      id: req.params.id, entityType: meta.entity_type, entityId: meta.entity_id, actor: a?.userId ?? null,
    }));
    ok(res, { updated: 1 });
  }));

  r.delete('/comments/:id', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const row = db.prepare('select user_id, is_deleted from comments where id = ?').get(req.params.id) as
      | { user_id: string; is_deleted: number } | undefined;
    if (!row) return fail(res, 404, 'not_found');
    if (row.user_id !== a?.userId && !isMod(a)) return fail(res, 403, 'forbidden');
    db.prepare('update comments set is_deleted = 1, updated_at = ? where id = ?').run(nowIso(), req.params.id);
    const meta = db.prepare('select entity_type, entity_id from comments where id = ?').get(req.params.id) as
      { entity_type: string; entity_id: number };
    safeHook(() => broadcastComment(meta.entity_type, meta.entity_id, 'delete', {
      id: req.params.id, entityType: meta.entity_type, entityId: meta.entity_id, actor: a?.userId ?? null,
    }));
    ok(res, { deleted: 1, soft: true });
  }));

  // ── comment_votes ───────────────────────────────────────────
  r.get('/comments/:id/votes', h((req, res) => {
    const row = db.prepare('select * from comment_vote_counts where comment_id = ?').get(req.params.id) as Row | undefined;
    ok(res, { counts: row ?? { comment_id: req.params.id, upvotes: 0, downvotes: 0, score: 0 } });
  }));

  r.post('/comments/:id/vote', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const value = int((req.body as Row)?.value);
    if (value !== 1 && value !== -1) return fail(res, 400, 'invalid_value');
    const exists = db.prepare('select 1 from comments where id = ? and is_deleted = 0').get(req.params.id);
    if (!exists) return fail(res, 404, 'not_found');
    db.prepare(`insert into comment_votes (comment_id, user_id, value, created_at) values (?,?,?,?)
                on conflict (comment_id, user_id) do update set value = excluded.value`)
      .run(req.params.id, a?.userId, value, nowIso());
    ok(res, { voted: value });
  }));

  r.delete('/comments/:id/vote', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const info = db.prepare('delete from comment_votes where comment_id = ? and user_id = ?').run(req.params.id, a?.userId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // ── collections + items + likes ─────────────────────────────
  const canRead = (id: string, a: AuthContext | null): Row | undefined => {
    const row = db.prepare('select * from collections where id = ?').get(id) as Row | undefined;
    if (!row) return undefined;
    if (row.is_public === 1 || row.user_id === a?.userId || isMod(a)) return row;
    return undefined;
  };
  const canWrite = (id: string, a: AuthContext | null): boolean => {
    const row = db.prepare('select user_id from collections where id = ?').get(id) as { user_id: string } | undefined;
    return Boolean(row && row.user_id === a?.userId);
  };

  r.get('/collections', optionalAuthMw, h((req, res) => {
    const a = auth(req);
    const { limit, offset } = page(req);
    const rows = a
      ? db.prepare(`select * from collections where is_public = 1 or user_id = ?
                    order by updated_at desc limit ? offset ?`).all(a.userId, limit, offset)
      : db.prepare('select * from collections where is_public = 1 order by updated_at desc limit ? offset ?').all(limit, offset);
    ok(res, { items: rows, limit, offset });
  }));

  r.get('/collections/:id', optionalAuthMw, h((req, res) => {
    const row = canRead(req.params.id, auth(req));
    if (!row) return fail(res, 404, 'not_found');
    ok(res, { collection: row });
  }));

  r.post('/collections', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const body = (req.body ?? {}) as Row;
    const title = str(body.title);
    if (!title || title.length < 3 || title.length > 100) return fail(res, 400, 'invalid_title');
    const row = db.prepare(`insert into collections (user_id, title, description, cover_image, is_public, created_at, updated_at)
      values (?,?,?,?,?,?,?) returning *`)
      .get(a?.userId, title, str(body.description) ?? null, str(body.coverImage) ?? null,
        body.isPublic === false ? 0 : 1, nowIso(), nowIso()) as Row;
    safeHook(() => {
      if (row.is_public === 1) {
        const feed = db.prepare(`insert into activity_feed (user_id, kind, collection_id, meta, is_public, created_at)
                    values (?,?,?,?,1,?) returning id`).get(a?.userId, 'collection_create', row.id, JSON.stringify({ title }), nowIso()) as { id: string };
        broadcastActivity({ id: feed.id, kind: 'collection_create', actor: a?.userId ?? null, collectionId: row.id });
      }
    });
    ok(res, { collection: row }, 201);
  }));

  r.patch('/collections/:id', requireAuthMw, h((req, res) => {
    const a = auth(req);
    if (!canWrite(req.params.id, a)) return fail(res, 404, 'not_found');
    const body = (req.body ?? {}) as Row;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of [['title', 'title'], ['description', 'description'], ['coverImage', 'cover_image'], ['isPublic', 'is_public']] as const) {
      if (body[key] !== undefined) {
        sets.push(`${col} = ?`);
        values.push(key === 'isPublic' ? (body[key] ? 1 : 0) : body[key]);
      }
    }
    if (sets.length === 0) return fail(res, 400, 'no_fields');
    sets.push('updated_at = ?');
    values.push(nowIso(), req.params.id);
    db.prepare(`update collections set ${sets.join(', ')} where id = ?`).run(...values);
    ok(res, { updated: 1 });
  }));

  r.delete('/collections/:id', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const row = db.prepare('select user_id from collections where id = ?').get(req.params.id) as { user_id: string } | undefined;
    if (!row) return fail(res, 404, 'not_found');
    if (row.user_id !== a?.userId && !isMod(a)) return fail(res, 403, 'forbidden');
    db.prepare('delete from collections where id = ?').run(req.params.id);
    ok(res, { deleted: 1 });
  }));

  r.get('/collections/:id/items', optionalAuthMw, h((req, res) => {
    if (!canRead(req.params.id, auth(req))) return fail(res, 404, 'not_found');
    const { limit, offset } = page(req);
    const rows = db.prepare('select * from collection_items where collection_id = ? order by position, added_at limit ? offset ?')
      .all(req.params.id, limit, offset);
    ok(res, { items: rows, limit, offset });
  }));

  r.post('/collections/:id/items', requireAuthMw, h((req, res) => {
    const a = auth(req);
    if (!canWrite(req.params.id, a)) return fail(res, 404, 'not_found');
    const body = (req.body ?? {}) as Row;
    const animeId = int(body.animeId ?? body.anime_id);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    const row = db.prepare(`insert into collection_items (collection_id, anime_id, anime_title, anime_cover, position, note, added_at)
      values (?,?,?,?,?,?,?) on conflict (collection_id, anime_id) do nothing returning *`)
      .get(req.params.id, animeId, str(body.animeTitle) ?? null, str(body.animeCover) ?? null,
        int(body.position) ?? 0, str(body.note) ?? null, nowIso()) as Row | undefined;
    ok(res, { item: row ?? null }, row ? 201 : 200);
  }));

  r.delete('/collections/:id/items/:animeId', requireAuthMw, h((req, res) => {
    const a = auth(req);
    if (!canWrite(req.params.id, a)) return fail(res, 404, 'not_found');
    const animeId = int(req.params.animeId);
    if (animeId === null) return fail(res, 400, 'invalid_anime_id');
    const info = db.prepare('delete from collection_items where collection_id = ? and anime_id = ?').run(req.params.id, animeId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  r.post('/collections/:id/like', requireAuthMw, h((req, res) => {
    const a = auth(req);
    if (!canRead(req.params.id, a)) return fail(res, 404, 'not_found');
    db.prepare('insert into collection_likes (collection_id, user_id, created_at) values (?,?,?) on conflict do nothing')
      .run(req.params.id, a?.userId, nowIso());
    ok(res, { liked: true });
  }));

  r.delete('/collections/:id/like', requireAuthMw, h((req, res) => {
    const a = auth(req);
    const info = db.prepare('delete from collection_likes where collection_id = ? and user_id = ?').run(req.params.id, a?.userId);
    if (info.changes === 0) return fail(res, 404, 'not_found');
    ok(res, { deleted: info.changes });
  }));

  // mod-only: danh sách comment đã xoá (kiểm chứng requireRole)
  r.get('/mod/comments/deleted', requireAuthMw, requireRole('mod'), h((_req, res) => {
    const rows = db.prepare('select id, user_id, entity_type, entity_id, is_deleted from comments where is_deleted = 1 limit 50').all();
    ok(res, { items: rows });
  }));

  return r;
}
