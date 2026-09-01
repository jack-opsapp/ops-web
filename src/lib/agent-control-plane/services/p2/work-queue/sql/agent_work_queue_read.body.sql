begin;

set local timezone = 'UTC';

-- Task 17 canonical work-queue read body. The service-only outer statement
-- preauthorizes every selected source, calls only frozen bounded private
-- projections, and packages one globally ordered atomic queue.
do $prerequisites$
begin
  if pg_catalog.to_regprocedure('private.agent_p2_task_attention_v1(uuid,uuid,text,text[],text,text,timestamp with time zone,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_read_domain_uuid_from_text(text)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_optional_canonical_text(text,integer,integer,boolean)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_legacy_lead_attention_v1(uuid,uuid,text,text[],text,timestamp with time zone,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_legacy_correspondence_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_legacy_schedule_attention_v1(uuid,uuid,text,text[],text,text,text,timestamp with time zone,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_sales_document_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)') is null
     or pg_catalog.to_regprocedure('private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)') is null
     or pg_catalog.to_regclass('public.email_connections') is null then
    raise exception 'agent_work_queue_read_prerequisite_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_work_queue_hash_ref_v1(
  p_prefix text,
  p_material jsonb
) returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
  select case when p_prefix in ('ops_proof:v1:', 'ops_evidence:v1:')
    then p_prefix || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          private.canonical_agent_projection_json(p_material),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  end
$function$;

create or replace function private.agent_p2_work_queue_expected_source_v1(
  p_source text,
  p_origin text,
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_required jsonb;
  v_resolved jsonb := '{}'::jsonb;
  v_groups jsonb := '[0]'::jsonb;
  v_view text;
  v_approve text;
begin
  if p_source not in (
       'task','lead','correspondence','commitment','match_review','schedule',
       'financial_document','payment','expense'
     )
     or p_origin not in ('explicit','default')
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;

  if p_source = 'task' then
    if p_permissions ->> 'tasks.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view' not in ('all','assigned') then
      return null;
    end if;
    v_required := '["ops.operations.read","ops.tasks.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'projects.view',p_permissions ->> 'projects.view',
      'tasks.view',p_permissions ->> 'tasks.view'
    );
  elsif p_source = 'lead' then
    if p_permissions ->> 'pipeline.view' not in ('all','assigned') then return null; end if;
    v_required := '["ops.jobs.read","ops.operations.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'pipeline.view',p_permissions ->> 'pipeline.view'
    );
  elsif p_source in ('correspondence','commitment') then
    if p_permissions ->> 'email.view' not in ('all','own')
       or p_permissions ->> 'inbox.view' not in ('all','assigned','own')
       or p_permissions ->> 'pipeline.view' not in ('all','assigned') then
      return null;
    end if;
    v_required := '["ops.correspondence.read","ops.operations.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'email.view',p_permissions ->> 'email.view',
      'inbox.view',p_permissions ->> 'inbox.view',
      'pipeline.view',p_permissions ->> 'pipeline.view'
    );
  elsif p_source = 'match_review' then
    if p_permissions ->> 'email.view' not in ('all','own')
       or p_permissions ->> 'inbox.view' not in ('all','assigned','own')
       or p_permissions ->> 'pipeline.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view' not in ('all','assigned') then
      return null;
    end if;
    v_required := '["ops.correspondence.read","ops.operations.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'email.view',p_permissions ->> 'email.view',
      'inbox.view',p_permissions ->> 'inbox.view',
      'pipeline.view',p_permissions ->> 'pipeline.view',
      'projects.view',p_permissions ->> 'projects.view'
    );
  elsif p_source = 'schedule' then
    if p_permissions ->> 'calendar.view' not in ('all','own')
       or p_permissions ->> 'tasks.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view' not in ('all','assigned') then
      return null;
    end if;
    v_required := '["ops.operations.read","ops.schedule.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'calendar.view',p_permissions ->> 'calendar.view',
      'projects.view',p_permissions ->> 'projects.view',
      'tasks.view',p_permissions ->> 'tasks.view'
    );
  elsif p_source = 'financial_document' then
    if p_permissions ->> 'estimates.view' not in ('all','assigned')
       or p_permissions ->> 'invoices.view' not in ('all','assigned')
       or p_permissions ->> 'pipeline.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view_financials' is distinct from 'all' then
      return null;
    end if;
    v_required := '["ops.financial_documents.read","ops.operations.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'estimates.view',p_permissions ->> 'estimates.view',
      'invoices.view',p_permissions ->> 'invoices.view',
      'pipeline.view',p_permissions ->> 'pipeline.view',
      'projects.view',p_permissions ->> 'projects.view',
      'projects.view_financials','all'
    );
  elsif p_source = 'payment' then
    if p_permissions ->> 'finances.view' is distinct from 'all'
       or p_permissions ->> 'invoices.view' not in ('all','assigned')
       or p_permissions ->> 'pipeline.view' not in ('all','assigned')
       or p_permissions ->> 'projects.view' not in ('all','assigned') then
      return null;
    end if;
    v_required := '["ops.operations.read","ops.payments.read"]'::jsonb;
    v_resolved := pg_catalog.jsonb_build_object(
      'finances.view','all',
      'invoices.view',p_permissions ->> 'invoices.view',
      'pipeline.view',p_permissions ->> 'pipeline.view',
      'projects.view',p_permissions ->> 'projects.view'
    );
  else
    v_view := p_permissions ->> 'expenses.view';
    v_approve := p_permissions ->> 'expenses.approve';
    v_required := '["ops.expenses.read","ops.operations.read"]'::jsonb;
    if v_view = 'all' and v_approve in ('all','assigned') then
      v_resolved := pg_catalog.jsonb_build_object(
        'expenses.approve',v_approve,'expenses.view','all'
      );
      v_groups := '[0,1]'::jsonb;
    elsif v_view = 'all' then
      v_resolved := pg_catalog.jsonb_build_object('expenses.view','all');
      v_groups := '[1]'::jsonb;
    elsif v_view = 'own' then
      v_resolved := pg_catalog.jsonb_build_object('expenses.view','own');
      v_groups := '[1]'::jsonb;
    else
      return null;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'source',p_source,
    'origin',p_origin,
    'required_oauth_scopes',v_required,
    'resolved_permission_scopes',v_resolved,
    'satisfied_permission_group_indexes',v_groups
  );
end;
$function$;

