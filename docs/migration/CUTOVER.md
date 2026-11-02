# CUTOVER — chuyển tsuki-wiki từ Supabase sang `server-v2`

> Trạng thái: **KẾ HOẠCH**, chưa thực thi. Chỉ đạo: bật theo thứ tự **Vercel env → API mới → verify → tắt Supabase**, mỗi bước có rollback riêng.
> Ngày soạn: 2026-11-02. Người duyệt: Lead + sir. Người thực thi: dev (backend) + lead (Vercel/DNS) + tester (verify).

## 0. Điều kiện Go / No-Go (kiểm ngay trước khi bắt đầu)

| # | Điều kiện | Trạng thái hiện tại (09:40 UTC) |
|---|---|---|
| G1 | Phase 0 gate xanh: `cd server-v2 && npm run check` + `npm test` **2 lần liên tiếp** exit 0 | ✅ **PASS** (09:44: check=0; test exit 0/0; script loop từng file 1 process) |
| G2 | Phase 1a API + authorization 8 bảng lõi xong, permission matrix pass | ❌ chưa có |
| G3 | Phase 3 migrate dry-run: 24/24 bảng khớp `count(*)`, 10 spot-check khớp | ❌ chưa chạy |
| G4 | **Frontend cutover — 8 file còn import shim `lib/supabase`** | ❌ **CHƯA XONG (8 file, đang chết runtime)** — `src/lib/supabase.ts` là **shim NÉM LỖI** (`Proxy.get` throw); 8 file còn import sẽ throw khi chạm `supabase.*`: `CommentSection.tsx`, `Profile.tsx`, `CollectionsPage.tsx`, `AdminDashboard.tsx`, `ActivityFeed.tsx`, `PersonalLibrary.tsx`, `RecommendedForYou.tsx`, `SuggestEditModal.tsx`. **Tiêu chí đóng (5 mục, đều đo được):** (1) `grep -rln "lib/supabase" src/ | grep -v "src/lib/supabase.ts" | wc -l` → **0** (hiện 8); (2) xoá `src/lib/supabase.ts`; (3) bỏ `@supabase/supabase-js` khỏi `package.json`; (4) bỏ entry `'supabase'` trong `manualChunks` (`vite.config.ts:25`); (5) artifact: `wc -c dist/assets/supabase-*.js` ≈ **0 byte** (chunk rỗng vẫn tồn tại — **không** dùng tiêu chí “0 file”), và `grep -l "GoTrueClient\|PostgrestClient\|supabase.co" dist/assets/*.js` → rỗng. **Ưu tiên migrate:** CommentSection → Profile → CollectionsPage → AdminDashboard (dùng nhiều nhất), rồi 4 file còn lại; test live 1 trang (Profile) không throw |
| G5 | **Domain + HTTPS hoạt động** (`api.animewiki.eu.cc`) | ✅ **PASS (09:49)** — `curl https://api.animewiki.eu.cc/api/health` → **200** `{"success":true,"message":"ok","db":true}`; HSTS có trên HTTPS. Cloudflare tunnel `animewiki-api` healthy, ingress `api.animewiki.eu.cc → http://103.69.75.49:25200`. Login HTTPS set `tsuki_at` (HttpOnly/Secure/SameSite=Lax) + `tsuki_rt` (Path=/api/auth); WSS `wss://api.animewiki.eu.cc/api/ws` nhận `comment:new` ~1.4s. Rotate: HTTP+secret → 409 `{rotated:false}`, HTTPS+secret → 200 + password + warning, no secret/`x-vercel-cron-signature` → 401 |
| G6 | Backup Supabase + SQLite đã tạo, có người giữ | ❌ chưa |
| G7 | Feature flag rollback đã test ít nhất 1 lần | ❌ chưa |
| G8 | **Runtime khớp build**: panel chạy Node đúng version với `engines`/esbuild | ✅ **PASS** — dev đã hạ `engines >=20.0.0` + `--target=node20`, bundle mới deploy (dist 09:48:58); live `health/deep` báo `node v20.20.2`, `db:true` |
| G9 | **Client IP không lấy từ XFF + origin không public** | ✅ **MITIGATED + HARDENING DONE (10:45, build `f430123`)** — cloudflared trong container, app **mặc định bind `127.0.0.1` khi có `TUNNEL_TOKEN`** (override bằng `HOST`), supervisor retry backoff 1s→30s + reset sau 60s uptime + dừng khi shutdown; `TRUSTED_PROXIES=127.0.0.1`; host systemd disabled; origin `103.69.75.49:25200` → **connection refused** (port không publish). Domain 200; domain XFF sau bucket đầy → 429; WSS `comment:new` ~1s. **Tiêu chí (độc lập port publish):** `curl -s -m 40 'https://r.jina.ai/http://103.69.75.49:25200/api/health' \| grep -c '"success":true'` → **0** (đạt khi `untrusted_proxy` hoặc `ERR_CONNECTION_REFUSED`/timeout). *Không dùng `grep untrusted_proxy` làm tiêu chí duy nhất.* |
| G10 | **Google OAuth production** | ✅ **PASS (11:25)** — sir login Google thật trên production: user `kobitnx223@gmail.com`, `provider=google`, `username=jades`, `badges=["admin"]`, `last_login_at=2026-11-02T11:25:51.349Z`; tạo **1 session** lúc `11:25:51.355Z`, `revoked_at=null`, redirect về `https://animewiki.eu.cc/`. `/api/auth/google/start` giờ trả **302** (client_id/redirect_uri/scope/PKCE S256 đúng, không `redirect_uri_mismatch`; trước đó 503). **Không còn là blocker** |
| G11 | **Captcha/bot defence** | ✅ **RESOLVED BY DECISION (B)** — tắt hCaptcha, chuyển bot defence lên Cloudflare. Frontend code đã xoá gate (`cde5963`), backend `CAPTCHA_DISABLED=1` (secret thắng cờ ⇒ bật lại = set secret + bỏ cờ). **⚠ Deploy frontend chưa xong:** bundle prod vẫn là bản cũ (`assets/index-DOKDDPZJ.js`, **12 hit `hcaptcha`**) ⇒ sau khi deploy phải verify `grep -c hcaptcha` = **0**. Cloudflare rule `/api/auth/*` = 10 req/10s/IP, block + mitigation 10s; verify live burst → **429** (`error code: 1015`). **Caveat:** rule CF **yếu hơn** app limiter (10 req/15phút/IP) và **per-IP** ⇒ lớp chính vẫn là app limiter; bot phân tán qua được cả 2. **Bot Fight Mode tách thành G12** |
| G12 | **Bot Fight Mode (Cloudflare)** | ⏳ **MANUAL — không chặn cutover** — API token thiếu scope (`10405 Method not allowed`); sir vào dashboard Cloudflare → Security → Bots → bật **Bot Fight Mode**. Ghi nhận là hardening sau cutover |

