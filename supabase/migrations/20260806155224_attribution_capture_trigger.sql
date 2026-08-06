-- Attribution capture (Unified Attribution P2).
--
-- Every company — web, iOS, or any future creation path — gets a
-- trial_attributions row at birth. Two reasons this must be universal rather
-- than web-only:
--   1. Denominator integrity: attribution rates are computed against ALL
--      companies. A missing row silently understates every rate.
--   2. billing_events_first_paid (already live) only UPDATEs an existing row,
--      so a company with no row can never be counted as a paid conversion.
--
-- Web later upgrades the row with real UTM/click-id data read from the
-- first-touch cookie; rows that are never upgraded stay honestly 'unknown'.
--
-- The insert is deliberately non-fatal: company creation must NEVER fail
-- because an analytics side-effect failed.

create or replace function public.seed_trial_attribution_for_company()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  begin
    insert into public.trial_attributions (company_id, trial_started_at, attributed_channel)
    values (
      new.id,
      coalesce(new.trial_start_date, new.created_at, now()),
      'unknown'
    )
    on conflict (company_id) do nothing;
  exception when others then
    -- Telemetry must never abort company creation.
    raise warning 'seed_trial_attribution_for_company failed for company %: %', new.id, sqlerrm;
  end;
  return new;
end $$;

-- AFTER INSERT: initialize_company_trial_trigger is a BEFORE INSERT trigger on
-- this same table, so new.trial_start_date is already populated by the time
-- this runs.
drop trigger if exists companies_seed_trial_attribution on public.companies;
create trigger companies_seed_trial_attribution
  after insert on public.companies
  for each row execute function public.seed_trial_attribution_for_company();

-- ── Backfill 1: a row for every existing live company ──
insert into public.trial_attributions (company_id, trial_started_at, attributed_channel)
select c.id,
       coalesce(c.trial_start_date, c.created_at, now()),
       'unknown'
from public.companies c
where c.deleted_at is null
on conflict (company_id) do nothing;

-- ── Backfill 2: stamp first_paid_at from invoices that predate the row ──
-- billing_events_first_paid only fires on NEW billing_events inserts, so
-- companies that already paid would sit first_paid_at IS NULL forever.
update public.trial_attributions ta
   set first_paid_at = f.first_paid,
       updated_at    = now()
from (
  select company_id, min(occurred_at) as first_paid
  from public.billing_events
  where event_type = 'invoice.paid' and company_id is not null
  group by company_id
) f
where ta.company_id = f.company_id
  and ta.first_paid_at is null;
