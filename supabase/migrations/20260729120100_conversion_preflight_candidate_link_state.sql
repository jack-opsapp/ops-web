-- =====================================================================
-- APPLIED to prod ijeekuhbatykdomumfjx on 2026-07-30 via MCP apply_migration
-- (name: conversion_preflight_candidate_link_state). Post-apply sentinel
-- verified: already_linked annotation present in the live definition.
-- DO NOT RE-RUN: the already-annotated guard aborts loudly.
-- =====================================================================
-- Authored during the iOS bug sweep (WS-B, bug 5468b3c6). NOT executed
-- against any Supabase project — not prod, not a branch, not the sandbox.
-- Committed as a reviewable artifact only. The iOS client shipped in the
-- same sweep does not depend on it; this migration RETIRES a client-side
-- workaround rather than enabling a client feature.
--
-- ---------------------------------------------------------------------
-- THE ASYMMETRY
-- ---------------------------------------------------------------------
-- `public.get_conversion_preflight` filters its `duplicate_candidates`
-- purely on AUTHORIZATION:
--
--     and private.user_can_view_project(v_actor_user_id, p.id)
--     and private.user_can_link_opportunity_to_project(v_actor_user_id, p.id)
--
-- ...and `private.user_can_link_opportunity_to_project` is
-- `user_can_view_project AND user_can_edit_project` — permissions only.
-- It says nothing about whether the project is ALREADY LINKED to a
-- different opportunity.
--
-- `public.convert_opportunity_to_project`, by contrast, hard-rejects a
-- link whose target already belongs to another opportunity:
--
--     raise exception 'linked project belongs to another opportunity'
--       using errcode = '23505';
--
-- So the preflight can, and does, offer MATCH candidates the commit will
-- refuse. iOS papered over this with a second round-trip
-- (`LeadConversionService.matchableCandidateProjectIds`) that re-reads
-- `projects.opportunity_id` / `projects.opportunity_ref` and filters
-- locally. That workaround is what produced bug 5468b3c6: when it
-- filtered EVERY candidate away, the sheet synthesized a client-side
-- "requires admin review" blocker and disabled both MATCH and CREATE,
-- stranding the operator with no explanation and no next action.
--
-- ---------------------------------------------------------------------
-- FIX
-- ---------------------------------------------------------------------
-- Annotate each candidate with its LINK STATE and let the client render
-- honestly instead of guessing:
--
--     "already_linked": true | false
--
-- true  => the project's opportunity mirrors point at some OTHER
--          opportunity (or at an unparseable legacy value). MATCH will be
--          rejected by the commit; the client shows it review-only.
-- false => unlinked, or already linked to THIS opportunity. Safe to offer
--          as a MATCH target.
--
-- The predicate mirrors the commit's own rejection test — both mirrors
-- (`opportunity_ref uuid`, legacy `opportunity_id text`), and an
-- unparseable legacy value counts as linked-elsewhere because the commit
-- treats it that way.
--
-- Candidates are NOT dropped from the payload. A same-address project the
-- operator cannot match is exactly the thing they need to SEE — hiding it
-- would restore the dead end from the other direction. Duplicate
-- prevention (the same-address create block) is unchanged by this file.
--
-- ---------------------------------------------------------------------
-- CLIENT RETIREMENT (follow-up, NOT part of this migration)
-- ---------------------------------------------------------------------
-- Once this is live, iOS can delete `matchableCandidateProjectIds` and
-- read `already_linked` straight off each candidate. Until then the
-- client keeps its own re-check; the two agree, so applying this file
-- changes no client behaviour on its own. `PreflightCandidate` already
-- decodes defensively (unknown keys ignored, missing keys defaulted), so
-- a SHIPPED iOS build tolerates the new key immediately — additive-only,
-- per the iOS/Supabase schema contract.
--
-- ---------------------------------------------------------------------
-- SENTINEL VERIFICATION (run BEFORE applying)
-- ---------------------------------------------------------------------
--   with d as (
--     select pg_get_functiondef(p.oid) as def
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where p.proname = 'get_conversion_preflight' and n.nspname = 'public'
--   )
--   select (select count(*) from regexp_matches(def, '''signals'', case', 'g'))
--            as needle_count,
--          (select count(*) from regexp_matches(def, 'already_linked', 'g'))
--            as annotation_count
--     from d;
--
--   Expected BEFORE: needle_count = 1, annotation_count = 0
--   Expected AFTER:  needle_count = 1, annotation_count > 0
--
-- ---------------------------------------------------------------------
-- SENTINEL VERIFICATION (run AFTER applying — behavioural, READ-ONLY)
-- ---------------------------------------------------------------------
-- `get_conversion_preflight` is STABLE and writes nothing, so this is
-- safe to run against prod as the service role.
--
--   select jsonb_pretty(
--            jsonb_path_query_array(
--              public.get_conversion_preflight(
--                p_opportunity_id => '<opportunity-uuid>',
--                p_company_id     => '<company-uuid>',
--                p_actor_user_id  => '<actor-user-uuid>'
--              ),
--              '$.duplicate_candidates[*]'
--            )
--          );
--
--   Expected AFTER: every element carries "already_linked": true|false.
--
--   Cross-check one annotated candidate against the raw mirrors:
--
--   select p.id, p.opportunity_ref, p.opportunity_id
--     from public.projects p
--    where p.id = '<candidate-project-uuid>';
--
--   already_linked must be true iff a mirror names an opportunity other
--   than the one passed above (or the legacy text value cannot parse as
--   a uuid).
-- =====================================================================

do $migration$
declare
  v_def   text;
  v_hits  integer;
  v_needle constant text :=
$needle$'signals', case$needle$;
  v_replacement constant text :=
$replacement$-- Bug 5468b3c6 — link state, so the client never offers a MATCH the
          -- commit will reject and never has to guess by re-reading the row.
          -- Mirrors the commit's own rejection test: either mirror naming a
          -- different opportunity counts as linked, and an unparseable legacy
          -- value counts as linked because the commit treats it that way.
          'already_linked', (
            (
              p.opportunity_ref is not null
              and p.opportunity_ref is distinct from p_opportunity_id
            )
            or (
              nullif(btrim(coalesce(p.opportunity_id::text, '')), '') is not null
              and (
                private.try_parse_uuid(p.opportunity_id::text) is null
                or private.try_parse_uuid(p.opportunity_id::text)
                     is distinct from p_opportunity_id
              )
            )
          ),
          'signals', case$replacement$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'get_conversion_preflight'
     and n.nspname = 'public';

  if v_def is null then
    raise exception
      'get_conversion_preflight not found — refusing to patch';
  end if;

  if position('already_linked' in v_def) > 0 then
    raise exception
      'get_conversion_preflight already annotates candidates — nothing to apply';
  end if;

  -- The candidate payload is the only 'signals' key in this function.
  -- A count other than 1 means the function was rewritten upstream and
  -- this patch must be re-authored against the live source, never guessed.
  select count(*) into v_hits
    from regexp_matches(v_def, '''signals'', case', 'g');

  if v_hits <> 1 then
    raise exception
      'expected exactly 1 candidate signals block to patch, found % — re-read the live definition before applying',
      v_hits;
  end if;

  execute replace(v_def, v_needle, v_replacement);
end
$migration$;
