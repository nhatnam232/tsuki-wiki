# CUTOVER — chuyển tsuki-wiki từ Supabase sang `server-v2`

> Trạng thái: **KẾ HOẠCH**, chưa thực thi. Chỉ đạo: bật theo thứ tự **Vercel env → API mới → verify → tắt Supabase**, mỗi bước có rollback riêng.
> Ngày soạn: 2026-11-02. Người duyệt: Lead + sir. Người thực thi: dev (backend) + lead (Vercel/DNS) + tester (verify).

## 0. Điều kiện Go / No-Go (kiểm ngay trước khi bắt đầu)

| # | Điều kiện | Trạng thái hiện tại (09:40 UTC) |
|---|---|---|
| G1 | Phase 0 gate xanh: `cd server-v2 && npm run check` + `npm test` **2 lần liên tiếp** exit 0 | ✅ **PASS** (09:44: check=0; test exit 0/0; script loop từng file 1 process) |
| G2 | Phase 1a API + authorization 8 bảng lõi xong, permission matrix pass | ❌ chưa có |
| G3 | Phase 3 migrate dry-run: 24/24 bảng khớp `count(*)`, 10 spot-check khớp | ❌ chưa chạy |
| G4 | Frontend cutover (17 file Supabase → `apiV2`) build/lint/check xanh | ❌ chưa làm |
| G5 | **Domain + HTTPS hoạt động** (`api.animewiki.eu.cc`) | ✅ **PASS (09:49)** — `curl https://api.animewiki.eu.cc/api/health` → **200** `{"success":true,"message":"ok","db":true}`; HSTS có trên HTTPS. Cloudflare tunnel `animewiki-api` healthy, ingress `api.animewiki.eu.cc → http://103.69.75.49:25200`. Login HTTPS set `tsuki_at` (HttpOnly/Secure/SameSite=Lax) + `tsuki_rt` (Path=/api/auth); WSS `wss://api.animewiki.eu.cc/api/ws` nhận `comment:new` ~1.4s. Rotate: HTTP+secret → 409 `{rotated:false}`, HTTPS+secret → 200 + password + warning, no secret/`x-vercel-cron-signature` → 401 |
| G6 | Backup Supabase + SQLite đã tạo, có người giữ | ❌ chưa |
| G7 | Feature flag rollback đã test ít nhất 1 lần | ❌ chưa |
| G8 | **Runtime khớp build**: panel chạy Node đúng version với `engines`/esbuild | ✅ **PASS** — dev đã hạ `engines >=20.0.0` + `--target=node20`, bundle mới deploy (dist 09:48:58) |

> **No-Go nếu bất kỳ G1–G8 đỏ.** Đặc biệt G5: chưa có TLS thì **không cutover**, vì cookie `Secure` không hoạt động qua HTTP và plaintext admin password không được phép rời máy chủ.
>
> **Phương án tạm nếu TLS chưa xong (phải chốt bằng văn bản):** chỉ dùng `IP:port` + `COOKIE_SECURE=false` trong **LAN/test nội bộ**, tuyệt đối không mời user thật và không gọi đó là production. Ghi rõ ngày hết hạn của phương án tạm và người chịu trách nhiệm.

## 1. Kiến trúc đích

- **Frontend**: Vercel (giữ nguyên), gọi `VITE_API_URL` trỏ backend mới; `src/lib/apiV2.ts` dùng `fetch(..., { credentials: 'include' })`.
- **Backend**: `server-v2` chạy trên Pterodactyl, artifact `server-v2/dist/server.cjs` (esbuild `--target=node20`, external `better-sqlite3`), SQLite **WAL** tại `data/app.db` (+ `-wal`, `-shm`), media tại `MEDIA_DIR` (default `./media`).
- **TLS/edge:** `cloudflared` chạy trên **host DSH** (systemd `cloudflared-animewiki`), tunnel `animewiki-api` → origin `http://103.69.75.49:25200`; public `https://api.animewiki.eu.cc`, WS `wss://api.animewiki.eu.cc/api/ws`. Env: `COOKIE_SECURE=true` (mặc định, đã bỏ `COOKIE_SECURE=false` khỏi `.env`), `TRUST_PROXY=1`.
- **Realtime**: WS cùng process, path `/ws`, auth bằng cookie khi handshake.
- **Không dùng** `deploy/bundle/server.cjs` cho v2 — file đó là bundle backend **Supabase cũ**, vẫn tracked để rollback tạm.
- **Supabase**: giữ **read-only + backup** tối thiểu 30 ngày sau cutover, chưa xoá project.

