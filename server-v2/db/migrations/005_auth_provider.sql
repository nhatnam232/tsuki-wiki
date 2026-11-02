-- 005 — thêm cột provider cho users (phục vụ import dữ liệu Supabase).
-- 'email' (password_hash) | 'google' | null (chưa rõ)
alter table users add column provider text;
create index if not exists users_provider_idx on users(provider);
