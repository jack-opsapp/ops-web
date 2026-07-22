-- 2026-07-22 production outage remediation (codifies the live hotfix).
--
-- Root cause: a single public.opportunity_correspondence_events row was
-- inserted with is_meaningful = true but its opportunity_projection_applied
-- flag never flipped true. The unbounded pending-projection guard introduced
-- by 20260721143000_email_commercial_outcome_guards.sql treated that
-- permanently-stuck row as forever "pending", so all three guarded RPCs
-- (convert_opportunity_to_project, commit_lead_summary_snapshot,
-- apply_email_opportunity_deferred_disposition) raised
-- 'meaningful correspondence projection pending' (SQLSTATE 40001) on every
-- call. Workers retried 40001 with no backoff or cap, producing a hot retry
-- loop (~1,800 failed transactions/sec) that pinned database CPU and took the
-- API down.
--
-- The fix bounds the guard: only unprojected meaningful events younger than
-- 60 seconds count as "projection pending". Correspondence projection runs
-- under the same opportunity lock as event insertion, so a healthy projection
-- is pending for well under 60 seconds; an unprojected row older than that is
-- a fault to surface (the projection-stuck monitor cron alerts at 5 minutes),
-- not a reason to wedge commercial writes forever.
--
-- This definition was applied live to production on 2026-07-22 and verified
-- byte-identical via pg_get_functiondef before this migration was written.
-- Keep the function text below exactly in sync with production.

begin;

CREATE OR REPLACE FUNCTION private.opportunity_has_pending_meaningful_email(p_company_id uuid, p_opportunity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
  select exists (
    select 1
    from public.opportunity_correspondence_events event
    where event.company_id = p_company_id
      and event.opportunity_id = p_opportunity_id
      and event.is_meaningful is true
      and event.opportunity_projection_applied is false
      and event.created_at > now() - interval '60 seconds'
  );
$function$;

comment on function private.opportunity_has_pending_meaningful_email(
  uuid, uuid
) is
  'True while a meaningful correspondence event inserted within the last 60 seconds is still awaiting counter projection. Bounded on 2026-07-22 so a stuck projection row degrades into a monitored fault instead of permanently blocking the guarded commercial RPCs with SQLSTATE 40001.';

-- create or replace preserves the ACL established by 20260721143000; re-assert
-- the private posture so this migration is also safe standalone.
revoke all on function private.opportunity_has_pending_meaningful_email(
  uuid, uuid
) from public, anon, authenticated, service_role;

commit;
