-- Maverick MCP read repairs. New forward migration; no business-row writes.
-- Exact source hashes fence unexpected production drift and make replay harmless.
-- Conversation RPCs return a strict raw snapshot, not a manifest proof envelope.
-- Keep wrapper input/revision validation; only remove incompatible result reproof.
-- The TypeScript repository validates that snapshot against its authorization proof.
begin;
-- Refuse to overwrite an unexpected helper from another release.
do $helper_guard$
declare v_existing oid := pg_catalog.to_regprocedure('private.agent_task_read_instant(timestamptz,boolean,text,boolean)');
begin
  if v_existing is not null and pg_catalog.md5(pg_catalog.pg_get_functiondef(v_existing)) <> '7b5cce75d56b38344bbf90f0b8804b09' then
    raise exception 'agent_maverick_read_repair_source_drift: agent_task_read_instant' using errcode='55000';
  end if;
end;
$helper_guard$;
-- Stored task dates encode inclusive civil date labels via their UTC date part,
-- as in the established job-summary/scheduled-jobs readers. Resolve each civil
-- midnight independently; adding 24 hours is wrong across DST transitions.
create or replace function private.agent_task_read_instant(
  p_date timestamptz, p_all_day boolean, p_timezone text, p_end_exclusive boolean
) returns timestamptz
language plpgsql stable set search_path = ''
as $function$
declare
  v_date date;
  v_instant timestamptz;
begin
  if p_date is null then return null; end if;
  if not coalesce(p_all_day,false) then return p_date; end if;
  if not pg_catalog.isfinite(p_date)
     or extract(year from p_date at time zone 'UTC') not between 1 and 9999
     or p_timezone is null or not exists (
       select 1 from pg_catalog.pg_timezone_names zone where zone.name=p_timezone
     ) then
    raise exception 'agent_task_schedule_source_invalid' using errcode='22000';
  end if;
  v_date := (p_date at time zone 'UTC')::date + case when p_end_exclusive then 1 else 0 end;
  v_instant := private.agent_civil_date_start(v_date,p_timezone);
  if v_instant is null or extract(year from v_instant at time zone 'UTC') not between 1 and 9999 then
    raise exception 'agent_task_schedule_source_invalid' using errcode='22000';
  end if;
  return v_instant;
end;
$function$;
revoke all on function private.agent_task_read_instant(timestamptz,boolean,text,boolean) from public,anon,authenticated,service_role;

