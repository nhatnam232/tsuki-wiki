# PHASES — Bỏ Supabase, thay bằng `server-v2` (Node + SQLite WAL + JWT cookie + Google OAuth + WebSocket)

> Nguồn sự thật: `supabase/setup_all.sql` (1266 dòng) → đã map đầy đủ trong [`AUTHZ-MATRIX.md`](./AUTHZ-MATRIX.md) (73 policy / 22 function / 20 trigger / 24 bảng / 5 view / 3 bucket).
> Trạng thái scaffold: `server-v2/` (untracked) đã có `package.json`, `db/schema.sql` **661 dòng** = **24 bảng + 5 view + 6 quest seed + `users`/`sessions`/`_migrations`**, **0 trigger**; auth core đang làm ở task-6.
> Mọi estimate là **ngày công của 1 dev quen repo**.
> **Zero new dependency ở Phase 0–1** (chốt với Lead): dùng `node:crypto` (scrypt + HMAC-SHA256 JWT), `better-sqlite3`, `express`, `node --test`. Rate-limit chạy in-memory. Không cài `argon2`/`bcrypt`/`jose`/`google-auth-library`/`express-rate-limit`/`csrf-csrf`/`zod`. Phase 2 có thể cần `ws` (server WS) — **xin duyệt riêng**, không thuộc zero-dep P0–P1.

> **Runtime production = Ptero `nodejs_20` (không phải 22).** Hệ quả: KHÔNG dùng module `node:sqlite` (chỉ có từ Node 22); dùng `better-sqlite3` prebuilt (kiểm ABI bằng `npm rebuild better-sqlite3` nếu panel build khác arch). **Đã khớp:** dev hạ `engines >=20.0.0` + esbuild `--target=node20` (bundle deploy 09:48:58, live `node v20.20.2`, `better-sqlite3` load OK) ⇒ hết lệch runtime; `fetch` (Node 18+) và `node --test` (Node 18+) có sẵn; WebSocket **client** toàn cục chỉ có từ Node 21/22 → Phase 2 dùng package `ws` hoặc `--experimental-websocket`.

## Mốc commit (local, chưa push)

| Commit | Nội dung |
|---|---|
| `c9f89cb` | feat(server-v2): self-hosted Node+SQLite backend, migrate data off Supabase |
| `970b911` | chore(lint): clear no-unused-vars/no-empty errors, fix cancelled flag |
| `edc3d8d` | fix(admin): remove forgeable cron auth bypass |
| `8c673f8` | feat(web): typed client cho server-v2 backend (`src/lib/backend.ts`, 407 dòng) |
| `15097d6` | fix(admin): gate rotate-password trước transaction; target node20; thêm `CUTOVER.md`, `007_mal_attempts.sql`, `services/malWorker.ts` |
| `d188f0e` | feat(server-v2): notifications, MAL worker, cloudflare gate, snake_case aliases |
| `56c3798` | fix(security): gate origin by socket IP, cap rate-limit map, lock health/deep |
| `69a6573` | fix(security): derive client IP from socket/cf-connecting-ip, never XFF (G9 fix, test 101/101) |
| `38e787f` | fix(security): fail-closed proxy allowlist, log real client IP (G9 mitigated, test 101/101) |
| `ac2cf39` | feat(deploy): run cloudflared inside container, bind app to loopback (G9 hardening done) |
| `f430123` | fix(deploy): default to loopback with a tunnel, supervise cloudflared |
| `e7c8930` | feat(api): media upload, favorites count, single library entry |
| `2cd3138` | feat(web): drop supabase-js from auth layer, use backend client |
| `8fd61a6` | feat(web): migrate likes, library button, quests and notifications to the API (G4 đang chạy) |

`main` **ahead `origin/main` 14 commit**, chưa push (mới nhất `8fd61a6`). Tại thời điểm planner kiểm 11:30: `git status` **sạch**; `server-v2` `npm test` **101/101 pass**, `check`=0; root `check`/`lint`/`build`=0.

## Tổng quan

| Phase | Nội dung | Ngày công | Phụ thuộc | Gate |
|---|---|---:|---|---|
| **0** | Scaffold + DB WAL + auth core (email/password + Google OAuth, JWT cookie) | **5–7** | — | `npm run check` + `npm test` xanh, 4 luồng auth chạy thật |
| **1** | 24 bảng API + authorization (73 policy) + trigger/hook + admin/cron | **15–20** | Phase 0 | Ma trận quyền 73 dòng có test allow/deny |
| **2** | Storage 3 bucket + WebSocket realtime | **4–6** | Phase 1 (service layer ổn định) | Cross-user upload bị 403; WS từ chối JWT sai |
| **3** | Migrate dữ liệu Supabase → SQLite + cutover frontend 18 file + gỡ Supabase khỏi `server/` | **4–7** | Phase 2 | Row count khớp 100%, `grep @supabase|supabase src/ server/` = 0, rollback đã thử |
| | **Tổng** | **28–40** | | |

