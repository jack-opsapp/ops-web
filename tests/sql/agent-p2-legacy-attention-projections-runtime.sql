begin;

do $catalog_contract$
declare
  v_signature text;
  v_signatures constant text[] := array[
    'private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)',
    'private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)',
    'private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)'
  ];
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
begin
  foreach v_signature in array v_signatures loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_p2_legacy_attention_runtime_failed: missing %',
        v_signature;
    end if;
    if pg_catalog.has_function_privilege(
      'anon', v_signature, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated', v_signature, 'EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'service_role', v_signature, 'EXECUTE'
    ) then
      raise exception
        'agent_p2_legacy_attention_runtime_failed: application execute %',
        v_signature;
    end if;

    select procedure.provolatile,
           procedure.prosecdef,
           procedure.proconfig
    into v_volatility, v_security_definer, v_config
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(v_signature);
    if v_volatility is distinct from 's'
       or v_security_definer
       or not (
         coalesce(v_config, array[]::text[])
         && array['search_path=', 'search_path=""']::text[]
       ) then
      raise exception
        'agent_p2_legacy_attention_runtime_failed: unsafe attributes %',
        v_signature;
    end if;
  end loop;
end;
$catalog_contract$;

do $text_helper_contract$
declare
  v_signature constant text :=
    'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)';
  v_role text;
  v_volatility "char";
  v_is_strict boolean;
  v_parallel "char";
  v_security_definer boolean;
  v_config text[];
begin
  if pg_catalog.to_regprocedure(v_signature) is null then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: missing %', v_signature;
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_function_privilege(v_role, v_signature, 'EXECUTE') then
      raise exception
        'agent_p2_legacy_attention_runtime_failed: application execute %',
        v_signature;
    end if;
  end loop;
  select procedure.provolatile,
         procedure.proisstrict,
         procedure.proparallel,
         procedure.prosecdef,
         procedure.proconfig
  into v_volatility,
       v_is_strict,
       v_parallel,
       v_security_definer,
       v_config
  from pg_catalog.pg_proc procedure
  where procedure.oid = pg_catalog.to_regprocedure(v_signature);
  if v_volatility is distinct from 'i'
     or not v_is_strict
     or v_parallel is distinct from 's'
     or v_security_definer
     or not (
       coalesce(v_config, array[]::text[])
       && array['search_path=', 'search_path=""']::text[]
     ) then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: unsafe text helper attributes';
  end if;
end;
$text_helper_contract$;

do $application_acl$
declare
  v_signatures oid[] := array[
    pg_catalog.to_regprocedure(
      'private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)'
    )::oid,
    pg_catalog.to_regprocedure(
      'private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)'
    )::oid,
    pg_catalog.to_regprocedure(
      'private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)'
    )::oid
  ];
begin
  if exists (
    select 1
    from pg_catalog.unnest(v_signatures) signature_row(signature)
    where pg_catalog.has_function_privilege(
      'authenticated', signature_row.signature, 'EXECUTE'
    )
  ) then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: authenticated execute';
  end if;
end;
$application_acl$;

select pg_catalog.set_config(
  'request.jwt.claim.role', 'service_role', true
);
select pg_catalog.set_config(
  'request.jwt.claims', '{"role":"service_role"}', true
);

do $unicode_projection_contract$
begin
  if private.agent_p2_optional_canonical_text(
       U&'\00A0Cafe\0301\00A0', 256, 1024, false
     ) is distinct from U&'Caf\00E9'
     or private.agent_p2_optional_canonical_text(
       U&'unsafe\202Etitle', 256, 1024, false
     ) is not null
     or private.agent_p2_optional_canonical_text(
       U&'unsafe\FEFFsubject', 512, 2048, false
     ) is not null
     or private.agent_p2_optional_canonical_text(
       U&'unsafe\2060snippet', 1000, 4000, true
     ) is not null
     or private.agent_p2_optional_canonical_text(
       E'line one\nline two', 1000, 4000, true
     ) is distinct from E'line one\nline two' then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: unicode text projection mismatch';
  end if;
end;
$unicode_projection_contract$;

