begin;

-- Auto-bug-reporting infrastructure.
-- Adds occurrence-tracking columns and a partial unique index so the iOS
-- AutoBugReporter helper can de-duplicate repeated failures of the same shape
-- (same category + screen + suspected file + error code) into a single row
-- while still letting a regression after resolution land as a NEW row.

alter table public.bug_reports
  add column if not exists times_reported   integer     not null default 1,
  add column if not exists last_reported_at timestamptz not null default now(),
  add column if not exists dedupe_key       text;

comment on column public.bug_reports.times_reported is
  'Occurrence count. Auto-filed bugs increment on re-fire; user-filed bugs stay at 1.';
comment on column public.bug_reports.last_reported_at is
  'Most recent occurrence. Differs from updated_at, which also moves on triage/status changes.';
comment on column public.bug_reports.dedupe_key is
  'Stable hash for auto-filed bugs: sha256(category:screen:suspected_file:error_code). NULL for user-filed.';

-- Partial unique index: dedupe only active tickets. A resolved/closed/duplicate
-- bug that re-fires later is treated as a regression and gets a new row.
create unique index if not exists idx_bug_reports_dedupe_key_active
  on public.bug_reports (company_id, dedupe_key)
  where dedupe_key is not null
    and status in ('new', 'triaged', 'in_progress');

commit;
