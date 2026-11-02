/**
 * Quest progress — ATOMIC bằng `on conflict ... do update set progress = progress + :delta`
 * (Postgres nguồn: `set progress = user_quest_progress.progress + delta`).
 * Không đọc-rồi-ghi trong JS để tránh lost update.
 */
import type { Db } from '../db/index';
import { nowIso } from '../lib/time';
import { grantBadge } from './badges';
import { notifyQuestComplete } from './notifications';

export interface BumpResult {
  questId: string;
  progress: number;
  targetValue: number;
  completed: boolean;
  badgeGranted: string | null;
}

/**
 * Cộng delta vào tiến độ của MỌI quest đang active có `metric` tương ứng.
 * Trả về danh sách quest đã cập nhật (kèm cờ completed khi vừa đạt target).
 */
export function bumpQuestProgress(
  db: Db,
  userId: string,
  metric: string,
  delta = 1
): BumpResult[] {
  const quests = db
    .prepare(
      `select id, target_value, badge_reward from quests
        where is_active = 1 and metric = ?
          and (starts_at is null or starts_at <= ?)
          and (ends_at is null or ends_at >= ?)`
    )
    .all(metric, nowIso(), nowIso()) as {
    id: string;
    target_value: number;
    badge_reward: string | null;
  }[];

  const upsert = db.prepare(
    `insert into user_quest_progress (user_id, quest_id, progress, updated_at)
     values (:userId, :questId, :delta, :now)
     on conflict (user_id, quest_id) do update
       set progress = user_quest_progress.progress + :delta,
           updated_at = :now`
  );

  const run = db.transaction((): BumpResult[] => {
    const results: BumpResult[] = [];
    for (const quest of quests) {
      upsert.run({ userId, questId: quest.id, delta, now: nowIso() });

      const row = db
        .prepare('select progress, completed_at from user_quest_progress where user_id = ? and quest_id = ?')
        .get(userId, quest.id) as { progress: number; completed_at: string | null };

      let completed = row.completed_at !== null;
      let badgeGranted: string | null = null;

      if (!completed && row.progress >= quest.target_value) {
        db.prepare(
          'update user_quest_progress set completed_at = ? where user_id = ? and quest_id = ?'
        ).run(nowIso(), userId, quest.id);
        completed = true;
        if (quest.badge_reward) {
          if (grantBadge(db, userId, quest.badge_reward)) badgeGranted = quest.badge_reward;
        }
        const meta = db.prepare('select title from quests where id = ?').get(quest.id) as { title: string } | undefined;
        notifyQuestComplete(db, { userId, questId: quest.id, title: meta?.title ?? quest.id });
      }

      results.push({
        questId: quest.id,
        progress: row.progress,
        targetValue: quest.target_value,
        completed,
        badgeGranted,
      });
    }
    return results;
  });

  return run();
}