### G11 — Runbook bật lại captcha sau này (hiện đã tắt theo quyết định B)

**Trạng thái 11:42:** code server đã xong (`d3f46e6` verify, `e819493` fail-fast boot: production thiếu `HCAPTCHA_SECRET` ⇒ throw trừ `CAPTCHA_DISABLED=1`). Frontend đang deploy **đã bake site key** (bundle `assets/index-DOKDDPZJ.js`, 8 hit `hcaptcha`, site key `1b487296…ae32` — UUID công khai). **Gate vẫn đỏ** cho tới khi live login trả **400 `captcha_required`**.

| Kịch bản sai | Hệ quả | Cách phát hiện |
|---|---|---|
| Bundle **thiếu** `VITE_HCAPTCHA_SITE_KEY` (build frontend thiếu env) | Widget không render → user gửi 0 token → khi bật secret **mọi login 400 `captcha_required`** | `curl -s https://animewiki.eu.cc | grep -oE '/assets/index-[^"]+\.js'` rồi `curl -s https://animewiki.eu.cc<asset> | grep -c hcaptcha` → phải **> 0** |
| `HCAPTCHA_SECRET` **khác account** với site key `1b487296…ae32` | `siteverify` trả `success:false` cho mọi token ⇒ **mọi login `captcha_failed`** | Chỉ phát hiện bằng **1 lần login browser thật** sau khi bật |

