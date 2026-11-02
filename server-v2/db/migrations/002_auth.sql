-- ============================================================
-- 002 — AUTH (Phase 0 / Slice 2)
--
-- Tách khỏi 001_schema.sql để KHÔNG đổi checksum của migration đã apply
-- (drift detection trong db/index.ts sẽ chặn nếu sửa 001).
--
-- Thêm:
--   users.password_hash  → hash scrypt cho đăng ký email+password
--                          (NULL với tài khoản chỉ dùng Google OAuth)
--   sessions.family_id   → nhóm token khi rotate; reuse token cũ → revoke cả family
--   sessions.replaced_by → id session mới thay thế (audit rotation)
--   sessions.rotate_count→ số lần đã rotate trong family
-- ============================================================

alter table users add column password_hash text;

alter table sessions add column family_id text;
alter table sessions add column replaced_by text;
alter table sessions add column rotate_count integer not null default 0;

create index if not exists sessions_family_idx on sessions(family_id);
