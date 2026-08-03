-- =====================================================================
-- DRAFT — NOT APPLIED. DO NOT RUN WITHOUT PM SIGN-OFF.
-- =====================================================================
-- This file is a drafted fix authored during the iOS bug sweep
-- (WS-B, bug ced5b3cb). It has NOT been executed against any Supabase
-- project — not prod, not a branch, not the sandbox. It is committed as
-- a reviewable artifact only. The iOS client shipped in the same sweep
-- feature-detects the defect described below and works correctly with
-- or without this migration.
--
-- ---------------------------------------------------------------------
-- DEFECT
-- ---------------------------------------------------------------------
-- `public.convert_opportunity_to_project` has one branch that computes a
-- real project-access answer:
--
--     v_project_id := private.try_parse_uuid(v_result ->> 'project_id');
--     if v_actor_user_id is not null and v_project_id is not null then
--       v_project_accessible := private.user_can_view_project(...);
--     end if;
--     return v_result || jsonb_build_object(
--       ..., 'project_accessible', coalesce(v_project_accessible, false));
--
-- Every other return path hardcodes `'project_accessible', false`. For the
-- guard branches (`guard_reason` = 'snapshot_mismatch' /
-- 'assignment_snapshot_mismatch') that is harmless — the client throws on
-- the guard decision before it ever reads the flag.
--
-- The IDEMPOTENT ALREADY-CONVERTED branch is different. It hands back a
-- REAL, actor-visible project id:
--
--     return v_result || jsonb_build_object(
--       'converted', false,
--       'already_converted', true,
--       'guard_reason', 'already_converted',
--       'project_id', v_link_to_project_id,   -- <= real identity
--       ...
--       'project_accessible', false           -- <= hardcoded, not computed
--     );
--
-- ...while asserting the project is inaccessible. That combination is a
-- lie the client cannot distinguish from a genuine access denial, and it
-- drove bug ced5b3cb-B on iOS: the DUPLICATE-EXISTS footer's OPEN PROJECT
-- action reached this branch, the client read `project_accessible = false`,
-- and its "committed but inaccessible" handler NULLED the opportunity's
-- local project link and set a PERSISTED presentation marker that
-- permanently hid MATCH PROJECT for that lead — while opening nothing.
--
-- Note the branch is reached only when the actor is non-null and the
-- opportunity already carried a project pointer, or (actorless service
-- path) on an exact completed retry. In the actor case the function has
-- both the actor and the project in scope, so the real answer is one
-- existing helper call away.
--
-- ---------------------------------------------------------------------
-- FIX
-- ---------------------------------------------------------------------
-- Compute `project_accessible` on the already-converted branch the same
-- way the success branch does. Actorless (service-role) callers keep
-- `false` — there is no actor whose visibility could be evaluated, which
-- is exactly the existing semantic of the success branch's
-- `if v_actor_user_id is not null` guard.
--
-- The function body is ~29 KB and the database is its source of truth
-- (it has been amended by several migrations). Re-emitting the whole
-- body here would silently revert any change landed after this file was
-- authored, so the patch is applied SURGICALLY against the live
-- definition and FAILS LOUDLY if the target text is not present exactly
-- once. Re-running it after it has been applied is a no-op-with-error,
-- not a silent double-apply.
--
-- ---------------------------------------------------------------------
-- SENTINEL VERIFICATION (run BEFORE applying — expect needle_count = 1)
-- ---------------------------------------------------------------------
--   with d as (
--     select pg_get_functiondef(p.oid) as def
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where p.proname = 'convert_opportunity_to_project'
--        and n.nspname = 'public'
--   )
--   select (select count(*)
--             from regexp_matches(
--               def,
--               '''linked_existing'', v_existing_linked_existing',
--               'g')) as needle_count,
--          (select count(*)
--             from regexp_matches(def, '''project_accessible'', false', 'g'))
--            as hardcoded_false_count
--     from d;
--
--   Expected BEFORE: needle_count = 1, hardcoded_false_count = 7
--   Expected AFTER:  needle_count = 1, hardcoded_false_count = 6
--
-- ---------------------------------------------------------------------
-- SENTINEL VERIFICATION (run AFTER applying — behavioural)
-- ---------------------------------------------------------------------
-- Against a company you may safely touch, pick an opportunity that is
-- ALREADY converted and whose project the actor can view, then re-run the
-- idempotent conversion and read the flag. This is READ-SAFE only in the
-- sense that the RPC is idempotent on an already-converted row — it still
-- writes an audit event, so run it on a sandbox/branch first.
--
--   select (public.convert_opportunity_to_project(
--             p_company_id                  => '<company-uuid>',
--             p_opportunity_id              => '<already-converted-opp-uuid>',
--             p_actual_value                => null,
--             p_expected_stage              => 'won',
--             p_decided_by                  => '<actor-user-uuid>',
--             p_notes                       => null,
--             p_title_override              => null,
--             p_link_to_project_id          => null,
--             p_source_path                 => 'sentinel',
--             p_win_opportunity             => true,
--             p_project_status              => 'accepted',
--             p_evidence                    => '{"surface":"sentinel"}'::jsonb,
--             p_expected_assignment_version => <assignment_version>
--          ))
--          ->> 'project_accessible' as project_accessible;
--
--   Expected BEFORE: 'false'   (the defect)
--   Expected AFTER:  'true'    (actor can view the linked project)
--
-- ---------------------------------------------------------------------
-- CLIENT COMPATIBILITY
-- ---------------------------------------------------------------------
-- iOS (fix/conversion-matching-cluster) treats the already-converted
-- branch's `project_accessible` as NON-AUTHORITATIVE: when
-- `already_converted = true` and a non-empty `project_id` is present, it
-- recovers the project by identity and never clears local link state.
-- After this migration lands, that recovery path simply stops being
-- exercised — `project_accessible = true` routes through the ordinary
-- accessible-project branch. No client release is gated on this file.
-- =====================================================================

do $migration$
declare
  v_def   text;
  v_hits  integer;
  v_needle constant text :=
$needle$'linked_existing', v_existing_linked_existing,
      'won', v_opp.stage = 'won',
      'project_accessible', false
    );
  end if$needle$;
  v_replacement constant text :=
$replacement$'linked_existing', v_existing_linked_existing,
      'won', v_opp.stage = 'won',
      -- Bug ced5b3cb — this branch returns a REAL project id, so it must
      -- return a REAL access answer. Actorless service callers keep false:
      -- there is no actor whose visibility could be evaluated.
      'project_accessible', case
        when v_actor_user_id is null then false
        else coalesce(
          private.user_can_view_project(v_actor_user_id, v_link_to_project_id),
          false
        )
      end
    );
  end if$replacement$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'convert_opportunity_to_project'
     and n.nspname = 'public';

  if v_def is null then
    raise exception
      'convert_opportunity_to_project not found — refusing to patch';
  end if;

  -- Idempotency + drift guard in one. Zero hits means either the patch is
  -- already applied or the branch was rewritten upstream; both demand a
  -- human re-read of the live source, never a silent skip.
  select count(*) into v_hits
    from regexp_matches(v_def, regexp_replace(v_needle, '([().*+?\[\]{}|^$\\])', '\\\1', 'g'), 'g');

  if v_hits <> 1 then
    raise exception
      'expected exactly 1 already-converted return to patch, found % — re-read the live definition before applying',
      v_hits;
  end if;

  execute replace(v_def, v_needle, v_replacement);
end
$migration$;
