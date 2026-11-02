/**
 * Notification service — NGUỒN GHI DUY NHẤT bảng `notifications` (không có route POST).
 * - Bỏ self-notify (actor === receiver).
 * - Idempotent theo (receiver, kind, link): gọi lại không nhân đôi.
 * - Broadcast `notification:new` SAU commit.
 */
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';
import { broadcastNotification } from '../ws/server';

export interface NotifyInput {
  userId: string;
  kind: 'new_episode' | 'system' | 'reply';
  body: string;
  link?: string | null;
  actorId?: string | null;
  animeId?: number | null;
  animeTitle?: string | null;
  animeCover?: string | null;
  episode?: number | null;
  /** Khoá idempotency bổ sung (vd 'comment:<id>'), ghép với link. */
  dedupeKey?: string | null;
}

export interface NotifyResult { created: boolean; id: string | null; reason?: string }

export function notifyUser(db: Db, input: NotifyInput): NotifyResult {
  if (input.actorId && input.actorId === input.userId) {
    return { created: false, id: null, reason: 'self_notify' };
  }

  const dedupe = input.dedupeKey ?? input.link ?? null;

  const run = db.transaction((): NotifyResult => {
    if (dedupe) {
      const existing = db
        .prepare('select id from notifications where user_id = ? and kind = ? and link = ? limit 1')
        .get(input.userId, input.kind, dedupe) as { id: string } | undefined;
      if (existing) return { created: false, id: existing.id, reason: 'duplicate' };
    }

    const row = db
      .prepare(`insert into notifications (user_id, kind, anime_id, anime_title, anime_cover, episode, body, link, created_at)
                values (?,?,?,?,?,?,?,?,?) returning id`)
      .get(input.userId, input.kind, input.animeId ?? null, input.animeTitle ?? null,
        input.animeCover ?? null, input.episode ?? null, input.body, dedupe, nowIso()) as { id: string };

    return { created: true, id: row.id };
  });

  const result = run();
  if (result.created && result.id) {
    try {
      broadcastNotification(input.userId, {
        id: result.id, kind: input.kind, body: input.body, link: dedupe, createdAt: nowIso(),
      });
    } catch (err) {
      process.stderr.write(`[notify] broadcast lỗi: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return result;
}

/** (a) Reply vào comment của người khác. */
export function notifyCommentReply(
  db: Db,
  args: { parentId: string; actorId: string; commentId: string; entityType: string; entityId: number; excerpt: string }
): NotifyResult | null {
  const parent = db.prepare('select user_id from comments where id = ?').get(args.parentId) as
    | { user_id: string }
    | undefined;
  if (!parent) return null;
  return notifyUser(db, {
    userId: parent.user_id,
    kind: 'reply',
    body: `${args.excerpt.slice(0, 80)}`,
    link: `comment:${args.commentId}`,
    dedupeKey: `comment:${args.commentId}`,
    actorId: args.actorId,
    animeId: args.entityType === 'anime' ? args.entityId : null,
  });
}

/** (b) Edit suggestion được approve/reject. */
export function notifyEditDecision(
  db: Db,
  args: { suggestionId: string; ownerId: string; status: 'approved' | 'rejected'; actorId: string; animeId: number }
): NotifyResult {
  return notifyUser(db, {
    userId: args.ownerId,
    kind: 'system',
    body: `Đề xuất chỉnh sửa anime #${args.animeId} đã được ${args.status === 'approved' ? 'duyệt' : 'từ chối'}`,
    link: `edit:${args.suggestionId}:${args.status}`,
    dedupeKey: `edit:${args.suggestionId}:${args.status}`,
    actorId: args.actorId,
    animeId: args.animeId,
  });
}

/** (c) Quest hoàn thành. */
export function notifyQuestComplete(
  db: Db,
  args: { userId: string; questId: string; title: string }
): NotifyResult {
  return notifyUser(db, {
    userId: args.userId,
    kind: 'system',
    body: `Hoàn thành nhiệm vụ: ${args.title}`,
    link: `quest:${args.questId}`,
    dedupeKey: `quest:${args.questId}`,
  });
}
