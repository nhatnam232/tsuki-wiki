-- ============================================================
-- 003 — Schema hardening (reviewer findings #1…#7)
--
-- 001_schema.sql GIỮ NGUYÊN (frozen) — mọi thay đổi đi qua file này.
--
-- Vì sao phải rebuild bảng thay vì ALTER:
--   SQLite KHÔNG hỗ trợ `ALTER TABLE ... ADD CHECK` và không đổi được DEFAULT
--   của cột. Muốn sửa DEFAULT uuid (#5) và thêm CHECK timestamp (#3) thì bắt
--   buộc dùng quy trình 12-bước của SQLite (create new → copy → drop → rename),
--   chạy với foreign_keys=OFF do runner bật qua directive dưới đây.
--
-- Nội dung:
--   #1 users.password_hash (đã có ở 002) + users.password_updated_at
--   #3 CHECK glob ISO-8601 cho mọi cột thời gian (*_at), CHECK date cho cột date
--   #5 DEFAULT uuid: abs(random()) % 4  →  abs(random() % 4)  (tránh integer overflow)
--   #7 compare_history: json_valid + trigger chỉ cho mảng integer (CHECK không
--      cho phép subquery nên phải dùng trigger — xem 004)
--   #2 14 trigger (9 touch_updated_at + 5 counter)  → file 004
--   Views: drop + create lại sau rebuild (#6)
--
-- @pragma foreign_keys=off
-- ============================================================

-- Views phải drop trước khi rebuild (định nghĩa view trỏ tới bảng sẽ bị rename).
drop view if exists anime_like_counts;
drop view if exists anime_reaction_counts;
drop view if exists user_library_stats;
drop view if exists comment_vote_counts;
drop view if exists activity_feed_enriched;

-- ── Rebuild 26 bảng với CHECK/DEFAULT đã sửa ──
create table _rb_users (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random() % 4)), 1)
                  || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                ),
  google_sub    text unique,
  email         text not null unique,
  email_verified integer not null default 0 check (email_verified in (0,1)),
  name          text,
  picture       text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at text,
  password_hash text,
  password_updated_at text,
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z'),
  check ("last_login_at" is null or "last_login_at" glob '????-??-??T??:??:??*Z'),
  check ("password_updated_at" is null or "password_updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_sessions (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  token_hash  text not null unique,
  user_agent  text,
  ip          text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  text not null,
  revoked_at  text,
  family_id text,
  replaced_by text,
  rotate_count integer not null default 0,
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("expires_at" is null or "expires_at" glob '????-??-??T??:??:??*Z'),
  check ("revoked_at" is null or "revoked_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_profiles (
  id            text primary key references users(id) on delete cascade,
  username      text unique,
  display_name  text,
  avatar_url    text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  gender        text check (gender is null or gender in ('male','female','other','prefer_not_to_say')),
  birthday      text,
  spotify_url   text,
  bio           text check (bio is null or length(bio) <= 500),
  badges        text not null default '[]' check (json_valid(badges)),
  comments_count integer not null default 0,
  library_count  integer not null default 0,
  reviews_count  integer not null default 0,
  cover_url     text,
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z'),
  check ("birthday" is null or "birthday" glob '????-??-??')
);
create table _rb_favorites (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  anime_id    integer not null,
  anime_title text,
  anime_cover text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_comments (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  entity_type text not null check (entity_type in ('anime','character')),
  entity_id   integer not null,
  parent_id   text references comments(id) on delete cascade,
  body        text not null check (length(body) between 1 and 2000),
  is_deleted  integer not null default 0 check (is_deleted in (0,1)),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  image_url   text,
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_seasons (
  id           integer primary key autoincrement,
  anime_id     integer not null unique,
  title        text not null,
  cover_image  text,
  score        real,
  episodes     integer,
  status       text,
  season       text,
  year         integer,
  season_key   text generated always as (lower(season) || '_' || cast(year as text)) stored,
  genres       text check (genres is null or json_valid(genres)),
  studio_name  text,
  type         text,
  synopsis     text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_recommendations (
  id              text primary key default (
                    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                    || substr(hex(randomblob(2)), 2) || '-'
                    || substr('89ab', 1 + (abs(random() % 4)), 1)
                    || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                  ),
  source_anime_id integer not null,
  target_anime_id integer not null,
  target_title    text,
  target_cover    text,
  target_score    real,
  weight          integer default 1,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (source_anime_id, target_anime_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_user_library (
  id              text primary key default (
                    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                    || substr(hex(randomblob(2)), 2) || '-'
                    || substr('89ab', 1 + (abs(random() % 4)), 1)
                    || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                  ),
  user_id         text not null references users(id) on delete cascade,
  anime_id        integer not null,
  anime_title     text not null,
  anime_cover     text,
  anime_episodes  integer,
  status          text not null default 'plan_to_watch'
                  check (status in ('watching','completed','plan_to_watch','dropped','on_hold')),
  current_episode integer not null default 0,
  score           integer check (score is null or (score >= 1 and score <= 10)),
  notes           text,
  started_at      text,
  completed_at    text,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_schedule (
  id             integer primary key autoincrement,
  anime_id       integer not null unique,
  title          text not null,
  cover_image    text,
  broadcast_day  text not null,
  broadcast_time text,
  broadcast_tz   text default 'Asia/Tokyo',
  season         text,
  year           integer,
  episodes       integer,
  status         text,
  studio_name    text,
  score          real,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_reactions (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random() % 4)), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text not null references users(id) on delete cascade,
  anime_id   integer not null,
  reaction   text not null check (reaction in ('heart','laugh','cry')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_reviews (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random() % 4)), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text not null references users(id) on delete cascade,
  anime_id   integer not null,
  body       text not null check (length(body) between 1 and 200),
  is_deleted integer not null default 0 check (is_deleted in (0,1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_mal_sync_jobs (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random() % 4)), 1)
                   || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                 ),
  user_id        text not null references users(id) on delete cascade,
  mal_username   text not null,
  status         text not null default 'pending'
                 check (status in ('pending','processing','completed','failed')),
  total_imported integer default 0,
  total_skipped  integer default 0,
  error_message  text,
  started_at     text,
  completed_at   text,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_translation_cache (
  text_hash       text not null,
  target_lang     text not null,
  source_text     text not null,
  translated_text text not null,
  provider        text,
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (text_hash, target_lang),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_comment_votes (
  comment_id text not null references comments(id) on delete cascade,
  user_id    text not null references users(id) on delete cascade,
  value      integer not null check (value in (-1, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (comment_id, user_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_notifications (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  kind        text not null default 'new_episode'
              check (kind in ('new_episode','system','reply')),
  anime_id    integer,
  anime_title text,
  anime_cover text,
  episode     integer,
  body        text,
  link        text,
  read_at     text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("read_at" is null or "read_at" glob '????-??-??T??:??:??*Z'),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_collections (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  title       text not null check (length(title) between 3 and 100),
  description text check (description is null or length(description) <= 500),
  cover_image text,
  is_public   integer not null default 1 check (is_public in (0,1)),
  slug        text unique,
  view_count  integer not null default 0,
  like_count  integer not null default 0,
  item_count  integer not null default 0,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_collection_items (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random() % 4)), 1)
                  || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                ),
  collection_id text not null references collections(id) on delete cascade,
  anime_id      integer not null,
  anime_title   text,
  anime_cover   text,
  position      integer not null default 0,
  note          text check (note is null or length(note) <= 280),
  added_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (collection_id, anime_id),
  check ("added_at" is null or "added_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_collection_likes (
  collection_id text not null references collections(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (collection_id, user_id),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_audit_logs (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  actor_id    text references users(id) on delete set null,
  action      text not null check (action in (
                'edit_anime','approve_edit','reject_edit','delete_comment_mod',
                'grant_badge','revoke_badge','create_collection','delete_collection',
                'login','other')),
  target_type text,
  target_id   text,
  diff        text check (diff is null or json_valid(diff)),
  reason      text,
  ip          text,
  user_agent  text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_anime_edit_suggestions (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random() % 4)), 1)
                   || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                 ),
  user_id        text not null references users(id) on delete cascade,
  anime_id       integer not null,
  field          text not null,
  content_before text,
  content_after  text not null,
  reason         text check (reason is null or length(reason) <= 500),
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','auto_approved')),
  reviewed_by    text references users(id) on delete set null,
  reviewed_at    text,
  review_note    text,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("reviewed_at" is null or "reviewed_at" glob '????-??-??T??:??:??*Z'),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_compare_history (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random() % 4)), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text references users(id) on delete cascade,
  anime_ids  text not null check (json_valid(anime_ids)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_quests (
  id           text primary key,
  title        text not null,
  description  text not null,
  badge_reward text,
  target_value integer not null default 1,
  metric       text not null,
  category     text not null default 'general',
  starts_at    text,
  ends_at      text,
  is_active    integer not null default 1 check (is_active in (0,1)),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("starts_at" is null or "starts_at" glob '????-??-??T??:??:??*Z'),
  check ("ends_at" is null or "ends_at" glob '????-??-??T??:??:??*Z'),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_user_quest_progress (
  user_id      text not null references users(id) on delete cascade,
  quest_id     text not null references quests(id) on delete cascade,
  progress     integer not null default 0,
  completed_at text,
  claimed_at   text,
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, quest_id),
  check ("claimed_at" is null or "claimed_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_activity_feed (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random() % 4)), 1)
                  || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                ),
  user_id       text not null references users(id) on delete cascade,
  kind          text not null check (kind in (
                  'library_add','library_complete','review_post','collection_create',
                  'comment_post','badge_earned','edit_approved')),
  anime_id      integer,
  anime_title   text,
  anime_cover   text,
  collection_id text,
  badge_id      text,
  meta          text check (meta is null or json_valid(meta)),
  is_public     integer not null default 1 check (is_public in (0,1)),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_admin_passwords (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random() % 4)), 1)
                   || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                 ),
  password_hash  text not null,
  valid_for_date text not null unique,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("valid_for_date" is null or "valid_for_date" glob '????-??-??'),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);
create table _rb_system_secrets (
  key         text primary key,
  value       text not null,
  description text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z'),
  check ("updated_at" is null or "updated_at" glob '????-??-??T??:??:??*Z')
);

-- ── Copy dữ liệu → drop → rename ──
insert into _rb_users ("id", "google_sub", "email", "email_verified", "name", "picture", "created_at", "updated_at", "last_login_at", "password_hash") select "id", "google_sub", "email", "email_verified", "name", "picture", "created_at", "updated_at", "last_login_at", "password_hash" from users;
drop table users;
alter table _rb_users rename to users;
insert into _rb_sessions ("id", "user_id", "token_hash", "user_agent", "ip", "created_at", "expires_at", "revoked_at", "family_id", "replaced_by", "rotate_count") select "id", "user_id", "token_hash", "user_agent", "ip", "created_at", "expires_at", "revoked_at", "family_id", "replaced_by", "rotate_count" from sessions;
drop table sessions;
alter table _rb_sessions rename to sessions;
insert into _rb_profiles ("id", "username", "display_name", "avatar_url", "created_at", "updated_at", "gender", "birthday", "spotify_url", "bio", "badges", "comments_count", "library_count", "reviews_count", "cover_url") select "id", "username", "display_name", "avatar_url", "created_at", "updated_at", "gender", "birthday", "spotify_url", "bio", "badges", "comments_count", "library_count", "reviews_count", "cover_url" from profiles;
drop table profiles;
alter table _rb_profiles rename to profiles;
insert into _rb_favorites ("id", "user_id", "anime_id", "anime_title", "anime_cover", "created_at") select "id", "user_id", "anime_id", "anime_title", "anime_cover", "created_at" from favorites;
drop table favorites;
alter table _rb_favorites rename to favorites;
insert into _rb_comments ("id", "user_id", "entity_type", "entity_id", "parent_id", "body", "is_deleted", "created_at", "updated_at", "image_url") select "id", "user_id", "entity_type", "entity_id", "parent_id", "body", "is_deleted", "created_at", "updated_at", "image_url" from comments;
drop table comments;
alter table _rb_comments rename to comments;
insert into _rb_anime_seasons ("id", "anime_id", "title", "cover_image", "score", "episodes", "status", "season", "year", "genres", "studio_name", "type", "synopsis", "created_at", "updated_at") select "id", "anime_id", "title", "cover_image", "score", "episodes", "status", "season", "year", "genres", "studio_name", "type", "synopsis", "created_at", "updated_at" from anime_seasons;
drop table anime_seasons;
alter table _rb_anime_seasons rename to anime_seasons;
insert into _rb_anime_recommendations ("id", "source_anime_id", "target_anime_id", "target_title", "target_cover", "target_score", "weight", "created_at") select "id", "source_anime_id", "target_anime_id", "target_title", "target_cover", "target_score", "weight", "created_at" from anime_recommendations;
drop table anime_recommendations;
alter table _rb_anime_recommendations rename to anime_recommendations;
insert into _rb_user_library ("id", "user_id", "anime_id", "anime_title", "anime_cover", "anime_episodes", "status", "current_episode", "score", "notes", "started_at", "completed_at", "created_at", "updated_at") select "id", "user_id", "anime_id", "anime_title", "anime_cover", "anime_episodes", "status", "current_episode", "score", "notes", "started_at", "completed_at", "created_at", "updated_at" from user_library;
drop table user_library;
alter table _rb_user_library rename to user_library;
insert into _rb_anime_schedule ("id", "anime_id", "title", "cover_image", "broadcast_day", "broadcast_time", "broadcast_tz", "season", "year", "episodes", "status", "studio_name", "score", "created_at", "updated_at") select "id", "anime_id", "title", "cover_image", "broadcast_day", "broadcast_time", "broadcast_tz", "season", "year", "episodes", "status", "studio_name", "score", "created_at", "updated_at" from anime_schedule;
drop table anime_schedule;
alter table _rb_anime_schedule rename to anime_schedule;
insert into _rb_anime_reactions ("id", "user_id", "anime_id", "reaction", "created_at") select "id", "user_id", "anime_id", "reaction", "created_at" from anime_reactions;
drop table anime_reactions;
alter table _rb_anime_reactions rename to anime_reactions;
insert into _rb_anime_reviews ("id", "user_id", "anime_id", "body", "is_deleted", "created_at", "updated_at") select "id", "user_id", "anime_id", "body", "is_deleted", "created_at", "updated_at" from anime_reviews;
drop table anime_reviews;
alter table _rb_anime_reviews rename to anime_reviews;
insert into _rb_mal_sync_jobs ("id", "user_id", "mal_username", "status", "total_imported", "total_skipped", "error_message", "started_at", "completed_at", "created_at") select "id", "user_id", "mal_username", "status", "total_imported", "total_skipped", "error_message", "started_at", "completed_at", "created_at" from mal_sync_jobs;
drop table mal_sync_jobs;
alter table _rb_mal_sync_jobs rename to mal_sync_jobs;
insert into _rb_translation_cache ("text_hash", "target_lang", "source_text", "translated_text", "provider", "updated_at") select "text_hash", "target_lang", "source_text", "translated_text", "provider", "updated_at" from translation_cache;
drop table translation_cache;
alter table _rb_translation_cache rename to translation_cache;
insert into _rb_comment_votes ("comment_id", "user_id", "value", "created_at") select "comment_id", "user_id", "value", "created_at" from comment_votes;
drop table comment_votes;
alter table _rb_comment_votes rename to comment_votes;
insert into _rb_notifications ("id", "user_id", "kind", "anime_id", "anime_title", "anime_cover", "episode", "body", "link", "read_at", "created_at") select "id", "user_id", "kind", "anime_id", "anime_title", "anime_cover", "episode", "body", "link", "read_at", "created_at" from notifications;
drop table notifications;
alter table _rb_notifications rename to notifications;
insert into _rb_collections ("id", "user_id", "title", "description", "cover_image", "is_public", "slug", "view_count", "like_count", "item_count", "created_at", "updated_at") select "id", "user_id", "title", "description", "cover_image", "is_public", "slug", "view_count", "like_count", "item_count", "created_at", "updated_at" from collections;
drop table collections;
alter table _rb_collections rename to collections;
insert into _rb_collection_items ("id", "collection_id", "anime_id", "anime_title", "anime_cover", "position", "note", "added_at") select "id", "collection_id", "anime_id", "anime_title", "anime_cover", "position", "note", "added_at" from collection_items;
drop table collection_items;
alter table _rb_collection_items rename to collection_items;
insert into _rb_collection_likes ("collection_id", "user_id", "created_at") select "collection_id", "user_id", "created_at" from collection_likes;
drop table collection_likes;
alter table _rb_collection_likes rename to collection_likes;
insert into _rb_audit_logs ("id", "actor_id", "action", "target_type", "target_id", "diff", "reason", "ip", "user_agent", "created_at") select "id", "actor_id", "action", "target_type", "target_id", "diff", "reason", "ip", "user_agent", "created_at" from audit_logs;
drop table audit_logs;
alter table _rb_audit_logs rename to audit_logs;
insert into _rb_anime_edit_suggestions ("id", "user_id", "anime_id", "field", "content_before", "content_after", "reason", "status", "reviewed_by", "reviewed_at", "review_note", "created_at") select "id", "user_id", "anime_id", "field", "content_before", "content_after", "reason", "status", "reviewed_by", "reviewed_at", "review_note", "created_at" from anime_edit_suggestions;
drop table anime_edit_suggestions;
alter table _rb_anime_edit_suggestions rename to anime_edit_suggestions;
insert into _rb_compare_history ("id", "user_id", "anime_ids", "created_at") select "id", "user_id", "anime_ids", "created_at" from compare_history;
drop table compare_history;
alter table _rb_compare_history rename to compare_history;
insert into _rb_quests ("id", "title", "description", "badge_reward", "target_value", "metric", "category", "starts_at", "ends_at", "is_active", "created_at") select "id", "title", "description", "badge_reward", "target_value", "metric", "category", "starts_at", "ends_at", "is_active", "created_at" from quests;
drop table quests;
alter table _rb_quests rename to quests;
insert into _rb_user_quest_progress ("user_id", "quest_id", "progress", "completed_at", "claimed_at", "updated_at") select "user_id", "quest_id", "progress", "completed_at", "claimed_at", "updated_at" from user_quest_progress;
drop table user_quest_progress;
alter table _rb_user_quest_progress rename to user_quest_progress;
insert into _rb_activity_feed ("id", "user_id", "kind", "anime_id", "anime_title", "anime_cover", "collection_id", "badge_id", "meta", "is_public", "created_at") select "id", "user_id", "kind", "anime_id", "anime_title", "anime_cover", "collection_id", "badge_id", "meta", "is_public", "created_at" from activity_feed;
drop table activity_feed;
alter table _rb_activity_feed rename to activity_feed;
insert into _rb_admin_passwords ("id", "password_hash", "valid_for_date", "created_at") select "id", "password_hash", "valid_for_date", "created_at" from admin_passwords;
drop table admin_passwords;
alter table _rb_admin_passwords rename to admin_passwords;
insert into _rb_system_secrets ("key", "value", "description", "created_at", "updated_at") select "key", "value", "description", "created_at", "updated_at" from system_secrets;
drop table system_secrets;
alter table _rb_system_secrets rename to system_secrets;

-- ── Recreate index (bị drop cùng bảng) ──
create index if not exists users_google_sub_idx on users(google_sub);
create index if not exists sessions_user_idx   on sessions(user_id, created_at desc);
create index if not exists sessions_expiry_idx on sessions(expires_at);
create index if not exists profiles_username_idx on profiles(username);
create index if not exists favorites_anime_idx on favorites(anime_id);
create index if not exists favorites_user_idx  on favorites(user_id);
create index if not exists comments_entity_idx on comments(entity_type, entity_id, created_at desc);
create index if not exists comments_parent_idx on comments(parent_id);
create index if not exists comments_user_idx   on comments(user_id);
create index if not exists anime_seasons_season_year_idx on anime_seasons(season, year);
create index if not exists anime_seasons_year_idx        on anime_seasons(year desc);
create index if not exists anime_seasons_score_idx       on anime_seasons(score desc);
create index if not exists anime_recs_source_idx on anime_recommendations(source_anime_id, weight desc);
create index if not exists user_library_user_idx  on user_library(user_id, status, updated_at desc);
create index if not exists user_library_anime_idx on user_library(anime_id);
create index if not exists anime_schedule_day_idx    on anime_schedule(broadcast_day, broadcast_time);
create index if not exists anime_schedule_status_idx on anime_schedule(status);
create index if not exists reactions_anime_idx on anime_reactions(anime_id, reaction);
create index if not exists reactions_user_idx  on anime_reactions(user_id);
create index if not exists reviews_anime_idx on anime_reviews(anime_id, created_at desc);
create index if not exists reviews_user_idx  on anime_reviews(user_id);
create index if not exists mal_sync_user_idx on mal_sync_jobs(user_id, created_at desc);
create index if not exists translation_cache_updated_idx on translation_cache(updated_at desc);
create index if not exists comment_votes_comment_idx on comment_votes(comment_id);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications(user_id, read_at) where read_at is null;
create index if not exists collections_user_idx   on collections(user_id, updated_at desc);
create index if not exists collections_public_idx on collections(is_public, like_count desc, updated_at desc);
create index if not exists collection_items_collection_idx on collection_items(collection_id, position);
create index if not exists collection_likes_user_idx on collection_likes(user_id);
create index if not exists audit_logs_actor_idx  on audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_target_idx on audit_logs(target_type, target_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs(action, created_at desc);
create index if not exists edit_suggestions_status_idx on anime_edit_suggestions(status, created_at desc);
create index if not exists edit_suggestions_user_idx   on anime_edit_suggestions(user_id, created_at desc);
create index if not exists edit_suggestions_anime_idx  on anime_edit_suggestions(anime_id, created_at desc);
create index if not exists compare_history_user_idx on compare_history(user_id, created_at desc);
create index if not exists quests_active_idx on quests(is_active, ends_at);
create index if not exists user_quest_progress_user_idx on user_quest_progress(user_id, completed_at);
create index if not exists activity_feed_recent_idx on activity_feed(created_at desc) where is_public = 1;
create index if not exists activity_feed_user_idx   on activity_feed(user_id, created_at desc);
create index if not exists admin_passwords_date_idx on admin_passwords(valid_for_date desc);
create index if not exists sessions_family_idx on sessions(family_id);

-- ── Recreate views ──
create view if not exists anime_like_counts as
  select anime_id, cast(count(*) as integer) as like_count
  from favorites
  group by anime_id;
create view if not exists anime_reaction_counts as
  select anime_id,
    sum(case when reaction = 'heart' then 1 else 0 end) as heart_count,
    sum(case when reaction = 'laugh' then 1 else 0 end) as laugh_count,
    sum(case when reaction = 'cry'   then 1 else 0 end) as cry_count,
    cast(count(*) as integer) as total_count
  from anime_reactions
  group by anime_id;
create view if not exists user_library_stats as
  select user_id,
    cast(count(*) as integer) as total_anime,
    sum(case when status = 'watching'      then 1 else 0 end) as watching_count,
    sum(case when status = 'completed'     then 1 else 0 end) as completed_count,
    sum(case when status = 'plan_to_watch' then 1 else 0 end) as plan_to_watch_count,
    sum(case when status = 'dropped'       then 1 else 0 end) as dropped_count,
    sum(case when status = 'on_hold'       then 1 else 0 end) as on_hold_count,
    round(avg(score), 2) as avg_score,
    sum(current_episode) as total_episodes_watched
  from user_library
  group by user_id;
create view if not exists comment_vote_counts as
  select comment_id,
    cast(coalesce(sum(case when value = 1  then 1 else 0 end), 0) as integer) as upvotes,
    cast(coalesce(sum(case when value = -1 then 1 else 0 end), 0) as integer) as downvotes,
    cast(coalesce(sum(value), 0) as integer) as score
  from comment_votes
  group by comment_id;
create view if not exists activity_feed_enriched as
  select a.id, a.user_id, a.kind, a.anime_id, a.anime_title, a.anime_cover,
         a.collection_id, a.badge_id, a.meta, a.created_at,
         p.display_name, p.username, p.avatar_url, p.badges
  from activity_feed a
  left join profiles p on p.id = a.user_id
  where a.is_public = 1;

-- ── Seed quest (insert or ignore → chạy lại vẫn an toàn) ──
insert or ignore into quests (id, title, description, badge_reward, target_value, metric, category) values
  ('library_starter',  'Khởi đầu hành trình',    'Thêm 5 anime đầu tiên vào thư viện',              'collector',     5,  'library_count',   'general'),
  ('library_pro',      'Nhà sưu tầm thực thụ',    'Thêm 50 anime vào thư viện',                      'top_fan',       50, 'library_count',   'general'),
  ('comment_starter',  'Người mở lời',            'Để lại 10 bình luận',                             'active',        10, 'comments_posted', 'social'),
  ('comment_pro',      'Bậc thầy thảo luận',      'Để lại 100 bình luận',                            'top_fan',       100,'comments_posted', 'social'),
  ('reviewer_5_edits', 'Curator tập sự',          'Đóng góp 5 edit suggestion được duyệt',           'reviewer',      5,  'edits_approved',  'curator'),
  ('completionist',    'Cày phim chuyên nghiệp',  'Hoàn thành 25 anime',                             'completionist', 25, 'completed_count', 'general');
