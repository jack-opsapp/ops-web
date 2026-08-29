-- PostgreSQL 17 runtime proof for Task 17. Run only against an isolated
-- disposable database after the forward ledger has been applied.
begin;

do $runtime_requires_postgresql_17$
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;
end;
$runtime_requires_postgresql_17$;

-- work_queue_sources_bump
-- work_queue_old_new_company_fanout
-- work_queue_irrelevant_update_no_bump
-- work_queue_match_review_index
-- work_queue_commitment_index
-- work_queue_legacy_lead_bound_index
-- work_queue_source_private_acl
do $source_catalog_proof$
begin
  if pg_catalog.to_regprocedure(
       'private.bump_agent_work_queue_source_revision()'
     ) is null
     or pg_catalog.to_regclass(
       'public.idx_activities_agent_match_review_v1'
     ) is null
     or pg_catalog.to_regclass(
       'public.idx_email_threads_agent_commitment_v1'
     ) is null
     or pg_catalog.to_regclass(
       'public.opportunities_agent_p2_legacy_attention_idx'
     ) is null then
    raise exception 'work_queue_sources_runtime_catalog_failed';
  end if;
end;
$source_catalog_proof$;

alter table public.activities
  add column task17_runtime_irrelevant text;

do $work_queue_source_trigger_behavior$
declare
  v_company_a uuid := '90000000-0000-4000-8000-000000000001';
  v_company_b uuid := '90000000-0000-4000-8000-000000000002';
  v_revision_a bigint;
  v_revision_b bigint;
begin
  insert into public.companies(id,name) values
    (v_company_a,'Work Queue Source A'),
    (v_company_b,'Work Queue Source B');
  insert into private.agent_read_domain_revisions(
    company_id,domain,source_revision
  ) values(v_company_a,'work_queue',0),(v_company_b,'work_queue',0)
  on conflict(company_id,domain) do update
    set source_revision=excluded.source_revision;

  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,match_needs_review
  ) values(
    '90000000-0000-4000-8000-000000000011',v_company_a,'email',
    pg_catalog.statement_timestamp(),
    '90000000-0000-4000-8000-000000000021',true
  );
  update public.activities
  set task17_runtime_irrelevant='does not affect queue'
  where id='90000000-0000-4000-8000-000000000011';
  select source_revision into v_revision_a
  from private.agent_read_domain_revisions
  where company_id=v_company_a and domain='work_queue';
  if v_revision_a<>1 then
    raise exception 'work_queue_irrelevant_update_bumped_revision';
  end if;
  update public.activities set company_id=v_company_b
  where id='90000000-0000-4000-8000-000000000011';
  delete from public.activities
  where id='90000000-0000-4000-8000-000000000011';

  insert into public.email_threads(
    id,company_id,connection_id,provider_thread_id,subject,
    first_message_at,last_message_at,next_commitment_due_at,
    has_unresolved_commitments
  ) values(
    '90000000-0000-4000-8000-000000000012',v_company_a,
    '90000000-0000-4000-8000-000000000021',
    'trigger:commitment','Trigger commitment',
    pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp(),true
  );
  update public.email_threads set has_unresolved_commitments=false
  where id='90000000-0000-4000-8000-000000000012';
  update public.email_threads
  set subject='revised subject',latest_snippet='revised snippet',
      last_message_at=pg_catalog.statement_timestamp()
  where id='90000000-0000-4000-8000-000000000012';
  delete from public.email_threads
  where id='90000000-0000-4000-8000-000000000012';

  insert into public.opportunities(
    id,company_id,title,stage,next_follow_up_at
  ) values(
    '90000000-0000-4000-8000-000000000013',v_company_a,
    'Trigger opportunity','lead',
    pg_catalog.statement_timestamp()
  );
  update public.opportunities
  set operator_action_required_at=pg_catalog.statement_timestamp()
  where id='90000000-0000-4000-8000-000000000013';
  update public.opportunities
  set assigned_to='90000000-0000-4000-8000-000000000022'
  where id='90000000-0000-4000-8000-000000000013';
  delete from public.opportunities
  where id='90000000-0000-4000-8000-000000000013';

  insert into public.email_connections(
    id,company_id,type,user_id,email
  ) values(
    '90000000-0000-4000-8000-000000000021',v_company_a::text,
    'individual','90000000-0000-4000-8000-000000000022',
    'trigger-owner@ops.test'
  );
  update public.email_connections
  set user_id='90000000-0000-4000-8000-000000000023'
  where id='90000000-0000-4000-8000-000000000021';
  delete from public.email_connections
  where id='90000000-0000-4000-8000-000000000021';

  insert into public.projects(id,company_id,title) values(
    '90000000-0000-4000-8000-000000000031',v_company_a,
    'Trigger project'
  );
  insert into public.project_tasks(
    id,company_id,project_id,team_member_ids
  ) values(
    '90000000-0000-4000-8000-000000000032',v_company_b,
    '90000000-0000-4000-8000-000000000031',array[]::text[]
  );
  update public.project_tasks
  set team_member_ids=array['90000000-0000-4000-8000-000000000022']
  where id='90000000-0000-4000-8000-000000000032';
  delete from public.project_tasks
  where id='90000000-0000-4000-8000-000000000032';
  insert into public.project_notes(
    id,company_id,project_id,author_id,content,mentioned_user_ids
  ) values(
    '90000000-0000-4000-8000-000000000033',v_company_b,
    '90000000-0000-4000-8000-000000000031',
    '90000000-0000-4000-8000-000000000022','Trigger project note',
    array[]::text[]
  );
  update public.project_notes
  set mentioned_user_ids=array['90000000-0000-4000-8000-000000000022']
  where id='90000000-0000-4000-8000-000000000033';
  delete from public.project_notes
  where id='90000000-0000-4000-8000-000000000033';
  delete from public.projects
  where id='90000000-0000-4000-8000-000000000031';

  select source_revision into v_revision_a
  from private.agent_read_domain_revisions
  where company_id=v_company_a and domain='work_queue';
  select source_revision into v_revision_b
  from private.agent_read_domain_revisions
  where company_id=v_company_b and domain='work_queue';
  if v_revision_a<>21 or v_revision_b<>8 then
    raise exception 'work_queue_source_revision_fanout_failed:%:%',
      v_revision_a,v_revision_b;
  end if;
