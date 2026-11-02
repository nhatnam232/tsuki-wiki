-- 007 — attempts cho MAL sync worker (retry/backoff)
alter table mal_sync_jobs add column attempts integer not null default 0;
create index if not exists mal_sync_pending_idx on mal_sync_jobs(status, created_at);
