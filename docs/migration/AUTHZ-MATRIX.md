# AUTHZ-MATRIX — Supabase RLS → Node authorization (tsuki-wiki)

> Trạng thái: **tài liệu thiết kế**, chưa phải code. Sinh ngày 2026-11-02. Phạm vi: `supabase/setup_all.sql` (1266 dòng, bản gộp của toàn bộ `schema*.sql`).

> Mục tiêu: khi bỏ Supabase, mỗi policy/function/trigger phải có đường đi rõ ràng — port sang Node, giữ ở SQLite, hay bỏ.

## 0. Cách đếm & bằng chứng

```bash
cd /tmp/opencode/work/tsuki-wiki
grep -ci "create policy"        supabase/setup_all.sql   # 73
grep -ci "create.*function"     supabase/setup_all.sql   # 22
grep -ci "create trigger"       supabase/setup_all.sql   # 20
grep -ci "create table"         supabase/setup_all.sql   # 24
```

Kết quả parse bằng script (`/tmp/opencode/parse_sql.py`, tách statement theo `;` ngoài paren + `$tag$`): **73 policy**, **22 function**, **20 trigger**, **24 bảng** — khớp 100% với grep.

Phân bố: **62 policy trên bảng nghiệp vụ** + **11 policy trên `storage.objects`** (3 bucket: `avatars`, `comment-images`, `covers`).

- Phân bố operation: SELECT=28, INSERT=15, UPDATE=12, DELETE=15, ALL=3.

- Phân bố role: 65 policy không có mệnh đề `TO` (mặc định **PUBLIC** = anon + authenticated), 8 policy `TO authenticated` (toàn bộ là storage insert/update/delete).

**Lưu ý quan trọng:** policy `PUBLIC` + predicate `auth.uid() = user_id` **thực tế chỉ cho authenticated** vì với anon `auth.uid()` = NULL → `NULL = user_id` = NULL → false. Khi port sang Node, `PUBLIC*` + own ⇒ **bắt buộc đăng nhập**.

## 1. Mô hình auth: Supabase → Node

| Supabase | Node (server-v2) | Ghi chú |
|---|---|---|
| `auth.uid()` | `req.user.id` (giải mã từ JWT trong cookie HttpOnly) | JWT chỉ chứa `sub`, `iat`, `exp`, `jti`; **không** chứa badges |
| role `anon` | request không có cookie / JWT invalid | `requireUser` trả 401 |
| role `authenticated` | `req.user` tồn tại + session chưa revoke | kiểm `sessions.token_hash` mỗi request (hoặc cache ngắn) |
| `public.is_mod_or_above(uid)` | `requireRole("mod")`: `profiles.badges ∩ {mod,admin,owner} ≠ ∅` | đọc DB, cache 30–60s theo user |
| `service_role` | **không tồn tại** ở client; service nội bộ dùng hàm repo trực tiếp | cron dùng `CRON_SECRET`, không dùng service key |
| `storage.foldername(name)[1] = uid` | `storage.assertPathOwner(bucket, key, uid)` — key phải bắt đầu `<uid>/` | validate cả key cũ (update) |
| RLS tự động lọc mọi query | **không có** — mọi query phải đi qua repo có tham số `:uid` | route KHÔNG được tự viết SQL |

## 2. Bảng policy — 62 policy trên bảng nghiệp vụ

> **STT toàn cục 1–73** theo đúng thứ tự xuất hiện trong `setup_all.sql` (khớp mục 4 và 8). Khoảng trống trong bảng là các policy `storage.objects` nằm ở mục 3.