> `VITE_HCAPTCHA_SITE_KEY` là **build-time**: đổi/rotate site key phải **rebuild frontend**; restart server không đủ.

**Trình tự flip (0 → 6):**
0. Trong dashboard hCaptcha, đối chiếu `HCAPTCHA_SECRET` thuộc **cùng account/site key** `1b487296…ae32`.
1. Set `HCAPTCHA_SECRET` (≥ production secret, không log giá trị).
2. Bỏ `CAPTCHA_DISABLED` khỏi env.
3. Restart/redeploy backend.
4. **Live gate:** `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.animewiki.eu.cc/api/auth/login -H 'content-type: application/json' -d '{"email":"probe@example.invalid","password":"x"}'` → **400**.
5. **Login browser thật 1 lần** (giải captcha) → phải 200 + cookie; nếu `captcha_failed` toàn bộ ⇒ secret sai account.
6. **Rollback nếu sai:** **thêm `CAPTCHA_DISABLED=1` VÀ xoá `HCAPTCHA_SECRET` cùng lúc**, rồi restart **một lần** (captcha tắt, site sống). **Thứ tự bắt buộc:** không xoá secret trước khi có cờ — production thiếu secret mà chưa có cờ ⇒ `assertCaptchaConfigured` **throw lúc boot** ⇒ crash-loop/site sập; đặt cờ trước rồi xoá secret trong cùng lần thay đổi là an toàn. **Ngữ nghĩa cố ý giữ nguyên: `HCAPTCHA_SECRET` thắng `CAPTCHA_DISABLED`** — `verifyCaptcha` **không** đọc cờ (secret check chạy trước ở `assertCaptchaConfigured`, xem `captcha.ts:31-32,44`); đừng “sửa” code để cờ short-circuit, vì sẽ tái tạo đúng lỗi “tưởng tắt mà vẫn bật”. Khuyến nghị thêm comment trong `verifyCaptcha`: “cố ý KHÔNG đọc CAPTCHA_DISABLED — secret thắng cờ”.

> **No-Go chỉ còn G2, G3, G4, G6, G7.** G1/G5/G8/G9/G10/G11 đã xanh; G9 hardening done (`f430123`), G10 Google OAuth verified thật (11:25), **G11 resolved by decision B** (captcha off + Cloudflare edge rate-limit, `cde5963`). Đặc biệt G5: chưa có TLS thì **không cutover**, vì cookie `Secure` không hoạt động qua HTTP và plaintext admin password không được phép rời máy chủ.
>
> **Phương án tạm nếu TLS chưa xong (phải chốt bằng văn bản):** chỉ dùng `IP:port` + `COOKIE_SECURE=false` trong **LAN/test nội bộ**, tuyệt đối không mời user thật và không gọi đó là production. Ghi rõ ngày hết hạn của phương án tạm và người chịu trách nhiệm.

## 1. Kiến trúc đích