end;
$work_queue_source_trigger_behavior$;

-- The disposable fixture matrix inserts all nine source kinds and validates:
-- work_queue_all_nine_sources
-- work_queue_explicit_denial_zero_read
-- work_queue_default_warning_zero_signal
-- work_queue_match_review_unlinked_safe
-- work_queue_correspondence_private_fields_absent
-- work_queue_keyset_no_duplicates
-- work_queue_source_501_fails_closed
-- work_queue_stale_revision_fails_closed
-- work_queue_service_only_acl
do $work_queue_acl_proof$
begin
  if pg_catalog.has_function_privilege(
       'anon',
       'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'work_queue_service_only_acl';
  end if;
end;
$work_queue_acl_proof$;

-- The owner-helper compatibility repair permits a signed snapshot inside the
-- fifteen-minute cursor window. This exact-signature fixture models the frozen
-- helper's bounded logical slice: 26 inspected, exactly 25 returned, has_more.
-- The work queue must never infer that the hidden helper row belongs to its
-- own global keyset.
create or replace function private.agent_p2_task_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_tasks_scope text,
  p_projects_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language sql stable security definer set search_path = ''
as $task_helper_bounded_slice_fixture$
  select pg_catalog.jsonb_build_object(
    'source_inspected_count',26,
    'returned_count',25,
    'has_more',true,
    'cards',coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'task_ref',pg_catalog.jsonb_build_object(
          'kind','task',
          'id',('50000000-0000-4000-8000-' ||
            pg_catalog.lpad(value::text,12,'0'))::uuid
        ),
        'job_ref',pg_catalog.jsonb_build_object(
          'kind','project','id','50000000-0000-4000-8000-999999999999'::uuid
        ),
        'reason_code','overdue',
        'attention_at',private.agent_rfc3339_utc(
          pg_catalog.date_trunc('milliseconds',$7) + value * interval '1 minute'
        ),
        'title','fixture task ' || value
      ) order by value
    ),'[]'::jsonb)
  )
  from pg_catalog.generate_series(1,least($8,25)) value;
$task_helper_bounded_slice_fixture$;

create or replace function private.agent_p2_legacy_schedule_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_calendar_scope text,
  p_projects_scope text,
  p_tasks_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $schedule_helper_asymmetric_scope_fixture$
begin
  if p_calendar_scope is distinct from 'all'
     or p_projects_scope is distinct from 'all'
     or p_tasks_scope is distinct from 'assigned' then
    raise exception 'work_queue_schedule_scope_order_invalid'
      using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'source_inspected_count',0,'returned_count',0,'has_more',false,
    'cards','[]'::jsonb
  );
end;
$schedule_helper_asymmetric_scope_fixture$;

create or replace function private.user_can_view_inbox_connection(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_opportunity_id uuid
) returns boolean
language sql stable set search_path = ''
as $inbox_visibility_fixture$
  select $3 in (
    '10000000-0000-4000-8000-000000000005'::uuid,
    '10000000-0000-4000-8000-000000000025'::uuid
  );
$inbox_visibility_fixture$;

create or replace function private.agent_user_can_access_entity(
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_entity_kind text,
  p_entity_id uuid,
  p_action text
) returns boolean
language sql stable set search_path = ''
as $entity_visibility_fixture$
  select not (
    $3='opportunity'
    and $4='70000000-0000-4000-8000-000000000001'::uuid
  );