-- read_agent_job_conversation_context_v3_impl: preserve function identity, owner, ACL and security settings.
do $repair_0$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.read_agent_job_conversation_context_v3_impl(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'));
begin
  if pg_catalog.md5(v_definition) = 'de9ef17cac7ead271ae370e3014f2802' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> '2f5eb3800e9c8ec5d8b8aa94af62c387' then
    raise exception 'agent_maverick_read_repair_source_drift: read_agent_job_conversation_context_v3_impl' using errcode = '55000';
  end if;
  -- Replace source characters 21431..21530: '           context_provider_source.source_sha256,\n           context_provider_source.source_sha256,\n'
  v_definition := overlay(v_definition placing $edit_0_0$           context_provider_source.source_sha256 as provider_delivery_source_sha256,
           context_provider_source.source_sha256 as original_content_hash,
$edit_0_0$ from 21431 for 100);
  -- Replace source characters 13222..13271: '           context_provider_source.source_sha256,\n'
  v_definition := overlay(v_definition placing $edit_0_1$           context_provider_source.source_sha256 as original_content_hash,
$edit_0_1$ from 13222 for 50);
  -- Replace source characters 12992..13046: '           context_provider_source.normalized_subject,\n'
  v_definition := overlay(v_definition placing $edit_0_2$           context_provider_source.normalized_subject as subject,
$edit_0_2$ from 12992 for 55);
  -- Replace source characters 12858..12907: '           context_provider_source.source_sha256,\n'
  v_definition := overlay(v_definition placing $edit_0_3$           context_provider_source.source_sha256 as provider_delivery_source_sha256,
$edit_0_3$ from 12858 for 50);
  -- Replace source characters 12707..12756: '           context_provider_source.connection_id,\n'
  v_definition := overlay(v_definition placing $edit_0_4$           context_provider_source.connection_id as source_connection_id,
$edit_0_4$ from 12707 for 50);

  if pg_catalog.md5(v_definition) <> 'de9ef17cac7ead271ae370e3014f2802' then
    raise exception 'agent_maverick_read_repair_output_invalid: read_agent_job_conversation_context_v3_impl' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_0$;

-- read_agent_job_conversation_context_as_system_v6_core: preserve function identity, owner, ACL and security settings.
do $repair_1$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.read_agent_job_conversation_context_as_system_v6_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'));
begin
  if pg_catalog.md5(v_definition) = '93ffeb120ce6bf5abe340ba423b2b95d' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> 'd4581cdba6e3ee308ad9c547a385c8e0' then
    raise exception 'agent_maverick_read_repair_source_drift: read_agent_job_conversation_context_as_system_v6_core' using errcode = '55000';
  end if;
  -- Replace source characters 1681..1722: '    ),\n    p_capability_manifest_revision\n'
  v_definition := overlay(v_definition placing $edit_1_0$$edit_1_0$ from 1681 for 42);
  -- Replace source characters 1148..1262: '  return private.reprove_agent_read_jsonb_for_manifest(\n    private.read_agent_job_conversation_context_v6_bridge(\n'
  v_definition := overlay(v_definition placing $edit_1_1$  return private.read_agent_job_conversation_context_v6_bridge(
$edit_1_1$ from 1148 for 115);

  if pg_catalog.md5(v_definition) <> '93ffeb120ce6bf5abe340ba423b2b95d' then
    raise exception 'agent_maverick_read_repair_output_invalid: read_agent_job_conversation_context_as_system_v6_core' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_1$;

-- read_agent_job_conversation_context_as_system_v7_core: preserve function identity, owner, ACL and security settings.
do $repair_2$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.read_agent_job_conversation_context_as_system_v7_core(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'));
begin
  if pg_catalog.md5(v_definition) = '0898a24a5fcdadcc0bda8199d682422e' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> 'b5078a0641ebea2da13a4436fd9c5b63' then
    raise exception 'agent_maverick_read_repair_source_drift: read_agent_job_conversation_context_as_system_v7_core' using errcode = '55000';
  end if;
  -- Replace source characters 1939..2056: "  return private.reprove_agent_read_jsonb_for_manifest(\n    v_v6_result,\n    '2026-08-20.capability-manifest.v7'\n  );\n"
  v_definition := overlay(v_definition placing $edit_2_0$  return v_v6_result;
$edit_2_0$ from 1939 for 118);

  if pg_catalog.md5(v_definition) <> '0898a24a5fcdadcc0bda8199d682422e' then
    raise exception 'agent_maverick_read_repair_output_invalid: read_agent_job_conversation_context_as_system_v7_core' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_2$;

-- read_agent_job_conversation_context_as_system: preserve function identity, owner, ACL and security settings.
do $repair_3$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.read_agent_job_conversation_context_as_system(text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,uuid,integer,text[],uuid)'));
begin
  if pg_catalog.md5(v_definition) = '5016e2f58f4bde33ab4da4f2e7551924' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> '2e8484c649c613cdf083035cbef0846a' then
    raise exception 'agent_maverick_read_repair_source_drift: read_agent_job_conversation_context_as_system' using errcode = '55000';
  end if;
  -- Replace source characters 2066..2176: "  return private.reprove_agent_read_jsonb_for_manifest(\n    v_result, '2026-08-22.capability-manifest.v8'\n  );\n"
  v_definition := overlay(v_definition placing $edit_3_0$  return v_result;
$edit_3_0$ from 2066 for 111);

  if pg_catalog.md5(v_definition) <> '5016e2f58f4bde33ab4da4f2e7551924' then
    raise exception 'agent_maverick_read_repair_output_invalid: read_agent_job_conversation_context_as_system' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_3$;

-- agent_p2_task_context_v1: preserve function identity, owner, ACL and security settings.
do $repair_4$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.agent_p2_task_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,text,uuid,text[],integer,integer,integer)'));
begin
  if pg_catalog.md5(v_definition) = '180d494b43178a0a154e9166d4b1b2e3' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> '81d9cf54908ca562221dd7a9b7fe3616' then
    raise exception 'agent_maverick_read_repair_source_drift: agent_p2_task_context_v1' using errcode = '55000';
  end if;
  -- Replace source characters 38278..38344: '                     then private.agent_rfc3339_utc(task.end_date)\n'
  v_definition := overlay(v_definition placing $edit_4_0$                     then private.agent_rfc3339_utc(private.agent_task_read_instant(
                       task.end_date,task.all_day,task.company_timezone,true
                     ))
$edit_4_0$ from 38278 for 67);
  -- Replace source characters 37906..37974: '                     then private.agent_rfc3339_utc(task.start_date)\n'
  v_definition := overlay(v_definition placing $edit_4_1$                     then private.agent_rfc3339_utc(private.agent_task_read_instant(
                       task.start_date,task.all_day,task.company_timezone,false
                     ))
$edit_4_1$ from 37906 for 69);
  -- Replace source characters 10162..10161: ''
  v_definition := overlay(v_definition placing $edit_4_2$           context.company_timezone,
$edit_4_2$ from 10162 for 0);
  -- Replace source characters 6713..6771: '    select task_revision.source_revision as task_revision,\n'
  v_definition := overlay(v_definition placing $edit_4_3$    select company.timezone as company_timezone,
           task_revision.source_revision as task_revision,
$edit_4_3$ from 6713 for 59);

  if pg_catalog.md5(v_definition) <> '180d494b43178a0a154e9166d4b1b2e3' then
    raise exception 'agent_maverick_read_repair_output_invalid: agent_p2_task_context_v1' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_4$;

-- agent_p2_task_list_v1: preserve function identity, owner, ACL and security settings.
do $repair_5$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.agent_p2_task_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text[],text,text,text,text,uuid,uuid,text[],timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,timestamp with time zone,jsonb,text,uuid)'));
begin
  if pg_catalog.md5(v_definition) = '06acd5ff2237f7c797a838176c453188' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> 'c3eb7f2890dbf4b31507b13365e46b61' then
    raise exception 'agent_maverick_read_repair_source_drift: agent_p2_task_list_v1' using errcode = '55000';
  end if;
  -- Replace source characters 16514..16584: '            or coalesce(task.end_date, task.start_date) < task.read_at\n'
  v_definition := overlay(v_definition placing $edit_5_0$            or task.read_ends_at <= task.read_at
$edit_5_0$ from 16514 for 71);
  -- Replace source characters 16022..16078: '          and coalesce(task.end_date, task.start_date) <\n'
  v_definition := overlay(v_definition placing $edit_5_1$          and task.read_ends_at <=
$edit_5_1$ from 16022 for 57);
  -- Replace source characters 15771..15881: '          and task.start_date < p_window_ends_before\n          and coalesce(task.end_date, task.start_date) >=\n'
  v_definition := overlay(v_definition placing $edit_5_2$          and task.read_starts_at < p_window_ends_before
          and task.read_ends_at >
$edit_5_2$ from 15771 for 111);
  -- Replace source characters 12982..12981: ''
  v_definition := overlay(v_definition placing $edit_5_3$           private.agent_task_read_instant(task.start_date,task.all_day,context.company_timezone,false) as read_starts_at,
           private.agent_task_read_instant(coalesce(task.end_date,task.start_date),task.all_day,context.company_timezone,true) as read_ends_at,
$edit_5_3$ from 12982 for 0);
  -- Replace source characters 9628..9686: '    select task_revision.source_revision as task_revision,\n'
  v_definition := overlay(v_definition placing $edit_5_4$    select company.timezone as company_timezone,
           task_revision.source_revision as task_revision,
$edit_5_4$ from 9628 for 59);

  if pg_catalog.md5(v_definition) <> '06acd5ff2237f7c797a838176c453188' then
    raise exception 'agent_maverick_read_repair_output_invalid: agent_p2_task_list_v1' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_5$;

-- agent_p2_task_attention_v1: preserve function identity, owner, ACL and security settings.
do $repair_6$
declare
  v_definition text := pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)'));