create or replace function private.agent_p2_work_queue_read_v1(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_selections jsonb,
  p_authorized_sources jsonb,
  p_warnings jsonb,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_priority integer,
  p_after_attention_at timestamptz,
  p_after_source text,
  p_after_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_read_at timestamptz;
  v_permissions jsonb;
  v_snapshot_revision text;
  v_source jsonb;
  v_card jsonb;
  v_result jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_revisions jsonb;
  v_source_inspected integer := 0;
  v_candidate jsonb;
  v_financial_candidates jsonb;
  v_context jsonb;
  v_rows jsonb;
  v_collection_ref text;
  v_source_has_more boolean;
  v_returned_count integer;
  v_expected_source jsonb;
  v_selection jsonb;
  v_supplied_source jsonb;
  v_authorized_count integer;
  v_warning_count integer;
  v_source_count integer;
  v_source_cards jsonb;
  v_expected_domains text[];
  v_source_slices jsonb := '[]'::jsonb;
  v_cards_before integer;
  v_source_truncated boolean;
  v_source_ids uuid[];
begin
  if auth.role() is distinct from 'service_role'
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from least(p_item_limit + 1, 26)
     or p_source_limit is distinct from 501
     or pg_catalog.jsonb_typeof(p_selections) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_selections) not between 1 and 9
     or pg_catalog.jsonb_typeof(p_authorized_sources) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_warnings) is distinct from 'array'
     or p_cursor_source_revisions is null
     or p_registered_permission_keys is null
     or not (
       p_cursor_read_at is null
       and p_cursor_source_revisions = '[]'::jsonb
       and p_after_priority is null
       and p_after_attention_at is null
       and p_after_source is null
       and p_after_id is null
       or p_cursor_read_at is not null
       and p_after_priority between 0 and 99
       and p_after_attention_at is not null
       and pg_catalog.isfinite(p_after_attention_at)
       and p_after_attention_at is distinct from null
       and p_after_attention_at = pg_catalog.date_trunc(
         'milliseconds',p_after_attention_at
       )
       and extract(year from p_after_attention_at at time zone 'UTC')
            between 1 and 9999
       and p_after_source in (
         'task','lead','correspondence','commitment','match_review','schedule',
         'financial_document','payment','expense'
       )
       and p_after_id is not null
       and pg_catalog.jsonb_typeof(p_cursor_source_revisions) = 'array'
       and pg_catalog.jsonb_array_length(p_cursor_source_revisions) between 1 and 9
       and not exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_cursor_source_revisions) revision(value)
         where revision.value is distinct from pg_catalog.jsonb_build_object(
             'domain',revision.value ->> 'domain',
             'source_revision',revision.value -> 'source_revision'
           )
            or revision.value ->> 'domain' is null
            or revision.value ->> 'domain' not in (
              'expenses','legacy_job_history','legacy_operational','payments',
              'sales_documents','tasks','work_queue'
            )
            or pg_catalog.jsonb_typeof(revision.value -> 'source_revision')
                 is distinct from 'number'
            or revision.value ->> 'source_revision' !~ '^(0|[1-9][0-9]{0,15})$'
            or case when pg_catalog.jsonb_typeof(
                 revision.value -> 'source_revision'
               ) = 'number'
               and revision.value ->> 'source_revision' ~ '^(0|[1-9][0-9]{0,15})$'
              then (revision.value ->> 'source_revision')::numeric > 9007199254740991
              else false end
       )
       and p_cursor_source_revisions = (
         select pg_catalog.jsonb_agg(revision.value order by
           revision.value ->> 'domain' collate "C"
         )
         from pg_catalog.jsonb_array_elements(p_cursor_source_revisions) revision(value)
       )
       and pg_catalog.jsonb_array_length(p_cursor_source_revisions) = (
         select pg_catalog.count(distinct revision.value ->> 'domain')
         from pg_catalog.jsonb_array_elements(p_cursor_source_revisions) revision(value)
       )
     )
     or not array[
       'calendar.view','email.view','estimates.view','expenses.approve',
       'expenses.view','finances.view','inbox.view','invoices.view',
       'pipeline.view','projects.view','projects.view_financials','tasks.view'
     ]::text[] <@ p_registered_permission_keys
     or exists (
       select 1 from pg_catalog.unnest(p_registered_permission_keys) key(value)
       where key.value is null
          or key.value is distinct from pg_catalog.btrim(key.value)
          or pg_catalog.octet_length(key.value) not between 1 and 128
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(value order by value collate "C")
       from (select distinct pg_catalog.unnest(p_registered_permission_keys) value) keys
     ) then
    raise exception 'agent_work_queue_read_invalid' using errcode = '22023';
  end if;

  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );
  if v_read_at is null
     or v_read_at is distinct from pg_catalog.date_trunc('milliseconds', v_read_at)
     or not pg_catalog.isfinite(v_read_at)
     or extract(year from v_read_at at time zone 'UTC') not between 1 and 9999
     or v_read_at > pg_catalog.statement_timestamp()
     or p_cursor_read_at is not null
        and v_read_at <= pg_catalog.statement_timestamp() - interval '15 minutes' then
    raise exception 'agent_work_queue_read_invalid' using errcode = '22023';
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (where permission.value ->> 'permission' is not null),
           '{}'::jsonb
         )
    into v_snapshot_revision, v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;

  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_selections) selected(value)
       where selected.value ->> 'source' is null
          or selected.value ->> 'origin' is null
          or selected.value ->> 'source' not in (
           'task','lead','correspondence','commitment','match_review','schedule',
           'financial_document','payment','expense'
         )
          or selected.value ->> 'origin' not in ('explicit','default')
          or selected.value is distinct from pg_catalog.jsonb_build_object(
         'source',selected.value ->> 'source',
         'origin',selected.value ->> 'origin'
       )
     )
     or p_selections is distinct from (
       select pg_catalog.jsonb_agg(selected.value order by
         case selected.value ->> 'source'
           when 'task' then 0 when 'lead' then 1 when 'correspondence' then 2
           when 'commitment' then 3 when 'match_review' then 4
           when 'schedule' then 5 when 'financial_document' then 6
           when 'payment' then 7 when 'expense' then 8 else 9 end
       )
       from pg_catalog.jsonb_array_elements(p_selections) selected(value)
     ) then
    raise exception 'agent_work_queue_preauthorization_failed'
      using errcode = '42501';
  end if;

  for v_selection in
    select value from pg_catalog.jsonb_array_elements(p_selections)
  loop
    v_expected_source := private.agent_p2_work_queue_expected_source_v1(
      v_selection ->> 'source',v_selection ->> 'origin',v_permissions
    );
    select pg_catalog.count(*),
           (coalesce(pg_catalog.jsonb_agg(source.value),'[]'::jsonb) -> 0)
      into v_authorized_count,v_supplied_source
    from pg_catalog.jsonb_array_elements(p_authorized_sources) source(value)
    where source.value ->> 'source' = v_selection ->> 'source';
    select pg_catalog.count(*)
      into v_warning_count
    from pg_catalog.jsonb_array_elements(p_warnings) warning(value)
    where warning.value ->> 'source' = v_selection ->> 'source';

    if v_expected_source is not null
       and (v_expected_source -> 'required_oauth_scopes') <@
           pg_catalog.to_jsonb(p_granted_scope_ceiling) then
      if v_authorized_count <> 1
         or v_warning_count <> 0
         or v_supplied_source is distinct from v_expected_source then
        raise exception 'agent_work_queue_preauthorization_failed'
          using errcode = '42501';
      end if;
    elsif v_selection ->> 'origin' = 'default' then
      if v_authorized_count <> 0
         or v_warning_count <> 1
         or not exists (
        select 1 from pg_catalog.jsonb_array_elements(p_warnings) warning(value)
        where warning.value = pg_catalog.jsonb_build_object(
          'code','DEFAULT_COMPONENT_OMITTED',
          'source',v_selection ->> 'source'
        )
      ) then
        raise exception 'agent_work_queue_preauthorization_failed'
          using errcode = '42501';
      end if;
    else
      raise exception 'agent_work_queue_preauthorization_failed'
        using errcode = '42501';
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(p_authorized_sources)
       + pg_catalog.jsonb_array_length(p_warnings)
       <> pg_catalog.jsonb_array_length(p_selections)
     or p_authorized_sources is distinct from (
       select coalesce(pg_catalog.jsonb_agg(source.value order by
         case source.value ->> 'source'
           when 'task' then 0 when 'lead' then 1 when 'correspondence' then 2
           when 'commitment' then 3 when 'match_review' then 4
           when 'schedule' then 5 when 'financial_document' then 6
           when 'payment' then 7 when 'expense' then 8 else 9 end
       ),'[]'::jsonb)
       from pg_catalog.jsonb_array_elements(p_authorized_sources) source(value)
     )
     or p_warnings is distinct from (
       select coalesce(pg_catalog.jsonb_agg(warning.value order by
         case warning.value ->> 'source'
           when 'task' then 0 when 'lead' then 1 when 'correspondence' then 2
           when 'commitment' then 3 when 'match_review' then 4
           when 'schedule' then 5 when 'financial_document' then 6
           when 'payment' then 7 when 'expense' then 8 else 9 end
       ),'[]'::jsonb)
       from pg_catalog.jsonb_array_elements(p_warnings) warning(value)
     ) then
    raise exception 'agent_work_queue_preauthorization_failed'
      using errcode = '42501';
  end if;

  perform 1
  from private.mcp_oauth_grants grant_row
  join private.mcp_oauth_clients client
    on client.client_id = grant_row.client_id
   and client.disabled_at is null
   and grant_row.scopes <@ client.scope_ceiling
   and grant_row.consent_catalog_revision = client.consent_catalog_revision
   and grant_row.exposure_revision = client.exposure_revision
  join public.companies company
    on company.id = p_company_id and company.deleted_at is null
  where grant_row.id = p_oauth_grant_id
    and grant_row.user_id = p_actor_user_id
    and grant_row.company_id = p_company_id
    and grant_row.client_id = p_oauth_client_id
    and grant_row.revision = p_grant_revision
    and grant_row.revoked_at is null
    and grant_row.scopes = p_granted_scope_ceiling
    and array['ops.operations.read']::text[] <@ grant_row.scopes
    and grant_row.accepted_labels = private.mcp_oauth_labels_for_scopes(
      grant_row.scopes, grant_row.consent_catalog_revision
    );
  if not found then
    raise exception 'agent_work_queue_preauthorization_failed'
      using errcode = '42501';
  end if;

  -- No source projection is called until the entire selected vector above has
  -- been re-proved. Each helper retains its own exact row-level authority.
  for v_source in
    select value
    from pg_catalog.jsonb_array_elements(p_authorized_sources)
    order by case value ->> 'source'
      when 'task' then 0 when 'lead' then 1 when 'correspondence' then 2
      when 'commitment' then 3 when 'match_review' then 4 when 'schedule' then 5
      when 'financial_document' then 6 when 'payment' then 7 else 8 end
  loop
    v_source_count := 0;
    v_cards_before := pg_catalog.jsonb_array_length(v_cards);
    v_source_truncated := false;
    if v_source ->> 'source' = 'task' then
      v_result := private.agent_p2_task_attention_v1(
        p_actor_user_id, p_company_id, p_permission_snapshot_revision,
        p_registered_permission_keys, v_permissions ->> 'tasks.view',
        v_permissions ->> 'projects.view', v_read_at, 25
      );
      v_source_count := coalesce(
        (v_result ->> 'source_inspected_count')::integer, 0
      );
      v_source_truncated := coalesce((v_result ->> 'has_more')::boolean,false);
      for v_card in select value from pg_catalog.jsonb_array_elements(v_result -> 'cards') loop
        if v_card ->> 'title' is null
           or private.agent_p2_optional_canonical_text(
                v_card ->> 'title',256,1024,false
              ) is distinct from v_card ->> 'title' then
          raise exception 'agent_work_queue_source_data_invalid'
            using errcode = '22000';
        end if;
        v_cards := v_cards || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domains', pg_catalog.jsonb_build_array('legacy_operational','tasks'),
            'item', pg_catalog.jsonb_build_object(
              'source','task',
              'queue_ref',v_card -> 'task_ref',
              'priority',case v_card ->> 'reason_code' when 'overdue' then 0 else 2 end,
              'attention_at',v_card -> 'attention_at',
              'task_ref',v_card -> 'task_ref','job_ref',v_card -> 'job_ref',
              'reason',v_card ->> 'reason_code','title',v_card ->> 'title',
              'content_kind','untrusted_business_data'
            )
          )
        );
      end loop;
    elsif v_source ->> 'source' = 'lead' then
      v_result := private.agent_p2_legacy_lead_attention_v1(
        p_actor_user_id,p_company_id,p_permission_snapshot_revision,
        p_registered_permission_keys,v_permissions ->> 'pipeline.view',
        v_read_at,25
      );
      v_source_count := coalesce(
        (v_result ->> 'source_inspected_count')::integer,0
      );
      v_source_truncated := coalesce((v_result ->> 'has_more')::boolean,false);
      for v_card in select value from pg_catalog.jsonb_array_elements(v_result -> 'cards') loop
        v_cards := v_cards || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domains',pg_catalog.jsonb_build_array('legacy_operational','work_queue'),
            'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'source','lead','queue_ref',pg_catalog.jsonb_build_object(
                'kind','lead','id',v_card #> '{job_ref,id}'
              ),'priority',case v_card ->> 'reason_code'
                when 'operator_action_required' then 0 else 1 end,
              'attention_at',v_card -> 'attention_at','job_ref',v_card -> 'job_ref',
              'reason',v_card ->> 'reason_code','title',v_card ->> 'title',
              'content_kind','untrusted_business_data'
            )
          )
        ));
      end loop;
    elsif v_source ->> 'source' = 'correspondence' then
      v_result := private.agent_p2_legacy_correspondence_attention_v1(
        p_actor_user_id,p_company_id,p_permission_snapshot_revision,
        p_registered_permission_keys,v_permissions ->> 'inbox.view',
        v_permissions ->> 'email.view',v_permissions ->> 'pipeline.view',
        v_read_at,25
      );
      if v_permissions ->> 'email.view' = 'own' then
        select coalesce(pg_catalog.jsonb_agg(card.value order by card.ordinality),
                        '[]'::jsonb)
          into v_source_cards
        from pg_catalog.jsonb_array_elements(v_result -> 'cards')
          with ordinality card(value,ordinality)
        join public.email_threads thread
          on thread.id=private.agent_read_domain_uuid_from_text(
            card.value ->> 'thread_ref'
          )
         and thread.company_id=p_company_id
        join public.email_connections connection
          on connection.id=thread.connection_id
         and private.agent_read_domain_uuid_from_text(connection.company_id::text)=
               p_company_id
         and connection.type::text='individual'
         and private.agent_read_domain_uuid_from_text(connection.user_id::text)=
               p_actor_user_id;
        v_result := pg_catalog.jsonb_set(v_result,'{cards}',v_source_cards,true);
        v_source_count := pg_catalog.jsonb_array_length(v_source_cards);
        v_source_truncated := false;
      else
        v_source_count := coalesce(
          (v_result ->> 'source_inspected_count')::integer,0
        );
        v_source_truncated := coalesce((v_result ->> 'has_more')::boolean,false);
      end if;
      for v_card in select value from pg_catalog.jsonb_array_elements(v_result -> 'cards') loop
        v_cards := v_cards || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domains',pg_catalog.jsonb_build_array(
              'legacy_job_history','legacy_operational','work_queue'
            ),
            'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'source','correspondence','queue_ref',pg_catalog.jsonb_build_object(
                'kind','correspondence','id',v_card -> 'thread_ref'
              ),'priority',1,'attention_at',v_card -> 'attention_at',
              'thread_ref',pg_catalog.jsonb_build_object(
                'kind','email_thread','id',v_card -> 'thread_ref'
              ),'job_ref',v_card -> 'job_ref',
              'reason','unresolved_correspondence','subject',v_card ->> 'subject',
              'snippet',coalesce(v_card ->> 'latest_snippet',''),
              'content_kind','untrusted_business_data'
            ))
          )
        );
      end loop;
    elsif v_source ->> 'source' = 'commitment' then
      select coalesce(pg_catalog.array_agg(
               raw.id order by raw.next_commitment_due_at,raw.id
             ),array[]::uuid[])
        into v_source_ids
      from (
        select thread.id,thread.next_commitment_due_at
        from public.email_threads thread
        where thread.company_id=p_company_id
          and thread.archived_at is null
          and thread.has_unresolved_commitments=true
          and thread.next_commitment_due_at is not null
        order by thread.next_commitment_due_at,thread.id
        limit 501
      ) raw;
      v_source_count := pg_catalog.cardinality(v_source_ids);
      if v_source_count >= p_source_limit then
        raise exception 'agent_work_queue_source_query_bound'
          using errcode='54000';
      end if;
      if exists (
        select 1
        from pg_catalog.unnest(v_source_ids) candidate(id)
        join public.email_threads thread on thread.id=candidate.id
        where private.user_can_view_inbox_connection(
                p_actor_user_id,p_company_id,thread.connection_id,
                thread.opportunity_id
              )
          and (
            v_permissions ->> 'email.view'='all'
            or exists (
              select 1 from public.email_connections connection
              where connection.id=thread.connection_id
                and private.agent_read_domain_uuid_from_text(
                  connection.company_id::text
                )=p_company_id
                and connection.type::text='individual'
                and private.agent_read_domain_uuid_from_text(
                  connection.user_id::text
                )=p_actor_user_id
            )
          )
          and (
            thread.opportunity_id is null
              and v_permissions ->> 'pipeline.view'='all'
            or thread.opportunity_id is not null
              and private.agent_user_can_access_entity(
                p_actor_user_id,p_company_id,'opportunity',
                thread.opportunity_id,'view'
              )
          )
          and (not pg_catalog.isfinite(thread.next_commitment_due_at)
           or extract(year from thread.next_commitment_due_at at time zone 'UTC')
                not between 1 and 9999
          )
      ) then
        raise exception 'agent_work_queue_source_data_invalid'
          using errcode = '22000';
      end if;
      with source as materialized (
        select thread.id,thread.opportunity_id,thread.next_commitment_due_at
        from pg_catalog.unnest(v_source_ids) with ordinality candidate(id,ordinality)
        join public.email_threads thread on thread.id=candidate.id
        where private.user_can_view_inbox_connection(
            p_actor_user_id,p_company_id,thread.connection_id,thread.opportunity_id
          )
          and (
            v_permissions ->> 'email.view'='all'
            or exists (
              select 1 from public.email_connections connection
              where connection.id=thread.connection_id
                and private.agent_read_domain_uuid_from_text(
                  connection.company_id::text
                )=p_company_id
                and connection.type::text='individual'
                and private.agent_read_domain_uuid_from_text(
                  connection.user_id::text
                )=p_actor_user_id
            )
          )
          and (
            thread.opportunity_id is null and v_permissions ->> 'pipeline.view' = 'all'
            or thread.opportunity_id is not null and private.agent_user_can_access_entity(
              p_actor_user_id,p_company_id,'opportunity',thread.opportunity_id,'view'
            )
          )
        order by candidate.ordinality
      ), bounded as materialized (
        select source.*,
               pg_catalog.row_number() over (
                 order by source.next_commitment_due_at,source.id
               ) as ordinality
        from source
      )
      select (select pg_catalog.count(*)::integer from source),
             coalesce(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'domains',pg_catalog.jsonb_build_array('work_queue'),
                 'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                   'source','commitment','queue_ref',pg_catalog.jsonb_build_object(
                     'kind','commitment','id',bounded.id
                   ),'priority',1,'attention_at',private.agent_rfc3339_utc(
                     pg_catalog.date_trunc('milliseconds',bounded.next_commitment_due_at)
                   ),'thread_ref',pg_catalog.jsonb_build_object(
                     'kind','email_thread','id',bounded.id
                   ),'job_ref',case when bounded.opportunity_id is null then null
                     else pg_catalog.jsonb_build_object(
                       'kind','opportunity','id',bounded.opportunity_id
                     ) end,'reason','unresolved_commitment'
                 ))
               ) order by bounded.next_commitment_due_at,bounded.id
             ) filter (where bounded.ordinality <= 25),'[]'::jsonb)
        into strict v_returned_count,v_result
      from bounded;
      v_source_truncated := v_returned_count > 25;
      v_cards := v_cards || v_result;
    elsif v_source ->> 'source' = 'match_review' then
      select coalesce(pg_catalog.array_agg(
               raw.id order by raw.created_at,raw.id
             ),array[]::uuid[])
        into v_source_ids
      from (
        select activity.id,activity.created_at
        from public.activities activity
        where activity.company_id=p_company_id
          and activity.match_needs_review=true
          and activity.type='email'
        order by activity.created_at,activity.id
        limit 501
      ) raw;
      v_source_count := pg_catalog.cardinality(v_source_ids);
      if v_source_count >= p_source_limit then
        raise exception 'agent_work_queue_source_query_bound'
          using errcode='54000';
      end if;
      if exists (
        select 1
        from pg_catalog.unnest(v_source_ids) candidate(id)
        join public.activities activity on activity.id=candidate.id
        where private.user_can_view_inbox_connection(
                p_actor_user_id,p_company_id,activity.email_connection_id,
                activity.opportunity_id
              )
          and (
            v_permissions ->> 'email.view'='all'
            or exists (
              select 1 from public.email_connections connection
              where connection.id=activity.email_connection_id
                and private.agent_read_domain_uuid_from_text(
                  connection.company_id::text
                )=p_company_id
                and connection.type::text='individual'
                and private.agent_read_domain_uuid_from_text(
                  connection.user_id::text
                )=p_actor_user_id
            )
          )
          and (activity.opportunity_id is not null
               or activity.project_id is not null
               or v_permissions ->> 'pipeline.view'='all')
          and (activity.opportunity_id is null
               or private.agent_user_can_access_entity(
                 p_actor_user_id,p_company_id,'opportunity',
                 activity.opportunity_id,'view'
               ))
          and (activity.project_id is null
               or private.agent_read_domain_uuid_from_text(activity.project_id) is null
               or private.agent_user_can_access_entity(
                 p_actor_user_id,p_company_id,'project',
                 private.agent_read_domain_uuid_from_text(activity.project_id),'view'
               ))
          and (activity.created_at is null
           or not pg_catalog.isfinite(activity.created_at)
           or extract(year from activity.created_at at time zone 'UTC')
                not between 1 and 9999
           or activity.project_id is not null
              and private.agent_read_domain_uuid_from_text(activity.project_id) is null
          )
      ) then
        raise exception 'agent_work_queue_source_data_invalid'
          using errcode = '22000';
      end if;
      if exists (
        select 1
        from pg_catalog.unnest(v_source_ids) candidate(id)
        join public.activities activity on activity.id=candidate.id
        cross join lateral (
          select pg_catalog.count(*)::integer as matched_count
          from (
            select thread.id
            from public.email_threads thread
            where thread.company_id = activity.company_id
              and thread.connection_id = activity.email_connection_id
              and thread.provider_thread_id = activity.email_thread_id
              and private.user_can_view_inbox_connection(
                p_actor_user_id,p_company_id,thread.connection_id,
                thread.opportunity_id
              )
              and (
                v_permissions ->> 'email.view'='all'
                or exists (
                  select 1 from public.email_connections connection
                  where connection.id=thread.connection_id
                    and private.agent_read_domain_uuid_from_text(
                      connection.company_id::text
                    )=p_company_id
                    and connection.type::text='individual'
                    and private.agent_read_domain_uuid_from_text(
                      connection.user_id::text
                    )=p_actor_user_id
                )
              )
              and (
                thread.opportunity_id is null
                  and v_permissions ->> 'pipeline.view' = 'all'
                or thread.opportunity_id is not null
                  and private.agent_user_can_access_entity(
                    p_actor_user_id,p_company_id,'opportunity',
                    thread.opportunity_id,'view'
                  )
              )
            limit 2
          ) matched
        ) mapping
        where private.user_can_view_inbox_connection(
            p_actor_user_id,p_company_id,activity.email_connection_id,
            activity.opportunity_id
          )
          and (
            v_permissions ->> 'email.view'='all'
            or exists (
              select 1 from public.email_connections connection
              where connection.id=activity.email_connection_id
                and private.agent_read_domain_uuid_from_text(
                  connection.company_id::text
                )=p_company_id
                and connection.type::text='individual'
                and private.agent_read_domain_uuid_from_text(
                  connection.user_id::text
                )=p_actor_user_id
            )
          )
          and (
            activity.opportunity_id is null and activity.project_id is null
              and v_permissions ->> 'pipeline.view' = 'all'
            or (activity.opportunity_id is not null or activity.project_id is not null)
              and (activity.opportunity_id is null or private.agent_user_can_access_entity(
                p_actor_user_id,p_company_id,'opportunity',activity.opportunity_id,'view'
              ))
              and (activity.project_id is null or private.agent_user_can_access_entity(
                p_actor_user_id,p_company_id,'project',
                private.agent_read_domain_uuid_from_text(activity.project_id),'view'
              ))
          )
          and activity.email_thread_id is not null
          and mapping.matched_count > 1
      ) then
        raise exception 'agent_work_queue_source_data_invalid'
          using errcode = '22000';
      end if;
      with source as materialized (
        select activity.id,activity.created_at,mapping.thread_id,
               activity.opportunity_id,activity.project_id
        from pg_catalog.unnest(v_source_ids) with ordinality candidate(id,ordinality)
        join public.activities activity on activity.id=candidate.id
        left join lateral (
          select thread.id as thread_id
          from public.email_threads thread
          where thread.company_id = activity.company_id
            and thread.connection_id = activity.email_connection_id
            and thread.provider_thread_id = activity.email_thread_id
            and private.user_can_view_inbox_connection(
              p_actor_user_id,p_company_id,thread.connection_id,
              thread.opportunity_id
            )
            and (
              v_permissions ->> 'email.view'='all'
              or exists (
                select 1 from public.email_connections connection
                where connection.id=thread.connection_id
                  and private.agent_read_domain_uuid_from_text(
                    connection.company_id::text
                  )=p_company_id
                  and connection.type::text='individual'
                  and private.agent_read_domain_uuid_from_text(
                    connection.user_id::text
                  )=p_actor_user_id
              )
            )
            and (
              thread.opportunity_id is null
                and v_permissions ->> 'pipeline.view' = 'all'
              or thread.opportunity_id is not null
                and private.agent_user_can_access_entity(
                  p_actor_user_id,p_company_id,'opportunity',
                  thread.opportunity_id,'view'
                )
            )
          order by thread.id
          limit 1
        ) mapping on true
        where private.user_can_view_inbox_connection(
            p_actor_user_id,p_company_id,activity.email_connection_id,
            activity.opportunity_id
          )
          and (
            v_permissions ->> 'email.view'='all'
            or exists (
              select 1 from public.email_connections connection
              where connection.id=activity.email_connection_id
                and private.agent_read_domain_uuid_from_text(
                  connection.company_id::text
                )=p_company_id
                and connection.type::text='individual'
                and private.agent_read_domain_uuid_from_text(
                  connection.user_id::text
                )=p_actor_user_id
            )
          )
          and (
            activity.opportunity_id is null and activity.project_id is null
              and v_permissions ->> 'pipeline.view' = 'all'
            or (activity.opportunity_id is not null or activity.project_id is not null)
              and (activity.opportunity_id is null or private.agent_user_can_access_entity(
                p_actor_user_id,p_company_id,'opportunity',activity.opportunity_id,'view'
              ))
              and (activity.project_id is null or private.agent_user_can_access_entity(
                p_actor_user_id,p_company_id,'project',
                private.agent_read_domain_uuid_from_text(activity.project_id),'view'
              ))
          )
        order by candidate.ordinality
      ), bounded as materialized (
        select source.*,
               pg_catalog.row_number() over (
                 order by source.created_at,source.id
               ) as ordinality
        from source
      )
      select (select pg_catalog.count(*)::integer from source),
             coalesce(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'domains',pg_catalog.jsonb_build_array('work_queue'),
                 'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                   'source','match_review','queue_ref',pg_catalog.jsonb_build_object(
                     'kind','match_review','id',bounded.id
                   ),'priority',0,'attention_at',private.agent_rfc3339_utc(
                     pg_catalog.date_trunc('milliseconds',bounded.created_at)
                   ),'activity_ref',pg_catalog.jsonb_build_object(
                     'kind','activity','id',bounded.id
                   ),'thread_ref',case when bounded.thread_id is null then null
                     else pg_catalog.jsonb_build_object(
                       'kind','email_thread','id',bounded.thread_id
                     ) end,'job_ref',case
                       when bounded.project_id is not null then pg_catalog.jsonb_build_object(
                         'kind','project','id',
                           private.agent_read_domain_uuid_from_text(bounded.project_id)
                       )
                       when bounded.opportunity_id is not null then pg_catalog.jsonb_build_object(
                         'kind','opportunity','id',bounded.opportunity_id
                       ) end,'reason','match_needs_review'
                 ))
               ) order by bounded.created_at,bounded.id
             ) filter (where bounded.ordinality <= 25),'[]'::jsonb)
        into strict v_returned_count,v_result
      from bounded;
      v_source_truncated := v_returned_count > 25;
      v_cards := v_cards || v_result;
    elsif v_source ->> 'source' = 'schedule' then
      v_result := private.agent_p2_legacy_schedule_attention_v1(
        p_actor_user_id,p_company_id,p_permission_snapshot_revision,
        p_registered_permission_keys,v_permissions ->> 'calendar.view',
        v_permissions ->> 'projects.view',v_permissions ->> 'tasks.view',
        v_read_at,25
      );
      v_source_count := coalesce(
        (v_result ->> 'source_inspected_count')::integer,0
      );
      v_source_truncated := coalesce((v_result ->> 'has_more')::boolean,false);
      for v_card in select value from pg_catalog.jsonb_array_elements(v_result -> 'cards') loop
        v_cards := v_cards || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domains',pg_catalog.jsonb_build_array('legacy_operational'),
            'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'source','schedule','queue_ref',pg_catalog.jsonb_build_object(
                'kind','schedule','id',v_card -> 'task_ref'
              ),'priority',2,'attention_at',v_card -> 'attention_at',
              'task_ref',pg_catalog.jsonb_build_object(
                'kind','task','id',v_card -> 'task_ref'
              ),'job_ref',v_card -> 'job_ref',
              'reason',v_card ->> 'reason_code','title',v_card ->> 'title',
              'content_kind','untrusted_business_data'
            )
          )
        ));
      end loop;
    elsif v_source ->> 'source' = 'financial_document' then
      v_financial_candidates := pg_catalog.jsonb_build_array(
        private.agent_p2_sales_expected_candidate_v1('estimate',v_permissions),
        private.agent_p2_sales_expected_candidate_v1('invoice',v_permissions)
      );
      v_result := private.agent_p2_sales_document_attention_v1(
        p_actor_user_id,p_company_id,p_oauth_grant_id,p_oauth_client_id,
        p_grant_revision,p_granted_scope_ceiling,p_permission_snapshot_revision,
        p_registered_permission_keys,v_financial_candidates,
        array['estimate','invoice']::text[],v_read_at,501,25
      );
      v_source_count := coalesce((v_result ->> 'source_inspected')::integer,0);
      for v_card in
        select value from pg_catalog.jsonb_array_elements(v_result -> 'cards')
        where value ->> 'due_on' is not null
      loop
        if v_card ->> 'document_number' is null
           or private.agent_p2_optional_canonical_text(
                v_card ->> 'document_number',256,1024,true
              ) is distinct from v_card ->> 'document_number' then
          raise exception 'agent_work_queue_source_data_invalid'
            using errcode = '22000';
        end if;
        v_cards := v_cards || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'domains',pg_catalog.jsonb_build_array(
              'legacy_operational','sales_documents'
            ),
            'item',pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'source','financial_document','queue_ref',pg_catalog.jsonb_build_object(
                'kind','financial_document','id',v_card #> '{document_ref,id}'
              ),'priority',case v_card ->> 'attention_kind'
                when 'invoice_overdue' then 0 else 2 end,
              'attention_at',(v_card ->> 'due_on') || 'T00:00:00.000Z',
              'document_ref',v_card -> 'document_ref',
              'job_ref',v_card -> 'job_ref','reason',v_card ->> 'attention_kind',
              'document_number',v_card ->> 'document_number',
              'content_kind','untrusted_business_data'
            ))
          )
        );
      end loop;
    elsif v_source ->> 'source' = 'payment' then
      v_candidate := private.agent_p2_payment_expected_candidate_v1(v_permissions);
      -- The frozen payment attention projection is intentionally aggregate-only.
      -- It is still executed and fenced, but no invented payment identity/time is
      -- converted into a queue card.
      v_result := private.agent_p2_payment_attention_v1(
        p_actor_user_id,p_company_id,p_oauth_grant_id,p_oauth_client_id,
        p_grant_revision,p_granted_scope_ceiling,p_permission_snapshot_revision,
        p_registered_permission_keys,v_candidate,v_read_at,501
      );
      v_source_count := coalesce((v_result ->> 'source_inspected')::integer,0);
    else
      v_source_cards := '[]'::jsonb;
      for v_candidate in
        select private.agent_p2_expense_expected_candidate_v1(
          variant, v_permissions
        )
        from (values ('pending_approval'::text),('reimbursement_batches'::text))
          variants(variant)
        where private.agent_p2_expense_expected_candidate_v1(
          variant, v_permissions
        ) is not null
      loop
        v_result := private.agent_p2_expense_attention_v1(
          p_actor_user_id,p_company_id,p_permission_snapshot_revision,
          p_registered_permission_keys,v_candidate,v_read_at,25,501
        );
        v_returned_count := pg_catalog.jsonb_array_length(v_result -> 'cards');
        v_source_count := v_source_count + v_returned_count;
        for v_card in select value from pg_catalog.jsonb_array_elements(v_result -> 'cards') loop
          if v_card ->> 'card_kind' = 'expense_approval' then
            v_source_cards := v_source_cards || pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'domains',pg_catalog.jsonb_build_array('expenses'),
                'item',pg_catalog.jsonb_build_object(
                  'source','expense','queue_ref',pg_catalog.jsonb_build_object(
                    'kind','expense','id',v_card #> '{expense_ref,id}'
                  ),'priority',1,'attention_at',v_card -> 'attention_at',
                  'expense_ref',v_card -> 'expense_ref','reason','approval_required'
                )
              )
            );
          elsif v_card ->> 'period_end' is not null then
            v_source_cards := v_source_cards || pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'domains',pg_catalog.jsonb_build_array('expenses'),
                'item',pg_catalog.jsonb_build_object(
                  'source','expense','queue_ref',pg_catalog.jsonb_build_object(
                    'kind','expense','id',v_card #> '{batch_ref,id}'
                  ),'priority',2,
                  'attention_at',(v_card ->> 'period_end') || 'T00:00:00.000Z',
                  'expense_ref',pg_catalog.jsonb_build_object(
                    'kind','reimbursement_batch','id',v_card #> '{batch_ref,id}'
                  ),'reason','reimbursement_pending'
                )
              )
            );
          end if;
        end loop;
      end loop;
      select coalesce(pg_catalog.jsonb_agg(card.value order by
               (card.value #>> '{item,priority}')::integer,
               card.value #>> '{item,attention_at}',
               card.value #>> '{item,source}' collate "C",
               card.value #>> '{item,queue_ref,id}'
             ),'[]'::jsonb)
        into v_source_cards
      from (
        select value
        from pg_catalog.jsonb_array_elements(v_source_cards) source(value)
        order by (value #>> '{item,priority}')::integer,
                 value #>> '{item,attention_at}',
                 value #>> '{item,source}' collate "C",
                 value #>> '{item,queue_ref,id}'
        limit 25
      ) card;
      v_source_truncated := v_source_count > pg_catalog.jsonb_array_length(
        v_source_cards
      );
      v_cards := v_cards || v_source_cards;
    end if;
    if v_source_count >= p_source_limit then
      raise exception 'agent_work_queue_source_query_bound' using errcode = '54000';
    end if;
    v_source_inspected := v_source_inspected + v_source_count;
    v_source_slices := v_source_slices || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source',v_source ->> 'source',
        'source_inspected',v_source_count,
        'bounded_count',pg_catalog.jsonb_array_length(v_cards) - v_cards_before,
        'truncated',v_source_truncated
      )
    );
  end loop;

  if v_source_inspected > 4500 then
    raise exception 'agent_work_queue_source_query_bound' using errcode = '54000';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_cards) card(value)
    group by card.value #>> '{item,queue_ref,kind}' collate "C",
             card.value #>> '{item,queue_ref,id}' collate "C"
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'agent_work_queue_duplicate_queue_ref'
      using errcode = '22000';
  end if;

  select pg_catalog.array_agg(domain order by domain collate "C")
    into v_expected_domains
  from (
    select distinct domains.domain
    from pg_catalog.jsonb_array_elements(p_authorized_sources) source(value)
    cross join lateral pg_catalog.unnest(case source.value ->> 'source'
      when 'task' then array['legacy_operational','tasks']
      when 'lead' then array['legacy_operational','work_queue']
      when 'correspondence' then array[
        'legacy_job_history','legacy_operational','work_queue'
      ]
      when 'commitment' then array['work_queue']
      when 'match_review' then array['work_queue']
      when 'schedule' then array['legacy_operational']
      when 'financial_document' then array[
        'legacy_operational','sales_documents'
      ]
      when 'payment' then array[
        'legacy_operational','payments','sales_documents'
      ]
      else array['expenses']
    end) domains(domain)
  ) expected;

  with required_domains(domain) as (
    select domain from pg_catalog.unnest(v_expected_domains) domain
    where domain not in ('legacy_operational','legacy_job_history')
  ), all_revisions as (
    select required.domain, revision.source_revision
    from required_domains required
    join private.agent_read_domain_revisions revision
      on revision.company_id = p_company_id and revision.domain = required.domain
    union all
    select 'legacy_operational',revision.source_revision
    from private.agent_operational_read_revisions revision
    where revision.company_id = p_company_id
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(p_authorized_sources) s(value)
        where s.value ->> 'source' in (
          'task','lead','correspondence','schedule','financial_document','payment'
        )
      )
    union all
    select 'legacy_job_history',revision.history_revision
    from private.agent_job_history_revisions revision
    where revision.company_id = p_company_id
      and exists (
        select 1 from pg_catalog.jsonb_array_elements(p_authorized_sources) s(value)
        where s.value ->> 'source' = 'correspondence'
      )
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'domain',domain,'source_revision',source_revision
    ) order by domain
  ),'[]'::jsonb) into v_revisions
  from all_revisions;

  if coalesce((
       select pg_catalog.array_agg(revision.value ->> 'domain' order by
         revision.value ->> 'domain' collate "C"
       )
       from pg_catalog.jsonb_array_elements(v_revisions) revision(value)
     ),array[]::text[]) is distinct from coalesce(v_expected_domains,array[]::text[]) then
    raise exception 'agent_work_queue_revision_vector_incomplete'
      using errcode = '42501';
  end if;

  if p_cursor_read_at is not null
     and p_cursor_source_revisions is distinct from v_revisions then
    raise exception 'agent_work_queue_read_stale' using errcode = '40001';
  end if;

  select pg_catalog.count(*) > p_item_limit
    into v_source_has_more
  from pg_catalog.jsonb_array_elements(v_cards) card(value)
  where p_after_priority is null or (
    (card.value #>> '{item,priority}')::integer,
    (card.value #>> '{item,attention_at}')::timestamptz,
    card.value #>> '{item,source}' collate "C",
    (card.value #>> '{item,queue_ref,id}')::uuid
  ) > (p_after_priority,p_after_attention_at,p_after_source collate "C",p_after_id);

  v_context := pg_catalog.jsonb_build_object(
    'company_id',p_company_id,'actor_user_id',p_actor_user_id,
    'oauth_grant_id',p_oauth_grant_id,'oauth_client_id',p_oauth_client_id,
    'grant_revision',p_grant_revision,
    'granted_scope_ceiling',pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision',p_permission_snapshot_revision,
    'capability_id','list_work_queue',
    'capability_revision','list_work_queue:2026-08-22.v1',
    'capability_manifest_revision',p_capability_manifest_revision,
    'ranking_revision','work-queue-ranking:2026-08-22.v1',
    'item_limit',p_item_limit,
    'cursor_read_at',case when p_cursor_read_at is null then null
      else private.agent_rfc3339_utc(p_cursor_read_at) end,
    'cursor_source_revisions',p_cursor_source_revisions,
    'cursor_predecessor',case when p_cursor_read_at is null then null
      else pg_catalog.jsonb_build_object(
        'order',pg_catalog.jsonb_build_array(
          p_after_priority,private.agent_rfc3339_utc(p_after_attention_at),
          p_after_source,p_after_id
        ),'tie_breaker',p_after_id
      ) end,
    'selections',p_selections,'authorized_sources',p_authorized_sources,
    'warnings',p_warnings,'read_at',private.agent_rfc3339_utc(v_read_at),
    'source_revisions',v_revisions,'source_inspected',v_source_inspected,
    'source_slices',v_source_slices,'source_has_more',v_source_has_more
  );

  with candidate as (
    select card.value -> 'item' as item,
           card.value -> 'domains' as domains,
           (card.value #>> '{item,priority}')::integer as priority,
           (card.value #>> '{item,attention_at}')::timestamptz as attention_at,
           card.value #>> '{item,source}' as source,
           (card.value #>> '{item,queue_ref,id}')::uuid as id
    from pg_catalog.jsonb_array_elements(v_cards) card(value)
    where p_after_priority is null or (
      (card.value #>> '{item,priority}')::integer,
      (card.value #>> '{item,attention_at}')::timestamptz,
      card.value #>> '{item,source}' collate "C",
      (card.value #>> '{item,queue_ref,id}')::uuid
    ) > (
      p_after_priority,p_after_attention_at,p_after_source collate "C",p_after_id
    )
  ), bounded as (
    select * from candidate
    order by priority, attention_at, source collate "C", id
    limit p_page_fetch_limit
  ), page as (
    select *,pg_catalog.row_number() over (
      order by priority,attention_at,source collate "C",id
    ) ordinality from bounded
  ), packaged as (
    select item,priority,attention_at,source,id,
           (
             select coalesce(pg_catalog.jsonb_agg(revision.value order by revision.value ->> 'domain' collate "C"),'[]'::jsonb)
             from pg_catalog.jsonb_array_elements(v_revisions) revision(value)
             where revision.value ->> 'domain' in (
               select pg_catalog.jsonb_array_elements_text(domains)
             )
           ) item_revisions
    from page where ordinality <= p_item_limit
  ), proof_rows as (
    select item,item_revisions,priority,attention_at,source,id,
           private.agent_p2_work_queue_hash_ref_v1(
             'ops_proof:v1:',v_context || pg_catalog.jsonb_build_object(
               'proof_kind','work_queue_entity','item',item,
               'item_source_revisions',item_revisions
             )
           ) proof_ref,
           private.agent_p2_work_queue_hash_ref_v1(
             'ops_evidence:v1:',v_context || pg_catalog.jsonb_build_object(
               'proof_kind','work_queue_evidence','queue_ref',item -> 'queue_ref'
             )
           ) evidence_ref
    from packaged
  )
  select coalesce(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'item',item,'item_source_revisions',item_revisions,
             'proof_ref',proof_ref,'evidence_ref',evidence_ref,
             'predecessor',pg_catalog.jsonb_build_object(
               'order',pg_catalog.jsonb_build_array(
                 priority,private.agent_rfc3339_utc(attention_at),source,id
               ),'tie_breaker',id
             )
           ) order by priority,attention_at,source collate "C",id
         ),'[]'::jsonb),
         (select pg_catalog.count(*) > p_item_limit from bounded)
    into v_rows,v_source_has_more
  from proof_rows;

  v_returned_count := pg_catalog.jsonb_array_length(v_rows);
  v_collection_ref := private.agent_p2_work_queue_hash_ref_v1(
    'ops_proof:v1:',v_context || pg_catalog.jsonb_build_object(
      'proof_kind','work_queue_collection',
      'returned_count',v_returned_count,'has_more',v_source_has_more,
      'children',(
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'queue_ref',row.value #> '{item,queue_ref}',
            'proof_ref',row.value -> 'proof_ref',
            'evidence_ref',row.value -> 'evidence_ref'
          ) order by row.ordinality
        ),'[]'::jsonb)
        from pg_catalog.jsonb_array_elements(v_rows)
          with ordinality row(value,ordinality)
      )
    )
  );

  return pg_catalog.jsonb_build_object(
    'company_id',p_company_id,'actor_user_id',p_actor_user_id,
    'oauth_grant_id',p_oauth_grant_id,'oauth_client_id',p_oauth_client_id,
    'grant_revision',p_grant_revision,
    'granted_scope_ceiling',pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision',p_permission_snapshot_revision,
    'capability_id','list_work_queue',
    'capability_revision','list_work_queue:2026-08-22.v1',
    'capability_manifest_revision',p_capability_manifest_revision,
    'selections',p_selections,'authorized_sources',p_authorized_sources,
    'warnings',p_warnings,'read_at',private.agent_rfc3339_utc(v_read_at),
    'source_revisions',v_revisions,'source_inspected',v_source_inspected,
    'source_slices',v_source_slices,'source_has_more',v_source_has_more,'rows',v_rows,
    'collection_proof_ref',v_collection_ref
  );
end;
$function$;

create or replace function private.agent_p2_work_queue_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorized_sources jsonb,
  p_sources text[],
  p_read_at timestamptz,
  p_source_limit integer,
  p_item_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_selections jsonb;
  v_result jsonb;
begin
  if p_read_at is null
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', pg_catalog.statement_timestamp()
     )
     or p_source_limit is distinct from 501
     or p_item_limit not between 1 and 25
     or p_sources is null
     or pg_catalog.cardinality(p_sources) not between 1 and 9
     or p_sources is distinct from (
       select pg_catalog.array_agg(source order by ordinality)
       from pg_catalog.unnest(array[
         'task','lead','correspondence','commitment','match_review','schedule',
         'financial_document','payment','expense'
       ]::text[]) with ordinality canonical(source, ordinality)
       where source = any(p_sources)
     )
     or p_sources is distinct from (
       select pg_catalog.array_agg(value ->> 'source' order by ordinality)
       from pg_catalog.jsonb_array_elements(p_authorized_sources)
         with ordinality authorized(value, ordinality)
     ) then
    raise exception 'agent_work_queue_attention_invalid'
      using errcode = '22023';
  end if;

  select pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'source', source,
             'origin', 'explicit'
           ) order by ordinality
         )
    into v_selections
  from pg_catalog.unnest(p_sources) with ordinality selected(source, ordinality);

  v_result := private.agent_p2_work_queue_read_v1(
    p_company_id,p_actor_user_id,p_oauth_grant_id,p_oauth_client_id,
    p_grant_revision,p_granted_scope_ceiling,p_permission_snapshot_revision,
    p_registered_permission_keys,'2026-08-22.capability-manifest.v8',
    v_selections,p_authorized_sources,'[]'::jsonb,p_item_limit,
    least(p_item_limit + 1,26),p_source_limit,null,'[]'::jsonb,
    null,null,null,null
  );

  if v_result ->> 'read_at' is distinct from
       private.agent_rfc3339_utc(p_read_at) then
    raise exception 'agent_work_queue_attention_snapshot_mismatch'
      using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'read_at',v_result -> 'read_at',
    'source_revisions',v_result -> 'source_revisions',
    'source_inspected',v_result -> 'source_inspected',
    'returned_count',pg_catalog.jsonb_array_length(v_result -> 'rows'),
    'has_more',v_result -> 'source_has_more',
    'cards',coalesce((
      select pg_catalog.jsonb_agg(row.value -> 'item' order by row.ordinality)
      from pg_catalog.jsonb_array_elements(v_result -> 'rows')
        with ordinality row(value,ordinality)
    ),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.read_agent_work_queue_as_system(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_selections jsonb,
  p_authorized_sources jsonb,
  p_warnings jsonb,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_priority integer,
  p_after_attention_at timestamptz,
  p_after_source text,
  p_after_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case when auth.role() is distinct from 'service_role'
    then private.agent_p2_work_queue_read_v1(
      null,null,null,null,null,null,null,null,null,null,null,null,
      null,null,null,null,null,null,null,null,null
    )
    else private.agent_p2_work_queue_read_v1(
      p_company_id,p_actor_user_id,p_oauth_grant_id,p_oauth_client_id,
      p_grant_revision,p_granted_scope_ceiling,p_permission_snapshot_revision,
      p_registered_permission_keys,p_capability_manifest_revision,p_selections,
      p_authorized_sources,p_warnings,p_item_limit,p_page_fetch_limit,
      p_source_limit,p_cursor_read_at,p_cursor_source_revisions,
      p_after_priority,p_after_attention_at,p_after_source,p_after_id
    )
  end
$function$;

revoke all on function private.agent_p2_work_queue_hash_ref_v1(text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.agent_p2_work_queue_expected_source_v1(
  text,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function private.agent_p2_work_queue_read_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,
  integer,integer,integer,timestamptz,jsonb,integer,timestamptz,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.agent_p2_work_queue_attention_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamptz,
  integer,integer
) from public,anon,authenticated,service_role;
revoke all on function public.read_agent_work_queue_as_system(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,
  integer,integer,integer,timestamptz,jsonb,integer,timestamptz,text,uuid
) from public,anon,authenticated,service_role;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_work_queue_hash_ref_v1(text,jsonb)',
    'private.agent_p2_work_queue_expected_source_v1(text,text,jsonb)',
    'private.agent_p2_work_queue_read_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
    'private.agent_p2_work_queue_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_work_queue_acl_function_missing:%',v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.format('alter function %s owner to current_user',v_signature);
    select proowner into v_owner from pg_catalog.pg_proc where oid = v_function_oid;
    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public' else role.rolname end role_name
      from pg_catalog.pg_proc procedure
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
      )) acl
      left join pg_catalog.pg_roles role on role.oid = acl.grantee
      where procedure.oid = v_function_oid and acl.grantee <> v_owner
    loop
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;
grant execute on function public.read_agent_work_queue_as_system(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,
  integer,integer,integer,timestamptz,jsonb,integer,timestamptz,text,uuid
) to service_role;

do $postflight$
declare
  v_signature text;
  v_function_oid oid;
  v_is_public boolean;
  v_service_role_oid oid := (
    select role.oid from pg_catalog.pg_roles role where role.rolname='service_role'
  );
begin
  if pg_catalog.to_regprocedure(
    'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)'
  ) is null
     or pg_catalog.has_function_privilege(
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
    raise exception 'agent_work_queue_read_postflight_failed'
      using errcode = '55000';
  end if;
  foreach v_signature in array array[
    'private.agent_p2_work_queue_hash_ref_v1(text,jsonb)',
    'private.agent_p2_work_queue_expected_source_v1(text,text,jsonb)',
    'private.agent_p2_work_queue_read_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)',
    'private.agent_p2_work_queue_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text[],timestamp with time zone,integer,integer)',
    'public.read_agent_work_queue_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,jsonb,jsonb,jsonb,integer,integer,integer,timestamp with time zone,jsonb,integer,timestamp with time zone,text,uuid)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    v_is_public := v_signature like 'public.%';
    if not exists (
         select 1
         from pg_catalog.pg_proc procedure
         where procedure.oid=v_function_oid
           and procedure.proowner=(select role.oid from pg_catalog.pg_roles role
                                   where role.rolname=current_user)
           and procedure.prosecdef=v_is_public
           and procedure.proconfig=array['search_path=""']::text[]
       )
       or exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral pg_catalog.aclexplode(coalesce(
           procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
         )) acl
         where procedure.oid=v_function_oid
           and acl.grantee<>procedure.proowner
           and (
             not v_is_public
             or acl.grantee<>v_service_role_oid
             or acl.privilege_type<>'EXECUTE'
             or acl.is_grantable
           )
       )
       or v_is_public and not exists (
         select 1
         from pg_catalog.pg_proc procedure
         cross join lateral pg_catalog.aclexplode(coalesce(
           procedure.proacl,pg_catalog.acldefault('f',procedure.proowner)
         )) acl
         where procedure.oid=v_function_oid
           and acl.grantee=v_service_role_oid
           and acl.privilege_type='EXECUTE'
           and not acl.is_grantable
       ) then
      raise exception 'agent_work_queue_function_postflight_failed:%',v_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