$entity_visibility_fixture$;

create or replace function private.agent_p2_legacy_correspondence_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_inbox_scope text,
  p_email_scope text,
  p_pipeline_scope text,
  p_read_at timestamptz,
  p_limit integer
) returns jsonb
language sql stable set search_path = ''
as $correspondence_own_scope_fixture$
  select pg_catalog.jsonb_build_object(
    'source_inspected_count',1,'returned_count',1,'has_more',false,
    'cards',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'thread_ref','80000000-0000-4000-8000-000000000001'::uuid,
      'job_ref',pg_catalog.jsonb_build_object(
        'kind','opportunity','id','70000000-0000-4000-8000-000000000002'::uuid
      ),
      'attention_at',private.agent_rfc3339_utc($8),
      'subject','other mailbox subject','latest_snippet','private snippet'
    ))
  );
$correspondence_own_scope_fixture$;

create or replace function private.agent_p2_expense_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidate jsonb,
  p_read_at timestamptz,
  p_limit integer,
  p_source_limit integer
) returns jsonb
language plpgsql stable set search_path = ''
as $expense_collision_fixture$
begin
  if pg_catalog.current_setting('task17.expense_collision',true)
       is distinct from 'on' then
    return pg_catalog.jsonb_build_object('cards','[]'::jsonb);
  end if;
  if $5 ->> 'variant_key' = 'pending_approval' then
    return pg_catalog.jsonb_build_object(
      'cards',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'card_kind','expense_approval','attention_at',
          private.agent_rfc3339_utc($6),
        'expense_ref',pg_catalog.jsonb_build_object(
          'kind','expense','id','71000000-0000-4000-8000-000000000001'::uuid
        )
      ))
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'cards',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'card_kind','reimbursement_batch','period_end','2026-08-29',
      'batch_ref',pg_catalog.jsonb_build_object(
        'kind','reimbursement_batch',
        'id','71000000-0000-4000-8000-000000000001'::uuid
      )
    ))
  );
end;
$expense_collision_fixture$;

do $work_queue_behavior_proof$
declare
  v_company uuid := '10000000-0000-4000-8000-000000000001';
  v_actor uuid := '10000000-0000-4000-8000-000000000002';
  v_client uuid := '10000000-0000-4000-8000-000000000003';
  v_grant uuid := '10000000-0000-4000-8000-000000000004';
  v_connection uuid := '10000000-0000-4000-8000-000000000005';
  v_scopes text[] := array['ops.correspondence.read','ops.operations.read'];
  v_all_scopes text[] := array[
    'ops.correspondence.read','ops.expenses.read','ops.financial_documents.read',
    'ops.jobs.read','ops.operations.read','ops.payments.read','ops.schedule.read',
    'ops.tasks.read'
  ];
  v_keys text[] := array[
    'calendar.view','email.view','estimates.view','expenses.approve',
    'expenses.view','finances.view','inbox.view','invoices.view',
    'pipeline.view','projects.view','projects.view_financials','tasks.view'
  ];
  v_permissions jsonb;
  v_revision text;
  v_authorized jsonb;
  v_all_authorized jsonb;
  v_first jsonb;
  v_second jsonb;
  v_last jsonb;
  v_card jsonb;
  v_read_at timestamptz;
