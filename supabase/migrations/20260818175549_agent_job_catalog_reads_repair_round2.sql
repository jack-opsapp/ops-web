-- Round 2 of the agent job-catalog read repair (2026-08-18).
--
-- plpgsql validates statement semantics lazily, so the first repair round
-- could only surface the first defect per function. Re-running the MCP mount
-- E2E against Maverick exposed the next layer:
--
--   * read_agent_job_summary_as_system (42804): the same uuid/legacy-TEXT
--     opportunity mixing repaired elsewhere in round 1 also occurs five
--     times here (three coalesce fallbacks, two mirror-conflict guards) —
--     round 1 repaired only this function's NULL-coupling defect.
--   * read_agent_job_summary_as_system / read_agent_job_history_as_system
--     (42883): public.estimates.project_id is TEXT while projects.id is
--     uuid, so `estimate.project_id = job.job_id` has no operator. Repaired
--     by casting the uuid side, matching the pattern the wave already used
--     correctly for project_photos (`photo.project_id = project.id::text`).
--   * read_agent_customer_jobs_as_system (42703): the first UNION arm of
--     raw_candidate left its source_data_invalid expression unaliased, so
--     the column materialized as "?column?" and every downstream
--     ranked.source_data_invalid reference failed. UNION column names come
--     from the first arm, so the alias belongs there.
--
-- Same guarded-transformation discipline as round 1: every site must occur
-- exactly the asserted number of times in the live definition or the repair
-- aborts without changing anything.

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
  -- ── read_agent_job_summary_as_system ───────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_job_summary_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],text[],text[])'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 3,
    'coalesce(project.opportunity_ref, project.opportunity_id)',
    e'coalesce(project.opportunity_ref,\n             private.agent_uuid_from_legacy_text(project.opportunity_id))'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 2,
    'and project.opportunity_ref is distinct from project.opportunity_id',
    e'and project.opportunity_ref is distinct from\n          private.agent_uuid_from_legacy_text(project.opportunity_id)'
  );
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_summary_as_system', 1,
    'and estimate.project_id = job.job_id',
    'and estimate.project_id = job.job_id::text'
  );
  execute v_def;

  -- ── read_agent_job_history_as_system ───────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_job_history_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,text,text,text,text,text,text,uuid,text[],jsonb,timestamptz,timestamptz,text[],timestamptz,bigint,bigint,bigint,timestamptz,text,text,integer)'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_job_history_as_system', 1,
    'and estimate.project_id = job.job_id)',
    'and estimate.project_id = job.job_id::text)'
  );
  execute v_def;

  -- ── read_agent_customer_jobs_as_system ─────────────────────────────────
  v_def := pg_get_functiondef(to_regprocedure(
    'public.read_agent_customer_jobs_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,uuid,text[],text[],text[],text[],text,timestamptz,timestamptz,timestamptz,bigint,timestamptz,text,uuid,integer)'
  ));
  v_def := pg_temp.agent_repair_replace(
    v_def, 'read_agent_customer_jobs_as_system', 1,
    e'           opportunity.source_data_invalid\n             or coalesce(project.source_data_invalid, false),',
    e'           opportunity.source_data_invalid\n             or coalesce(project.source_data_invalid, false)\n             as source_data_invalid,'
  );
  execute v_def;
end;
$repair$;