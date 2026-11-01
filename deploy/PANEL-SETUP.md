# Panel-hosting Setup (Pterodactyl-style, không cần npm install)

> Backend Anime Wiki được bundle sẵn thành **1 file duy nhất** `deploy/bundle/server.cjs` (~2MB, chứa hết express + supabase client + cache).
> Frontend ở lại Vercel, chỉ backend chạy trên panel.

## Bước 1 — Tạo server trên panel

1. Panel → tạo server, chọn image **Node 20+** (node22 / "node generic")
2. Nhớ **Allocation (IP + port)** — port sẽ tự thành `SERVER_PORT` khi app chạy

## Bước 2 — Upload 2 file (Files tab)

1. `deploy/bundle/server.cjs` → upload vào root của server (vd `/home/container/server.cjs`)
2. `deploy/panel.env.example` → upload, **điền giá trị rồi rename thành `.env`**

### Ý nghĩa từng env — lấy ở đâu

| Env | Giá trị từ đâu | Bắt buộc |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | cùng chỗ → **service_role** | ✅ ⚠️ SECRET |
| `VITE_SUPABASE_ANON_KEY` | cùng chỗ → anon (chỉ frontend dùng — đặt trên Vercel là chính) | — |
| `SITE_URL` | `https://animewiki.eu.cc` | ✅ |
| `UPSTASH_REDIS_*` | upstash.com free tier | optional — bỏ trống = memory cache |
| `DEEPL_API_KEY` **hoặc** `LIBRETRANSLATE_*` | deepl.com / libretranslate | optional |
| `ADMIN_PASSWORD_WEBHOOK` | webhook Discord | optional |
| `CRON_SECRET` | để trống | optional — backend tự sinh |

**Dữ liệu nội dung anime không cần API key nào** — nó lấy công khai từ AniList GraphQL (fallback Jikan).

## Bước 3 — Startup command

```
node server.cjs
```

(PORT: code tự đọc `SERVER_PORT` hoặc `PORT` từ panel — không phải điền.)

## Bước 4 — DNS Cloudflare

Vào zone `animewiki.eu.cc` → DNS → thêm:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `api` | IP của panel host | DNS only (xám) |

## Bước 5 — Trỏ Vercel frontend sang API mới

1. Vercel → project `trae_anm_v1p5` → Settings → Environment Variables:
   `VITE_API_URL` = `https://api.animewiki.eu.cc`
2. Redeploy. (Mã nguồn repo đã sẵn sàng đọc biến này — `src/lib/api.ts`.)

## Bước 6 — Kiểm tra

```bash
curl -I https://api.animewiki.eu.cc/api/anime/1
curl -I https://animewiki.eu.cc          # site phải load được data
```

## Troubleshooting

| Hiện tượng | Nguyên nhân |
|---|---|
| Panel console `EADDRINUSE` | đặt lại port trống qua Allocation |
| Site không thấy data, 404 ở `/api/*` | frontend thiếu `VITE_API_URL` hoặc redeploy chưa ăn |
| `Invalid API key` | `SERVICE_ROLE_KEY` sai / thiếu |
| Cache quéo `Upstash` lỗi | URL/token sai — hoặc bỏ trống cho dùng memory |
| Console báo `listen ::` | bình thường — bind cả IPv4+IPv6 |