create function pg_temp.assert_legacy_attention_read_at(
  p_kind text,
  p_read_at timestamptz,
  p_expect_window_valid boolean,
  p_rejection_marker text
) returns void
language plpgsql
set search_path = ''
as $function$
begin
  begin
    if p_kind = 'lead' then
      perform private.agent_p2_legacy_lead_attention_v1(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'invalid', array['pipeline.view'], 'all', p_read_at, 1
      );
    elsif p_kind = 'correspondence' then
      perform private.agent_p2_legacy_correspondence_attention_v1(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'invalid', array['email.view','inbox.view','pipeline.view'],
        'all', 'all', 'all', p_read_at, 1
      );
    elsif p_kind = 'schedule' then
      perform private.agent_p2_legacy_schedule_attention_v1(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'invalid', array['calendar.view','projects.view','tasks.view'],
        'all', 'all', 'all', p_read_at, 1
      );
    else
      raise exception 'unknown legacy attention kind';
    end if;
    raise exception 'legacy attention request unexpectedly authorized';
  exception
    when sqlstate '42501' then
      if not p_expect_window_valid then
        raise exception '%', p_rejection_marker;
      end if;
    when sqlstate '22023' then
      if p_expect_window_valid then
        raise exception
          'agent_p2_legacy_attention_runtime_failed: legacy attention cursor-window rejected';
      end if;
  end;
end;
$function$;

do $signed_cursor_window_contract$
declare
  v_kind text;
  v_now constant timestamptz := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
begin
  foreach v_kind in array array['lead','correspondence','schedule']::text[] loop
    perform pg_temp.assert_legacy_attention_read_at(
      v_kind,
      v_now - interval '14 minutes',
      true,
      'agent_p2_legacy_attention_runtime_failed: legacy attention cursor-window accepted'
    );
    perform pg_temp.assert_legacy_attention_read_at(
      v_kind,
      v_now + interval '1 millisecond',
      false,
      'agent_p2_legacy_attention_runtime_failed: legacy attention future read-at accepted'
    );
    perform pg_temp.assert_legacy_attention_read_at(
      v_kind,
      v_now - interval '15 minutes',
      false,
      'agent_p2_legacy_attention_runtime_failed: legacy attention expired read-at accepted'
    );
    perform pg_temp.assert_legacy_attention_read_at(
      v_kind,
      v_now - interval '1 microsecond',
      false,
      'agent_p2_legacy_attention_runtime_failed: legacy attention non-millisecond read-at accepted'
    );
    perform pg_temp.assert_legacy_attention_read_at(
      v_kind,
      'infinity'::timestamptz,
      false,
      'agent_p2_legacy_attention_runtime_failed: legacy attention non-finite read-at accepted'
    );
  end loop;
end;
$signed_cursor_window_contract$;

-- The correspondence fence must stop at the first 501 broad index matches,
-- even when every early row will later be rejected as future-snoozed/non-due.
alter table public.email_threads disable trigger all;
insert into public.email_threads (
  id,
  company_id,
  connection_id,
  provider_thread_id,
  subject,
  first_message_at,
  last_message_at,
  opportunity_id,
  snoozed_until,
  has_unresolved_commitments,
  next_commitment_due_at
)
select pg_catalog.md5('agent-p2-attention-' || source.ordinality::text)::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid,
       'agent-p2-attention-' || source.ordinality::text,
       'Attention fixture ' || source.ordinality::text,
       pg_catalog.statement_timestamp() - interval '1 day',
       pg_catalog.statement_timestamp() - interval '1 day',
       '44444444-4444-4444-8444-444444444444'::uuid,
       pg_catalog.statement_timestamp() + interval '30 days',
       false,
       pg_catalog.statement_timestamp() +
         source.ordinality * interval '1 second'
from pg_catalog.generate_series(1, 10001) source(ordinality);

select pg_catalog.set_config('enable_seqscan', 'off', true);

do $source_bound_explain_contract$
declare
  v_plan json;