begin
  if pg_catalog.md5(v_definition) = '12a9305eb5fd49221fb3fd17eca1d95b' then return; end if;
  if v_definition is null or pg_catalog.md5(v_definition) <> '59ad76a7e5de072587b4ec74e56ece3f' then
    raise exception 'agent_maverick_read_repair_source_drift: agent_p2_task_attention_v1' using errcode = '55000';
  end if;
  -- Replace source characters 6819..6880: '        or coalesce(raw.end_date, raw.start_date) < p_read_at\n'
  v_definition := overlay(v_definition placing $edit_6_0$        or raw.read_ends_at <= p_read_at
$edit_6_0$ from 6819 for 62);
  -- Replace source characters 6169..6201: '             else raw.start_date\n'
  v_definition := overlay(v_definition placing $edit_6_1$             else raw.read_starts_at
$edit_6_1$ from 6169 for 33);
  -- Replace source characters 5903..6030: '             when coalesce(raw.end_date, raw.start_date) < p_read_at\n               then coalesce(raw.end_date, raw.start_date)\n'
  v_definition := overlay(v_definition placing $edit_6_2$             when raw.read_ends_at <= p_read_at
               then raw.read_ends_at
$edit_6_2$ from 5903 for 128);
  -- Replace source characters 5574..5642: '             when coalesce(raw.end_date, raw.start_date) < p_read_at\n'
  v_definition := overlay(v_definition placing $edit_6_3$             when raw.read_ends_at <= p_read_at
$edit_6_3$ from 5574 for 69);
  -- Replace source characters 4609..4608: ''
  v_definition := overlay(v_definition placing $edit_6_4$           private.agent_task_read_instant(task.start_date,task.all_day,context.company_timezone,false) as read_starts_at,
           private.agent_task_read_instant(coalesce(task.end_date,task.start_date),task.all_day,context.company_timezone,true) as read_ends_at,
$edit_6_4$ from 4609 for 0);
  -- Replace source characters 3257..3315: '    select task_revision.source_revision as task_revision,\n'
  v_definition := overlay(v_definition placing $edit_6_5$    select company.timezone as company_timezone,
           task_revision.source_revision as task_revision,
$edit_6_5$ from 3257 for 59);

  if pg_catalog.md5(v_definition) <> '12a9305eb5fd49221fb3fd17eca1d95b' then
    raise exception 'agent_maverick_read_repair_output_invalid: agent_p2_task_attention_v1' using errcode = '55000';
  end if;
  execute v_definition;
end;
$repair_6$;

commit;
