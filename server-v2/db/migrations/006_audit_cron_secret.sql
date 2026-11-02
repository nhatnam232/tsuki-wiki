-- 006 — mở rộng audit_logs.action cho 'cron_secret_read'.
-- SQLite không ALTER được CHECK → rebuild riêng bảng audit_logs (12-step).
-- @pragma foreign_keys=off
drop index if exists audit_logs_actor_idx;
drop index if exists audit_logs_target_idx;
drop index if exists audit_logs_action_idx;

create table _rb_audit_logs (
  id          text primary key default (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4'
                || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random() % 4)), 1)
                || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  actor_id    text references users(id) on delete set null,
  action      text not null check (action in (
                'edit_anime','approve_edit','reject_edit','delete_comment_mod',
                'grant_badge','revoke_badge','create_collection','delete_collection',
                'login','cron_secret_read','other')),
  target_type text,
  target_id   text,
  diff        text check (diff is null or json_valid(diff)),
  reason      text,
  ip          text,
  user_agent  text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  check ("created_at" is null or "created_at" glob '????-??-??T??:??:??*Z')
);

insert into _rb_audit_logs (id, actor_id, action, target_type, target_id, diff, reason, ip, user_agent, created_at)
  select id, actor_id, action, target_type, target_id, diff, reason, ip, user_agent, created_at from audit_logs;
drop table audit_logs;
alter table _rb_audit_logs rename to audit_logs;

create index if not exists audit_logs_actor_idx  on audit_logs(actor_id, created_at desc);
create index if not exists audit_logs_target_idx on audit_logs(target_type, target_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs(action, created_at desc);