Đường găng: Phase 0 → Phase 1 → Phase 3. Phase 2 song song được với nửa sau Phase 1 nếu dev thứ 2.

> **Nếu cần rút ngắn:** cắt Phase 1 thành 1a = 12 bảng lõi (profiles, favorites, comments, user_library, anime_reactions, anime_reviews, collections, collection_items, collection_likes, notifications, quests, user_quest_progress) + Phase 1b = 12 bảng còn lại. Cách này giữ được mốc ~22–26 ngày nhưng frontend cutover phải chờ 1b.

### P0 deploy — TLS đã xong (09:49), còn 2 nợ hạ tầng

**Trạng thái: RESOLVED.** `https://api.animewiki.eu.cc/api/health` → **200** `{"success":true,"message":"ok","db":true}`; HSTS có trên HTTPS; login set cookie `HttpOnly; Secure; SameSite=Lax`, refresh `Path=/api/auth`; WSS `wss://api.animewiki.eu.cc/api/ws` hoạt động. Kiến trúc: `cloudflared` chạy trên **host DSH** (systemd `cloudflared-animewiki`, tunnel `animewiki-api`) → origin `http://103.69.75.49:25200`; env `COOKIE_SECURE=true` (đã bỏ `COOKIE_SECURE=false`), `TRUST_PROXY=1`. `auth/cookies.ts:35` bật `Secure` mặc định ⇒ **một trong hai** tình huống xấu: (a) browser bỏ cookie → auth hỏng; (b) đặt `COOKIE_SECURE=false` → token đi clear-text. **Gate cứng: phải có domain + TLS trước khi cho user thật**; chỉ test cookie trên `https://` hoặc `localhost`. Khi chưa có TLS, giới hạn ở mạng nội bộ và ghi rõ trong runbook.

### P0 hotfix độc lập migration — `user_library_stats` có thể đang lộ dữ liệu (CHƯA VERIFY)

View Postgres **không tự áp RLS** của bảng nền, và Supabase grant mặc định cho `anon` trên object mới trong schema `public`. Suy luận: `GET /rest/v1/user_library_stats?select=*` bằng anon key có thể trả thống kê của **mọi user**. Chưa kiểm được vì không có Supabase live.

```bash
# chỉ đọc, không in key
curl -s "$VITE_SUPABASE_URL/rest/v1/user_library_stats?select=*&limit=5" -H "apikey: $VITE_SUPABASE_ANON_KEY"
# rỗng/401 = an toàn; có row = ĐANG LỘ
```

Vá (cần sir duyệt trước khi chạy trên production): `revoke all on public.user_library_stats from anon, authenticated;` hoặc tạo lại view với `security_invoker = true` (PG15+). Việc này độc lập với migration, có thể làm ngay.

### Quy ước đếm file & trạng thái repo (dùng chung cho mọi task)

```bash
cd /tmp/opencode/work/tsuki-wiki
git diff --name-only | wc -l     # 13  ← con số chuẩn "13 file modified"
git status --short | grep -c '^ M'   # 13  ← tương đương
git status --short | wc -l       # 15  ← KHÔNG dùng: 13 M + ?? docs/ + ?? server-v2/
```

`docs/` (tài liệu migration) và `server-v2/` (backend mới) là thư mục **untracked hợp lệ**. Không thêm chúng vào `.gitignore` (che mất deliverable); không commit trong phạm vi audit.

> Lưu ý lint: `npm run lint` ở root chạy `eslint .` với `ignores: ['dist']` nên **quét cả `server-v2/dist/server.cjs`** (artifact của dev) → số warning tăng 37 → 40. Khi verify baseline, dùng `npx eslint src server api` hoặc thêm `server-v2/dist` vào ignore (cần sửa `eslint.config.js` — ngoài phạm vi planner).

---

## Phase 0 — Scaffold + DB + Auth core

> Nếu muốn 2 gate nhỏ hơn: tách **0a** = scaffold + db + schema + middleware (gate: check/test xanh, WAL) và **0b** = auth + admin auth (gate: 4 luồng auth + cron 200/401). Hiện giữ 1 phase để khớp task-6 đang chạy.

**Mục tiêu:** `server-v2` boot được, SQLite ở WAL, có 3 cách vào hệ thống (email/password, Google OAuth, refresh) và middleware quyền cơ bản.

