-- Corrective repair for four agent job-catalog read RPCs (2026-08-18).
--
-- The MCP mount E2E on Maverick Projects was the first production execution
-- of these Task 13 read paths; plpgsql validates statement semantics lazily,
-- so four defects survived the wave apply and its parse verification:
--
--   * read_agent_customer_jobs_as_system  (42804): coalesce mixed the uuid
--     projects.opportunity_ref with the legacy TEXT projects.opportunity_id.
--   * read_agent_job_history_as_system    (42804): the same column pair
--     mixed in a CASE branch and an IS DISTINCT FROM.
--   * read_agent_correspondence_evidence_page_as_system (42883): the same
--     pair as a raw uuid = text comparison.
--   * read_agent_job_summary_as_system    (22023): the scope-coupling block
--     evaluated NULL-array expressions (p_readiness_rule_codes && ...,
--     'X' = any(NULL)) to NULL, and NULL IS DISTINCT FROM false is true, so
--     every request omitting readiness_rule_codes / financial_components
--     was rejected — an identity-only summary could never succeed for any
--     caller through any adapter.
--
-- Applied as a guarded transformation of the live definitions: each
-- defective expression must occur exactly the expected number of times in
-- the current definition (which is ledger-md5-verified wave text) or the
-- repair aborts; the repaired definition is then re-executed. Re-executing
-- CREATE OR REPLACE preserves ownership and ACLs. The legacy text column
-- flows through a new shape-guarded immutable cast: a non-uuid legacy value
-- reads as "no linked opportunity" in fallbacks and as a mirror conflict
-- when a real opportunity_ref disagrees — the wave's stated intent.
-- Local equivalence proof: this transform over the wave originals produces
-- definitions byte-identical to the reviewed whole-body corrective.

create or replace function private.agent_uuid_from_legacy_text(
  p_value text
) returns uuid
language sql
immutable
set search_path to 'pg_catalog', 'pg_temp'
as $helper$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then lower(p_value)::uuid
  end;
$helper$;

revoke all on function private.agent_uuid_from_legacy_text(text)
  from public, anon, authenticated, service_role;

create function pg_temp.agent_repair_replace(
  p_def text,
  p_fn text,
  p_expected integer,
  p_old text,
  p_new text
) returns text
language plpgsql
as $tmp$
declare
  v_count integer;
begin
  v_count := (length(p_def) - length(replace(p_def, p_old, '')))
    / length(p_old);
  if v_count is distinct from p_expected then
    raise exception
      'repair site drifted in % (found %, expected %): %',
      p_fn, v_count, p_expected, left(p_old, 60);
  end if;
  return replace(p_def, p_old, p_new);
end;
$tmp$;

do $repair$
declare
  v_def text;
begin
  -- ── read_agent_customer_jobs_as_system ─────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_customer_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer)'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_customer_jobs_as_system', 1,
    e'coalesce(project.opportunity_ref, project.opportunity_id)\n             as linked_opportunity_id,',
    e'coalesce(project.opportunity_ref,\n               private.agent_uuid_from_legacy_text(project.opportunity_id))\n             as linked_opportunity_id,'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_customer_jobs_as_system', 1,
    'and project.opportunity_id is distinct from project.opportunity_ref',
    e'and private.agent_uuid_from_legacy_text(project.opportunity_id)\n               is distinct from project.opportunity_ref'
  );
  execute v_def;

  -- ── read_agent_job_history_as_system ───────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer)'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_history_as_system', 1,
    'then project.opportunity_ref else project.opportunity_id end',
    e'then project.opportunity_ref\n             else private.agent_uuid_from_legacy_text(project.opportunity_id) end'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_history_as_system', 1,
    'and project.opportunity_ref is distinct from project.opportunity_id',
    e'and project.opportunity_ref is distinct from\n               private.agent_uuid_from_legacy_text(project.opportunity_id)'
  );
  execute v_def;

  -- ── read_agent_correspondence_evidence_page_as_system ──────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_correspondence_evidence_page_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text)'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_correspondence_evidence_page_as_system', 1,
    'then project.opportunity_ref else project.opportunity_id end',
    e'then project.opportunity_ref\n         else private.agent_uuid_from_legacy_text(project.opportunity_id) end'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_correspondence_evidence_page_as_system', 1,
    'and project.opportunity_ref is distinct from project.opportunity_id',
    e'and project.opportunity_ref is distinct from\n         private.agent_uuid_from_legacy_text(project.opportunity_id)'
  );
  execute v_def;

  -- ── read_agent_job_summary_as_system ───────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_job_summary_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[])'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 2,
    e'p_readiness_rule_codes && array[\n         ''SCHEDULE_UNCONFIRMED'', ''CREW_UNASSIGNED''\n       ]::text[]',
    e'coalesce(p_readiness_rule_codes && array[\n         ''SCHEDULE_UNCONFIRMED'', ''CREW_UNASSIGNED''\n       ]::text[], false)'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 1,
    e'or ''CUSTOMER_RECORD_UNRESOLVED'' = any(p_readiness_rule_codes)\n     ) is distinct from (p_clients_scope is not null)',
    e'or coalesce(\n         ''CUSTOMER_RECORD_UNRESOLVED'' = any(p_readiness_rule_codes), false\n       )\n     ) is distinct from (p_clients_scope is not null)'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 1,
    e'or (''SITE_PHOTOS_MISSING'' = any(p_readiness_rule_codes)) is distinct from\n       (p_photos_scope is not null)',
    e'or coalesce(''SITE_PHOTOS_MISSING'' = any(p_readiness_rule_codes), false)\n       is distinct from (p_photos_scope is not null)'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 1,
    e'or (''estimate_rollup'' = any(p_financial_components)) is distinct from\n       (p_estimates_scope is not null)',
    e'or coalesce(''estimate_rollup'' = any(p_financial_components), false)\n       is distinct from (p_estimates_scope is not null)'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 1,
    e'or (''invoice_rollup'' = any(p_financial_components)) is distinct from\n       (p_invoices_scope is not null)',
    e'or coalesce(''invoice_rollup'' = any(p_financial_components), false)\n       is distinct from (p_invoices_scope is not null)'
  );
  execute v_def;
end;
$repair$;