## 2. Chuẩn bị trước cutover (T-7 → T-1)

1. **G5 đã xong (09:49)**: `curl https://api.animewiki.eu.cc/api/health` → 200 là smoke test bắt buộc trước mỗi lần cutover; nếu tunnel down thì dừng, không cutover.
2. Tạo backup Supabase: `pg_dump` (nếu có quyền) hoặc export JSON qua service role **read-only**, lưu ngoài repo, ghi `sha256`.
3. Build + lưu artifact: `cd server-v2 && npm run build` → copy `dist/server.cjs` + `node_modules/better-sqlite3` lên panel; **giữ bản `.prev`** để rollback.
4. Tạo backup SQLite: copy `data/app.db`, `data/app.db-wal`, `data/app.db-shm` (phải **stop process** trước khi copy để WAL không lệch).
5. Migration dry-run: hiện repo có `server-v2/scripts/import-supabase.ts` (đọc `IMPORT_DIR`, in bảng `rows JSON/insert/skip` + `foreign_key_check`). Chạy trên **DB copy** trước, lưu báo cáo; script Phase 3 có `--dry-run/--apply` **chưa tồn tại** — nếu cần thì dev bổ sung trước cutover.
6. Cấu hình env panel theo `server-v2/.env.example`: `JWT_SECRET` (≥32), `CRON_SECRET` (≥32), `DB_PATH`, `MEDIA_DIR` (nếu có), `SITE_URL=https://animewiki.eu.cc`, `CORS_ORIGINS=https://animewiki.eu.cc`, `COOKIE_SECURE=true`, `TRUST_PROXY=1` **chỉ khi** panel nằm sau reverse proxy tin cậy.
7. Set `VITE_API_URL` trên **Vercel Preview** trước (chưa production), deploy preview để test.
8. Thông báo cửa sổ bảo trì (đề xuất 60 phút, giờ thấp điểm), bật banner “đang bảo trì” nếu cần.

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
curl -i -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"<test>","password":"<test>"}' -c /tmp/cj.txt   # 200 + Set-Cookie HttpOnly/Secure/SameSite=Lax
curl -i $BASE/auth/me -b /tmp/cj.txt              # 200, đúng user
curl -i $BASE/library -b /tmp/cj.txt              # 200, chỉ dữ liệu của mình
curl -i -X POST $BASE/comments -b /tmp/cj.txt -H 'content-type: application/json' \
  -d '{"entity_type":"anime","entity_id":1,"body":"smoke test"}'   # 201
curl -i $BASE/comments?entity_type=anime\&entity_id=1              # có comment vừa tạo
curl -i -X POST $BASE/admin/verify-password -b /tmp/cj.txt -H 'content-type: application/json' -d '{"password":"sai"}'  # 403 nếu không đủ mod
curl -i $BASE/admin/cron-secret -b /tmp/cj.txt     # 403/401 với user thường; 200 chỉ owner
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
- **Origin `103.69.75.49:25200` vẫn truy cập trực tiếp được** (đã verify HTTP 200). Với `TRUST_PROXY=1`, caller gọi thẳng IP có thể spoof `X-Forwarded-For` ⇒ ảnh hưởng **rate-limit** (không ảnh hưởng auth vì JWT/cookie vẫn verify). Khuyến nghị: firewall chỉ cho dải IP Cloudflare hoặc bind localhost; ghi nhận là nợ hạ tầng.
- HSTS hiện gửi cả trên HTTP (`security.ts:18-20`) nên vô hiệu; sau khi có TLS phải kiểm `Strict-Transport-Security` chỉ xuất hiện trên HTTPS và không gây khoá domain nếu chứng chỉ sai.
- `server-v2/package.json` đã hạ `engines >=20` + `--target=node20`, bundle mới deploy 09:48:58 ⇒ khớp panel nodejs_20 (G8 ✅).