### Deliverables
1. `server-v2/index.ts` + `app.ts`: Express 4, `helmet`, `cors` whitelist, `express.json({limit})`, error handler thống nhất `{ success, error }`, `GET /api/health`.
2. `db/index.ts`: better-sqlite3 + `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`; migration runner idempotent ghi `_migrations`.
3. `db/schema.sql`: giữ 24 bảng + 5 view hiện có; **chỉ thêm** `users.password_hash TEXT` (`users.email_verified` **đã có** ở dòng 72); `sessions` đã có + index. Sửa comment `schema.sql:548` từ `bcrypt` → `scrypt` cho khớp quyết định zero-dep (**dev sửa**, planner không đụng code).
4. Auth:
   - `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`.
   - `GET /api/auth/google/start` + `GET /api/auth/google/callback` (OAuth 2.0 code flow, `state` chống CSRF, verify `id_token`).
   - Access JWT 15 phút + refresh/session token 30 ngày, **cả hai trong cookie HttpOnly; Secure; SameSite=Lax**; access `Path=/`, refresh **`Path=/api/auth`** (đủ cho `/refresh` và `/logout`; nếu để mặc định `/api/auth/refresh` thì logout không nhận được refresh cookie ⇒ access hết hạn là không revoke được session — đúng như ghi chú `auth/session.ts:22-28`); refresh rotation + `sessions.revoked_at`.
   - Hash password: **`crypto.scrypt`** (N=16384, r=8, p=1, salt 16B ngẫu nhiên, key 64B, lưu `scrypt$N$r$p$salt$hash`); so sánh `timingSafeEqual`; không log plaintext; password policy tối thiểu 8 ký tự.
   - **2 ngưỡng khác nhau cho 2 endpoint khác nhau**: login/signup = **10 request/15 phút/IP** (+ khoá tạm sau 5 lần sai); `verify-password` = **5 lần/phút/user** (brute-force tính theo tài khoản, IP dễ đổi).
   - CSRF double-submit cho mọi route ghi dùng cookie.
