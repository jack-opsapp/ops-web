-- AI-provider failure isolation: durable lead-scan deferral marker.
--
-- When an OpenAI-provider outage skips Step-5 lead classification for an
-- unmatched thread, the sync cycle stamps lead_scan_pending_at so the thread can
-- be re-scanned once the provider recovers, instead of freezing the Gmail
-- cursor. It is a POSITIVE deferral flag, set only on an outage skip — never
-- inferred from opportunity_id IS NULL (the vast majority of unmatched threads
-- are already classified-and-correctly-rejected non-leads).
--
-- Additive + nullable, so the iOS sync (additive-only between App Store
-- releases) ignores the column. The partial index keeps the drain sweep cheap:
-- the pending set is near-empty outside an outage window.
begin;
alter table public.email_threads
  add column if not exists lead_scan_pending_at timestamptz;

create index if not exists email_threads_lead_scan_pending_idx
  on public.email_threads (company_id, lead_scan_pending_at)
  where lead_scan_pending_at is not null and opportunity_id is null;
commit;