- **Frontend**: Vercel (giữ nguyên), gọi `VITE_API_URL` trỏ backend mới; `src/lib/apiV2.ts` dùng `fetch(..., { credentials: 'include' })`.
- **Backend**: `server-v2` chạy trên Pterodactyl, artifact `server-v2/dist/server.cjs` (esbuild `--target=node20`, external `better-sqlite3`), SQLite **WAL** tại `data/app.db` (+ `-wal`, `-shm`), media tại `MEDIA_DIR` (default `./media`).
- **TLS/edge:** `cloudflared` chạy **trong container Ptero** (`startTunnel()` spawn `./cloudflared tunnel run` khi có `TUNNEL_TOKEN`, supervisor backoff 1s→30s, dừng khi shutdown), app **auto-bind `127.0.0.1`** khi có `TUNNEL_TOKEN` (log WARNING nếu không loopback), tunnel ingress `http://127.0.0.1:25200`, `TRUSTED_PROXIES=127.0.0.1`; host systemd `cloudflared-animewiki` **disabled**; public `https://api.animewiki.eu.cc`, WS `wss://api.animewiki.eu.cc/api/ws`. `COOKIE_SECURE=true`. Origin port **không publish** (connection refused từ ngoài).
- **Realtime**: WS cùng process, path `/ws`, auth bằng cookie khi handshake.
- **Không dùng** `deploy/bundle/server.cjs` cho v2 — file đó là bundle backend **Supabase cũ**, vẫn tracked để rollback tạm.
- **Supabase**: giữ **read-only + backup** tối thiểu 30 ngày sau cutover, chưa xoá project.

## 2. Chuẩn bị trước cutover (T-7 → T-1)

1. **G5 đã xong (09:49)**: `curl https://api.animewiki.eu.cc/api/health` → 200 là smoke test bắt buộc trước mỗi lần cutover; nếu tunnel down thì dừng, không cutover.
2. Tạo backup Supabase: `pg_dump` (nếu có quyền) hoặc export JSON qua service role **read-only**, lưu ngoài repo, ghi `sha256`.
3. Build + lưu artifact: `cd server-v2 && npm run build` → copy `dist/server.cjs` + `node_modules/better-sqlite3` lên panel; **giữ bản `.prev`** để rollback.
4. Tạo backup SQLite: copy `data/app.db`, `data/app.db-wal`, `data/app.db-shm` (phải **stop process** trước khi copy để WAL không lệch).
5. Migration dry-run: hiện repo có `server-v2/scripts/import-supabase.ts` (đọc `IMPORT_DIR`, in bảng `rows JSON/insert/skip` + `foreign_key_check`). Chạy trên **DB copy** trước, lưu báo cáo; script Phase 3 có `--dry-run/--apply` **chưa tồn tại** — nếu cần thì dev bổ sung trước cutover.
6. **G9 (mitigated + hardening done, `f430123`):** `TUNNEL_TOKEN` ⇒ app tự bind `127.0.0.1` (override `HOST`), supervisor backoff 1s→30s/reset 60s, `TRUSTED_PROXIES=127.0.0.1`; cloudflared trong container. **Checklist deploy:** (a) smoke test domain 200 + origin `connection refused`/403 và fetcher ngoài không thấy `"success":true`; (b) theo dõi log `[tunnel]` khi restart; (c) pin build = `f430123` để rollback tái tạo được; (d) **dev bổ sung `HOST`/`TUNNEL_TOKEN` vào `.env.example`** (hiện thiếu; comment `TRUSTED_PROXIES` còn ví dụ IP host cũ cần sửa).
7. Cấu hình env panel theo `server-v2/.env.example`: `JWT_SECRET` (≥32), `CRON_SECRET` (≥32), `DB_PATH`, `MEDIA_DIR` (nếu có), `SITE_URL=https://animewiki.eu.cc`, `CORS_ORIGINS=https://animewiki.eu.cc`, `COOKIE_SECURE=true`, `TRUST_PROXY=1` **chỉ khi** panel nằm sau reverse proxy tin cậy.
8. Set `VITE_API_URL` trên **Vercel Preview** trước (chưa production), deploy preview để test.
9. **Google OAuth đã cấu hình + verify thật** (G10 PASS 11:25); smoke test `/api/auth/google/start` → 302. **Captcha (G11):** đã tắt theo quyết định B — set `CAPTCHA_DISABLED=1`, frontend không còn gate (`cde5963`); Cloudflare rule `/api/auth/*` 10 req/10s/IP là lớp chống bot. Chỉ bật lại captcha nếu sau này cần (xem runbook G11).
10. Thông báo cửa sổ bảo trì (đề xuất 60 phút, giờ thấp điểm), bật banner “đang bảo trì” nếu cần.

