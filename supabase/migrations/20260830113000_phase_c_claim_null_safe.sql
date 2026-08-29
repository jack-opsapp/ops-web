-- Phase C work claims never matched fresh queue rows.
--
-- The deployed predicate excluded fully-completed rows with
--   not (a = r and b = r and c = r and d = r)
-- Every freshly enqueued row carries NULL in all four component markers, so
-- each comparison evaluates to UNKNOWN, `not (UNKNOWN)` stays UNKNOWN, and the
-- WHERE clause rejects the row. The queue therefore accumulated rows that were
-- due but could never be claimed (23 rows, attempt_count = 0 on every one,
-- oldest due 2026-08-21) while the worker reported an empty queue.
--
-- The claimable predicate below is the null-safe De Morgan transform of the
-- intended exclusion: a row is claimable when ANY component marker is distinct
-- from the required event id. Fresh all-NULL rows are claimable; rows whose
-- four markers all equal required_event_id remain excluded. Nothing else in the
-- function changes.
--
-- Applied to production ahead of this file as the emergency hotfix
-- `phase_c_claim_null_safe_hotfix` (identical predicate). This migration is the
-- repo source of truth for that fix so a schema redeploy cannot regress it.

create or replace function public.claim_opportunity_phase_c_work(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns table (
  company_id uuid,
  opportunity_id uuid,
  required_event_id uuid,
  required_event_at timestamptz,
  required_activity_id uuid,
  required_connection_id uuid,
  required_provider_thread_id text,
  attempt_count integer,
  component_outcomes jsonb,
  component_errors jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_worker_id), '') is null
    or p_limit < 1 or p_limit > 50
    or p_lease_seconds < 30 or p_lease_seconds > 900
  then
    raise exception 'invalid_phase_c_claim' using errcode = '22023';
  end if;

  return query
  with claimed as (
    select work.opportunity_id
      from public.opportunity_phase_c_work work
     where work.completed_at is null
       and work.next_attempt_at <= now()
       and (work.lease_expires_at is null or work.lease_expires_at <= now())
       and (
         work.summary_completed_event_id is distinct from work.required_event_id
         or work.lifecycle_completed_event_id is distinct from work.required_event_id
         or work.commercial_completed_event_id is distinct from work.required_event_id
         or work.event_handoff_completed_event_id is distinct from work.required_event_id
       )
     order by work.next_attempt_at, work.required_event_at, work.opportunity_id
     for update skip locked
     limit p_limit
  ), leased as (
    update public.opportunity_phase_c_work work
       set lease_owner = btrim(p_worker_id),
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           attempt_count = work.attempt_count + 1,
           last_attempt_at = now(),
           updated_at = now()
      from claimed
     where work.opportunity_id = claimed.opportunity_id
    returning work.*
  )
  select leased.company_id,
         leased.opportunity_id,
         leased.required_event_id,
         leased.required_event_at,
         leased.required_activity_id,
         leased.required_connection_id,
         leased.required_provider_thread_id,
         leased.attempt_count,
         leased.component_outcomes,
         leased.component_errors
    from leased
   order by leased.required_event_at, leased.opportunity_id;
end;
$function$;

revoke all on function public.claim_opportunity_phase_c_work(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_opportunity_phase_c_work(text, integer, integer)
  to service_role;