5. Middleware: `requireUser`, `requireRole('mod')` = **mod-or-above**: `badges ∩ {mod, admin, owner} ≠ ∅` (tương đương `is_mod_or_above`, `AUTHZ-MATRIX.md` §1 / nguồn `setup_all.sql:630`). **Không exact-match** — nếu chỉ so `=== 'mod'` thì owner/admin bị 403 và tự khoá khỏi cổng admin. Đọc `profiles.badges`, cache 30–60s; `rateLimit`.
6. `scripts/bootstrap-owner.ts`: gán badge `owner` theo email (thay `bootstrap_owner()`).
7. **Admin auth tối thiểu (matrix §5 xếp P0) — NƠI DUY NHẤT implement**: `GET` + `POST /api/admin/rotate-password` nhận `x-cron-secret` hoặc `Authorization: Bearer $CRON_SECRET` (tuyệt đối không nhận `x-vercel-cron-signature`); `POST /api/admin/verify-password` **bắt buộc guard `requireRole('mod')`** = mod-or-above (`badges ∩ {mod, admin, owner} ≠ ∅`, tương đương `is_mod_or_above` — `setup_all.sql:1234`, `AUTHZ-MATRIX.md` §1) — + **rate-limit 5 lần/phút/user** (thống nhất với #4) + audit success/fail (nếu thiếu guard sẽ thành endpoint brute-force mật khẩu admin công khai); `CRON_SECRET`: env **≥32 ký tự**, DB fallback **≥32** (`services/cronSecret.ts:10-19`; dev đã nâng env từ 16 → 32 lúc 09:31). **Route operator: `GET /api/admin/cron-secret` — chỉ badge `owner`** (hierarchical owner-only, tương đương `get_or_create_cron_secret()` bản Supabase vốn revoke anon/authenticated) trả secret hiện tại; mod/admin → 403, anon → 401. **rotate-password GIỮ trả plaintext** nhưng chỉ khi caller đã auth **và request qua HTTPS**; bắt buộc **rate-limit 10 lần/phút/IP** (`ADMIN_ROTATE_MAX=10`, áp cho cả GET+POST — Lead chốt giữ 10) + ghi `audit_logs`; **gate TLS/webhook phải chạy trước transaction rotate**; tuyệt đối không log/cache plaintext. Nếu có `ADMIN_PASSWORD_WEBHOOK`: gửi Discord và response **chỉ trả `{rotated:true, webhook_sent:true}`** (không kèm plaintext); webhook fail → 5xx, không trả plaintext. Tradeoff: trả plaintext chỉ chấp nhận được khi TLS + caller đã auth; nếu chưa có TLS thì coi như blocked (xem mục P0 deploy). Phase 1 chỉ mở rộng test deny/audit, **không làm lại endpoint**.
8. Test: `test/auth.test.ts` (signup/login/refresh/logout/401/403), `test/db.test.ts` (WAL, migration chạy 2 lần không đổi, `isForeignKeysEnabled`), `test/admin.test.ts` (rotate/verify 200/401). **Chạy mỗi file 1 process** (`tsx --test --test-isolation=process test/*.test.ts` hoặc loop từng file) vì `jwt.ts` cache secret + DB singleton + `MEDIA_DIR` dùng chung: chạy cả 9 file trong 1 process hiện fail 2 test `routes-core` (68/70) nhưng 8/8 pass khi chạy riêng — lỗi do shared state, không phải logic. Tách `test/` (Phase 0) và `test/phase1a/` (routes-core/routes-extras) + script npm riêng để gate Phase 0 không bị nhiễu scope 1a.

### Acceptance criteria
- [ ] `cd server-v2 && npm run check` → exit 0; `npm test` (chạy **từng file 1 process**) → exit 0 **hai lần liên tiếp** (chống flaky). Hiện trạng 09:44 (planner tự chạy): script test là **loop từng file, mỗi file 1 process** — `for f in test/*.test.ts; do npx tsx --test "$f" || exit 1; done` (`server-v2/package.json:14`, **không dùng flag `--test-isolation`**); `npm test` **2 lần liên tiếp đều exit 0**, `npm run check` = 0 ⇒ **G1 PASS**. Lần fail 09:40 là do cây đang được dev ghi (số file test đổi giữa 2 lần chạy), không kết luận flaky.
- [ ] `sqlite3 data/app.db "PRAGMA journal_mode;"` → `wal`. **KHÔNG** kiểm `foreign_keys` bằng sqlite3 CLI (pragma là per-connection, CLI mở connection mới → luôn `0`; đã thử: `sqlite3 /tmp/x.db "PRAGMA foreign_keys;"` → `0`). Kiểm bằng `isForeignKeysEnabled(db)` trong `npm test`.
- [ ] Chạy migration 2 lần: `select count(*) from _migrations` không đổi.
- [ ] Signup → login → `/api/auth/me` 200 → refresh → logout: sau logout, refresh cũ trả 401 và `sessions.revoked_at` đã set.
- [ ] Cookie có đủ `HttpOnly; Secure; SameSite=Lax`; refresh cookie `Path=/api/auth` (kiểm `curl -i`); logout khi access đã hết hạn vẫn revoke được session (nhờ refresh cookie tới `/api/auth/logout`).
- [ ] JWT sửa 1 ký tự → 401; JWT hết hạn → 401; request không cookie tới route protected → 401.
- [ ] Google OAuth: callback tạo user với `google_sub`, email trùng user cũ thì **link**, không tạo trùng; email đã có `password_hash` nhưng chưa verify → **409** (không cho chiếm tài khoản).
- [ ] `lib/time.ts` cấm `datetime('now')` + có test quét source; migration checksum chuẩn hoá bỏ comment (sửa comment không làm DB cũ throw).
- [ ] Không có plaintext password trong DB/log: `sqlite3 data/app.db "select password_hash from users"` → chuỗi hash, không phải mật khẩu.
- [ ] Admin: `GET`/`POST /api/admin/rotate-password` + secret đúng → 200; thiếu/sai → 401; `x-vercel-cron-signature` → 401.
- [ ] `GET /api/admin/cron-secret`: owner → 200; mod/admin (không owner) → 403; anon → 401; không log secret.
- [ ] `rotate-password` qua HTTPS + auth → 200; nếu `ADMIN_PASSWORD_WEBHOOK` set → response `{rotated:true, webhook_sent:true}` **không plaintext**; webhook fail → **502 `{rotated:true, webhook_sent:false}`** (plaintext đã mất vì DB chỉ lưu hash ⇒ phải rotate lại khi webhook hoạt động); **lần thứ 11 trong 1 phút/IP → 429** (`ADMIN_ROTATE_MAX=10`). Nếu không webhook: plaintext trả kèm `warning:'plaintext_over_tls_only'`, không log. **HTTP + không webhook → 409 `{rotated:false, tls_required_for_plaintext}` — gate TLS/webhook PHẢI check TRƯỚC transaction rotate** (nếu check sau sẽ xoay mật khẩu rồi vứt plaintext ⇒ khoá admin vĩnh viễn; code hiện đã đúng thứ tự ở `admin/routes.ts:60-68`).
- [ ] `docs/migration/AUTHZ-MATRIX.md` không bị sửa bởi phase này (trừ khi reviewer yêu cầu).

### Verify (chạy tay)
```bash
cd server-v2
npm run check && npx tsx --test --test-isolation=process test/*.test.ts   # tránh shared-state giả fail
sqlite3 data/app.db "PRAGMA journal_mode;"          # kỳ vọng wal
# foreign_keys: assert trong test qua isForeignKeysEnabled() — KHÔNG dùng sqlite3 CLI
PORT=3101 npm run dev &                       # dev server
curl -i -X POST localhost:3101/api/auth/signup -H 'content-type: application/json' \
  -d '{"email":"dev@example.com","password":"Test1234!"}' -c /tmp/cj.txt
curl -i localhost:3101/api/auth/me -b /tmp/cj.txt
curl -i -X POST localhost:3101/api/auth/logout -b /tmp/cj.txt
curl -i -X POST localhost:3101/api/auth/refresh -b /tmp/cj.txt   # phải 401
kill %1
```
> **Dependency: zero new deps ở Phase 0–1** — đã chốt với Lead. JWT = HMAC-SHA256 tự viết trên `node:crypto` (`base64url(header).base64url(payload).HMAC`), verify phải từ chối `alg` khác, so sánh chữ ký bằng `timingSafeEqual`. OAuth Google = `fetch` + verify id_token theo JWKS (cần cache JWKS, kiểm `aud`/`iss`/`exp`). Rate-limit = Map in-memory theo IP+user; **sweeper `setInterval(60s).unref()`** dọn bucket hết hạn, vẫn còn prune O(N) khi >50k key (`middleware/rateLimit.ts:30-56`). `TRUST_PROXY=1` chỉ bật khi reverse proxy tin cậy + allowlist IP, nếu bật bừa thì `X-Forwarded-For` giả làm limiter thành bypass/self-DoS. CSRF = double-submit cookie tự viết. Validation = viết tay (không zod).
> Phase 2 mới có thể cần thêm (`ws`, thư viện upload) — **xin duyệt riêng trước khi cài**.
> **Ngoại lệ zero-dep duy nhất (Lead đã duyệt): `bcryptjs`** — chỉ dùng để **verify hash legacy Supabase** (`$2a/$2b/$2y`) trong `crypto/password.ts:11,69-72`, sau đó **rehash sang scrypt**; không dùng cho hash mới. Có thể xoá dependency sau khi user legacy cuối cùng đăng nhập + rehash. **Không bắt user reset mật khẩu.**
> **`ws ^8.22.1` đã được duyệt riêng và GIỮ trong `server-v2/package.json` từ Phase 0** — cần cho Phase 2 (đã implement `ws/server.ts`); Phase 0/1 không import nhưng không cần gỡ. Đây không phải vi phạm zero-dep, chỉ là dependency được duyệt trước cho Phase 2.

### Rủi ro
- Tự viết JWT/HMAC + scrypt thay thư viện chuẩn → rủi ro bảo mật cao nếu sai (so sánh không constant-time, nhận `alg`, salt cố định, thiếu `exp`). Reviewer **bắt buộc** soi kỹ ở task-9; có test cho token sửa 1 byte / `alg:none` / hết hạn.
- SQLite + many writes → `SQLITE_BUSY`; WAL + `busy_timeout` + transaction ngắn là bắt buộc, test bằng 2 tiến trình ghi song song.
- Cookie `SameSite=Lax` + frontend khác domain (nếu tách) → cần `SameSite=None; Secure` + CORS credentials; chốt sớm.
- **Nợ hạ tầng TLS (đã hết blocked, còn 2 điểm):** (a) `cloudflared` chạy **ngoài container** trên host DSH ⇒ backend phụ thuộc host này; muốn tự chủ phải đưa vào container (task riêng); (b) origin `103.69.75.49:25200` **vẫn truy cập trực tiếp được** — với `TRUST_PROXY=1` có thể spoof `X-Forwarded-For`, chỉ ảnh hưởng rate-limit, không ảnh hưởng auth; khuyến nghị firewall chỉ cho IP Cloudflare hoặc bind localhost.

---

## Phase 1 — 24 bảng API + authorization + trigger/hook

**Mục tiêu:** toàn bộ nghiệp vụ Supabase chạy được trên Node, mỗi policy trong matrix có rule tương đương và **có test chứng minh**.

### Deliverables
1. **24 bảng** có route/service/repo: `profiles, favorites, comments, anime_seasons, anime_recommendations, user_library, anime_schedule, anime_reactions, anime_reviews, mal_sync_jobs, translation_cache, comment_votes, notifications, collections, collection_items, collection_likes, audit_logs, anime_edit_suggestions, compare_history, quests, user_quest_progress, activity_feed, admin_passwords, system_secrets`.
   - 2 bảng cuối **không có route** (internal only) — đúng policy `using (false)`.
2. **Authorization**: 73 policy → helper/repo đúng cột “Rule Node” trong matrix; `requireUser` + ownership `WHERE user_id = :uid`; `requireRole('mod')` cho 6 policy mod; `canReadCollection`/`canWriteCollection` (EXISTS join) cho `collection_items`.
3. **Trigger**: 14 trigger port từ Supabase (9 `touch_updated_at` + 5 counter — AUTHZ-MATRIX §6) **+ 11 trigger bổ sung cho Phase 0/1a = 25 trigger** (`db/migrations/004_triggers.sql` 209 dòng, test #69 xác nhận 25 trigger / 5 view, migration chạy 2 lần không throw).
4. **Node service/hook** thay **10 function P1 còn lại** (22 = 6 P0 [handle_new_user, is_mod_or_above, bootstrap_owner, rotate/verify/cron secret — **đã xong ở Phase 0 #7**] + 6 SQLite trigger + 10 P1): grant/revoke badge, auto-approve edit, approve/reject edit + audit, bump quest progress + badge award, quests hooks (library/comment), activity hooks (library/collection). **Không implement lại 3 hàm admin đã có ở Phase 0.**
5. **5 view** có endpoint chỉ đọc: `anime_like_counts`, `anime_reaction_counts`, `user_library_stats` (**lọc `user_id = :uid`**), `comment_vote_counts`, `activity_feed_enriched` (`is_public = 1`).
6. **Cron/admin hardening** (endpoint **đã có ở Phase 0 #7** — Phase 1 KHÔNG làm lại): thêm rate-limit cho rotate (miễn trừ request cron hợp lệ), audit đầy đủ actor/outcome, test deny: thiếu/sai secret → 401, `x-vercel-cron-signature` → 401, GET/POST đều đúng, verify-password thiếu `mod` → 403.
7. Validation + phân trang + error code thống nhất; audit_logs cho mọi hành động mod/admin. Rate-limit của verify-password **giữ đúng 5 lần/phút/user** như Phase 0 (không đổi số ở Phase 1).
8. **Translation service** thay `server/lib/translate.ts` (DeepL/LibreTranslate + `translation_cache`): cache key theo `(source_lang,target_lang,hash)`, timeout + fallback, rate limit; nếu thiếu API key thì trả nguyên văn. Đây là file Supabase thứ 2 còn sót trong `server/` (dùng `SUPABASE_SERVICE_ROLE_KEY` để ghi cache — phải bỏ).
9. **Notifications producer (job hằng ngày)**: nguồn Supabase **không có INSERT policy** cho `notifications` — chỉ service-role ghi. Phase 1 phải có job `new_episode` chạy hằng ngày (so lịch phát sóng → tạo notification cho user có anime trong library) + route đọc/đánh dấu `read_at`; ghi rõ ai được tạo. `audit_logs` cũng không có INSERT policy → chỉ service ghi, không mở route.
10. **MAL sync worker**: vòng `pending → processing → completed/failed` cho `mal_sync_jobs`, retry + backoff + timeout, chạy nền trong process (setInterval + claim bằng UPDATE ... WHERE status='pending', không thêm queue dependency); route chỉ tạo job + đọc trạng thái.
11. Test: `test/authz-matrix.test.ts` — **mỗi policy 1 case allow + 1 case deny** (tối thiểu 73 × 2 assertion), `test/counters.test.ts`, `test/hooks.test.ts`, `test/admin.test.ts`, `test/translate.test.ts`, `test/notifications.test.ts`.

### Acceptance criteria
- [ ] Ma trận 73 dòng: mỗi dòng có test allow/deny, pass 100% (`npm run test:authz`).
- [ ] Không route nào nhận `user_id`/`role`/`badges` từ body: `grep -rn "body.user_id\|body.role\|body.badges" src/` → rỗng.
- [ ] Không response nào chứa `password_hash`, `admin_passwords`, `system_secrets`: test snapshot + `grep`.
- [ ] Counter đúng sau insert/soft-delete/restore: thêm 3 comment → `comments_count = 3`; soft delete 1 → `2`; xoá hẳn → `2`.
- [ ] `updated_at` đổi sau UPDATE ở 9 bảng có trigger.
- [ ] `collections` private của user A: user B nhận 404/403 ở list/detail/items (không lộ tồn tại nếu là private).
- [ ] Mod xoá comment người khác được; user thường xoá comment người khác → 403.
- [ ] Cron GET `/api/admin/rotate-password` với secret đúng → 200; thiếu/sai → 401; **không** chấp nhận header `x-vercel-cron-signature` (chống tái phát bypass).
- [ ] `npm run check` + `npm test` exit 0.

### Verify
```bash
cd server-v2
npm run check && npm test
npm run test:authz 2>&1 | tail -20          # kỳ vọng: 146+ pass, 0 fail
sqlite3 data/app.db "select comments_count from profiles where id='<uid>';"
sqlite3 data/app.db "select count(*) from sqlite_master where type='trigger';"   # kỳ vọng 14
grep -rn "body.user_id\|body.role\|body.badges" src/ || echo "NO_CLIENT_OWNERSHIP"
grep -rn "admin_passwords\|system_secrets" src/routes/ || echo "NO_INTERNAL_ROUTES"
```

### Rủi ro
- 73 policy nhưng nhiều policy trùng logic (own/read-all) → gom helper, tránh copy-paste 73 lần; test vẫn phải đủ 73 case để không mất dấu.
- Trigger counter + soft delete dễ lệch khi update nhiều lần `is_deleted` → test toggle 2 chiều.
- Quest/activity hook chạy sau transaction: nếu hook fail, dữ liệu chính đã commit → ghi log + retry, không rollback user action.
- **[P0 → MITIGATED + hardening DONE 10:45, `f430123`] Bypass rate-limit qua XFF/origin:** cloudflared trong container; app tự bind `127.0.0.1` khi có `TUNNEL_TOKEN` (WARNING nếu không loopback), supervisor backoff 1s→30s/reset 60s, `TRUSTED_PROXIES=127.0.0.1`; origin **connection refused** từ ngoài, domain 200, XFF spoof → 429. Fragility IP ISP hết. **Còn nợ docs:** `.env.example` thiếu `HOST`/`TUNNEL_TOKEN` + comment `TRUSTED_PROXIES` còn IP host cũ (dev cập nhật). **Vantage:** tiêu chí `"success":true` count = 0 qua fetcher ngoài, không phải `grep untrusted_proxy`.
- **[P2] `/api/health/deep`** — đã đóng: trả **401** cả origin lẫn domain (verify 10:01); không còn lộ `dbFile/node/uptimeSec`.
- **[G10 ✅ PASS 11:25] Google OAuth production:** sir login Google thật; DB có user `kobitnx223@gmail.com` (provider=google, username=jades, badges=["admin"]), `last_login_at=2026-11-02T11:25:51.349Z`, 1 session tạo 11:25:51.355Z, `revoked_at=null`; `/api/auth/google/start` → **302** đúng (trước là 503). Không còn blocker/không còn là quyết định sản phẩm.

---

## Phase 2 — Storage 3 bucket + WebSocket realtime

### Deliverables
1. Storage service (local disk `data/uploads/<bucket>/<uid>/...` hoặc S3-compatible): `PUT/POST`, `GET` public, `DELETE`; guard `assertPathOwner` cho 11 policy storage; giới hạn MIME (jpg/png/webp/avif), size (avatars ≤ 2MB, comment-images ≤ 5MB, covers ≤ 5MB); đổi tên file an toàn; chống path traversal.
2. Signed URL cho file không public (nếu cần) + cache header.
3. WebSocket server (`ws`): auth bằng JWT cookie khi handshake, từ chối 401 nếu invalid; rooms: `comments:<entityType>:<entityId>`, `notifications:<userId>`, `activity`; broadcast sau khi transaction commit (không broadcast khi rollback).
4. Sự kiện: comment create/update/delete, reaction, notification, activity, admin rotate (không lộ nội dung).
5. Client SDK tối thiểu trong `src/` (chỉ khi Lead duyệt đụng frontend — Phase 3 mới cutover).

### Acceptance criteria
- [ ] User A upload vào `avatars/<A>/x.png` OK; vào `avatars/<B>/x.png` → 403; `../` path → 400.
- [ ] File > giới hạn hoặc MIME sai → 413/415, file không được ghi vào disk.
- [ ] WS không cookie → đóng 1008; JWT hết hạn → đóng; join room của người khác → 403.
- [ ] Comment mới broadcast đúng room, **không** tới room khác; đo latency local < 200ms.
- [ ] Transaction rollback → không có message nào được gửi.

### Verify
```bash
cd server-v2
node --test test/storage.test.ts test/ws.test.ts
curl -i -X POST localhost:3101/api/uploads/avatars -b /tmp/cjA.txt -F "file=@/tmp/a.png"   # 200
curl -i -X POST localhost:3101/api/uploads/avatars -b /tmp/cjB.txt -F "file=@/tmp/a.png"   # phải 403 khi path của A
node --test test/ws-client.test.ts    # dùng package `ws` (Phase 2 được duyệt riêng) — Node 20 không có WebSocket client toàn cục
```

---

## Phase 3 — Migrate dữ liệu + cutover frontend 18 file

### Deliverables
1. `scripts/migrate-supabase.mjs`: đọc Supabase **read-only** (service role, `--dry-run` mặc định), xuất JSON snapshot; import vào SQLite theo thứ tự FK; `--apply` mới ghi; idempotent (`UPSERT` theo PK).
2. Mapping kiểu: uuid→TEXT, timestamptz→ISO UTC, jsonb/text[]→JSON text, boolean→0/1; `auth.users` → `users` (giữ `id`, email; password Supabase không migrate được → user phải reset mật khẩu hoặc dùng Google).
3. Kiểm chứng: script so sánh `count(*)` từng bảng (Supabase vs SQLite), checksum 3 cột định danh, báo cáo lệch.
4. Cutover frontend: 18 file đang dùng `@supabase/supabase-js` → `src/lib/apiV2.ts` (fetch + credentials include) + `useAuthV2` + `useRealtime` (WS); route guard; xoá `@supabase/supabase-js` khỏi `package.json` khi xong.
5. **Gỡ Supabase phía server** (2 file còn lại): `server/lib/translate.ts`, `server/routes/admin.ts` (đã port ở Phase 1), `server/lib/`/`server/routes/` còn lại, `api/index.ts`, `scripts/prerender.ts`, `vercel.json` — quyết định xoá `server/`+`api/` hay trỏ Vercel sang `server-v2`. Kiểm: `grep -rln "supabase\|SUPABASE" server/ api/ scripts/ --include=*.ts` → rỗng.
6. Feature flag `VITE_BACKEND=supabase|v2` để rollback tức thời; runbook cutover + rollback trong `docs/migration/CUTOVER.md`.
7. Backup: copy `data/app.db` + WAL trước mỗi lần import; giữ bản Supabase read-only ít nhất 30 ngày.

### Acceptance criteria
- [ ] `node scripts/migrate-supabase.mjs --dry-run` in bảng so sánh, **không ghi** DB.
- [ ] Sau `--apply`: `count(*)` 24/24 bảng khớp Supabase (ghi rõ số từng bảng vào log).
- [ ] 10 spot-check ngẫu nhiên (id, created_at, quan hệ FK) khớp.
- [ ] Frontend: `grep -rn "@supabase" src/` → rỗng; login/signup/Google/library/comment/collection chạy được trên backend mới.
- [ ] Server: `grep -rln "supabase\|SUPABASE" server/ api/ scripts/ --include=*.ts` → rỗng (2 file hiện có: `server/routes/admin.ts`, `server/lib/translate.ts`).
- [ ] Rollback: bật `VITE_BACKEND=supabase` → app cũ chạy lại; đã thử 1 lần và ghi log.
- [ ] `npm run check`, `npm run lint`, `npm run build` ở root → exit 0.

### Verify
```bash
cd /tmp/opencode/work/tsuki-wiki
node server-v2/scripts/migrate-supabase.mjs --dry-run
node server-v2/scripts/migrate-supabase.mjs --apply --backup data/backup-$(date +%s).db
sqlite3 server-v2/data/app.db "select 'profiles',count(*) from profiles union all select 'comments',count(*) from comments;"
grep -rn "@supabase" src/ || echo "NO_SUPABASE_IMPORTS"
grep -rln "supabase\|SUPABASE" server/ api/ scripts/ --include=*.ts || echo "NO_SUPABASE_SERVER"
npm run check && npm run lint && npm run build
```

---

## Thứ tự giao việc & gate

| Task board | Owner | Phụ thuộc | Gate |
|---|---|---|---|
| Phase 0 implement | dev | — | Phase 0 acceptance |
| Review AUTHZ-MATRIX + PHASES (đối chiếu SQL) | reviewer | — | Matrix đúng 73/22/20, không suy diễn |
| Review code Phase 0 (auth/cookie/CSRF) | reviewer | Phase 0 implement | Không merge khi còn P0 |
| Phase 1 implement | dev | Phase 0 | Phase 1 acceptance |
| Permission matrix test suite | tester | Phase 1 + matrix review | 73 policy × allow/deny pass |

## Giả định & việc chưa chốt

- Chưa chốt nơi lưu file: local disk (đơn giản, phải backup) vs S3/MinIO (bền hơn, thêm hạ tầng) — Phase 2 quyết.
- Chưa chốt frontend gọi API same-origin (Vercel rewrite `/api` → Node) hay cross-origin; ảnh hưởng cookie `SameSite` và CORS.
- Password của user cũ **không migrate được** (Supabase hash không export) → cần flow “đặt lại mật khẩu” hoặc ép dùng Google ở lần đăng nhập đầu.
- Chưa có test suite ở frontend; Phase 3 chỉ verify bằng build + smoke tay, trừ khi sir duyệt thêm Playwright.
- Notification `new_episode` và MAL sync worker hiện **không có implementation nguồn** (chỉ có bảng + policy) — phải chốt ai tạo dữ liệu trước khi Phase 1 kết thúc.
- Estimate 28–40 ngày (Phase 1: 15–20) là **ước lượng của planner**, chưa được dev xác nhận theo từng task; nếu dev thấy lệch thì cập nhật lại bảng.