## 3. Thứ tự cutover

### Bước 1 — Bật API mới (chưa nhận traffic thật)
```bash
# trên panel
node server-v2/dist/server.cjs          # hoặc panel start command
curl -sS https://api.animewiki.eu.cc/api/health
# kỳ vọng: {"success":true,"message":"ok","db":true}
```
- Kiểm log boot: `db=.../app.db wal=true node=v20...`.
- Chưa đổi `VITE_API_URL` production.

### Bước 2 — Vercel env trỏ Preview → API mới
```bash
# Vercel dashboard → Preview env
VITE_API_URL=https://api.animewiki.eu.cc/api
```
- Redeploy **preview**, KHÔNG production.
- Test preview: login, library, comment, collection, notification, upload avatar.
- Nếu preview lỗi → xoá env preview, không ảnh hưởng production.

### Bước 3 — Chuyển production
1. Set `VITE_API_URL` cho Production (cùng giá trị).
2. Redeploy production (ghi lại deployment URL **trước** khi đổi để rollback).
3. Kiểm ngay 5 phút đầu: `curl -I https://animewiki.eu.cc`, login 1 tài khoản test, xem Network không còn request `*.supabase.co`.

### Bước 4 — Verify sau cutover (bắt buộc, xem §4)
Chạy hết checklist; ghi log + ảnh chụp màn hình. Chỉ khi tất cả PASS mới sang bước 5.

### Bước 5 — Freeze Supabase + migrate delta
1. Vô hiệu hoá ghi vào Supabase: revoke anon/authenticated insert/update (hoặc chuyển project sang read-only nếu gói hỗ trợ).
2. Chạy migration **delta** lần cuối: dùng `server-v2/scripts/import-supabase.ts` (idempotent, đọc `IMPORT_DIR`) trên DB thật sau khi freeze; nếu dev bổ sung `--apply/--since` thì dùng cờ đó. So `count(*)` + `foreign_key_check` lần cuối, lưu log.
3. Ghi rõ thời điểm freeze (T_freeze) vào biên bản.

### Bước 6 — Tắt Supabase
1. Chưa xoá project. Đổi API keys (anon/service) sang bản **revoked** để mọi client cũ fail-closed; giữ DB read-only.
2. Giữ backup + project **30 ngày**; sau đó mới quyết định xoá.
3. Cập nhật `README`/`DEPLOYMENT.md` trỏ backend mới, gỡ hướng dẫn Supabase cũ.

## 4. Checklist verify sau cutover

```bash
BASE=https://api.animewiki.eu.cc/api
curl -sS $BASE/health                            # {"success":true,...}
curl -sS http://103.69.75.49:25200/api/health     # đo từ IP NGOÀI allowlist: kỳ vọng 403 untrusted_proxy; đo từ host tunnel (116.66.214.191) sẽ thấy 200 — đúng thiết kế, không phải lỗi
curl -i -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"<test>","password":"<test>"}' -c /tmp/cj.txt   # 200 + Set-Cookie HttpOnly/Secure/SameSite=Lax
curl -i $BASE/auth/me -b /tmp/cj.txt              # 200, đúng user
curl -i $BASE/library -b /tmp/cj.txt              # 200, chỉ dữ liệu của mình
curl -i -X POST $BASE/comments -b /tmp/cj.txt -H 'content-type: application/json' \
  -d '{"entity_type":"anime","entity_id":1,"body":"smoke test"}'   # 201
curl -i $BASE/comments?entity_type=anime\&entity_id=1              # có comment vừa tạo
curl -i -X POST $BASE/admin/verify-password -b /tmp/cj.txt -H 'content-type: application/json' -d '{"password":"sai"}'  # 403 nếu không đủ mod
curl -i $BASE/admin/cron-secret -b /tmp/cj.txt     # 403/401 với user thường; 200 chỉ owner
curl -i -X POST $BASE/auth/login -H 'content-type: application/json' -d '{"email":"x@y.z","password":"bad"}'   # khi HCAPTCHA_SECRET set: 400 captcha_required
```

