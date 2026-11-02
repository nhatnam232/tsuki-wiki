# FRONTEND-API-MAP — Supabase client → backend `server-v2`

> Mục đích: mỗi chỗ frontend đang gọi Supabase phải có endpoint thay thế rõ ràng, để dev Phase 1a/1b làm đúng thứ tự và Phase 3 rewrite không phải đoán.
> Nguồn: đọc trực tiếp `src/` tại commit hiện tại (branch `main`, 13 file M + `?? server-v2/`, `?? docs/`), không suy diễn.
> Ngày: 2026-11-02.

## 0. Cách lấy dữ liệu (chạy lại được)

```bash
cd /tmp/opencode/work/tsuki-wiki
grep -rln "supabase" src/ --include=*.ts --include=*.tsx | sort          # 17 file
grep -rnE "supabase\s*\.\s*(from|rpc|storage|auth|channel|removeChannel)" src/ | wc -l   # 32 call site trực tiếp
grep -rhoE "\.from\('[a-z_]+'\)" src/ | sort -u                          # 16 tên = 14 bảng/view + 2 bucket
grep -rhoE "\.rpc\('[a-z_]+'" src/ | sort -u                             # 2 RPC
grep -rn "\.channel(" src/                                                # 3 channel
```

**Đếm thực tế:**
- **17 file** có `supabase` (không phải 18). Danh sách Lead đưa có 17 đường dẫn unique: 6 components + 2 hooks + 6 pages + 2 providers + `lib/supabase.ts`.
- **16 tên** khớp `.from('...')`; trong đó **14 là bảng/view** (12 bảng + 2 view) và **2 là bucket** (`avatars`, `covers`) do `supabase.storage.from(...)` cũng khớp regex. Không có bảng nào khác.
- **2 RPC**, **3 bucket**, **3 realtime channel**.

## 1. Bảng map chính

Quy ước Auth: **anon** = không cần đăng nhập; **user** = JWT cookie hợp lệ; **mod** = `requireRole('mod')` (mod-or-above: `badges ∩ {mod,admin,owner}`); **owner/admin** = riêng cờ `owner|admin`.