begin
  execute $plan$
    explain (format json)
    with source_match_inspection as materialized (
      select opportunity.id,
             least(
               coalesce(
                 opportunity.operator_action_required_at,
                 'infinity'::timestamptz
               ),
               coalesce(
                 opportunity.next_follow_up_at,
                 'infinity'::timestamptz
               )
             ) as attention_at
      from public.opportunities opportunity
      where opportunity.company_id =
              '22222222-2222-4222-8222-222222222222'::uuid
        and opportunity.deleted_at is null
        and opportunity.archived_at is null
        and opportunity.merged_into_opportunity_id is null
        and opportunity.stage not in ('won', 'lost', 'discarded')
        and least(
          coalesce(
            opportunity.operator_action_required_at,
            'infinity'::timestamptz
          ),
          coalesce(
            opportunity.next_follow_up_at,
            'infinity'::timestamptz
          )
        ) <= pg_catalog.statement_timestamp()
      order by attention_at, opportunity.id
      limit 501
    )
    select pg_catalog.count(*)
    from source_match_inspection source
    where source.id = '00000000-0000-4000-8000-000000000000'::uuid
  $plan$ into v_plan;
  if v_plan::text not like '%opportunities_agent_p2_legacy_attention_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: adversarial source-bound explain mismatch lead';
  end if;

  execute $plan$
    explain (analyze, format json)
    with source_match_inspection as materialized (
      select thread.id,
             coalesce(
               thread.next_commitment_due_at,
               thread.last_message_at
             ) as attention_at
      from public.email_threads thread
      where thread.company_id =
              '22222222-2222-4222-8222-222222222222'::uuid
        and thread.opportunity_id is not null
        and thread.archived_at is null
        and (
          coalesce(thread.has_unresolved_commitments, false)
          or thread.next_commitment_due_at is not null
        )
        and thread.unread_count between 0 and 9007199254740991
      order by attention_at, thread.id
      limit 501
    )
    select pg_catalog.count(*)
    from source_match_inspection source
    where source.id = '00000000-0000-4000-8000-000000000000'::uuid
  $plan$ into v_plan;
  if v_plan::text not like '%email_threads_agent_p2_legacy_attention_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%'
     or v_plan::text not like '%"Actual Rows": 501%' then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: adversarial source-bound explain mismatch correspondence';
  end if;

  execute $plan$
    explain (format json)
    with source_match_inspection as materialized (
      select task.id, task.start_date as attention_at
      from public.project_tasks task
      where task.company_id =
              '22222222-2222-4222-8222-222222222222'::uuid
        and task.deleted_at is null
        and task.status = 'active'
        and task.start_date is not null
        and task.start_date >= pg_catalog.statement_timestamp()
        and task.start_date <
              pg_catalog.statement_timestamp() + interval '7 days'
      order by task.start_date, task.id
      limit 501
    )
    select pg_catalog.count(*)
    from source_match_inspection source
    where source.id = '00000000-0000-4000-8000-000000000000'::uuid
  $plan$ into v_plan;
  if v_plan::text not like '%project_tasks_agent_p2_legacy_attention_idx%'
     or v_plan::text not like '%"Node Type": "Limit"%' then
    raise exception
      'agent_p2_legacy_attention_runtime_failed: adversarial source-bound explain mismatch schedule';
  end if;
end;
$source_bound_explain_contract$;

alter table public.email_threads enable trigger all;

do $request_and_authority_contract$
declare
  v_actor constant uuid := '11111111-1111-4111-8111-111111111111';
  v_company constant uuid := '22222222-2222-4222-8222-222222222222';
  v_read_at timestamptz := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
begin
  begin
    perform private.agent_p2_legacy_lead_attention_v1(
      v_actor, v_company, 'invalid', array['pipeline.view'],
      'all', v_read_at, 0
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: lead limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_lead_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_lead_attention_v1(
      v_actor, v_company, 'invalid', array['pipeline.view'],
      'all', v_read_at, null
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: lead null limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_lead_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_correspondence_attention_v1(
      v_actor, v_company, 'invalid',
      array['email.view', 'inbox.view', 'pipeline.view'],
      'all', 'all', 'all', v_read_at, 0
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: correspondence limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_correspondence_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_correspondence_attention_v1(
      v_actor, v_company, 'invalid',
      array['email.view', 'inbox.view', 'pipeline.view'],
      'all', 'all', 'all', v_read_at, null
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: correspondence null limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_correspondence_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_schedule_attention_v1(
      v_actor, v_company, 'invalid',
      array['calendar.view', 'projects.view', 'tasks.view'],
      'all', 'all', 'all', v_read_at, 0
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: schedule limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_schedule_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_schedule_attention_v1(
      v_actor, v_company, 'invalid',
      array['calendar.view', 'projects.view', 'tasks.view'],
      'all', 'all', 'all', v_read_at, null
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: schedule null limit allowed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'invalid_agent_p2_legacy_schedule_attention_request' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_lead_attention_v1(
      v_actor, v_company, 'invalid', array['pipeline.view'],
      'all', v_read_at, 1
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: lead authority allowed';
  exception when sqlstate '42501' then
    if sqlerrm is distinct from
       'agent_p2_legacy_lead_attention_unauthorized' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_correspondence_attention_v1(
      v_actor, v_company, 'invalid',
      array['email.view', 'inbox.view', 'pipeline.view'],
      'all', 'all', 'all', v_read_at, 1
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: correspondence authority allowed';
  exception when sqlstate '42501' then
    if sqlerrm is distinct from
       'agent_p2_legacy_correspondence_attention_unauthorized' then
      raise;
    end if;
  end;

  begin
    perform private.agent_p2_legacy_schedule_attention_v1(
      v_actor, v_company, 'invalid',
      array['calendar.view', 'projects.view', 'tasks.view'],
      'all', 'all', 'all', v_read_at, 1
    );
    raise exception
      'agent_p2_legacy_attention_runtime_failed: schedule authority allowed';
  exception when sqlstate '42501' then
    if sqlerrm is distinct from
       'agent_p2_legacy_schedule_attention_unauthorized' then
      raise;
    end if;
  end;
end;
$request_and_authority_contract$;

rollback;