Checklist thủ công (browser):
- [ ] Đăng ký email/password mới, đăng nhập, refresh (F5), logout; sau logout gọi `/auth/refresh` → 401.
- [ ] Google OAuth login → tạo/link đúng user, không tạo trùng.
- [ ] Thêm/sửa/xoá library; counter `profiles.library_count` đổi đúng; `updated_at` đổi.
- [ ] Favorite (like) + count; comment + vote + sửa/xoá; collection tạo/like; notification mark read/read-all/delete.
- [ ] WS: mở 2 tab, tạo comment ở tab A → tab B nhận `comment:new`; notification tới đúng user; activity feed cập nhật.
- [ ] Upload avatar/cover/comment image → URL public mở được; upload path người khác → 403.
- [ ] Admin: owner xem `/api/admin/cron-secret` được; mod thường 403; rotate qua HTTPS trả plaintext (hoặc webhook_sent nếu có webhook).
- [ ] DevTools: không còn request tới `*.supabase.co`; cookie có `HttpOnly; Secure; SameSite=Lax`.
- [ ] Kiểm 5 view: activity feed phân trang, genres cho recommendations, comment counts, library stats của chính mình.

## 5. Rollback từng bước

| Bước | Sự cố | Rollback | Thời gian |
|---|---|---|---|
| R1 Backend boot fail | panel không start / migration throw | stop process mới, chạy `server-v2/dist/server.cjs.prev`, khôi phục `data/app.db` từ backup nếu migration đã ghi | < 5 phút |
| R2 Preview | preview lỗi | xoá `VITE_API_URL` ở Preview env, không đụng production | < 2 phút |
| R3 Production env | lỗi sau redeploy | Vercel → Deployments → **Promote deployment trước đó**; hoặc unset `VITE_API_URL` (frontend quay lại `/api` cũ trên Vercel) | < 5 phút |
| R4 DNS/TLS | tunnel/HTTPS lỗi | trả DNS về bản ghi cũ (Cloudflare DNS only), giữ chứng chỉ | 5–15 phút (chờ TTL) |
| R5 SQLite hỏng | file DB corrupt | stop process → copy `app.db` + `-wal` + `-shm` từ backup → boot lại, kiểm `PRAGMA integrity_check` | 10–20 phút |
| R6 Supabase | cần quay lại hoàn toàn | mở lại quyền ghi Supabase, promote deployment Vercel cũ, giữ backend mới **stop** để tránh ghi đôi | 15–30 phút |

**Nguyên tắc vàng:** trong cửa sổ cutover chỉ **một** nguồn ghi được sống. Nếu phải rollback sau khi đã ghi vào SQLite, dữ liệu phát sinh từ T_freeze phải export ngược (script `migrate-back`) hoặc chấp nhận mất theo chính sách đã duyệt — **phải ghi rõ trong biên bản trước khi cutover**.

## 6. Ngưỡng rollback (ai cũng có quyền đề xuất, Lead quyết)

- Lỗi 5xx > **1%** trong 10 phút, hoặc login fail > **2%**.
- Bất kỳ **mất dữ liệu** phát hiện được (count lệch, comment/library biến mất).
- WS không kết nối được > 5 phút.
- Cookie không được set trên Safari/Chrome (kiểm 2 browser).
- Bất kỳ sự cố bảo mật (token lộ, plaintext admin password ra log).

## 7. Ownership

| Việc | Owner | Khi nào |
|---|---|---|
| Cloudflare tunnel/domain/TLS | sir (quyền) + lead | ✅ xong 09:49; khi sự cố tunnel → lead |
| Build + deploy backend, backup DB | dev | T-1 → bước 1 |
| Vercel env + promote/rollback | lead | bước 2–3, R2–R3 |
| Verify checklist | tester | bước 4 |
| Delta migration + freeze | dev | bước 5 |
| Quyết định Go/No-Go & rollback | lead | mọi bước |

