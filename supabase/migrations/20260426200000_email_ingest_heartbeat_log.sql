-- Phase C observability heartbeat log.
--
-- The /api/cron/email-ingest-heartbeat cron runs every 15 min and writes a row
-- to this table whenever it fires an alert (notification rail + email) about
-- a company whose email ingestion has produced zero events in the last hour.
-- The row is consulted on the next run to dedup further alerts within a 4-hour
-- window.
--
-- Service-role only; no RLS read path needed for end users.

create table if not exists public.email_ingest_heartbeat_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  triggered_at timestamptz not null default now(),
  reason text not null
);

create index if not exists email_ingest_heartbeat_log_company_recent_idx
  on public.email_ingest_heartbeat_log (company_id, triggered_at desc);

alter table public.email_ingest_heartbeat_log enable row level security;
-- No policies: only the service-role client (cron) reads/writes this table.
