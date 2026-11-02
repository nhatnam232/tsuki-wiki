-- ============================================================
-- tsuki-wiki — server-v2 SQLite schema
--
-- Nguồn: supabase/*.sql (bản gộp: supabase/setup_all.sql, 1266 dòng).
-- Mục tiêu: parity dữ liệu với Supabase, self-host bằng better-sqlite3.
--
-- CHẠY: do migration runner trong `db/index.ts` thực thi (idempotent,
-- ghi nhận vào bảng `_migrations`). KHÔNG chạy tay 2 lần liên tiếp
-- trên cùng file khi DB đang có dữ liệu cũ nếu không hiểu rõ.
-- Toàn bộ DDL dùng `IF NOT EXISTS` nên chạy lại vẫn an toàn.
--
-- ── BẢNG KIỂU (Postgres → SQLite) ────────────────────────────
--   uuid                     → TEXT (uuid-like, sinh bằng randomblob)
--   timestamptz              → TEXT ISO-8601 UTC  (strftime '%Y-%m-%dT%H:%M:%fZ')
--   date                     → TEXT 'YYYY-MM-DD'
--   time                     → TEXT 'HH:MM:SS'
--   jsonb                    → TEXT (JSON, CHECK json_valid)
--   text[] / integer[]       → TEXT (JSON array, CHECK json_valid)
--   boolean                  → INTEGER 0/1 (+ CHECK IN (0,1))
--   numeric(p,s)             → REAL
--   smallint                 → INTEGER
--   serial                   → INTEGER PRIMARY KEY AUTOINCREMENT
--   inet                     → TEXT
--   enum (create type)       → TEXT + CHECK (... IN (...))
--   char_length(x)           → length(x)
--   gen_random_uuid()        → biểu thức default lower(hex(randomblob(..)))
--   now()                    → strftime('%Y-%m-%dT%H:%M:%fZ','now')
--   count(*) filter (where)  → sum(case when ... then 1 else 0 end)
--
-- ── RLS (Supabase) ───────────────────────────────────────────
-- Supabase dùng Postgres RLS + auth.uid(). server-v2 tự viết backend nên
-- RLS KHÔNG tồn tại trong SQLite: quyền được enforce ở tầng service
-- (route → service → repo), mỗi query đều nhận user_id từ JWT đã verify.
-- Danh sách policy được port sang comment ở từng bảng (nguồn: setup_all.sql).
--   * bảng PUBLIC READ (select using true):
--       profiles, favorites(read), comments(read), anime_seasons,
--       anime_recommendations, anime_schedule, anime_reactions(read),
--       anime_reviews(read), translation_cache, comment_votes(read),
--       collection_likes(read), quests, activity_feed(is_public)
--   * bảng SELF-ONLY (auth.uid() = user_id):
--       user_library, mal_sync_jobs, notifications, compare_history,
--       user_quest_progress, collections(private), collection_likes(write)
--   * bảng MOD/ADMIN-ONLY (is_mod_or_above):
--       audit_logs(read mod), anime_edit_suggestions(read/write mod),
--       comments(delete/update mod), collections(delete mod)
--   * bảng KHÔNG truy cập trực tiếp (select using false):
--       admin_passwords, system_secrets  → chỉ service-role / server nội bộ
--   * storage.* / auth.users / public.is_mod_or_above() / public.grant_badge()
--     ... là hạ tầng Supabase → xem mục "DEFERRED" cuối file.
--
-- ── VIEW (5) ─────────────────────────────────────────────────
--   anime_like_counts, anime_reaction_counts, user_library_stats,
--   comment_vote_counts, activity_feed_enriched
-- ============================================================

-- ------------------------------------------------------------
-- 0. AUTH (v2 ADDITION — thay cho auth.users của Supabase)
--    Ở Supabase, `profiles.id` + mọi `user_id` là FK tới auth.users(id).
--    Self-host: bảng `users` giữ định danh Google OAuth, `sessions` giữ
--    refresh/session token (JWT HttpOnly cookie trỏ tới đây).
--    Lưu ý: 2 bảng này KHÔNG có trong 24 bảng nghiệp vụ của Supabase.
-- ------------------------------------------------------------
create table if not exists users (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random()) % 4), 1)
                  || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                ),
  google_sub    text unique,                       -- sub trong Google ID token
  email         text not null unique,
  email_verified integer not null default 0 check (email_verified in (0,1)),
  name          text,
  picture       text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at text
);
create index if not exists users_google_sub_idx on users(google_sub);

create table if not exists sessions (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  token_hash  text not null unique,               -- sha256 của session token (KHÔNG lưu raw)
  user_agent  text,
  ip          text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  text not null,
  revoked_at  text
);
create index if not exists sessions_user_idx   on sessions(user_id, created_at desc);
create index if not exists sessions_expiry_idx on sessions(expires_at);

-- ------------------------------------------------------------
-- 1. BASE — profiles, favorites, comments
--    (src: schema.sql · setup_all.sql L32-162)
--    RLS: profiles read-all / insert+update own; favorites read-all, write own;
--         comments read-all, write own, delete+update mod.
--    Trigger handle_new_user() (auth.users → profiles) thay bằng OAuth callback
--    ở tầng service (xem DEFERRED).
-- ------------------------------------------------------------
create table if not exists profiles (
  id            text primary key references users(id) on delete cascade,
  username      text unique,
  display_name  text,
  avatar_url    text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- v3: profile extensions
  gender        text check (gender is null or gender in ('male','female','other','prefer_not_to_say')),
  birthday      text,                             -- date 'YYYY-MM-DD'
  spotify_url   text,
  bio           text check (bio is null or length(bio) <= 500),
  -- v5: badges + counters
  badges        text not null default '[]' check (json_valid(badges)),  -- text[]
  comments_count integer not null default 0,
  library_count  integer not null default 0,
  reviews_count  integer not null default 0,
  -- v6: cover
  cover_url     text
);
create index if not exists profiles_username_idx on profiles(username);

create table if not exists favorites (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  user_id     text not null references users(id) on delete cascade,
  anime_id    integer not null,
  anime_title text,
  anime_cover text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id)
);
create index if not exists favorites_anime_idx on favorites(anime_id);
create index if not exists favorites_user_idx  on favorites(user_id);

create table if not exists comments (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  image_url   text                                 -- v3
);
create index if not exists comments_entity_idx on comments(entity_type, entity_id, created_at desc);
create index if not exists comments_parent_idx on comments(parent_id);
create index if not exists comments_user_idx   on comments(user_id);

-- ------------------------------------------------------------
-- 2. v2 — Library, schedule, reactions, reviews, MAL sync
--    (src: schema_v2.sql · setup_all.sql L169-388)
-- ------------------------------------------------------------
create table if not exists anime_seasons (
  id           integer primary key autoincrement,   -- serial
  anime_id     integer not null unique,
  title        text not null,
  cover_image  text,
  score        real,                                -- numeric(4,2)
  episodes     integer,
  status       text,
  season       text,
  year         integer,
  season_key   text generated always as (lower(season) || '_' || cast(year as text)) stored,
  genres       text check (genres is null or json_valid(genres)),   -- text[]
  studio_name  text,
  type         text,
  synopsis     text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists anime_seasons_season_year_idx on anime_seasons(season, year);
create index if not exists anime_seasons_year_idx        on anime_seasons(year desc);
-- pg: score desc nulls last → sqlite: DESC đã đẩy NULL xuống cuối
create index if not exists anime_seasons_score_idx       on anime_seasons(score desc);

create table if not exists anime_recommendations (
  id              text primary key default (
                    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                    || substr(hex(randomblob(2)), 2) || '-'
                    || substr('89ab', 1 + (abs(random()) % 4), 1)
                    || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                  ),
  source_anime_id integer not null,
  target_anime_id integer not null,
  target_title    text,
  target_cover    text,
  target_score    real,
  weight          integer default 1,
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (source_anime_id, target_anime_id)
);
create index if not exists anime_recs_source_idx on anime_recommendations(source_anime_id, weight desc);

-- enum watch_status → TEXT + CHECK
create table if not exists user_library (
  id              text primary key default (
                    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                    || substr(hex(randomblob(2)), 2) || '-'
                    || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  started_at      text,                            -- date
  completed_at    text,                            -- date
  created_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id)
);
create index if not exists user_library_user_idx  on user_library(user_id, status, updated_at desc);
create index if not exists user_library_anime_idx on user_library(anime_id);

create table if not exists anime_schedule (
  id             integer primary key autoincrement,  -- serial
  anime_id       integer not null unique,
  title          text not null,
  cover_image    text,
  broadcast_day  text not null,
  broadcast_time text,                             -- time 'HH:MM:SS'
  broadcast_tz   text default 'Asia/Tokyo',
  season         text,
  year           integer,
  episodes       integer,
  status         text,
  studio_name    text,
  score          real,
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists anime_schedule_day_idx    on anime_schedule(broadcast_day, broadcast_time);
create index if not exists anime_schedule_status_idx on anime_schedule(status);

-- enum reaction_type → TEXT + CHECK
create table if not exists anime_reactions (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random()) % 4), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text not null references users(id) on delete cascade,
  anime_id   integer not null,
  reaction   text not null check (reaction in ('heart','laugh','cry')),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id)
);
create index if not exists reactions_anime_idx on anime_reactions(anime_id, reaction);
create index if not exists reactions_user_idx  on anime_reactions(user_id);

create table if not exists anime_reviews (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random()) % 4), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text not null references users(id) on delete cascade,
  anime_id   integer not null,
  body       text not null check (length(body) between 1 and 200),
  is_deleted integer not null default 0 check (is_deleted in (0,1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (user_id, anime_id)
);
create index if not exists reviews_anime_idx on anime_reviews(anime_id, created_at desc);
create index if not exists reviews_user_idx  on anime_reviews(user_id);

-- enum mal_sync_status → TEXT + CHECK
create table if not exists mal_sync_jobs (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists mal_sync_user_idx on mal_sync_jobs(user_id, created_at desc);

-- ------------------------------------------------------------
-- 3. translation_cache (DeepL/MyMemory cache)
--    (src: schema_translation_cache.sql · setup_all.sql L395-409)
--    RLS: read-all; write chỉ server (service role) → v2: chỉ repo nội bộ.
-- ------------------------------------------------------------
create table if not exists translation_cache (
  text_hash       text not null,
  target_lang     text not null,
  source_text     text not null,
  translated_text text not null,
  provider        text,
  updated_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (text_hash, target_lang)
);
create index if not exists translation_cache_updated_idx on translation_cache(updated_at desc);

-- ------------------------------------------------------------
-- 4. v4 — Comment votes (Reddit-style)
--    (src: schema_v4_comment_votes.sql · setup_all.sql L445-470)
-- ------------------------------------------------------------
create table if not exists comment_votes (
  comment_id text not null references comments(id) on delete cascade,
  user_id    text not null references users(id) on delete cascade,
  value      integer not null check (value in (-1, 1)),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (comment_id, user_id)
);
create index if not exists comment_votes_comment_idx on comment_votes(comment_id);

-- ------------------------------------------------------------
-- 5. v6 — notifications
--    (src: schema_v6_cover_notifications_admin.sql · setup_all.sql L602-630)
-- ------------------------------------------------------------
create table if not exists notifications (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications(user_id, read_at) where read_at is null;

-- ------------------------------------------------------------
-- 6. v7 — Collections, audit logs, edit suggestions, compare history
--    (src: schema_v7_collections_audit_edits.sql · setup_all.sql L680-945)
-- ------------------------------------------------------------
create table if not exists collections (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists collections_user_idx   on collections(user_id, updated_at desc);
create index if not exists collections_public_idx on collections(is_public, like_count desc, updated_at desc);

create table if not exists collection_items (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random()) % 4), 1)
                  || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                ),
  collection_id text not null references collections(id) on delete cascade,
  anime_id      integer not null,
  anime_title   text,
  anime_cover   text,
  position      integer not null default 0,
  note          text check (note is null or length(note) <= 280),
  added_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unique (collection_id, anime_id)
);
create index if not exists collection_items_collection_idx on collection_items(collection_id, position);

create table if not exists collection_likes (
  collection_id text not null references collections(id) on delete cascade,
  user_id       text not null references users(id) on delete cascade,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (collection_id, user_id)
);
create index if not exists collection_likes_user_idx on collection_likes(user_id);

-- enum audit_action → TEXT + CHECK
create table if not exists audit_logs (
  id          text primary key default (
                lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-'
                || substr('89ab', 1 + (abs(random()) % 4), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
              ),
  actor_id    text references users(id) on delete set null,
  action      text not null check (action in (
                'edit_anime','approve_edit','reject_edit','delete_comment_mod',
                'grant_badge','revoke_badge','create_collection','delete_collection',
                'login','other')),
  target_type text,
  target_id   text,
  diff        text check (diff is null or json_valid(diff)),   -- jsonb
  reason      text,
  ip          text,                                            -- inet
  user_agent  text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists audit_logs_actor_idx  on audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_target_idx on audit_logs(target_type, target_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs(action, created_at desc);

-- enum edit_status → TEXT + CHECK
create table if not exists anime_edit_suggestions (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists edit_suggestions_status_idx on anime_edit_suggestions(status, created_at desc);
create index if not exists edit_suggestions_user_idx   on anime_edit_suggestions(user_id, created_at desc);
create index if not exists edit_suggestions_anime_idx  on anime_edit_suggestions(anime_id, created_at desc);

create table if not exists compare_history (
  id         text primary key default (
               lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
               || substr(hex(randomblob(2)), 2) || '-'
               || substr('89ab', 1 + (abs(random()) % 4), 1)
               || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
             ),
  user_id    text references users(id) on delete cascade,
  anime_ids  text not null check (json_valid(anime_ids)),   -- integer[]
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists compare_history_user_idx on compare_history(user_id, created_at desc);

-- ------------------------------------------------------------
-- 7. v8 — Quests / Achievements, Activity feed, Admin daily password, secrets
--    (src: schema_v8_quests_activity_admin.sql + v8_2 · setup_all.sql L952-1244)
-- ------------------------------------------------------------
create table if not exists quests (
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
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists quests_active_idx on quests(is_active, ends_at);

create table if not exists user_quest_progress (
  user_id      text not null references users(id) on delete cascade,
  quest_id     text not null references quests(id) on delete cascade,
  progress     integer not null default 0,
  completed_at text,
  claimed_at   text,
  updated_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primary key (user_id, quest_id)
);
create index if not exists user_quest_progress_user_idx on user_quest_progress(user_id, completed_at);

-- enum activity_kind → TEXT + CHECK
create table if not exists activity_feed (
  id            text primary key default (
                  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                  || substr(hex(randomblob(2)), 2) || '-'
                  || substr('89ab', 1 + (abs(random()) % 4), 1)
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
  meta          text check (meta is null or json_valid(meta)),   -- jsonb
  is_public     integer not null default 1 check (is_public in (0,1)),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists activity_feed_recent_idx on activity_feed(created_at desc) where is_public = 1;
create index if not exists activity_feed_user_idx   on activity_feed(user_id, created_at desc);

-- RLS ở Supabase: select using (false) → v2: không expose qua API công khai.
create table if not exists admin_passwords (
  id             text primary key default (
                   lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                   || substr(hex(randomblob(2)), 2) || '-'
                   || substr('89ab', 1 + (abs(random()) % 4), 1)
                   || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))
                 ),
  password_hash  text not null,                    -- scrypt (thay crypt/gen_salt)
  valid_for_date text not null unique,             -- date
  created_at     text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index if not exists admin_passwords_date_idx on admin_passwords(valid_for_date desc);

create table if not exists system_secrets (
  key         text primary key,
  value       text not null,
  description text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============================================================
-- VIEWS (5) — port từ setup_all.sql
-- ============================================================

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

-- ============================================================
-- SEED — 6 quest mặc định (setup_all.sql L990-997)
-- ============================================================
insert or ignore into quests (id, title, description, badge_reward, target_value, metric, category) values
  ('library_starter',  'Khởi đầu hành trình',    'Thêm 5 anime đầu tiên vào thư viện',              'collector',     5,  'library_count',   'general'),
  ('library_pro',      'Nhà sưu tầm thực thụ',    'Thêm 50 anime vào thư viện',                      'top_fan',       50, 'library_count',   'general'),
  ('comment_starter',  'Người mở lời',            'Để lại 10 bình luận',                             'active',        10, 'comments_posted', 'social'),
  ('comment_pro',      'Bậc thầy thảo luận',      'Để lại 100 bình luận',                            'top_fan',       100,'comments_posted', 'social'),
  ('reviewer_5_edits', 'Curator tập sự',          'Đóng góp 5 edit suggestion được duyệt',           'reviewer',      5,  'edits_approved',  'curator'),
  ('completionist',    'Cày phim chuyên nghiệp',  'Hoàn thành 25 anime',                             'completionist', 25, 'completed_count', 'general');

-- ============================================================
-- DEFERRED — có trong Supabase, CHƯA port ở slice 1 (Phase 0)
--
-- Nguồn đối chiếu chi tiết: docs/migration/AUTHZ-MATRIX.md (73 policy,
-- 22 function, 20 trigger, 24 bảng, 5 view — do planner lập).
--
--   * RLS → KHÔNG port sang SQLite (không có auth.uid()). 62 policy trên bảng
--     nghiệp vụ + 11 policy trên storage.objects được enforce ở tầng service
--     (route → service → repo), xem cột "Port sang" trong AUTHZ-MATRIX §2–§3.
--
--   * 14 trigger SQLite cần port ở Phase 1 (AUTHZ-MATRIX §6):
--       touch_updated_at (8): profiles, comments, anime_seasons, user_library,
--                             anime_schedule, anime_reviews, collections,
--                             user_quest_progress, system_secrets (9 bảng)
--       counter (6):          comments_count_trg, library_count_trg,
--                             reviews_count_trg, collection_items_count_trg,
--                             collection_likes_count_trg
--     Lưu ý kỹ thuật: SQLite KHÔNG sửa được NEW.* trong BEFORE trigger và
--     mỗi trigger chỉ 1 event → phải viết AFTER trigger + UPDATE theo NEW.id,
--     và tách mỗi event (INSERT/UPDATE/DELETE) thành trigger riêng.
--     Slice 1 để service layer set `updated_at` tường minh.
--
--   * 5 trigger CHUYỂN sang Node hook (không port được sang SQLite):
--       quests_library_trg, quests_comments_trg,
--       activity_library_trg, activity_collection_trg,
--       edit_suggestions_auto_approve
--
--   * 1 trigger BỎ hẳn: on_auth_user_created (không còn auth.users) →
--     logic tạo users + profiles nằm trong OAuth callback của Node.
--
--   * 16 function/RPC → viết lại bằng Node service (AUTHZ-MATRIX §5):
--       grant_badge, revoke_badge, is_mod_or_above, bootstrap_owner,
--       approve_edit, reject_edit, bump_quest_progress, auto_approve_trusted_edit,
--       rotate_admin_password, get_or_create_cron_secret, verify_admin_password,
--       handle_new_user
--     Hash mật khẩu: scrypt thay pgcrypto crypt()/gen_salt().
--     CSPRNG: crypto.randomBytes thay random().
--
--   * Storage buckets (avatars, comment-images, covers) + storage.foldername()
--     → v2: upload local disk hoặc object storage (Phase 2).
--   * pg_trgm (translation_cache, profiles.username) → v2: FTS5 (Phase 2).
-- ============================================================