## 8. Rủi ro đã biết / chưa verify

- **Cloudflare 1033** (530) là blocker hạ tầng, không phải lỗi code — cần sir.
- Cookie cross-subdomain (`animewiki.eu.cc` ↔ `api.animewiki.eu.cc`) là **same-site** nên `SameSite=Lax` được gửi, nhưng CORS phải allow đúng origin + `credentials: include`; **chưa verify trên browser thật**.
- `Vercel rewrite /api/*` sang backend có thể làm mất prefix nếu dùng rewrite thay env absolute — khuyến nghị dùng `VITE_API_URL` absolute cho cutover đầu.
- Migration password legacy: chỉ user có hash bcrypt Supabase mới cần `bcryptjs`; user còn lại dùng scrypt; **chưa test với dữ liệu thật**.
- Chưa có e2e/Playwright; verify bước 4 là thủ công + curl.
- **Tunnel nằm ngoài container**: `cloudflared` chạy trên host DSH (`systemd cloudflared-animewiki`), không nằm trong container Ptero ⇒ backend phụ thuộc host DSH sống. Muốn tự chủ phải đưa cloudflared vào container (task riêng, chưa làm).
- **G9 — MITIGATED + hardening DONE (`f430123`):** cloudflared trong container, auto-bind loopback khi có `TUNNEL_TOKEN`, supervisor backoff + reset, `TRUSTED_PROXIES=127.0.0.1`, origin **connection refused** từ ngoài; domain 200, XFF spoof → 429. **Fragility IP ISP đã hết.** **Còn 1 nợ docs:** `.env.example` thiếu `HOST`/`TUNNEL_TOKEN`, comment `TRUSTED_PROXIES` còn IP host cũ — dev cập nhật. **Vantage:** origin phải test bằng fetcher ngoài; tiêu chí là không thấy `"success":true`, không phải `grep untrusted_proxy`.
- **DoS qua spoof XFF (chỉ từ trusted host):** reviewer đo local với `TRUST_PROXY=1`: 55.000 request XFF ngẫu nhiên làm 1.800 → **34 req/s** (prune O(N) `rateLimit.ts:56`). Từ ngoài allowlist hiện **403** nên không khai thác được; tuy nhiên vẫn nên bỏ prune O(N) và cap cứng số bucket. **Lưu ý:** với trusted host, attacker còn set được `x-forwarded-proto: https` ⇒ kích hoạt nhánh rotate “HTTPS → plaintext” qua HTTP; chỉ có ý nghĩa nếu host DSH bị chiếm.
- **`/api/health/deep`** — đã được chặn, hiện trả **401** cả origin lẫn domain (verify 10:01); P2 này đóng.
- **Google OAuth** — đã cấu hình và verify login thật (11:25, G10 PASS); smoke test `/api/auth/google/start` → 302 trước mỗi lần cutover.
- **Bot defence (G11) — resolved by decision B:** captcha tắt có chủ ý (`cde5963` + `CAPTCHA_DISABLED=1`), chống bot bằng **Cloudflare edge** rule `/api/auth/*` 10 req/10s/IP (block, mitigation 10s). **Deploy frontend còn chờ** — bundle prod vẫn chứa hCaptcha (12 hit) nên phải verify lại sau deploy. **Residual:** CF rule yếu hơn app limiter (10/15phút) và per-IP ⇒ bot phân tán lọt; **Bot Fight Mode = G12 manual** (scope `10405`). Muốn bật lại captcha: set secret + bỏ cờ (runbook G11).
- HSTS hiện gửi cả trên HTTP (`security.ts:18-20`) nên vô hiệu; sau khi có TLS phải kiểm `Strict-Transport-Security` chỉ xuất hiện trên HTTPS và không gây khoá domain nếu chứng chỉ sai.
- `server-v2/package.json` đã hạ `engines >=20` + `--target=node20`, bundle mới deploy 09:48:58 ⇒ khớp panel nodejs_20 (G8 ✅).