begin
  perform pg_catalog.set_config('request.jwt.claim.role','service_role',true);
  insert into public.companies(id,name)
  values(v_company,'Work Queue Runtime');
  insert into public.users(id,company_id,first_name,last_name)
  values(v_actor,v_company,'Queue','Reader');
  insert into public.user_permission_overrides(
    user_id,company_id,permission,scope,granted
  ) values
    (v_actor,v_company,'email.view','all',true),
    (v_actor,v_company,'inbox.view','all',true),
    (v_actor,v_company,'pipeline.view','all',true),
    (v_actor,v_company,'projects.view','all',true);
  insert into private.mcp_oauth_clients(
    client_id,client_name,redirect_uris,token_endpoint_auth_method,
    grant_types,response_types,scope,registration_source,
    scope_ceiling,consent_catalog_revision,exposure_revision
  ) values(
    v_client,'Work queue runtime',
    array['https://work-queue-runtime.ops.invalid/callback']::text[],
    'none',array['authorization_code','refresh_token']::text[],
    array['code']::text[],pg_catalog.array_to_string(v_scopes,' '),'manual',
    v_scopes,'2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );
  insert into private.mcp_oauth_grants(
    id,user_id,company_id,client_id,scopes,revision,accepted_labels,
    consent_catalog_revision,exposure_revision
  ) values(
    v_grant,v_actor,v_company,v_client,v_scopes,
    '11111111111111111111111111111111',
    private.mcp_oauth_labels_for_scopes(
      v_scopes,'2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );
  insert into private.agent_read_domain_revisions(company_id,domain,source_revision)
  values(v_company,'work_queue',1)
  on conflict(company_id,domain) do update
    set source_revision=excluded.source_revision;

  insert into public.email_threads(
    id,company_id,connection_id,provider_thread_id,subject,
    first_message_at,last_message_at,next_commitment_due_at,
    has_unresolved_commitments
  )
  select ('20000000-0000-4000-8000-' || pg_catalog.lpad(value::text,12,'0'))::uuid,
         v_company,v_connection,
         case when value=1 then 'provider:opaque-thread' else 'provider:' || value end,
         'Commitment ' || value::text,
         pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp(),
         pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())
           + value * interval '1 minute',true
  from pg_catalog.generate_series(1,26) value;
  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,email_thread_id,
    match_needs_review
  ) values(
    '30000000-0000-4000-8000-000000000001',v_company,'email',
    pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp()) - interval '1 minute',
    v_connection,'provider:opaque-thread',true
  );

  select authority.permission_snapshot_revision,
         coalesce(pg_catalog.jsonb_object_agg(
           permission.value ->> 'permission',permission.value ->> 'scope'
           order by permission.value ->> 'permission' collate "C"
         ) filter(where permission.value ->> 'permission' is not null),'{}'::jsonb)
    into v_revision,v_permissions
  from private.resolve_agent_actor_authority(v_actor,v_company,v_keys) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;
  v_authorized := pg_catalog.jsonb_build_array(
    private.agent_p2_work_queue_expected_source_v1(
      'commitment','explicit',v_permissions
    ),
    private.agent_p2_work_queue_expected_source_v1(
      'match_review','explicit',v_permissions
    )
  );

  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
    v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
    '[{"source":"commitment","origin":"explicit"},{"source":"match_review","origin":"explicit"}]'::jsonb,
    v_authorized,'[]'::jsonb,25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if pg_catalog.jsonb_array_length(v_first -> 'rows') <> 25
     or (v_first ->> 'source_has_more')::boolean is not true
     or (v_first ->> 'source_inspected')::integer <> 27
     or v_first #>> '{rows,0,item,source}' <> 'match_review'
     or v_first #>> '{rows,0,item,thread_ref,id}' is distinct from
          '20000000-0000-4000-8000-000000000001'
     or (v_first #> '{rows,0,item}') ? 'provider_thread_id'
     or v_first #>> '{source_slices,0,bounded_count}' <> '25'
     or v_first #>> '{source_slices,0,truncated}' <> 'true' then
    raise exception 'work_queue_all_nine_sources';
  end if;

  v_last := v_first #> '{rows,24,predecessor}';
  v_read_at := (v_first ->> 'read_at')::timestamptz;
  v_second := public.read_agent_work_queue_as_system(
    v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
    v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
    '[{"source":"commitment","origin":"explicit"},{"source":"match_review","origin":"explicit"}]'::jsonb,
    v_authorized,'[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
    (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
    v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
  );
  if pg_catalog.jsonb_array_length(v_second -> 'rows') <> 1
     or (v_second ->> 'source_has_more')::boolean then
    raise exception 'work_queue_keyset_no_duplicates';
  end if;

  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
      v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
      '[{"source":"match_review","origin":"explicit"}]'::jsonb,
      '[{"source":"match_review","origin":"explicit","required_oauth_scopes":["ops.operations.read"],"resolved_permission_scopes":{},"satisfied_permission_group_indexes":[0]}]'::jsonb,
      '[]'::jsonb,25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_explicit_denial_zero_read';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
      v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"default"},{"source":"lead","origin":"default"}]'::jsonb,
      '[]'::jsonb,
      '[{"code":"DEFAULT_COMPONENT_OMITTED","source":"lead"},{"code":"DEFAULT_COMPONENT_OMITTED","source":"task"}]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_noncanonical_warning_vector_was_accepted';
  exception when insufficient_privilege then null;
  end;

  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
    v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
    '[{"source":"lead","origin":"default"}]'::jsonb,'[]'::jsonb,
    '[{"code":"DEFAULT_COMPONENT_OMITTED","source":"lead"}]'::jsonb,
    25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if v_first -> 'source_revisions' <> '[]'::jsonb
     or v_first -> 'source_slices' <> '[]'::jsonb
     or v_first -> 'rows' <> '[]'::jsonb then
    raise exception 'work_queue_default_warning_zero_signal';
  end if;

  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
      v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
      '[{"source":"forged","origin":"default"}]'::jsonb,'[]'::jsonb,
      '[{"code":"DEFAULT_COMPONENT_OMITTED","source":"forged"}]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'forged_default_was_accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
      v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
      '[{"source":"commitment","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_authorized -> 0),'[]'::jsonb,
      25,26,501,v_read_at,'[]'::jsonb,null,null,null,null
    );
    raise exception 'partial_cursor_was_accepted';
  exception when invalid_parameter_value then null;
  end;

  insert into public.user_permission_overrides(
    user_id,company_id,permission,scope,granted
  ) values
    (v_actor,v_company,'calendar.view','all',true),
    (v_actor,v_company,'estimates.view','all',true),
    (v_actor,v_company,'expenses.approve','all',true),
    (v_actor,v_company,'expenses.view','all',true),
    (v_actor,v_company,'finances.view','all',true),
    (v_actor,v_company,'invoices.view','all',true),
    (v_actor,v_company,'projects.view_financials','all',true),
    (v_actor,v_company,'tasks.view','assigned',true);
  insert into private.mcp_oauth_clients(
    client_id,client_name,redirect_uris,token_endpoint_auth_method,
    grant_types,response_types,scope,registration_source,
    scope_ceiling,consent_catalog_revision,exposure_revision
  ) values(
    '10000000-0000-4000-8000-000000000013',
    'Work queue all-source runtime',
    array['https://work-queue-all-runtime.ops.invalid/callback']::text[],
    'none',array['authorization_code','refresh_token']::text[],
    array['code']::text[],pg_catalog.array_to_string(v_all_scopes,' '),'manual',
    v_all_scopes,'2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );
  insert into private.mcp_oauth_grants(
    id,user_id,company_id,client_id,scopes,revision,accepted_labels,
    consent_catalog_revision,exposure_revision
  ) values(
    '10000000-0000-4000-8000-000000000014',v_actor,v_company,
    '10000000-0000-4000-8000-000000000013',v_all_scopes,
    '22222222222222222222222222222222',
    private.mcp_oauth_labels_for_scopes(
      v_all_scopes,'2026-08-22.mcp-consent-catalog.v1'
    ),
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );
  insert into private.agent_read_domain_revisions(company_id,domain,source_revision)
  values
    (v_company,'tasks',2),(v_company,'sales_documents',3),
    (v_company,'payments',4),(v_company,'expenses',5)
  on conflict(company_id,domain) do update
    set source_revision=excluded.source_revision;
  insert into private.agent_operational_read_revisions(company_id,source_revision)
  values(v_company,6);
  insert into private.agent_job_history_revisions(company_id,history_revision)
  values(v_company,7);
  select authority.permission_snapshot_revision,
         coalesce(pg_catalog.jsonb_object_agg(
           permission.value ->> 'permission',permission.value ->> 'scope'
           order by permission.value ->> 'permission' collate "C"
         ) filter(where permission.value ->> 'permission' is not null),'{}'::jsonb)
    into v_revision,v_permissions
  from private.resolve_agent_actor_authority(v_actor,v_company,v_keys) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;
  select pg_catalog.jsonb_agg(
           private.agent_p2_work_queue_expected_source_v1(
             source,'explicit',v_permissions
           ) order by ordinality
         )
    into v_all_authorized
  from pg_catalog.unnest(array[
    'task','lead','correspondence','commitment','match_review','schedule',
    'financial_document','payment','expense'
  ]::text[]) with ordinality selected(source,ordinality);
  if v_all_authorized #> '{8,satisfied_permission_group_indexes}'
       <> '[0,1]'::jsonb then
    raise exception 'work_queue_expense_admin_group_parity_failed';
  end if;
  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"lead","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 1,v_all_authorized -> 0),
      '[]'::jsonb,25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_noncanonical_authorized_vector_was_accepted';
  exception when insufficient_privilege then null;
  end;

  insert into public.email_connections(
    id,company_id,type,user_id,email
  ) values
    (v_connection,v_company::text,'individual',v_actor::text,
     'actor-mailbox@ops.test'),
    ('10000000-0000-4000-8000-000000000025',v_company::text,'individual',
     '10000000-0000-4000-8000-000000000099','other-mailbox@ops.test');
  insert into public.opportunities(id,company_id,title,stage) values
    ('70000000-0000-4000-8000-000000000001',v_company,
     'Hidden opportunity','lead'),
    ('70000000-0000-4000-8000-000000000002',v_company,
     'Visible opportunity','lead');
  insert into public.projects(id,company_id,title) values(
    '70000000-0000-4000-8000-000000000003',v_company,'Queue project'
  );
  insert into public.project_tasks(
    id,company_id,project_id,team_member_ids
  ) values(
    '70000000-0000-4000-8000-000000000004',v_company,
    '70000000-0000-4000-8000-000000000003',array[]::text[]
  );
  insert into public.email_threads(
    id,company_id,connection_id,opportunity_id,provider_thread_id,
    next_commitment_due_at,has_unresolved_commitments,subject,
    latest_snippet,first_message_at,last_message_at,unread_count
  ) values(
    '80000000-0000-4000-8000-000000000001',v_company,
    '10000000-0000-4000-8000-000000000025',null,'provider:other-mailbox',
    pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())-
      interval '2 minutes',true,'other mailbox subject','private snippet',
    pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp(),1
  );
  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,email_thread_id,
    match_needs_review
  ) values(
    '80000000-0000-4000-8000-000000000002',v_company,'email',
    pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())-
      interval '2 minutes','10000000-0000-4000-8000-000000000025',
    'provider:other-mailbox',true
  );

  -- A mapped provider thread has independent connection/job authority. The
  -- activity remains visible, but the hidden linked-opportunity thread UUID
  -- and provider identifier must both be omitted.
  insert into public.email_threads(
    id,company_id,connection_id,opportunity_id,provider_thread_id,
    subject,first_message_at,last_message_at,has_unresolved_commitments
  ) values(
    '70000000-0000-4000-8000-000000000010',v_company,v_connection,
    '70000000-0000-4000-8000-000000000001','provider:hidden-job',
    'Hidden mapped thread',pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp(),false
  );
  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,email_thread_id,
    match_needs_review
  ) values(
    '70000000-0000-4000-8000-000000000011',v_company,'email',
    pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())-
      interval '90 seconds',v_connection,'provider:hidden-job',true
  );
  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"match_review","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(v_all_authorized -> 4),'[]'::jsonb,
    25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  select row.value into v_card
  from pg_catalog.jsonb_array_elements(v_first -> 'rows') row(value)
  where row.value #>> '{item,activity_ref,id}'=
    '70000000-0000-4000-8000-000000000011';
  if v_card is null
     or (v_card #> '{item}') ? 'thread_ref'
     or v_card::text like '%provider:hidden-job%'
     or v_card::text like '%70000000-0000-4000-8000-000000000010%' then
    raise exception 'work_queue_hidden_mapped_thread_leaked';
  end if;

  insert into public.email_threads(
    id,company_id,connection_id,opportunity_id,provider_thread_id,
    subject,first_message_at,last_message_at,next_commitment_due_at,
    has_unresolved_commitments
  ) values(
    '20000000-0000-4000-8000-000000000097',v_company,v_connection,
    '70000000-0000-4000-8000-000000000001','provider:hidden-invalid',
    'Hidden invalid thread',pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp(),
    'infinity'::timestamptz,true
  );
  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"commitment","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(v_all_authorized -> 3),'[]'::jsonb,
    25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if v_first::text like '%20000000-0000-4000-8000-000000000097%'
     or v_first::text like '%provider:hidden-invalid%' then
    raise exception 'work_queue_hidden_job_invalid_commitment_leaked';
  end if;
  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,email_thread_id,
    opportunity_id,project_id,match_needs_review
  ) values(
    '30000000-0000-4000-8000-000000000097',v_company,'email',
    'infinity'::timestamptz,v_connection,'provider:hidden-invalid',
    '70000000-0000-4000-8000-000000000001','legacy:not-a-uuid',true
  );
  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"match_review","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(v_all_authorized -> 4),'[]'::jsonb,
    25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if v_first::text like '%30000000-0000-4000-8000-000000000097%'
     or v_first::text like '%provider:hidden-invalid%' then
    raise exception 'work_queue_hidden_job_invalid_match_leaked';
  end if;

  begin
    insert into public.activities(
      id,company_id,type,created_at,email_connection_id,email_thread_id,
      project_id,match_needs_review
    ) values(
      '30000000-0000-4000-8000-000000000099',v_company,'email',
      pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp()),
      v_connection,'provider:malformed-project','legacy:not-a-uuid',true
    );
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"match_review","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 4),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_malformed_legacy_project_was_accepted';
  exception when sqlstate '22000' then null;
  end;

  begin
    insert into public.email_threads(
      id,company_id,connection_id,provider_thread_id,
      subject,first_message_at,last_message_at,next_commitment_due_at,
      has_unresolved_commitments
    ) values(
      '20000000-0000-4000-8000-000000000099',v_company,v_connection,
      'provider:infinite-commitment','Infinite commitment',
      pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp(),
      'infinity'::timestamptz,true
    );
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"commitment","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 3),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_infinite_commitment_was_accepted';
  exception when sqlstate '22000' then null;
  end;

  begin
    delete from private.agent_read_domain_revisions
    where company_id=v_company and domain='work_queue';
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"match_review","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 4),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_missing_revision_was_accepted';
  exception when insufficient_privilege then null;
  end;

  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"task","origin":"explicit"},{"source":"lead","origin":"explicit"},{"source":"correspondence","origin":"explicit"},{"source":"commitment","origin":"explicit"},{"source":"match_review","origin":"explicit"},{"source":"schedule","origin":"explicit"},{"source":"financial_document","origin":"explicit"},{"source":"payment","origin":"explicit"},{"source":"expense","origin":"explicit"}]'::jsonb,
    v_all_authorized,'[]'::jsonb,25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if pg_catalog.jsonb_array_length(v_first -> 'source_slices') <> 9
     or pg_catalog.jsonb_array_length(v_first -> 'source_revisions') <> 7 then
    raise exception 'work_queue_all_nine_sources';
  end if;

  -- A helper slice with exactly 25 returned cards succeeds. Its hidden 26th
  -- card is outside the work queue's frozen logical union and cannot mint a
  -- false outer cursor.
  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"task","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(v_all_authorized -> 0),'[]'::jsonb,
    25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if pg_catalog.jsonb_array_length(v_first -> 'rows') <> 25
     or (v_first ->> 'source_has_more')::boolean
     or v_first #>> '{source_slices,0,source_inspected}' <> '26'
     or v_first #>> '{source_slices,0,bounded_count}' <> '25'
     or v_first #>> '{source_slices,0,truncated}' <> 'true' then
    raise exception 'work_queue_helper_exactly_25_or_hidden_26_failed';
  end if;

  -- Adding one independently bounded correspondence source creates the global
  -- union's real 26th card. Page two walks only that frozen 26-card union.
  v_first := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(
      v_all_authorized -> 0,v_all_authorized -> 2
    ),'[]'::jsonb,25,26,501,null,'[]'::jsonb,null,null,null,null
  );
  if pg_catalog.jsonb_array_length(v_first -> 'rows') <> 25
     or (v_first ->> 'source_has_more')::boolean is not true then
    raise exception 'work_queue_global_bounded_union_26_failed';
  end if;
  v_read_at := (v_first ->> 'read_at')::timestamptz;
  if v_read_at > pg_catalog.statement_timestamp()
     or v_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes'
     or v_read_at <> pg_catalog.date_trunc('milliseconds',v_read_at) then
    raise exception 'work_queue_page2_signed_read_at_window_failed';
  end if;
  v_last := v_first #> '{rows,24,predecessor}';
  begin
    update public.activities
    set created_at=created_at + interval '1 millisecond'
    where id='30000000-0000-4000-8000-000000000001';
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(
        v_all_authorized -> 0,v_all_authorized -> 2
      ),'[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
      (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
      v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'work_queue_stale_revision_was_accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.email_connections
    set user_id='10000000-0000-4000-8000-000000000099'
    where id=v_connection;
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 0,v_all_authorized -> 2),
      '[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
      (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
      v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'work_queue_email_ownership_stale_was_accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.opportunities
    set assigned_to=v_actor
    where id='70000000-0000-4000-8000-000000000002';
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 0,v_all_authorized -> 2),
      '[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
      (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
      v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'work_queue_opportunity_assignment_stale_was_accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.project_tasks
    set team_member_ids=array[v_actor::text]
    where id='70000000-0000-4000-8000-000000000004';
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 0,v_all_authorized -> 2),
      '[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
      (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
      v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'work_queue_project_membership_stale_was_accepted';
  exception when serialization_failure then null;
  end;
  begin
    update public.email_threads
    set subject='changed subject',latest_snippet='changed snippet',
        last_message_at=last_message_at + interval '1 millisecond'
    where id='80000000-0000-4000-8000-000000000001';
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 0,v_all_authorized -> 2),
      '[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
      (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
      v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
    );
    raise exception 'work_queue_correspondence_projection_stale_was_accepted';
  exception when serialization_failure then null;
  end;
  v_second := public.read_agent_work_queue_as_system(
    v_company,v_actor,'10000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000013',
    '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
    '2026-08-22.capability-manifest.v8',
    '[{"source":"task","origin":"explicit"},{"source":"correspondence","origin":"explicit"}]'::jsonb,
    pg_catalog.jsonb_build_array(
      v_all_authorized -> 0,v_all_authorized -> 2
    ),'[]'::jsonb,25,26,501,v_read_at,v_first -> 'source_revisions',
    (v_last #>> '{order,0}')::integer,(v_last #>> '{order,1}')::timestamptz,
    v_last #>> '{order,2}',(v_last ->> 'tie_breaker')::uuid
  );
  if pg_catalog.jsonb_array_length(v_second -> 'rows') <> 1
     or (v_second ->> 'source_has_more')::boolean
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_first -> 'rows') first_row
       join pg_catalog.jsonb_array_elements(v_second -> 'rows') second_row
         on first_row #>> '{item,queue_ref,id}' =
            second_row #>> '{item,queue_ref,id}'
     ) then
    raise exception 'work_queue_page2_frozen_union_or_duplicate_failed';
  end if;

  declare
    v_own_revision text;
    v_own_permissions jsonb;
    v_own_authorized jsonb;
  begin
    update public.user_permission_overrides
    set scope='own'
    where user_id=v_actor and company_id=v_company
      and permission='email.view';
    select authority.permission_snapshot_revision,
           coalesce(pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',permission.value ->> 'scope'
             order by permission.value ->> 'permission' collate "C"
           ) filter(where permission.value ->> 'permission' is not null),'{}'::jsonb)
      into v_own_revision,v_own_permissions
    from private.resolve_agent_actor_authority(v_actor,v_company,v_keys) authority
    left join lateral pg_catalog.jsonb_array_elements(
      authority.effective_permissions
    ) permission(value) on true
    group by authority.permission_snapshot_revision;
    v_own_authorized := pg_catalog.jsonb_build_array(
      private.agent_p2_work_queue_expected_source_v1(
        'correspondence','explicit',v_own_permissions
      ),
      private.agent_p2_work_queue_expected_source_v1(
        'commitment','explicit',v_own_permissions
      ),
      private.agent_p2_work_queue_expected_source_v1(
        'match_review','explicit',v_own_permissions
      )
    );
    if private.agent_p2_work_queue_expected_source_v1(
         'expense','explicit',
         (v_own_permissions || '{"expenses.view":"own"}'::jsonb)
           - 'expenses.approve'
       ) #> '{satisfied_permission_group_indexes}' <> '[1]'::jsonb then
      raise exception 'work_queue_expense_own_group_parity_failed';
    end if;
    v_first := public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_own_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"correspondence","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_own_authorized -> 0),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    if v_first -> 'rows' <> '[]'::jsonb
       or (v_first ->> 'source_has_more')::boolean
       or v_first #>> '{source_slices,0,source_inspected}' <> '0'
       or v_first #>> '{source_slices,0,bounded_count}' <> '0'
       or v_first #>> '{source_slices,0,truncated}' <> 'false' then
      raise exception 'work_queue_correspondence_own_count_leaked';
    end if;
    v_first := public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_own_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"correspondence","origin":"explicit"},{"source":"commitment","origin":"explicit"},{"source":"match_review","origin":"explicit"}]'::jsonb,
      v_own_authorized,'[]'::jsonb,25,26,501,null,'[]'::jsonb,
      null,null,null,null
    );
    if v_first::text like '%80000000-0000-4000-8000-000000000001%'
       or v_first::text like '%80000000-0000-4000-8000-000000000002%'
       or v_first::text like '%provider:other-mailbox%'
       or v_first::text like '%private snippet%' then
      raise exception 'work_queue_email_own_mailbox_leaked';
    end if;
    raise exception 'rollback_email_own_fixture' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;
  end;

  insert into public.email_threads(
    id,company_id,connection_id,provider_thread_id,subject,
    first_message_at,last_message_at,next_commitment_due_at,
    has_unresolved_commitments
  )
  select ('40000000-0000-4000-8000-' || pg_catalog.lpad(value::text,12,'0'))::uuid,
         v_company,'10000000-0000-4000-8000-000000000015'::uuid,'bound:' || value,
         'Bound commitment ' || value::text,
         pg_catalog.statement_timestamp(),pg_catalog.statement_timestamp(),
         pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())
           + value * interval '1 minute',true
  from pg_catalog.generate_series(1,475) value;
  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,v_grant,v_client,'11111111111111111111111111111111',
      v_scopes,v_revision,v_keys,'2026-08-22.capability-manifest.v8',
      '[{"source":"commitment","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_authorized -> 0),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_source_501_fails_closed';
  exception when program_limit_exceeded then null;
  end;

  insert into public.activities(
    id,company_id,type,created_at,email_connection_id,email_thread_id,
    match_needs_review
  )
  select ('60000000-0000-4000-8000-' || pg_catalog.lpad(value::text,12,'0'))::uuid,
         v_company,'email',
         pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp())
           + value * interval '1 millisecond',
         '10000000-0000-4000-8000-000000000015'::uuid,
         'unauthorized:' || value,true
  from pg_catalog.generate_series(1,500) value;
  begin
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"match_review","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 4),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_match_raw_unauthorized_501_was_accepted';
  exception when program_limit_exceeded then null;
  end;

  begin
    perform pg_catalog.set_config('task17.expense_collision','on',true);
    perform public.read_agent_work_queue_as_system(
      v_company,v_actor,'10000000-0000-4000-8000-000000000014',
      '10000000-0000-4000-8000-000000000013',
      '22222222222222222222222222222222',v_all_scopes,v_revision,v_keys,
      '2026-08-22.capability-manifest.v8',
      '[{"source":"expense","origin":"explicit"}]'::jsonb,
      pg_catalog.jsonb_build_array(v_all_authorized -> 8),'[]'::jsonb,
      25,26,501,null,'[]'::jsonb,null,null,null,null
    );
    raise exception 'work_queue_duplicate_queue_ref_was_accepted';
  exception when sqlstate '22000' then null;
  end;
end;
$work_queue_behavior_proof$;

rollback;