| File | Dòng | Gọi Supabase hiện tại | Endpoint backend mới | Auth | Ghi chú (field cần trả / WS) |
|---|---:|---|---|---|---|
| `src/lib/supabase.ts` | 15 | `createClient(url, anonKey)` | **Không map REST** — thay bằng `src/lib/apiV2.ts` (fetch + `credentials:'include'`) | — | Xoá `@supabase/supabase-js` khỏi `package.json`; không còn anon key ở client |
| `src/providers/AuthProvider.tsx` | 70 | `from('profiles').select(...).eq('id', userId).maybeSingle()` | `GET /api/profiles/me` | user | Trả đúng field đang select: `id, username, display_name, avatar_url, cover_url, gender, birthday, spotify_url, bio, created_at, badges, comments_count, library_count, reviews_count` (không trả email) |
| | 87 | `from('profiles').upsert({id, display_name, avatar_url})` | **Bỏ** — server tự tạo profile trong signup/OAuth callback (`handle_new_user`) | — | Nếu giữ route thì chỉ `POST /api/profiles/bootstrap` nội bộ; client không tự set `id` |
| | 131 | `auth.getSession()` | `GET /api/auth/me` | user | Trả `{ user, profile }`; 401 nếu cookie hết hạn |
| | 145 | `auth.onAuthStateChange(...)` | **Không map REST** — thay bằng state từ `/api/auth/me` + WS `session:revoked` (tuỳ chọn) | — | Đăng xuất ở tab khác: dùng `BroadcastChannel` hoặc event WS |
| | 164 | `auth.signInWithOAuth({provider:'google'})` | `GET /api/auth/google/start` (302 → Google) | anon | Callback: `GET /api/auth/google/callback` (server-side, set cookie) |
| | 173 | `auth.signInWithPassword({email,password})` | `POST /api/auth/login` | anon | Rate-limit 10/15 phút/IP; trả lỗi thống nhất, không lộ user tồn tại |
| | 183 | `auth.signUp({email,password,options})` | `POST /api/auth/signup` | anon | Server tạo `users` + `profiles`; trả 409 nếu email tồn tại |
| | 215 | `from('profiles').upsert({id,...updates},{onConflict:'id'})` | `PATCH /api/profiles/me` | user | Whitelist field; cấm `badges`, counters, `id` |
| | 228 | `auth.updateUser({data:{full_name, avatar_url}})` | `PATCH /api/profiles/me` | user | Không có endpoint riêng; metadata Supabase biến mất |
| | 257 | `storage.from('avatars').upload(filePath,file,{upsert:true})` | `POST /api/uploads/avatars` (multipart) | user | Field: `file`; server tự đặt path `<uid>/avatar-<ts>.<ext>`; ≤2MB, image/* |
| | 265 | `storage.from('avatars').getPublicUrl(filePath)` | URL trong response upload (hoặc `GET /uploads/avatars/<uid>/<file>`) | anon | Trả `{ url }` |
| | 290 | `storage.from('covers').upload(...)` | `POST /api/uploads/covers` | user | ≤5MB, image/*; path `<uid>/cover-<ts>.<ext>` |
| | 298 | `storage.from('covers').getPublicUrl(...)` | URL trong response upload | anon | Trả `{ url }` |
| | 318 | `auth.signOut()` | `POST /api/auth/logout` | user | Revoke `sessions`, xoá cookie |
| `src/pages/AuthCallback.tsx` | 12 | `auth.getSession()` | `GET /api/auth/me` rồi redirect | anon→user | Nếu OAuth xử lý server-side thì page này chỉ còn đọc `/me` và điều hướng |
| `src/components/AddToLibraryButton.tsx` | 83 | `from('user_library').select('status').eq(user_id).eq(anime_id)` | `GET /api/library/:animeId` | user | Trả `{ status }` hoặc 404 (thay `maybeSingle`) |
| | 112 | `from('user_library').upsert(payload,{onConflict:'user_id,anime_id'})` | `PUT /api/library/:animeId` | user | Body: `status, anime_title, anime_cover, anime_episodes`; server bỏ `user_id` client gửi |
| | 155 | `from('user_library').delete().eq(user_id).eq(anime_id)` | `DELETE /api/library/:animeId` | user | 204 |
| `src/hooks/useLibraryMutation.ts` | 34 | `select('*').eq(user_id).eq(anime_id).maybeSingle()` | `GET /api/library/:animeId` | user | 404 = null (không lỗi) |
| | 61 | `select('*').eq(user_id).order(updated_at desc)` | `GET /api/library` | user | Sort `updated_at desc` mặc định |
| | 94 | `upsert(payload).select().single()` | `PUT /api/library/:animeId` | user | Trả **full row** sau upsert (optimistic update cần) |
| | 142 | `delete().eq(user_id).eq(anime_id)` | `DELETE /api/library/:animeId` | user | — |
| `src/pages/PersonalLibrary.tsx` | 499 | `select('*').eq(user_id).order(updated_at desc)` | `GET /api/library` | user | Toàn bộ entry của mình |
| | 533 | `update({...updates}).eq(id).eq(user_id)` | `PATCH /api/library/entries/:id` | user | Server kiểm `entries.user_id = req.user.id`; whitelist `status,current_episode,score,notes` |
| | 548 | `delete().eq(id).eq(user_id)` | `DELETE /api/library/entries/:id` | user | — |
| `src/hooks/useAnimeLike.ts` | 34 | `from('favorites').select('*',{count:'exact',head:true}).eq(anime_id)` | `GET /api/favorites/count?anime_id=` | anon | Trả `{ count }` — public, không lộ user |
| | 49 | `select('id').eq(user_id).eq(anime_id).maybeSingle()` | `GET /api/favorites/mine?anime_id=` | user | Trả `{ liked: boolean }` |
| | 76 | `upsert(rows,{onConflict:'user_id,anime_id',ignoreDuplicates:true})` | `POST /api/favorites/bulk` | user | Body `{ items:[{anime_id,anime_title,anime_cover}] }`; idempotent (bỏ qua trùng) |
| | 108 | `delete().eq(user_id).eq(anime_id)` | `DELETE /api/favorites/:animeId` | user | — |
| | 127 | `insert({user_id,anime_id,anime_title,anime_cover})` | `POST /api/favorites` | user | Server gán `user_id`; 409 nếu đã tồn tại (hoặc idempotent 200) |
| `src/pages/Profile.tsx` | 108 | `favorites.select(...).eq(user_id).order(created_at desc).limit(60)` | `GET /api/favorites?limit=60` | user | Trả `anime_id, anime_title, anime_cover, created_at` |
| | 114 | `user_library.select(...).eq(user_id).order(updated_at desc).limit(120)` | `GET /api/library?limit=120` | user | Trả field history như đang select |
| `src/components/RecommendedForYou.tsx` | 56 | `user_library.select('anime_id').eq(user_id).limit(50)` | `GET /api/library?fields=anime_id&limit=50` | user | Hoặc `GET /api/me/signals` gộp library+favorites |
| | 62 | `favorites.select('anime_id').eq(user_id).limit(50)` | `GET /api/favorites?fields=anime_id&limit=50` | user | — |
| | 83 | `anime_seasons.select('genres').in('anime_id', ids)` | `GET /api/anime/genres?ids=1,2,3` | anon | Dữ liệu cache công khai; trả `[{anime_id, genres[]}]` |
| `src/components/CommentSection.tsx` | 127 | `comments.select(...).eq(entity_type).eq(entity_id).order(created_at asc).limit(500)` | `GET /api/comments?entity_type=&entity_id=&limit=500` | anon | **Server phải tự lọc `is_deleted=0`** (xem §5); trả `id,user_id,entity_type,entity_id,parent_id,body,image_url,is_deleted,created_at` |
| | 148 | `profiles.select(...).in('id', userIds)` | `GET /api/profiles?ids=a,b,c` | anon | Chỉ field public: `id,display_name,avatar_url,username,created_at,badges,comments_count,library_count,reviews_count` |
| | 176 | `comment_vote_counts.select('comment_id,upvotes,downvotes').in(comment_id)` | **Gộp vào** `GET /api/comments` (`upvotes`,`downvotes`) | anon | Tránh N+1; nếu cần riêng: `GET /api/comments/counts?ids=` |
| | 188 | `comment_votes.select('comment_id,value').eq(user_id).in(comment_id)` | **Gộp vào** `GET /api/comments?include_my_vote=1` | user | Trả `my_vote: -1\|0\|1` |
| | 215 | `.channel('comments-'+entityType+'-'+entityId)` | **WS** room `comments:<entityType>:<entityId>` | user (subscribe) | Events: `comment:new`, `comment:update`, `comment:delete`, `comment:vote` |
| | 263 | `storage.from('comment-images').upload(...)` | `POST /api/uploads/comment-images` | user | ≤5MB, image/*; path `<uid>/...` |
| | 275 | `getPublicUrl(path)` | URL trong response upload | anon | — |
| | 278 | `comments.insert({entity_type,entity_id,parent_id,body,image_url})` | `POST /api/comments` | user | Server gán `user_id`; validate body 1..2000; trả row |
| | 310 | `comments.delete().eq(id).eq(user_id)` | `DELETE /api/comments/:id` | user (own) / mod | Soft delete `is_deleted=1`; mod xoá được của người khác |
| | 344 | `comment_votes.delete().eq(comment_id).eq(user_id)` | `DELETE /api/comments/:id/vote` | user | Toggle off |
| | 350 | `comment_votes.upsert({...},{onConflict:'comment_id,user_id'})` | `PUT /api/comments/:id/vote` | user | Body `{value: 1\|-1}`; trả aggregate mới |
| `src/components/QuestsPanel.tsx` | 45 | `quests.select('*').eq(is_active,true).order(category)` | `GET /api/quests` | anon | Public |
| | 46 | `user_quest_progress.select(...).eq(user_id)` | `GET /api/quests/progress` | user | Hoặc `GET /api/quests?with_progress=1`; **không có route ghi** (service/hook) |
| `src/components/SuggestEditModal.tsx` | 53 | `anime_edit_suggestions.insert({user_id,anime_id,field,content_before,content_after,reason})` | `POST /api/edit-suggestions` | user | Server gán `user_id`; auto-approve nếu badge trusted (thay trigger) |
| `src/pages/AdminDashboard.tsx` | 61 | `anime_edit_suggestions.select('*').eq(status,'pending').order(created_at).limit(100)` | `GET /api/admin/edit-suggestions?status=pending` | mod | RLS hiện là guard duy nhất (xem §5) |
| | 84 | `rpc(action==='approve'?'approve_edit':'reject_edit',{suggestion_id,note})` | `POST /api/admin/edit-suggestions/:id/approve` / `/reject` | mod | Body `{note}`; ghi `audit_logs`; trả 403 nếu không mod |
| `src/components/AdminPasswordGate.tsx` | 95 | `rpc('verify_admin_password',{candidate})` | `POST /api/admin/verify-password` | mod | Body `{candidate}` → `{ok:boolean}`; rate-limit 5/phút/user; audit success/fail; so sánh scrypt |
| | 127 | `rpc('rotate_admin_password')` | `POST /api/admin/rotate-password` | owner/admin | Trả `{password}` **một lần**; audit actor; (cron dùng `GET` cùng path + `CRON_SECRET`) |
| `src/pages/CollectionsPage.tsx` | 46 | `collections.select('*').limit(50)` + `.eq(is_public,true)` hoặc `.eq(user_id)` | `GET /api/collections?scope=public\|mine&limit=50` | anon / user | Server enforce `is_public OR owner`; không tin query param để lọc quyền |
| | 63 | `collection_likes.select('collection_id').eq(user_id)` | `GET /api/collection-likes/mine` | user | Trả mảng id đã like |
| | 74 | `collections.insert({user_id,title,is_public:true}).select().single()` | `POST /api/collections` | user | Server gán `user_id`; `is_public` default **1** |
| | 97 | `collection_likes.delete().eq(collection_id).eq(user_id)` | `DELETE /api/collections/:id/like` | user | — |
| | 99 | `collection_likes.insert({collection_id,user_id})` | `POST /api/collections/:id/like` | user | UNIQUE(collection_id,user_id) → idempotent |
| `src/pages/ActivityFeed.tsx` | 63 | `activity_feed_enriched.select('*').order(created_at desc).limit(PAGE_SIZE)` + cursor `lt(created_at)` | `GET /api/activity?limit=20&cursor=<ISO>` | anon | View đã có `WHERE is_public=1`; server giữ điều kiện này |
| | 89 | `.channel('activity_feed_live')` + postgres_changes INSERT filter `is_public=eq.true` | **WS** room `activity` | user (subscribe) | Event `activity:new` — payload chỉ dữ liệu public |
| `src/providers/NotificationsProvider.tsx` | 62 | `notifications.select('*').eq(user_id).order(created_at desc).limit(30)` | `GET /api/notifications?limit=30` | user | Scope theo token, không theo query |
| | 87 | `.channel('notifications-'+user.id)` + `event:'*'` filter `user_id` | **WS** room `user:<id>` | user | Events `notification:new`, `notification:read`, `notification:deleted` |
| | 110 | `notifications.update({read_at}).eq(id).eq(user_id)` | `POST /api/notifications/:id/read` | user | — |
| | 124 | `notifications.update({read_at}).eq(user_id).is('read_at',null)` | `POST /api/notifications/read-all` | user | Trả `{updated:n}` |
| | 136 | `notifications.delete().eq(id).eq(user_id)` | `DELETE /api/notifications/:id` | user | — |

**Tổng hợp:** map ra **54 endpoint REST mới** + **1 WS endpoint** `/ws` với **3 room/event set**. Trong đó 6 endpoint chỉ phục vụ `collection_items`/collection detail (chưa có UI), phần còn lại bám trực tiếp các call site ở §1.


## 2. Realtime — 3 channel → WS event

| Channel hiện tại | File:line | Room backend | Event | Payload tối thiểu | Ai subscribe |
|---|---|---|---|---|---|
| `comments-<entityType>-<entityId>` | `CommentSection.tsx:215` | `comments:<entityType>:<entityId>` | `comment:new`, `comment:update`, `comment:delete`, `comment:vote` | `{id, entity_type, entity_id, parent_id, body, image_url, user_id, created_at, upvotes, downvotes}` | mọi user đang mở entity |
| `notifications-<userId>` | `NotificationsProvider.tsx:87` | `user:<userId>` | `notification:new`, `notification:read`, `notification:deleted` | `{id, kind, anime_id, anime_title, episode, body, link, read_at, created_at}` | chính user đó |
| `activity_feed_live` | `ActivityFeed.tsx:89` | `activity` | `activity:new` | row `activity_feed_enriched` (is_public) | mọi user |

Ghi chú: WS auth bằng JWT cookie lúc handshake; broadcast **sau commit**, không broadcast khi rollback; room `user:<id>` chỉ server join hộ theo token, client không tự chọn room người khác.

## 3. Storage — 3 bucket

| Bucket | File:line | Endpoint | Auth | Giới hạn / path |
|---|---|---|---|---|
| `avatars` | `AuthProvider.tsx:257,265` | `POST /api/uploads/avatars` → `{url}` | user | image/*, ≤2MB, `<uid>/avatar-<ts>.<ext>` |
| `covers` | `AuthProvider.tsx:290,298` | `POST /api/uploads/covers` → `{url}` | user | image/*, ≤5MB, `<uid>/cover-<ts>.<ext>` |
| `comment-images` | `CommentSection.tsx:263,275` | `POST /api/uploads/comment-images` → `{url}` | user | image/*, ≤5MB, `<uid>/<ts>.<ext>` |

Public read: cả 3 bucket đang public (policy `read using bucket_id=...`). Backend giữ `GET /uploads/<bucket>/*` công khai, chặn `../` và path ngoài `<uid>` khi ghi/xoá.

## 4. Nơi frontend đang dựa vào RLS (backend phải tự lọc)

Đây là các query **không tự lọc đủ** — nếu backend chỉ dịch 1-1 sẽ lộ dữ liệu hoặc thiếu quyền:

| # | File:line | Query | RLS đang che điều gì | Backend phải làm |
|---:|---|---|---|---|
| 1 | `AdminDashboard.tsx:61` | `anime_edit_suggestions` — chỉ `eq(status)`, **không lọc role** | `edit_suggestions_read_mod` (chỉ mod thấy toàn bộ) | `requireRole('mod')` ở route; nếu không, user thường đọc được mọi suggestion |
| 2 | `CommentSection.tsx:127` | `comments` — lọc theo entity, **không lọc `is_deleted`** | Không có filter nào ở RLS; app tự ẩn | Server trả `is_deleted` và/hoặc mặc định `WHERE is_deleted=0` |
| 3 | `CommentSection.tsx:148` | `profiles.in('id', ids)` | `profiles_read_all` | Chỉ trả field public; **không** email/password_hash |
| 4 | `CollectionsPage.tsx:46` | `collections` — tab public thêm `is_public=true`, tab mine thêm `user_id` | `collections_read` = public OR owner | Server enforce theo token; `scope=public` không được trả collection private |
| 5 | `NotificationsProvider.tsx:62` | `notifications` — `eq(user_id)` lấy từ client | `notifications_select_own` | Scope theo `req.user.id`; bỏ `user_id` khỏi query param nếu có |
| 6 | `useAnimeLike.ts:34` | `favorites` count theo anime, **không user** | `favorites_read_all` | Public count OK, nhưng không trả danh sách user |
| 7 | `QuestsPanel.tsx:46` | `user_quest_progress` — `eq(user_id)` client | `user_quest_progress_self` (ALL) | Chỉ SELECT của mình; **không mở route ghi** |
| 8 | `ActivityFeed.tsx:63` | `activity_feed_enriched` | View không áp RLS; đã có `WHERE is_public=1` trong view | Giữ `is_public=1`, không thêm cột nhạy cảm |
| 9 | `CommentSection.tsx:176` | `comment_vote_counts` | View aggregate, không RLS | Public OK; không lộ `user_id` của vote |
| 10 | `PersonalLibrary.tsx:533,548` | `update/delete .eq(user_id)` từ client | `library_update_own/delete_own` | WHERE `user_id = req.user.id`, không tin body |
| 11 | `AuthProvider.tsx:87` | `profiles.upsert({id: user.id})` | `profiles_insert_own` | Bỏ hẳn; server tạo profile trong auth callback |
| 12 | `CollectionsPage.tsx:74` | `collections.insert({user_id, is_public:true})` | `collections_insert_own` | Server gán `user_id`; `is_public` default 1 |
| 13 | `AddToLibraryButton.tsx:112`, `useLibraryMutation.ts:94` | `user_library.upsert({user_id})` | `library_insert_own/update_own` | Server gán `user_id`, validate `status` enum |

## 5. Coverage 24 bảng + 2 view (frontend chạm tới đâu)

| Bảng/View | Frontend gọi trực tiếp | Đường khác | Phase |
|---|---|---|---|
| `profiles` | ✅ AuthProvider, CommentSection | — | 1a |
| `favorites` | ✅ useAnimeLike, Profile, RecommendedForYou | — | 1a |
| `user_library` | ✅ AddToLibraryButton, useLibraryMutation, PersonalLibrary, Profile, RecommendedForYou | — | 1a |
| `comments` | ✅ CommentSection | — | 1a |
| `comment_votes` | ✅ CommentSection | — | 1a |
| `collections` | ✅ CollectionsPage | — | 1a |
| `collection_likes` | ✅ CollectionsPage | — | 1a |
| `collection_items` | ❌ không có call nào | Cần route cho trang chi tiết collection (chưa tồn tại) | 1a (API) |
| `anime_seasons` | ✅ RecommendedForYou (genres) | server cache | 1b |
| `notifications` | ✅ NotificationsProvider | — | 1b |
| `quests` | ✅ QuestsPanel | — | 1b |
| `user_quest_progress` | ✅ QuestsPanel (read-only) | service/hook ghi | 1b |
| `activity_feed` | ❌ chỉ qua view + WS filter | hook/service ghi | 1b |
| `activity_feed_enriched` (view) | ✅ ActivityFeed | — | 1b |
| `anime_like_counts` (view) | ❌ | — | hoãn |
| `anime_reaction_counts` (view) | ❌ | — | hoãn |
| `user_library_stats` (view) | ❌ (PersonalLibrary tự tính trong JS) | — | 1b (nếu cần) |
| `comment_vote_counts` (view) | ✅ CommentSection | — | 1b |
| `anime_edit_suggestions` | ✅ SuggestEditModal, AdminDashboard | — | 1b |
| `audit_logs` | ❌ (chỉ hiển thị trong text/comment) | service ghi | 1b |
| `anime_schedule` | ❌ | `GET /api/schedule` hiện có | 1b |
| `anime_recommendations` | ❌ | — | 1b |
| `anime_reactions` | ❌ | — | 1b |
| `anime_reviews` | ❌ | — | 1b |
| `mal_sync_jobs` | ❌ | — | 1b |
| `translation_cache` | ❌ | `POST /api/translate` hiện có | 1b |
| `compare_history` | ❌ | — | 1b |
| `admin_passwords` | ❌ (qua RPC) | admin service | 1b |
| `system_secrets` | ❌ | internal | 1b |

## 6. Endpoint còn thiếu so với Phase 1a (8 bảng lõi)

Phase 1a = `profiles, favorites, user_library, comments, comment_votes, collections, collection_items, collection_likes`. Các endpoint **đã có trong map** nhưng **chưa có call nào từ frontend** (dev phải làm để 1a đủ bề mặt):

| Endpoint | Bảng | Vì sao cần dù frontend chưa gọi |
|---|---|---|
| `GET /api/collections/:id` | `collections` | Trang chi tiết collection (`/collections/:slug` có link trong `CollectionsPage.tsx:275,294` nhưng **chưa có page/route**) |
| `GET /api/collections/:id/items` | `collection_items` | Hiển thị anime trong collection |
| `POST /api/collections/:id/items` | `collection_items` | Thêm anime vào collection (chưa có UI) |
| `PATCH /api/collections/:id/items/:itemId` | `collection_items` | Sửa note/order |
| `DELETE /api/collections/:id/items/:itemId` | `collection_items` | Xoá khỏi collection |
| `GET /api/collections/:id/like` | `collection_likes` | Trạng thái like của user hiện tại (frontend đang tự suy từ `GET /api/collection-likes/mine`) |
| `PATCH /api/profiles/me` (đã có trong map) | `profiles` | Frontend gọi qua `upsert`; endpoint mới phải whitelist field |
| `POST /api/favorites/bulk` (đã có trong map) | `favorites` | Sync local favorites khi đăng nhập (`useAnimeLike.ts:76`) |

**Phần 1b (endpoint thuộc 1b, dev không làm ở 1a):** `GET /api/anime/genres` (`anime_seasons`), `GET/POST/PATCH/DELETE /api/notifications*`, `GET /api/quests` + `/api/quests/progress`, `GET /api/activity` + WS `activity`, `GET /api/admin/edit-suggestions` + approve/reject, `POST /api/admin/verify-password` + `/rotate-password`, `POST /api/edit-suggestions`, `POST /api/uploads/*` (storage Phase 2).

## 7. Việc Phase 3 phải sửa (đối chiếu nhanh)

- 17 file trong bảng §1: bỏ `supabase` import, thay bằng `apiV2` + `useAuthV2`/`useRealtime`.
- `src/lib/supabase.ts` xoá hẳn; `@supabase/supabase-js` xoá khỏi `package.json`.
- `AuthCallback.tsx` đổi sang `/api/auth/me` (OAuth callback server-side).
- 3 realtime channel → subscribe WS room tương ứng; bỏ polling 60s ở `NotificationsProvider.tsx:96` khi WS ổn định.
- `sessionStorage` admin gate (`AdminPasswordGate.tsx:100`) giữ nguyên nhưng giá trị chỉ có nghĩa UI; quyền thật do `POST /api/admin/*` kiểm.

## 8. Chưa verify

- Chưa chạy frontend để xác nhận từng call site có đúng là đường duy nhất (một số component có thể có fallback local, vd favorites khi chưa đăng nhập).
- Chưa có UI cho `collection_items`, `compare_history`, `mal_sync_jobs`, `anime_reviews`, `anime_reactions` → endpoint tương ứng có thể hoãn tới khi có màn hình.
- Số "18 file" trong yêu cầu không khớp thực tế: `grep -rln supabase src/` = **17**. `src/index.css:440` chỉ nhắc trong comment, không phải call site.