| STT | Bảng | Policy | Op | Role | Predicate (SQL gốc) | Rule Node tương đương | Tầng enforce |
|---:|---|---|---|---|---|---|---|
| 1 | `profiles` | `profiles_read_all` | SELECT | PUBLIC* | `USING (true)` | Route công khai trả profile (bỏ email) — không cần auth — Không trả email/password_hash | Public route |
| 2 | `profiles` | `profiles_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = id)` | requireUser(); server tự gán id = req.user.id, bỏ id client gửi — Chỉ signup/OAuth callback tạo row; không mở POST /profiles | Node-service |
| 3 | `profiles` | `profiles_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = id)` | requireUser(); UPDATE ... WHERE id = :uid; whitelist field (display_name, bio, avatar_url, username, gender, birthday, spotify_url, cover_url) — badges/counters cấm client sửa | Node-repo (WHERE) |
| 4 | `favorites` | `favorites_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead (không auth) | Public route |
| 5 | `favorites` | `favorites_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id = req.user.id — INSERT ... ON CONFLICT DO NOTHING | Node-service |
| 6 | `favorites` | `favorites_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); DELETE ... WHERE user_id = :uid AND anime_id = :id | Node-repo (WHERE) |
| 7 | `comments` | `comments_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead; app lọc is_deleted = 0 — Policy SQL không lọc is_deleted — app phải lọc | Public route |
| 8 | `comments` | `comments_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; validate entity_type/entity_id/body 1..2000 | Node-service |
| 9 | `comments` | `comments_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 10 | `comments` | `comments_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); soft delete SET is_deleted = 1 WHERE user_id = :uid — Trigger counter cần nhận biết is_deleted đổi | Node-repo (WHERE) |
| 15 | `anime_seasons` | `anime_seasons_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 16 | `anime_recommendations` | `anime_recs_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 17 | `user_library` | `library_select_own` | SELECT | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 18 | `user_library` | `library_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; UPSERT theo (user_id, anime_id) | Node-service |
| 19 | `user_library` | `library_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid AND id = :id — with_check cũng phải khớp | Node-repo (WHERE) |
| 20 | `user_library` | `library_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 21 | `anime_schedule` | `schedule_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 22 | `anime_reactions` | `reactions_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 23 | `anime_reactions` | `reactions_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id — UNIQUE (user_id, anime_id) — chỉ 1 reaction/user/anime (setup_all.sql:299) | Node-service |
| 24 | `anime_reactions` | `reactions_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 25 | `anime_reactions` | `reactions_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 26 | `anime_reviews` | `reviews_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead; app lọc is_deleted = 0 | Public route |
| 27 | `anime_reviews` | `reviews_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; body 1..200 | Node-service |
| 28 | `anime_reviews` | `reviews_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 29 | `anime_reviews` | `reviews_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); soft delete | Node-repo (WHERE) |
| 30 | `mal_sync_jobs` | `mal_sync_select_own` | SELECT | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 31 | `mal_sync_jobs` | `mal_sync_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id | Node-service |
| 32 | `translation_cache` | `translation_cache_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead (cache dịch dùng chung) — Cache không chứa dữ liệu user | Public route |
| 36 | `comment_votes` | `comment_votes_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead (tổng hợp qua view comment_vote_counts) | Public route |
| 37 | `comment_votes` | `comment_votes_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; UNIQUE(comment_id, user_id) | Node-service |
| 38 | `comment_votes` | `comment_votes_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid — Check cũng phải own | Node-repo (WHERE) |
| 39 | `comment_votes` | `comment_votes_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 44 | `notifications` | `notifications_select_own` | SELECT | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid (chỉ của mình, không lọc read) | Node-repo (WHERE) |
| 45 | `notifications` | `notifications_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid; chỉ cho set read_at — Cột là read_at, không phải is_read (setup_all.sql:612) | Node-repo (WHERE) |
| 46 | `notifications` | `notifications_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 47 | `comments` | `comments_delete_mod` | DELETE | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); WHERE id = :id (bất kỳ comment); ghi audit_logs — Role đọc từ profiles.badges | Node-middleware + service |
| 48 | `comments` | `comments_update_mod` | UPDATE | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); WHERE id = :id | Node-middleware + service |
| 49 | `collections` | `collections_read` | SELECT | PUBLIC* | `USING (is_public = true or auth.uid() = user_id)` | scopeCollections(user): WHERE is_public = 1 OR user_id = :uid — Áp cho cả list và detail | Node-repo (WHERE) |
| 50 | `collections` | `collections_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; is_public mặc định 1 (public) — setup_all.sql:686 & schema.sql:386 = default true/1 — PHẢI giữ 1, nếu 0 thì collection mới luôn private | Node-service |
| 51 | `collections` | `collections_update_own` | UPDATE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 52 | `collections` | `collections_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 53 | `collections` | `collections_delete_mod` | DELETE | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); WHERE id = :id; ghi audit | Node-middleware + service |
| 54 | `collection_items` | `collection_items_read` | SELECT | PUBLIC* | `USING (exists (select 1 from public.collections c where c.id = collection_id and (c.is_public = true or c.user_id = auth.uid())))` | canReadCollection(user, collectionId): EXISTS(SELECT 1 FROM collections c WHERE c.id = :cid AND (c.is_public = 1 OR c.user_id = :uid)) — KHÔNG dịch được thành middleware thuần — predicate phụ thuộc row bảng khác | Node + DB join (EXISTS) |
| 55 | `collection_items` | `collection_items_write_owner` | ALL | PUBLIC* | `USING (exists (select 1 from public.collections c where c.id = collection_id and c.user_id = auth.uid()))` | canWriteCollection(user, collectionId): EXISTS(... c.user_id = :uid) — áp cho INSERT/UPDATE/DELETE — Policy ALL: một hàm dùng cho cả 3 thao tác | Node + DB join (EXISTS) |
| 56 | `collection_likes` | `collection_likes_read` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 57 | `collection_likes` | `collection_likes_insert` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; UNIQUE(collection_id, user_id) | Node-service |
| 58 | `collection_likes` | `collection_likes_delete` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 59 | `audit_logs` | `audit_select_self` | SELECT | PUBLIC* | `USING (actor_id = auth.uid())` | requireUser(); WHERE actor_id = :uid | Node-repo (WHERE) |
| 60 | `audit_logs` | `audit_select_mod` | SELECT | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); toàn bộ audit | Node-middleware |
| 61 | `anime_edit_suggestions` | `edit_suggestions_read_self` | SELECT | PUBLIC* | `USING (user_id = auth.uid())` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 62 | `anime_edit_suggestions` | `edit_suggestions_read_mod` | SELECT | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); toàn bộ suggestion | Node-middleware |
| 63 | `anime_edit_suggestions` | `edit_suggestions_insert` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id; auto-approve nếu badges ∩ {active,top_fan,mod,admin,owner} — Thay trigger auto_approve_trusted_edit | Node-service |
| 64 | `anime_edit_suggestions` | `edit_suggestions_update_mod` | UPDATE | PUBLIC* | `USING (public.is_mod_or_above(auth.uid()))` | requireRole('mod'); PATCH status/review_note | Node-middleware + service |
| 65 | `compare_history` | `compare_history_self` | ALL | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); SELECT/INSERT/DELETE đều WHERE user_id = :uid — Policy ALL | Node-repo (WHERE) |
| 66 | `quests` | `quests_read_all` | SELECT | PUBLIC* | `USING (true)` | publicRead | Public route |
| 67 | `user_quest_progress` | `user_quest_progress_self` | ALL | PUBLIC* | `USING (auth.uid() = user_id)` | SELECT: requireUser() + WHERE user_id = :uid. INSERT/UPDATE: KHÔNG mở route nào — chỉ service/hook quest ghi — Policy ALL ở nguồn cho phép client tự ghi progress — đây là lỗ có sẵn, KHÔNG bê sang Node | Node-repo (SELECT) + Internal (write) |
| 68 | `activity_feed` | `activity_read_public` | SELECT | PUBLIC* | `USING (is_public = true)` | WHERE is_public = 1 — Kết hợp với activity_read_own | Node-repo (WHERE) |
| 69 | `activity_feed` | `activity_read_own` | SELECT | PUBLIC* | `USING (auth.uid() = user_id)` | OR user_id = :uid (gộp vào cùng query) | Node-repo (WHERE) |
| 70 | `activity_feed` | `activity_insert_own` | INSERT | PUBLIC* | `WITH CHECK (auth.uid() = user_id)` | requireUser(); ép user_id — thực tế chỉ service hook ghi | Node-service |
| 71 | `activity_feed` | `activity_delete_own` | DELETE | PUBLIC* | `USING (auth.uid() = user_id)` | requireUser(); WHERE user_id = :uid | Node-repo (WHERE) |
| 72 | `admin_passwords` | `admin_passwords_no_direct_access` | SELECT | PUBLIC* | `USING (false)` | Không mở route nào; chỉ service nội bộ (rotate/verify) đọc bảng — Tương đương using(false) | Internal (không expose) |
| 73 | `system_secrets` | `system_secrets_no_direct` | SELECT | PUBLIC* | `USING (false)` | Không mở route nào; chỉ service đọc CRON_SECRET — Tương đương using(false) | Internal (không expose) |

_Đếm: **62 policy** trên bảng nghiệp vụ (STT toàn cục 1–73, khớp danh sách Supabase)._

## 3. Bảng policy — 11 policy trên `storage.objects` (3 bucket)

> STT toàn cục: **11–14** (avatars), **33–35** (comment-images), **40–43** (covers) — đúng thứ tự SQL.

| STT | Bucket | Policy | Op | Role | Predicate (SQL gốc) | Rule Node tương đương | Tầng enforce |
|---:|---|---|---|---|---|---|---|
| 11 | `avatars` | `avatars_public_read` | SELECT | PUBLIC* | `USING (bucket_id = 'avatars')` | storage.readPublic('avatars', key) | Node-storage |
| 12 | `avatars` | `avatars_insert_own` | INSERT | authenticated | `WITH CHECK (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('avatars', key, uid) + MIME/size check | Node-storage |
| 13 | `avatars` | `avatars_update_own` | UPDATE | authenticated | `USING (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('avatars', key, uid) | Node-storage |
| 14 | `avatars` | `avatars_delete_own` | DELETE | authenticated | `USING (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('avatars', key, uid) | Node-storage |
| 33 | `comment-images` | `comment_images_public_read` | SELECT | PUBLIC* | `USING (bucket_id = 'comment-images')` | storage.readPublic('comment-images', key) | Node-storage |
| 34 | `comment-images` | `comment_images_insert_own` | INSERT | authenticated | `WITH CHECK (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('comment-images', key, uid) | Node-storage |
| 35 | `comment-images` | `comment_images_delete_own` | DELETE | authenticated | `USING (bucket_id = 'comment-images' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('comment-images', key, uid) | Node-storage |
| 40 | `covers` | `covers_public_read` | SELECT | PUBLIC* | `USING (bucket_id = 'covers')` | storage.readPublic('covers', key) | Node-storage |
| 41 | `covers` | `covers_insert_own` | INSERT | authenticated | `WITH CHECK (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('covers', key, uid) | Node-storage |
| 42 | `covers` | `covers_update_own` | UPDATE | authenticated | `USING (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('covers', key, uid) | Node-storage |
| 43 | `covers` | `covers_delete_own` | DELETE | authenticated | `USING (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text)` | storage.assertPathOwner('covers', key, uid) | Node-storage |

_Đếm: **11 policy** storage (STT toàn cục 11–14, 33–35, 40–43)._

## 4. Policy KHÔNG dịch được thành middleware thuần

Các policy dưới đây **không thể** kiểm bằng một middleware đọc JWT — predicate phụ thuộc dữ liệu bảng khác, hoặc thuộc hạ tầng không có trong SQLite. Phải giữ kiểm tra ở tầng DB/query (EXISTS/JOIN) hoặc tầng storage, không được thay bằng check trong RAM.

| Policy (STT toàn cục) | Vì sao không dịch được | Cách giữ đúng ngữ nghĩa |
|---|---|---|
| `collection_items_read` (STT 54) | Predicate là `EXISTS (SELECT 1 FROM collections c WHERE ...)` — phụ thuộc row bảng `collections` | Repo helper `canReadCollection()` chạy `EXISTS` trong cùng transaction; mọi SELECT/INSERT/UPDATE `collection_items` phải gọi helper này |
| `collection_items_write_owner` (STT 55) | Như trên, policy `ALL` áp cho cả 3 thao tác ghi | `canWriteCollection()` với `EXISTS ... c.user_id = :uid` |
| `comments_delete_mod` / `comments_update_mod` (STT 47, 48) | Role suy từ `profiles.badges` (mảng) — không nằm trong JWT | `requireRole()` đọc DB; **không** nhét badges vào JWT (revoke role sẽ trễ hạn token) |
| `collections_delete_mod`, `audit_select_mod`, `edit_suggestions_read_mod`, `edit_suggestions_update_mod` (STT 53, 60, 62, 64) | Cùng lý do role-from-DB | `requireRole("mod")` + ghi `audit_logs` |
| 11 policy `storage.objects` (STT 11–14, 33–35, 40–43) | `storage.foldername()`/bucket là hạ tầng Supabase Storage, **không tồn tại** trong SQLite | Tầng storage Node: `readPublic` / `assertPathOwner(bucket, key, uid)`; route upload không nhận `bucket`/`path` tuỳ ý từ client |
| `admin_passwords_no_direct_access`, `system_secrets_no_direct` (STT 72, 73) | `using (false)` — mục đích là **không** cho client đọc | Không tồn tại route; service nội bộ là đường duy nhất |

Ngoài policy, các thành phần sau **bắt buộc ở tầng DB** (không thể enforce bằng middleware):

1. **Counter** `profiles.comments_count / library_count / reviews_count`, `collections.item_count / like_count` — phải atomic trong transaction/trigger, nếu tính ở Node sẽ sai khi 2 request đồng thời (SQLite WAL vẫn cần transaction).
2. **`updated_at`** — phải set trong cùng câu UPDATE (trigger hoặc service), không dựa vào clock của app nhiều instance.
3. **5 view tổng hợp** (`anime_like_counts`, `anime_reaction_counts`, `user_library_stats`, `comment_vote_counts`, `activity_feed_enriched`) — là aggregate/join; ở Supabase view chạy bằng quyền owner (RLS không tự áp), nên khi port phải kiểm quyền ở query gọi view: `user_library_stats` chỉ trả của `:uid`; `activity_feed_enriched` đã có `WHERE is_public = 1`.
4. **UNIQUE/CHECK/FK** — thay cho phần "with check" mà RLS không chặn được (vd `UNIQUE(comment_id,user_id)` của votes, `CHECK (char_length(body) BETWEEN 1 AND 2000)`).

### 4.1 Bảng KHÔNG có INSERT policy — ai được ghi?

`notifications` và `audit_logs` chỉ có policy SELECT/UPDATE/DELETE (không có INSERT). Ở Supabase, việc ghi do `SECURITY DEFINER` function/service-role đảm nhận (vd `rotate_admin_password` ghi audit). Sang Node: **chỉ service nội bộ được INSERT**, không mở route `POST /notifications` hay `POST /audit_logs`; nếu cần route cho user thì đó là thay đổi so với nguồn và phải ghi rõ trong đặc tả.


## 5. 22 function — port đi đâu?

| # | Function | Trả về | SECURITY DEFINER | Vai trò hiện tại | Port sang | Lý do | Phase |
|---:|---|---|---|---|---|---|---|
| 1 | `handle_new_user()` | `returns trigger` | ✅ | trigger | Node — auth callback | Tạo `users` + `profiles` sau signup/OAuth; là trigger trên `auth.users` (không tồn tại ở SQLite) | P0 |
| 2 | `touch_updated_at()` | `returns trigger` | — | trigger | SQLite trigger | Set `updated_at` trong cùng UPDATE, không phụ thuộc app | P1 |
| 3 | `profiles_bump_comments()` | `returns trigger` | — | trigger | SQLite trigger | Counter atomic; xử lý cả toggle `is_deleted` (INSERT/UPDATE/DELETE) | P1 |
| 4 | `profiles_bump_library()` | `returns trigger` | — | trigger | SQLite trigger | Counter atomic theo INSERT/DELETE | P1 |
| 5 | `profiles_bump_reviews()` | `returns trigger` | — | trigger | SQLite trigger | Counter atomic + toggle `is_deleted` | P1 |
| 6 | `grant_badge(target uuid, badge text)` | `returns void` | ✅ | RPC / helper | Node service | Badges là JSON array; cần distinct-union, nên làm trong service có transaction | P1 |
| 7 | `revoke_badge(target uuid, badge text)` | `returns void` | ✅ | RPC / helper | Node service | Xoá phần tử khỏi JSON array | P1 |
| 8 | `is_mod_or_above(uid uuid)` | `returns boolean` | ✅ | RPC / helper | Node helper `requireRole` | Node đọc `profiles.badges`; chỉ cần trong SQL nếu trigger quest/auto-approve ở DB | P0 |
| 9 | `bootstrap_owner(target_email text)` | `returns void` | ✅ | RPC / helper | Node CLI script | One-time: gán badge owner theo email; không expose API | P0 |
| 10 | `bump_collection_items()` | `returns trigger` | — | trigger | SQLite trigger | Counter atomic cho `collections.item_count` | P1 |
| 11 | `bump_collection_likes()` | `returns trigger` | — | trigger | SQLite trigger | Counter atomic cho `collections.like_count` | P1 |
| 12 | `auto_approve_trusted_edit()` | `returns trigger` | ✅ | trigger | Node service | SQLite không gán được `NEW.*` trong BEFORE trigger; có thể AFTER INSERT + UPDATE nhưng Node service gọn và dễ test hơn | P1 |
| 13 | `approve_edit(suggestion_id uuid, note text default null)` | `returns void` | ✅ | RPC / helper | Node service + transaction | Mod check + update suggestion + audit log phải cùng transaction | P1 |
| 14 | `reject_edit(suggestion_id uuid, note text default null)` | `returns void` | ✅ | RPC / helper | Node service + transaction | Như trên | P1 |
| 15 | `bump_quest_progress(uid uuid, metric_name text, delta integer default 1)` | `returns void` | ✅ | RPC / helper | Node service + transaction | Loop quest active, upsert progress, cấp badge khi đạt target | P1 |
| 16 | `quests_after_library_change()` | `returns trigger` | ✅ | trigger | Node hook (after write) | Gọi `bumpQuestProgress(user,"library_count"/"completed_count")` trong service | P1 |
| 17 | `quests_after_comment()` | `returns trigger` | ✅ | trigger | Node hook (after write) | Gọi `bumpQuestProgress(user,"comments_posted")` | P1 |
| 18 | `record_activity_library()` | `returns trigger` | ✅ | trigger | Node hook (after write) | Insert `activity_feed` khi thêm library / chuyển completed | P1 |
| 19 | `record_activity_collection()` | `returns trigger` | ✅ | trigger | Node hook (after write) | Insert activity khi tạo collection public | P1 |
| 20 | `rotate_admin_password()` | `returns text` | ✅ | RPC / helper | Node cron job + `POST /api/admin/rotate-password` | CSPRNG thật; hash scrypt; prune 7 ngày; audit. Plaintext chỉ trả khi HTTPS + caller đã auth; có webhook thì gửi Discord và response `{rotated:true, webhook_sent:true}` | **P0** |
| 21 | `get_or_create_cron_secret()` | `returns text` | ✅ | RPC / helper | Node service + `GET /api/admin/cron-secret` (**owner-only**) | Env `CRON_SECRET` **≥32**; fallback DB `system_secrets` ≥32; CSPRNG; route chỉ badge `owner` (mod/admin → 403), không log secret | **P0** |
| 22 | `verify_admin_password(candidate text)` | `returns boolean` | ✅ | RPC / helper | Node service | scrypt compare + role check + audit; rate-limit ở route | **P0** |

_Đếm: **22 function** → **6 giữ ở SQLite trigger**, **16 viết bằng Node**._

## 6. 20 trigger — port đi đâu?

| # | Trigger | Bảng | Timing | Gọi function | Port sang | Ghi chú |
|---:|---|---|---|---|---|---|
| 1 | `on_auth_user_created` | `auth.users` | after insert | `handle_new_user()` | BỎ (drop) | Không có `auth.users`; logic chuyển vào auth callback Node |
| 2 | `profiles_touch_updated_at` | `profiles` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 3 | `comments_touch_updated_at` | `comments` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 4 | `anime_seasons_touch_updated_at` | `anime_seasons` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 5 | `user_library_touch_updated_at` | `user_library` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 6 | `anime_schedule_touch_updated_at` | `anime_schedule` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 7 | `reviews_touch_updated_at` | `anime_reviews` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 8 | `comments_count_trg` | `comments` | after insert or update or delete | `profiles_bump_comments()` | SQLite trigger | Counter, có xử lý toggle is_deleted |
| 9 | `library_count_trg` | `user_library` | after insert or delete | `profiles_bump_library()` | SQLite trigger | Counter |
| 10 | `reviews_count_trg` | `anime_reviews` | after insert or update or delete | `profiles_bump_reviews()` | SQLite trigger | Counter, có toggle is_deleted |
| 11 | `collections_touch_updated_at` | `collections` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 12 | `collection_items_count_trg` | `collection_items` | after insert or delete | `bump_collection_items()` | SQLite trigger | Counter |
| 13 | `collection_likes_count_trg` | `collection_likes` | after insert or delete | `bump_collection_likes()` | SQLite trigger | Counter |
| 14 | `edit_suggestions_auto_approve` | `anime_edit_suggestions` | before insert | `auto_approve_trusted_edit()` | BỎ (Node service) | BEFORE INSERT không sửa được NEW trong SQLite → set status trong service khi tạo suggestion |
| 15 | `user_quest_progress_touch` | `user_quest_progress` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |
| 16 | `quests_library_trg` | `user_library` | after insert or update | `quests_after_library_change()` | BỎ (Node hook) | Service `userLibrary` gọi quest progress sau commit |
| 17 | `quests_comments_trg` | `comments` | after insert | `quests_after_comment()` | BỎ (Node hook) | Service `comments.create` gọi quest progress |
| 18 | `activity_library_trg` | `user_library` | after insert or update | `record_activity_library()` | BỎ (Node hook) | Service `userLibrary` insert activity |
| 19 | `activity_collection_trg` | `collections` | after insert | `record_activity_collection()` | BỎ (Node hook) | Service `collections.create` insert activity |
| 20 | `system_secrets_touch` | `system_secrets` | before update | `touch_updated_at()` | SQLite trigger | Port: `AFTER UPDATE ... UPDATE <t> SET updated_at = ... WHERE id = NEW.id` (SQLite không sửa được `NEW`) |

_Đếm: **20 trigger** → **14 SQLite trigger**, **5 chuyển Node hook/service**, **1 drop hẳn**._

> Ghi chú implementation: `server-v2/db/migrations/004_triggers.sql` hiện có **25 trigger** = 14 ở bảng này + **11 trigger bổ sung** cho auth/session/hardening (test #69: 25 trigger / 5 view). Con số 14 là phần **port từ Supabase**, không phải tổng số trigger của backend mới.

## 7. 5 view — không có RLS, phải kiểm quyền ở query

| View | Nội dung | Rủi ro khi bê nguyên sang SQLite | Cách làm ở Node |
|---|---|---|---|
| `anime_like_counts` | `count(*)` favorites theo anime | Dữ liệu công khai, không lộ user | Trả qua endpoint public, cache ngắn |
| `anime_reaction_counts` | đếm reaction theo anime | Công khai | Endpoint public |
| `user_library_stats` | thống kê theo `user_id` | **Lộ thống kê của người khác** nếu query không lọc | Luôn `WHERE user_id = :uid` (hoặc chỉ trả khi profile public) |
| `comment_vote_counts` | up/down/score theo comment | Công khai | Public endpoint |
| `activity_feed_enriched` | activity + join profiles | Đã có `WHERE is_public = 1`; nhưng join lộ `display_name/username/avatar` — chấp nhận vì profile vốn public | Giữ `WHERE is_public = 1`; không thêm cột nhạy cảm |

> **⚠ Rủi ro production (chưa verify):** với Postgres, view không tự áp RLS của bảng nền; Supabase grant mặc định cho `anon` trên object mới trong schema `public`. Vì vậy `GET /rest/v1/user_library_stats?select=*` bằng **anon key** có thể trả thống kê của toàn bộ user. Kiểm tra 1 lệnh (không in key):

> ```bash
> curl -s "$VITE_SUPABASE_URL/rest/v1/user_library_stats?select=*&limit=5" -H "apikey: $VITE_SUPABASE_ANON_KEY"
> # rỗng/401 = an toàn; có row = ĐANG LỘ
> ```

> Vá ngay, độc lập migration: `revoke all on public.user_library_stats from anon, authenticated;` hoặc tạo lại view với `security_invoker = true` (PG15+).

## 8. Checklist verify (dùng ở Phase 1)

- [ ] Mỗi dòng policy **STT 1–73** (mục 2 + 3) có ít nhất 1 test allow + 1 test deny (tester sở hữu).
- [ ] `grep -rn "supabase" server-v2/ --include=*.ts` → rỗng (không còn phụ thuộc Supabase).
- [ ] Không route nào nhận `user_id`/`role` từ body; mọi `user_id` lấy từ `req.user.id`.
- [ ] Counter đúng sau insert/delete/toggle `is_deleted`: `sqlite3 data.db "select comments_count from profiles where id=?"`.
- [ ] `updated_at` đổi sau UPDATE trên 9 bảng có trigger.
- [ ] Không endpoint nào trả `admin_passwords` / `system_secrets`.

## 9. Trạng thái scaffold hiện có (không thuộc phạm vi tài liệu này)

`server-v2/db/schema.sql` (**661 dòng**, untracked) đã port 24 bảng + 5 view + seed 6 quest; **0 trigger**; phần DEFERRED cuối file khớp đúng các mục 5–6 ở trên. Vì vậy Phase 0/1 chỉ cần bổ sung auth (`users.password_hash`) + toàn bộ trigger/hook còn thiếu.
