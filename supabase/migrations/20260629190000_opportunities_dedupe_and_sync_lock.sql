-- P0-A (Inbox Clean-State Layer): dedupe hardening.
--
-- 1) opportunities.source_thread_key — the provider email thread id, set at
--    creation for email-sourced leads. A UNIQUE (company_id, source_thread_key)
--    makes a given (company, email thread) able to spawn at most ONE opportunity,
--    closing the webhook-manual-sync <-> 15-min-cron race that produced duplicate
--    leads. Postgres treats NULLs as DISTINCT, so every existing row (this is a
--    new column => all NULL) and every non-email opportunity stay unconstrained.
--    Existing duplicates are deliberately NOT backfilled here — their key stays
--    NULL so the constraint validates instantly; cleaning them up is a separate,
--    explicitly-gated live-data step.
--
-- 2) email_connections.sync_in_progress_at — a per-connection sync lock claimed
--    at the top of runSync and released in finally, serializing syncs for one
--    connection. Stale locks (a crashed sync) expire after a TTL the app applies.
--
-- ADDITIVE / iOS-SAFE: new nullable columns + a unique constraint that cannot
-- conflict with existing data (every existing source_thread_key is NULL). No
-- rename / drop / type-change.
--
-- Rollback (sentinel):
--   alter table public.opportunities  drop constraint if exists opportunities_company_source_thread_key_key;
--   alter table public.opportunities  drop column     if exists source_thread_key;
--   alter table public.email_connections drop column  if exists sync_in_progress_at;

alter table public.opportunities
  add column if not exists source_thread_key text;

alter table public.email_connections
  add column if not exists sync_in_progress_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'opportunities_company_source_thread_key_key'
  ) then
    alter table public.opportunities
      add constraint opportunities_company_source_thread_key_key
      unique (company_id, source_thread_key);
  end if;
end$$;

comment on column public.opportunities.source_thread_key is
  'Provider email thread id for email-sourced leads, set at creation. UNIQUE (company_id, source_thread_key) dedupes opportunities per email thread (P0-A). NULL for non-email or pre-existing leads (NULLs are distinct).';
comment on column public.email_connections.sync_in_progress_at is
  'Per-connection sync lock timestamp. Claimed at the top of runSync, released in finally; stale locks expire after the app TTL. Serializes webhook + cron syncs (P0-A).';
