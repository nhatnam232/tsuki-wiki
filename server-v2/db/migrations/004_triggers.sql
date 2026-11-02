-- ============================================================
-- 004 — Triggers (reviewer finding #2)
--
-- 9 trigger `touch_updated_at` + 5 counter (comments/library/reviews/
-- collection_items/collection_likes) + 2 validation trigger cho
-- compare_history.anime_ids (#7).
--
-- LƯU Ý SQLite (khác Postgres — đã verify bằng CLI):
--   * `create trigger x after insert or delete on t` là SYNTAX ERROR:
--     mỗi trigger chỉ đúng 1 event. Vì vậy 5 counter family = 14 trigger
--     (comments 4, reviews 4, library 2, item 2, like 2).
--   * Không sửa được `new.*` trong BEFORE trigger → touch_updated_at phải là
--     AFTER UPDATE + UPDATE theo khoá chính, có guard `new.updated_at is old.updated_at`
--     để không đệ quy kể cả khi bật `PRAGMA recursive_triggers`.
--   * CHECK constraint không cho subquery → validate mảng JSON phải dùng trigger.
--
-- Tổng: 9 + 14 + 2 = 25 trigger, thuộc 16 "family" tương ứng 16 object Postgres.
-- ============================================================

-- ── touch_updated_at (9) ──
create trigger if not exists trg_touch_profiles
after update on profiles
for each row when new.updated_at is old.updated_at
begin
  update profiles set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_comments
after update on comments
for each row when new.updated_at is old.updated_at
begin
  update comments set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_anime_seasons
after update on anime_seasons
for each row when new.updated_at is old.updated_at
begin
  update anime_seasons set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_user_library
after update on user_library
for each row when new.updated_at is old.updated_at
begin
  update user_library set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_anime_schedule
after update on anime_schedule
for each row when new.updated_at is old.updated_at
begin
  update anime_schedule set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_anime_reviews
after update on anime_reviews
for each row when new.updated_at is old.updated_at
begin
  update anime_reviews set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_collections
after update on collections
for each row when new.updated_at is old.updated_at
begin
  update collections set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where id = new.id;
end;

create trigger if not exists trg_touch_user_quest_progress
after update on user_quest_progress
for each row when new.updated_at is old.updated_at
begin
  update user_quest_progress set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where user_id = new.user_id and quest_id = new.quest_id;
end;

create trigger if not exists trg_touch_system_secrets
after update on system_secrets
for each row when new.updated_at is old.updated_at
begin
  update system_secrets set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   where key = new.key;
end;

-- ── counter (14 trigger / 5 family) ──
create trigger if not exists trg_counter_comments_ins
after insert on comments
for each row when new.is_deleted = 0
begin
  update profiles set comments_count = comments_count + 1 where id = new.user_id;
end;

create trigger if not exists trg_counter_comments_del
after delete on comments
for each row when old.is_deleted = 0
begin
  update profiles set comments_count = max(0, comments_count - 1) where id = old.user_id;
end;

create trigger if not exists trg_counter_comments_softdelete
after update of is_deleted on comments
for each row when old.is_deleted = 0 and new.is_deleted = 1
begin
  update profiles set comments_count = max(0, comments_count - 1) where id = new.user_id;
end;

create trigger if not exists trg_counter_comments_restore
after update of is_deleted on comments
for each row when old.is_deleted = 1 and new.is_deleted = 0
begin
  update profiles set comments_count = comments_count + 1 where id = new.user_id;
end;

create trigger if not exists trg_counter_library_ins
after insert on user_library
for each row
begin
  update profiles set library_count = library_count + 1 where id = new.user_id;
end;

create trigger if not exists trg_counter_library_del
after delete on user_library
for each row
begin
  update profiles set library_count = max(0, library_count - 1) where id = old.user_id;
end;

create trigger if not exists trg_counter_reviews_ins
after insert on anime_reviews
for each row when new.is_deleted = 0
begin
  update profiles set reviews_count = reviews_count + 1 where id = new.user_id;
end;

create trigger if not exists trg_counter_reviews_del
after delete on anime_reviews
for each row when old.is_deleted = 0
begin
  update profiles set reviews_count = max(0, reviews_count - 1) where id = old.user_id;
end;

create trigger if not exists trg_counter_reviews_softdelete
after update of is_deleted on anime_reviews
for each row when old.is_deleted = 0 and new.is_deleted = 1
begin
  update profiles set reviews_count = max(0, reviews_count - 1) where id = new.user_id;
end;

create trigger if not exists trg_counter_reviews_restore
after update of is_deleted on anime_reviews
for each row when old.is_deleted = 1 and new.is_deleted = 0
begin
  update profiles set reviews_count = reviews_count + 1 where id = new.user_id;
end;

create trigger if not exists trg_counter_collection_items_ins
after insert on collection_items
for each row
begin
  update collections set item_count = item_count + 1 where id = new.collection_id;
end;

create trigger if not exists trg_counter_collection_items_del
after delete on collection_items
for each row
begin
  update collections set item_count = max(0, item_count - 1) where id = old.collection_id;
end;

create trigger if not exists trg_counter_collection_likes_ins
after insert on collection_likes
for each row
begin
  update collections set like_count = like_count + 1 where id = new.collection_id;
end;

create trigger if not exists trg_counter_collection_likes_del
after delete on collection_likes
for each row
begin
  update collections set like_count = max(0, like_count - 1) where id = old.collection_id;
end;

-- ── compare_history.anime_ids: chỉ cho JSON array of integer (#7) ──
create trigger if not exists trg_chk_compare_history_ins
before insert on compare_history
begin
  select raise(abort, 'compare_history.anime_ids phải là JSON array of integer')
   where json_valid(new.anime_ids) = 0
      or json_type(new.anime_ids) <> 'array'
      or exists (select 1 from json_each(new.anime_ids) where json_each.type <> 'integer');
end;

create trigger if not exists trg_chk_compare_history_upd
before update of anime_ids on compare_history
begin
  select raise(abort, 'compare_history.anime_ids phải là JSON array of integer')
   where json_valid(new.anime_ids) = 0
      or json_type(new.anime_ids) <> 'array'
      or exists (select 1 from json_each(new.anime_ids) where json_each.type <> 'integer');
end;
