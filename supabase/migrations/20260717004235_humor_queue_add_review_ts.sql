-- Slack review message ts for a drafted card awaiting approval (✅ = clear it, ❌ = kill it)
alter table public.humor_queue add column if not exists review_ts text;

create index if not exists humor_queue_pending_review_idx
  on public.humor_queue (created_at)
  where cleared = false and review_ts is not null;
