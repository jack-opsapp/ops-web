-- INCIDENT FIX — lead disposition/archive UNDO could never succeed.
--
-- STATUS: APPLIED to prod ijeekuhbatykdomumfjx on 2026-07-30 via MCP
-- apply_migration (name: lead_feedback_undo_timestamp_truth). This file is the
-- repo record of that applied change. Idempotent in effect but guarded: on a
-- re-run the drift guard finds 0 clock_timestamp declarations and aborts
-- loudly rather than silently double-applying.
--
-- ROOT CAUSE
-- public.update_timestamp() is a BEFORE UPDATE trigger on public.opportunities
-- that stamps `NEW.updated_at = now()` — the TRANSACTION timestamp, fixed for
-- the whole transaction. The feedback RPCs captured
-- `v_now := clock_timestamp()` a few milliseconds later, wrote
-- `updated_at = v_now`, then recorded `applied_opportunity_updated_at = v_now`
-- as "the state I wrote". The trigger silently overwrote the column with
-- now(), so the recorded snapshot was NEVER the persisted value (observed
-- drift ~3.4ms on every row, snapshot always LATER than the row).
--
-- undo_* compares opportunity.updated_at against applied_opportunity_updated_at
-- and raises `feedback_undo_conflict` (errcode 40001) when they differ. They
-- always differed, so undo failed 100% of the time — and 40001
-- (serialization_failure) reads as transient, so the client retried a
-- permanently-failing call in a loop (~100 errors/second observed in prod
-- postgres logs, 2026-07-30 16:34:48 UTC). Bug row 7bee2ebc.
--
-- FIX
-- Capture v_now with now() in all four functions (apply/undo × disposition/
-- archive) so the recorded snapshot is byte-identical to what the trigger
-- writes — exact by construction rather than by luck.

do $migration$
declare
  v_fn      text;
  v_def     text;
  v_hits    integer;
  v_needle  constant text := 'v_now timestamptz := clock_timestamp();';
  v_replace constant text := 'v_now timestamptz := now();';
begin
  foreach v_fn in array array[
    'apply_lead_disposition_feedback',
    'undo_lead_disposition_feedback',
    'apply_lead_archive_feedback',
    'undo_lead_archive_feedback'
  ]
  loop
    select pg_get_functiondef(p.oid)
      into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;

    if v_def is null then
      raise exception 'function public.% not found — refusing to patch', v_fn;
    end if;

    v_hits := (length(v_def) - length(replace(v_def, v_needle, ''))) / length(v_needle);

    if v_hits <> 1 then
      raise exception
        'expected exactly 1 clock_timestamp declaration in public.%, found % — re-read the live definition before applying',
        v_fn, v_hits;
    end if;

    execute replace(v_def, v_needle, v_replace);
  end loop;
end
$migration$;
