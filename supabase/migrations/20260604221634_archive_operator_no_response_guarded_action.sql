-- Archive-first auto-cleanup: introduce the `archive_operator_no_response`
-- guarded action.
--
-- Context: the lead-lifecycle cron previously moved beyond-qualified leads with
-- an unanswered customer inbound to "lost". Per product direction the auto
-- cleanup must only ever ARCHIVE (a reversible, judgment-free disposition);
-- classifying lost vs. archived vs. discarded is deferred to phase C's
-- intelligent determination. The evaluator now emits `archive_operator_no_response`
-- for any active-stage lead whose meaningful inbound went unanswered past the
-- no-response window (covers early-stage "forgot to follow up" leads too).
--
-- This action archives identically to `archive_no_meaningful_correspondence`
-- (sets archived_at; no stage change, no disposition row). The
-- `move_to_lost_operator_no_response` machinery is left fully intact for phase C
-- to drive later.
--
-- Two changes:
--   1. Extend the audit table's action CHECK to accept the new value.
--   2. Add the new value to the guarded-executor RPC's allow-list + archive
--      branches. To avoid hand-retyping the 200-line SECURITY DEFINER body
--      (transcription risk on a privileged function), we patch the live source
--      via pg_get_functiondef + targeted string replacement, asserting exactly
--      five insertions before EXECUTE. Idempotent: re-running is a no-op.

-- 1. Audit action CHECK ───────────────────────────────────────────────────────
alter table public.opportunity_lifecycle_action_audit
  drop constraint if exists opportunity_lifecycle_action_audit_action_check;

alter table public.opportunity_lifecycle_action_audit
  add constraint opportunity_lifecycle_action_audit_action_check
  check (action = any (array[
    'archive_after_two_unanswered_followups',
    'archive_no_meaningful_correspondence',
    'archive_operator_no_response',
    'move_to_lost_operator_no_response',
    'reactivate_on_related_inbound'
  ]::text[]));

-- 2. Guarded-executor RPC allow-list + archive branches ───────────────────────
do $mig$
declare
  v_src  text;
  v_new  text;
  v_hits integer;
begin
  select pg_get_functiondef(p.oid)
    into v_src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'execute_opportunity_lifecycle_guarded_action'
    and p.prokind = 'f';

  if v_src is null then
    raise exception 'execute_opportunity_lifecycle_guarded_action not found';
  end if;

  -- Idempotency: already migrated → no-op.
  if position('archive_operator_no_response' in v_src) > 0 then
    raise notice 'archive_operator_no_response already present; skipping function patch';
    return;
  end if;

  v_new := v_src;

  -- (B) Allow-list: ...correspondence', <nl> 'move_to_lost...  (1 occurrence)
  v_new := replace(
    v_new,
    E'\'archive_no_meaningful_correspondence\',\n    \'move_to_lost_operator_no_response\',',
    E'\'archive_no_meaningful_correspondence\',\n    \'archive_operator_no_response\',\n    \'move_to_lost_operator_no_response\','
  );

  -- (A) The two 4-item archive groups (allowed_keys + before_values):
  --     ...correspondence', <nl> 'reactivate...  (2 occurrences)
  v_new := replace(
    v_new,
    E'\'archive_no_meaningful_correspondence\',\n    \'reactivate_on_related_inbound\'',
    E'\'archive_no_meaningful_correspondence\',\n    \'archive_operator_no_response\',\n    \'reactivate_on_related_inbound\''
  );

  -- (C) The two 2-item archive-only groups (payload guard + update):
  --     ...correspondence' <nl> ) then   (2 occurrences, no trailing comma)
  v_new := replace(
    v_new,
    E'\'archive_no_meaningful_correspondence\'\n  ) then',
    E'\'archive_no_meaningful_correspondence\',\n    \'archive_operator_no_response\'\n  ) then'
  );

  -- Assert exactly five insertions landed (1 + 2 + 2). Any pattern drift →
  -- abort with zero changes to the live function.
  v_hits := (length(v_new) - length(replace(v_new, 'archive_operator_no_response', '')))
            / length('archive_operator_no_response');
  if v_hits <> 5 then
    raise exception 'expected 5 archive_operator_no_response insertions, got %; aborting function patch', v_hits;
  end if;

  execute v_new;
end
$mig$;
