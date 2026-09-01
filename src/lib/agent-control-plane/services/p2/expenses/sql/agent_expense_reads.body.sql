begin;

set local timezone = 'UTC';

-- Task 16 canonical expense read body. The two public readers are fixed,
-- service-role-only SECURITY DEFINER wrappers. Private projections are
-- invoker functions with an empty search path and no callable application ACL.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_money_to_minor_units(numeric,text)'),
      ('function', 'auth.role()'),
      ('function', 'extensions.digest(bytea,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
      ('table', 'public.companies'),
      ('table', 'public.expenses'),
      ('table', 'public.expense_project_allocations'),
      ('table', 'public.expense_categories'),
      ('table', 'public.expense_batches'),
      ('table', 'public.users'),
      ('table', 'public.projects'),
      ('table', 'public.project_tasks')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_expense_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_expense_hash_ref(
  p_prefix text,
  p_material jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_prefix not in ('ops_proof:v1:', 'ops_evidence:v1:') then
    raise exception 'invalid_agent_expense_hash_prefix'
      using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(p_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function private.agent_p2_expense_list_v1(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_view_kind text,
  p_project_id uuid,
  p_batch_disposition text,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_date date,
  p_after_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_permissions jsonb;
  v_source_revisions jsonb;
  v_proof_candidate jsonb;
  v_source_ids uuid[] := array[]::uuid[];
  v_source_id uuid;
  v_source_count integer := 0;
  v_candidate_items jsonb := '[]'::jsonb;
  v_candidate_count integer := 0;
  v_item jsonb;
  v_item_id uuid;
  v_item_kind text;
  v_order_date date;
  v_has_more boolean;
  v_read_at timestamptz;
  v_read_at_text text;
  v_cursor_predecessor jsonb;
  v_query jsonb;
  v_proof_context jsonb;
  v_proof_ref text;
  v_evidence_ref text;
  v_rows jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_returned_count integer := 0;
  v_current_revision bigint;
  v_expenses_view text;
  v_expenses_approve text;
  v_projects_view text;
  v_batch_disposition text;
  v_record record;
begin
  if p_request_id is null
     or pg_catalog.char_length(p_request_id) not between 1 and 256
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'list_expenses'
     or p_capability_revision is distinct from
          'list_expenses:2026-08-22.v1'
     or p_view_kind not in (
       'mine', 'company', 'job', 'pending_approval',
       'reimbursement_batches'
     )
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or (p_view_kind = 'job') is distinct from (p_project_id is not null)
     or (p_view_kind = 'reimbursement_batches') is distinct from
          (p_batch_disposition is not null)
     or (
       p_view_kind = 'reimbursement_batches'
       and p_batch_disposition not in ('all', 'owed', 'paid')
     )
     or (
       (p_cursor_read_at is null)
       is distinct from (p_after_order_date is null)
     )
     or (
       (p_cursor_read_at is null)
       is distinct from (p_after_id is null)
     )
     or p_cursor_source_revisions is null
     or pg_catalog.jsonb_typeof(p_cursor_source_revisions)
          is distinct from 'array'
     or (
       p_cursor_read_at is null
       and p_cursor_source_revisions is distinct from '[]'::jsonb
     ) then
    raise exception 'agent_expense_read_invalid' using errcode = '22023';
  end if;

  v_context := private.agent_p2_expense_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidate,
    p_view_kind
  );
  if v_context is null then
    raise exception 'agent_expense_read_unauthorized' using errcode = '42501';
  end if;
  v_permissions := v_context -> 'permissions';
  v_source_revisions := v_context -> 'source_revisions';
  v_proof_candidate := v_context -> 'proof_authorization_candidate';
  v_expenses_view := v_permissions ->> 'expenses.view';
  v_expenses_approve := v_permissions ->> 'expenses.approve';
  v_projects_view := v_permissions ->> 'projects.view';

  if p_cursor_read_at is not null then
    if p_cursor_source_revisions is distinct from v_source_revisions
       or p_cursor_read_at is distinct from pg_catalog.date_bin(
         interval '1 millisecond',
         p_cursor_read_at,
         timestamptz '2000-01-01 00:00:00+00'
       )
       or p_cursor_read_at > statement_timestamp()
       or p_cursor_read_at <= statement_timestamp() - interval '15 minutes' then
      raise exception 'agent_expense_read_stale' using errcode = '40001';
    end if;
    v_read_at := p_cursor_read_at;
  else
    v_read_at := pg_catalog.date_bin(
      interval '1 millisecond',
      statement_timestamp(),
      timestamptz '2000-01-01 00:00:00+00'
    );
  end if;
  v_read_at_text := private.agent_rfc3339_utc(v_read_at);

  if p_view_kind = 'job' then
    if not exists (
         select 1
         from public.projects project
         where project.id = p_project_id
           and project.company_id = p_company_id
           and project.deleted_at is null
       )
       or (
         v_projects_view = 'assigned'
         and not private.agent_p2_expense_project_assigned_v1(
           p_actor_user_id,
           p_company_id,
           p_project_id
         )
       ) then
      raise exception 'agent_expense_not_found_or_not_visible'
        using errcode = 'P0002';
    end if;

    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select expense.id,
             coalesce(expense.expense_date, date '0001-01-01')
               as order_date
      from public.expense_project_allocations allocation
      join public.expenses expense
        on expense.id = allocation.expense_id
       and expense.company_id = p_company_id
       and expense.deleted_at is null
      where private.agent_read_domain_uuid_from_text(allocation.project_id) =
              p_project_id
        and (
          p_after_order_date is null
          or coalesce(
               expense.expense_date,
               date '0001-01-01'
             ) < p_after_order_date
          or (
            coalesce(
              expense.expense_date,
              date '0001-01-01'
            ) = p_after_order_date
            and expense.id > p_after_id
          )
        )
      group by expense.id, expense.expense_date
      order by order_date desc, expense.id
      limit 501
    ) source;
  elsif p_view_kind = 'mine' then
    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select expense.id,
             coalesce(expense.expense_date, date '0001-01-01')
               as order_date
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.submitted_by = p_actor_user_id
        and expense.deleted_at is null
        and (
          p_after_order_date is null
          or coalesce(
               expense.expense_date,
               date '0001-01-01'
             ) < p_after_order_date
          or (
            coalesce(
              expense.expense_date,
              date '0001-01-01'
            ) = p_after_order_date
            and expense.id > p_after_id
          )
        )
      order by order_date desc, expense.id
      limit 501
    ) source;
  elsif p_view_kind in ('company', 'pending_approval') then
    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select expense.id,
             coalesce(expense.expense_date, date '0001-01-01')
               as order_date
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.deleted_at is null
        and (
          p_view_kind = 'company'
          or expense.status = 'submitted'
        )
        and (
          p_after_order_date is null
          or coalesce(
               expense.expense_date,
               date '0001-01-01'
             ) < p_after_order_date
          or (
            coalesce(
              expense.expense_date,
              date '0001-01-01'
            ) = p_after_order_date
            and expense.id > p_after_id
          )
        )
      order by order_date desc, expense.id
      limit 501
    ) source;
  else
    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select batch.id,
             coalesce(
               batch.period_end,
               batch.period_start,
               date '0001-01-01'
             ) as order_date
      from public.expense_batches batch
      where batch.company_id = p_company_id
        and batch.status in (
          'approved', 'partially_approved', 'auto_approved'
        )
        and (
          p_after_order_date is null
          or coalesce(
               batch.period_end,
               batch.period_start,
               date '0001-01-01'
             ) < p_after_order_date
          or (
            coalesce(
              batch.period_end,
              batch.period_start,
              date '0001-01-01'
            ) = p_after_order_date
            and batch.id > p_after_id
          )
        )
      order by order_date desc, batch.id
      limit 501
    ) source;
  end if;

  v_source_count := pg_catalog.cardinality(v_source_ids);
  if v_source_count >= 501 then
    raise exception 'agent_expense_source_query_bound' using errcode = '54000';
  end if;

  foreach v_source_id in array v_source_ids loop
    if p_view_kind = 'pending_approval'
       and v_expenses_approve = 'assigned'
       and not private.agent_p2_expense_assigned_approver_v1(
         p_actor_user_id,
         p_company_id,
         v_source_id
       ) then
      continue;
    end if;

    if p_view_kind = 'reimbursement_batches' then
      if v_expenses_view = 'own' and not exists (
        select 1
        from public.expense_batches batch
        where batch.id = v_source_id
          and batch.company_id = p_company_id
          and batch.submitted_by = p_actor_user_id
      ) then
        continue;
      end if;
      v_item := private.agent_p2_expense_batch_item_v1(
        p_company_id,
        v_source_id,
        true
      );
      v_batch_disposition := v_item ->> 'disposition';
      if p_batch_disposition <> 'all'
         and v_batch_disposition is distinct from p_batch_disposition then
        continue;
      end if;
    else
      if v_expenses_view = 'own' and not exists (
        select 1
        from public.expenses expense
        where expense.id = v_source_id
          and expense.company_id = p_company_id
          and expense.deleted_at is null
          and expense.submitted_by = p_actor_user_id
      ) then
        continue;
      end if;
      v_item := private.agent_p2_expense_item_v1(
        p_company_id,
        v_source_id,
        case when p_view_kind = 'job' then p_project_id else null end,
        25
      );
    end if;
    if v_item is null then continue; end if;

    v_candidate_items := v_candidate_items ||
      pg_catalog.jsonb_build_array(v_item);
    v_candidate_count := v_candidate_count + 1;
    exit when v_candidate_count >= p_page_fetch_limit;
  end loop;

  v_has_more := v_candidate_count > p_item_limit;
  v_item_kind := case when p_view_kind = 'reimbursement_batches'
    then 'reimbursement_batch' else 'expense'
  end;
  v_query := pg_catalog.jsonb_build_object(
    'view', case
      when p_view_kind = 'job' then pg_catalog.jsonb_build_object(
        'kind', 'job',
        'job_ref', pg_catalog.jsonb_build_object(
          'kind', 'project', 'id', p_project_id
        )
      )
      when p_view_kind = 'reimbursement_batches'
        then pg_catalog.jsonb_build_object(
          'kind', 'reimbursement_batches',
          'disposition', p_batch_disposition
        )
      else pg_catalog.jsonb_build_object('kind', p_view_kind)
    end
  );
  v_cursor_predecessor := case when p_cursor_read_at is null then null
    else pg_catalog.jsonb_build_object(
      'item_kind', v_item_kind,
      'order', pg_catalog.jsonb_build_array(
        pg_catalog.to_char(p_after_order_date, 'YYYY-MM-DD'),
        p_after_id
      ),
      'tie_breaker', p_after_id
    )
  end;
  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidate', v_proof_candidate,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'ranking_revision', 'expense-ranking:2026-08-22.v1',
    'query', v_query,
    'item_limit', p_item_limit,
    'cursor_read_at', case when p_cursor_read_at is null then null
      else private.agent_rfc3339_utc(p_cursor_read_at)
    end,
    'cursor_source_revisions', p_cursor_source_revisions,
    'cursor_predecessor', v_cursor_predecessor,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_count,
    'source_has_more', v_has_more
  );

  for v_record in
    select source.value as item,
           source.ordinality::integer as ordinality
    from pg_catalog.jsonb_array_elements(v_candidate_items)
      with ordinality source(value, ordinality)
    where source.ordinality <= p_item_limit
    order by source.ordinality
  loop
    v_item := v_record.item;
    v_item_kind := v_item ->> 'item_kind';
    v_item_id := case when v_item_kind = 'expense'
      then (v_item #>> '{expense_ref,id}')::uuid
      else (v_item #>> '{batch_ref,id}')::uuid
    end;
    v_order_date := case when v_item_kind = 'expense'
      then coalesce(
        (v_item ->> 'expense_date')::date,
        date '0001-01-01'
      )
      else coalesce(
        (v_item ->> 'period_end')::date,
        (v_item ->> 'period_start')::date,
        date '0001-01-01'
      )
    end;
    v_proof_ref := private.agent_p2_expense_hash_ref(
      'ops_proof:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'expense_list_entity',
        'item', v_item
      )
    );
    v_evidence_ref := private.agent_p2_expense_hash_ref(
      'ops_evidence:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'expense_list_evidence',
        'item_ref', case when v_item_kind = 'expense'
          then v_item -> 'expense_ref'
          else v_item -> 'batch_ref'
        end
      )
    );
    v_rows := v_rows || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item', v_item,
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref,
        'predecessor', pg_catalog.jsonb_build_object(
          'item_kind', v_item_kind,
          'order', pg_catalog.jsonb_build_array(
            pg_catalog.to_char(v_order_date, 'YYYY-MM-DD'),
            v_item_id
          ),
          'tie_breaker', v_item_id
        )
      )
    );
    v_children := v_children || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'item_ref', case when v_item_kind = 'expense'
          then v_item -> 'expense_ref'
          else v_item -> 'batch_ref'
        end,
        'proof_ref', v_proof_ref,
        'evidence_ref', v_evidence_ref
      )
    );
    v_returned_count := v_returned_count + 1;
  end loop;

  select revision.source_revision
    into v_current_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'expenses';
  if v_current_revision is distinct from
       (v_source_revisions #>> '{0,source_revision}')::bigint then
    raise exception 'agent_expense_read_stale' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'authorization_candidate', p_authorization_candidate,
    'query', v_query,
    'ranking_revision', 'expense-ranking:2026-08-22.v1',
    'item_limit', p_item_limit,
    'cursor_read_at', case when p_cursor_read_at is null then null
      else private.agent_rfc3339_utc(p_cursor_read_at)
    end,
    'cursor_source_revisions', p_cursor_source_revisions,
    'cursor_predecessor', v_cursor_predecessor,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_count,
    'source_has_more', v_has_more,
    'rows', v_rows,
    'collection_proof_ref', private.agent_p2_expense_hash_ref(
      'ops_proof:v1:',
      v_proof_context || pg_catalog.jsonb_build_object(
        'proof_kind', 'expense_list_collection',
        'returned_count', v_returned_count,
        'has_more', v_has_more,
        'children', v_children
      )
    )
  );
end;
$function$;

create or replace function private.agent_p2_expense_money_v1(
  p_amount numeric,
  p_currency text
) returns jsonb
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_currency text := pg_catalog.upper(p_currency);
  v_minor bigint;
begin
  if p_currency is distinct from v_currency
     or private.agent_currency_minor_exponent_or_null(v_currency) is null then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;
  v_minor := private.agent_money_to_minor_units(p_amount, v_currency);
  return pg_catalog.jsonb_build_object(
    'amount_minor', v_minor,
    'currency', v_currency
  );
exception
  when sqlstate '22003' or sqlstate '22023' then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
end;
$function$;

create or replace function private.agent_p2_expense_expected_candidate_v1(
  p_variant text,
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_view_scope text;
  v_approve_scope text;
  v_projects_scope text;
  v_required_scopes jsonb;
  v_resolved jsonb := '{}'::jsonb;
  v_groups jsonb := '[]'::jsonb;
begin
  if p_variant not in (
       'mine', 'company', 'job', 'pending_approval',
       'reimbursement_batches', 'expense'
     )
     or p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;

  v_view_scope := p_permissions ->> 'expenses.view';
  v_approve_scope := p_permissions ->> 'expenses.approve';
  v_projects_scope := p_permissions ->> 'projects.view';
  v_required_scopes := case when p_variant = 'job'
    then pg_catalog.jsonb_build_array('ops.expenses.read', 'ops.jobs.read')
    else pg_catalog.jsonb_build_array('ops.expenses.read')
  end;

  if p_variant = 'mine' then
    if v_view_scope not in ('all', 'own') then return null; end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'expenses.view', v_view_scope
    );
    v_groups := pg_catalog.jsonb_build_array(0);
  elsif p_variant = 'company' then
    if v_view_scope is distinct from 'all' then return null; end if;
    v_resolved := pg_catalog.jsonb_build_object('expenses.view', 'all');
    v_groups := pg_catalog.jsonb_build_array(0);
  elsif p_variant = 'job' then
    if v_view_scope not in ('all', 'own')
       or v_projects_scope not in ('all', 'assigned') then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'expenses.view', v_view_scope,
      'projects.view', v_projects_scope
    );
    v_groups := pg_catalog.jsonb_build_array(0);
  elsif p_variant = 'pending_approval' then
    if v_view_scope is distinct from 'all'
       or v_approve_scope not in ('all', 'assigned') then
      return null;
    end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'expenses.approve', v_approve_scope,
      'expenses.view', 'all'
    );
    v_groups := pg_catalog.jsonb_build_array(0);
  else
    if v_view_scope not in ('all', 'own') then return null; end if;
    v_resolved := pg_catalog.jsonb_build_object(
      'expenses.view', v_view_scope
    );
    if v_approve_scope in ('all', 'assigned') then
      v_resolved := v_resolved || pg_catalog.jsonb_build_object(
        'expenses.approve', v_approve_scope
      );
    end if;
    select coalesce(
             pg_catalog.jsonb_agg(source.group_index order by source.group_index),
             '[]'::jsonb
           )
      into v_groups
    from (
      select 0 as group_index
      where v_view_scope = 'all'
        and v_approve_scope in ('all', 'assigned')
      union all select 1 where v_view_scope = 'all'
      union all select 2 where v_view_scope = 'own'
    ) source;
  end if;

  return pg_catalog.jsonb_build_object(
    'variant_key', p_variant,
    'required_oauth_scopes', v_required_scopes,
    'resolved_permission_scopes', v_resolved,
    'satisfied_permission_group_indexes', v_groups
  );
end;
$function$;

create or replace function private.agent_p2_expense_proof_candidate_v1(
  p_candidate jsonb
) returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'variantKey', p_candidate ->> 'variant_key',
    'requiredOAuthScopes', p_candidate -> 'required_oauth_scopes',
    'resolvedPermissionScopes', p_candidate -> 'resolved_permission_scopes',
    'satisfiedPermissionGroupIndexes',
      p_candidate -> 'satisfied_permission_group_indexes',
    'expensesViewScope',
      p_candidate -> 'resolved_permission_scopes' ->> 'expenses.view',
    'expensesApproveScope',
      p_candidate -> 'resolved_permission_scopes' ->> 'expenses.approve',
    'projectsViewScope',
      p_candidate -> 'resolved_permission_scopes' ->> 'projects.view'
  );
$function$;

create or replace function private.agent_p2_expense_read_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidate jsonb,
  p_expected_variant text
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
  v_expected_candidate jsonb;
  v_required_scopes text[];
  v_result jsonb;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_granted_scope_ceiling is null
     or p_registered_permission_keys is null
     or p_authorization_candidate is null
     or pg_catalog.jsonb_typeof(p_authorization_candidate)
          is distinct from 'object'
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(
         scope.value order by scope.value collate "C"
       )
       from (
         select distinct source.value
         from pg_catalog.unnest(p_granted_scope_ceiling) source(value)
       ) scope
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) key
     ) then
    return null;
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (
             where permission.value ->> 'permission' is not null
               and permission.value ->> 'scope' is not null
           ),
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

  v_expected_candidate := private.agent_p2_expense_expected_candidate_v1(
    p_expected_variant,
    v_permissions
  );
  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or v_expected_candidate is null
     or p_authorization_candidate is distinct from v_expected_candidate then
    return null;
  end if;

  select coalesce(
           pg_catalog.array_agg(
             scope.value order by scope.value collate "C"
           ),
           array[]::text[]
         )
    into v_required_scopes
  from pg_catalog.jsonb_array_elements_text(
    v_expected_candidate -> 'required_oauth_scopes'
  ) scope(value);

  select pg_catalog.jsonb_build_object(
           'permissions', v_permissions,
           'source_revisions', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'expenses',
               'source_revision', expense_revision.source_revision
             )
           ),
           'proof_authorization_candidate',
             private.agent_p2_expense_proof_candidate_v1(
               v_expected_candidate
             )
         )
    into v_result
  from private.mcp_oauth_grants grant_row
  join private.mcp_oauth_clients oauth_client
    on oauth_client.client_id = grant_row.client_id
   and oauth_client.disabled_at is null
   and grant_row.scopes <@ oauth_client.scope_ceiling
   and grant_row.consent_catalog_revision =
         oauth_client.consent_catalog_revision
   and grant_row.exposure_revision = oauth_client.exposure_revision
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_read_domain_revisions expense_revision
    on expense_revision.company_id = p_company_id
   and expense_revision.domain = 'expenses'
   and expense_revision.source_revision between 0 and 9007199254740991
  where grant_row.id = p_oauth_grant_id
    and grant_row.user_id = p_actor_user_id
    and grant_row.company_id = p_company_id
    and grant_row.client_id = p_oauth_client_id
    and grant_row.revision = p_grant_revision
    and grant_row.revoked_at is null
    and grant_row.scopes = p_granted_scope_ceiling
    and v_required_scopes <@ grant_row.scopes
    and grant_row.accepted_labels =
      private.mcp_oauth_labels_for_scopes(
        grant_row.scopes,
        grant_row.consent_catalog_revision
      );

  return v_result;
end;
$function$;

create or replace function private.agent_p2_expense_project_assigned_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_project_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.projects project
    where project.id = p_project_id
      and project.company_id = p_company_id
      and project.deleted_at is null
      and exists (
        select 1
        from public.project_tasks task
        where task.company_id = p_company_id
          and task.project_id = p_project_id
          and task.deleted_at is null
          and p_actor_user_id::text = any(
            coalesce(task.team_member_ids, array[]::text[])
          )
      )
  );
$function$;

create or replace function private.agent_p2_expense_assigned_approver_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_expense_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with bounded_allocations as materialized (
    select allocation.id,
           private.agent_read_domain_uuid_from_text(allocation.project_id)
             as project_id
    from public.expense_project_allocations allocation
    where allocation.expense_id = p_expense_id
    order by allocation.id
    limit 26
  ), evaluated as (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(
             pg_catalog.bool_and(
               allocation.project_id is not null
               and private.agent_p2_expense_project_assigned_v1(
                 p_actor_user_id,
                 p_company_id,
                 allocation.project_id
               )
             ),
             false
           ) as all_assigned
    from bounded_allocations allocation
  )
  select evaluated.source_count between 1 and 25
     and evaluated.all_assigned
  from evaluated;
$function$;

create or replace function private.agent_p2_expense_batch_assigned_approver_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_batch_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with bounded_expenses as materialized (
    select expense.id
    from public.expenses expense
    where expense.company_id = p_company_id
      and expense.batch_id = p_batch_id
      and expense.deleted_at is null
    order by expense.id
    limit 501
  ), evaluated as (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(
             pg_catalog.bool_and(
               private.agent_p2_expense_assigned_approver_v1(
                 p_actor_user_id,
                 p_company_id,
                 expense.id
               )
             ),
             false
           ) as all_assigned
    from bounded_expenses expense
  )
  select evaluated.source_count between 1 and 500
     and evaluated.all_assigned
  from evaluated;
$function$;

create or replace function private.agent_p2_expense_item_v1(
  p_company_id uuid,
  p_expense_id uuid,
  p_project_filter uuid,
  p_allocation_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_expense public.expenses%rowtype;
  v_category_name text;
  v_submitter_name text;
  v_merchant_name text;
  v_allocations jsonb;
  v_allocation_source_count integer;
  v_allocation_count integer;
  v_distinct_project_count integer;
  v_currency text;
begin
  if p_allocation_limit is distinct from 25 then
    raise exception 'agent_expense_result_bound' using errcode = '54000';
  end if;

  select expense.*
    into v_expense
  from public.expenses expense
  where expense.id = p_expense_id
    and expense.company_id = p_company_id
    and expense.deleted_at is null;
  if not found then return null; end if;

  if v_expense.status not in (
       'draft', 'submitted', 'approved', 'rejected', 'reimbursed'
     )
     or v_expense.currency is null
     or v_expense.currency is distinct from pg_catalog.upper(v_expense.currency)
     or private.agent_currency_minor_exponent_or_null(v_expense.currency)
          is null then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;
  v_currency := v_expense.currency;

  select private.agent_p2_optional_canonical_text(
           pg_catalog.concat_ws(
             ' ',
             nullif(pg_catalog.btrim(member.first_name), ''),
             nullif(pg_catalog.btrim(member.last_name), '')
           ),
           256,
           1024,
           true
         )
    into v_submitter_name
  from public.users member
  where member.id = v_expense.submitted_by
    and member.company_id = p_company_id;

  if v_expense.category_id is not null then
    select private.agent_p2_optional_canonical_text(
             category.name,
             256,
             1024,
             true
           )
      into v_category_name
    from public.expense_categories category
    where category.id = v_expense.category_id
      and category.company_id = p_company_id;
    if v_category_name is null then
      raise exception 'agent_expense_source_data_invalid'
        using errcode = '22000';
    end if;
  end if;

  if v_expense.merchant_name is not null then
    v_merchant_name := private.agent_p2_optional_canonical_text(
      v_expense.merchant_name,
      256,
      1024,
      true
    );
  end if;

  with allocation_source as materialized (
    select allocation.id,
           private.agent_read_domain_uuid_from_text(allocation.project_id)
             as project_id,
           allocation.percentage,
           coalesce(
             allocation.amount,
             v_expense.amount * allocation.percentage / 100::numeric
           ) as allocation_amount
    from public.expense_project_allocations allocation
    where allocation.expense_id = v_expense.id
      and (
        p_project_filter is null
        or private.agent_read_domain_uuid_from_text(allocation.project_id) =
             p_project_filter
      )
    order by
      private.agent_read_domain_uuid_from_text(allocation.project_id),
      allocation.id
    limit 26
  ), validation_source as materialized (
    select source.*,
           project.id as active_project_id,
           source.percentage * 100::numeric as basis_points
    from allocation_source source
    left join public.projects project
      on project.id = source.project_id
     and project.company_id = p_company_id
     and project.deleted_at is null
  ), validated as materialized (
    select source.*,
           source.project_id is not null
             and source.active_project_id is not null
             and source.percentage is not null
             and source.basis_points = pg_catalog.trunc(source.basis_points)
             and source.basis_points between 1 and 10000
             and source.allocation_amount is not null as is_valid
    from validation_source source
  )
  select pg_catalog.count(*)::integer,
         (pg_catalog.count(*) filter (where source.is_valid))::integer,
         (
           pg_catalog.count(distinct source.active_project_id)
             filter (where source.is_valid)
         )::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'allocation_ref', pg_catalog.jsonb_build_object(
                 'kind', 'expense_allocation',
                 'id', source.id
               ),
               'project_ref', pg_catalog.jsonb_build_object(
                 'kind', 'project',
                 'id', source.active_project_id
               ),
               'percentage_basis_points', source.basis_points::integer,
               'amount', private.agent_p2_expense_money_v1(
                 source.allocation_amount,
                 v_currency
               )
             ) order by source.active_project_id, source.id
           ) filter (where source.is_valid),
           '[]'::jsonb
         )
    into v_allocation_source_count,
         v_allocation_count,
         v_distinct_project_count,
         v_allocations
  from validated source;

  if v_allocation_source_count >= 26
     or v_allocation_count is distinct from v_allocation_source_count
     or v_distinct_project_count is distinct from v_allocation_count then
    if v_allocation_source_count >= 26 then
      raise exception 'agent_expense_result_bound' using errcode = '54000';
    end if;
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;

  return pg_catalog.jsonb_build_object(
    'item_kind', 'expense',
    'expense_ref', pg_catalog.jsonb_build_object(
      'kind', 'expense', 'id', v_expense.id
    ),
    'submitted_by', pg_catalog.jsonb_build_object(
      'team_member_ref', pg_catalog.jsonb_build_object(
        'kind', 'team_member', 'id', v_expense.submitted_by
      ),
      'display_name', v_submitter_name,
      'content_kind', 'untrusted_business_data'
    ),
    'category', case when v_expense.category_id is null
      then pg_catalog.jsonb_build_object('kind', 'uncategorized')
      else pg_catalog.jsonb_build_object(
        'kind', 'category',
        'category_ref', pg_catalog.jsonb_build_object(
          'kind', 'expense_category', 'id', v_expense.category_id
        ),
        'name', v_category_name,
        'content_kind', 'untrusted_business_data'
      )
    end,
    'merchant_name', v_merchant_name,
    'expense_date', case when v_expense.expense_date is null then null
      else pg_catalog.to_char(v_expense.expense_date, 'YYYY-MM-DD')
    end,
    'amount', private.agent_p2_expense_money_v1(
      v_expense.amount,
      v_currency
    ),
    'tax_amount', case when v_expense.tax_amount is null then null
      else private.agent_p2_expense_money_v1(
        v_expense.tax_amount,
        v_currency
      )
    end,
    'lifecycle', v_expense.status,
    'batch_ref', case when v_expense.batch_id is null then null
      else pg_catalog.jsonb_build_object(
        'kind', 'expense_batch', 'id', v_expense.batch_id
      )
    end,
    'allocations', v_allocations,
    'updated_at', private.agent_rfc3339_utc(
      pg_catalog.date_bin(
        interval '1 millisecond',
        v_expense.updated_at,
        timestamptz '2000-01-01 00:00:00+00'
      )
    ),
    'content_kind', 'untrusted_business_data'
  );
end;
$function$;

create or replace function private.agent_p2_expense_batch_item_v1(
  p_company_id uuid,
  p_batch_id uuid,
  p_for_list boolean
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_batch public.expense_batches%rowtype;
  v_currency text;
  v_currency_count integer;
  v_expense_count integer;
  v_currency_invalid boolean;
  v_submitter_name text;
  v_batch_number text;
  v_approved_amount numeric;
  v_reimbursement_amount numeric;
  v_disposition text;
  v_result jsonb;
begin
  select batch.*
    into v_batch
  from public.expense_batches batch
  where batch.id = p_batch_id
    and batch.company_id = p_company_id;
  if not found then return null; end if;

  if v_batch.status not in (
       'open', 'pending_review', 'submitted', 'approved',
       'partially_approved', 'rejected', 'auto_approved'
     )
     or v_batch.submitted_by is null
     or (p_for_list and v_batch.status not in (
       'approved', 'partially_approved', 'auto_approved'
     )) then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(
           distinct pg_catalog.upper(source.currency)
         )::integer,
         pg_catalog.min(pg_catalog.upper(source.currency)),
         coalesce(pg_catalog.bool_or(
           source.currency is null
           or source.currency is distinct from
                pg_catalog.upper(source.currency)
         ), false)
    into v_expense_count, v_currency_count, v_currency, v_currency_invalid
  from (
    select expense.currency
    from public.expenses expense
    where expense.company_id = p_company_id
      and expense.batch_id = p_batch_id
      and expense.deleted_at is null
    order by expense.id
    limit 501
  ) source;
  if v_expense_count >= 501 then
    raise exception 'agent_expense_source_query_bound'
      using errcode = '54000';
  end if;
  if v_currency_count is distinct from 1
     or v_currency is null
     or v_currency_invalid
     or private.agent_currency_minor_exponent_or_null(v_currency) is null
     or v_batch.total_amount is null
     or (
       v_batch.period_start is not null
       and v_batch.period_end is not null
       and v_batch.period_start > v_batch.period_end
     ) then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;

  v_batch_number := private.agent_p2_optional_canonical_text(
    v_batch.batch_number,
    256,
    1024,
    true
  );
  if v_batch_number is null then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;

  select private.agent_p2_optional_canonical_text(
           pg_catalog.concat_ws(
             ' ',
             nullif(pg_catalog.btrim(member.first_name), ''),
             nullif(pg_catalog.btrim(member.last_name), '')
           ),
           256,
           1024,
           true
         )
    into v_submitter_name
  from public.users member
  where member.id = v_batch.submitted_by
    and member.company_id = p_company_id;

  v_approved_amount := case
    when v_batch.status = 'partially_approved'
      then v_batch.approved_amount
    when v_batch.status in ('approved', 'auto_approved')
      then coalesce(v_batch.approved_amount, v_batch.total_amount)
    else coalesce(v_batch.approved_amount, 0::numeric)
  end;
  v_reimbursement_amount := case
    when v_batch.status in (
      'approved', 'partially_approved', 'auto_approved'
    ) then v_approved_amount
    else 0::numeric
  end;
  if v_approved_amount is null then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;
  v_disposition := case
    when v_batch.paid_at is not null then 'paid'
    when v_batch.status in (
      'approved', 'partially_approved', 'auto_approved'
    ) then 'owed'
    else 'not_eligible'
  end;
  if v_batch.paid_at is not null
     and v_batch.status not in (
       'approved', 'partially_approved', 'auto_approved'
     ) then
    raise exception 'agent_expense_source_data_invalid'
      using errcode = '22000';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'batch_ref', pg_catalog.jsonb_build_object(
      'kind', 'expense_batch', 'id', v_batch.id
    ),
    'batch_number', v_batch_number,
    'submitted_by', pg_catalog.jsonb_build_object(
      'team_member_ref', pg_catalog.jsonb_build_object(
        'kind', 'team_member', 'id', v_batch.submitted_by
      ),
      'display_name', v_submitter_name,
      'content_kind', 'untrusted_business_data'
    ),
    'period_start', case when v_batch.period_start is null then null
      else pg_catalog.to_char(v_batch.period_start, 'YYYY-MM-DD')
    end,
    'period_end', case when v_batch.period_end is null then null
      else pg_catalog.to_char(v_batch.period_end, 'YYYY-MM-DD')
    end,
    'lifecycle', v_batch.status,
    'total', private.agent_p2_expense_money_v1(
      v_batch.total_amount,
      v_currency
    ),
    'approved', private.agent_p2_expense_money_v1(
      v_approved_amount,
      v_currency
    ),
    'reimbursement_amount', private.agent_p2_expense_money_v1(
      v_reimbursement_amount,
      v_currency
    ),
    'paid_at', case when v_batch.paid_at is null then null
      else private.agent_rfc3339_utc(
        pg_catalog.date_bin(
          interval '1 millisecond',
          v_batch.paid_at,
          timestamptz '2000-01-01 00:00:00+00'
        )
      )
    end,
    'disposition', v_disposition,
    'content_kind', 'untrusted_business_data'
  );
  if p_for_list then
    v_result := pg_catalog.jsonb_build_object(
      'item_kind', 'reimbursement_batch'
    ) || v_result;
  end if;
  return v_result;
end;
$function$;

create or replace function private.agent_p2_expense_context_v1(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_expense_id uuid,
  p_source_limit integer,
  p_allocation_limit integer,
  p_allocation_fetch_limit integer,
  p_review_reason_character_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_permissions jsonb;
  v_source_revisions jsonb;
  v_proof_candidate jsonb;
  v_expense_row public.expenses%rowtype;
  v_expense jsonb;
  v_batch jsonb;
  v_payout_state text;
  v_review_reason jsonb;
  v_review_text text;
  v_can_review boolean := false;
  v_read_at timestamptz;
  v_read_at_text text;
  v_result jsonb;
  v_source_inspected jsonb;
  v_proof_material jsonb;
  v_proof_ref text;
  v_evidence_ref text;
  v_current_revision bigint;
begin
  if p_request_id is null
     or pg_catalog.char_length(p_request_id) not between 1 and 256
     or p_capability_manifest_revision is distinct from
          '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'get_expense_context'
     or p_capability_revision is distinct from
          'get_expense_context:2026-08-22.v1'
     or p_expense_id is null
     or p_source_limit is distinct from 501
     or p_allocation_limit is distinct from 25
     or p_allocation_fetch_limit is distinct from 26
     or p_review_reason_character_limit is distinct from 1000 then
    raise exception 'agent_expense_read_invalid' using errcode = '22023';
  end if;

  v_context := private.agent_p2_expense_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidate,
    'expense'
  );
  if v_context is null then
    raise exception 'agent_expense_read_unauthorized' using errcode = '42501';
  end if;
  v_permissions := v_context -> 'permissions';
  v_source_revisions := v_context -> 'source_revisions';
  v_proof_candidate := v_context -> 'proof_authorization_candidate';

  select expense.*
    into v_expense_row
  from public.expenses expense
  where expense.id = p_expense_id
    and expense.company_id = p_company_id
    and expense.deleted_at is null
    and (
      v_permissions ->> 'expenses.view' = 'all'
      or (
        v_permissions ->> 'expenses.view' = 'own'
        and expense.submitted_by = p_actor_user_id
      )
    );
  if not found then
    raise exception 'agent_expense_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;

  v_expense := private.agent_p2_expense_item_v1(
    p_company_id,
    p_expense_id,
    null,
    p_allocation_limit
  );
  if v_expense is null then
    raise exception 'agent_expense_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;

  if v_expense_row.batch_id is null then
    v_batch := null;
    v_payout_state := 'not_eligible';
  else
    v_batch := private.agent_p2_expense_batch_item_v1(
      p_company_id,
      v_expense_row.batch_id,
      false
    );
    if v_batch is null then
      raise exception 'agent_expense_source_data_invalid'
        using errcode = '22000';
    end if;
    v_payout_state := v_batch ->> 'disposition';
  end if;

  v_can_review := v_expense_row.submitted_by = p_actor_user_id
    or v_permissions ->> 'expenses.approve' = 'all'
    or (
      v_permissions ->> 'expenses.approve' = 'assigned'
      and private.agent_p2_expense_assigned_approver_v1(
        p_actor_user_id,
        p_company_id,
        p_expense_id
      )
    );
  if v_can_review then
    if v_expense_row.status = 'rejected'
       and nullif(
         pg_catalog.btrim(v_expense_row.rejection_reason), ''
       ) is not null then
      v_review_text := private.agent_p2_optional_canonical_text(
        v_expense_row.rejection_reason,
        p_review_reason_character_limit,
        4000,
        true
      );
      if v_review_text is not null then
        v_review_reason := pg_catalog.jsonb_build_object(
          'kind', 'rejection',
          'text', v_review_text,
          'content_kind', 'untrusted_business_data'
        );
      end if;
    elsif v_expense_row.flagged_at is not null
       and nullif(
         pg_catalog.btrim(v_expense_row.flag_comment), ''
       ) is not null then
      v_review_text := private.agent_p2_optional_canonical_text(
        v_expense_row.flag_comment,
        p_review_reason_character_limit,
        4000,
        true
      );
      if v_review_text is not null then
        v_review_reason := pg_catalog.jsonb_build_object(
          'kind', 'flag',
          'text', v_review_text,
          'content_kind', 'untrusted_business_data'
        );
      end if;
    end if;
  end if;

  v_read_at := pg_catalog.date_bin(
    interval '1 millisecond',
    statement_timestamp(),
    timestamptz '2000-01-01 00:00:00+00'
  );
  v_read_at_text := private.agent_rfc3339_utc(v_read_at);
  v_result := pg_catalog.jsonb_build_object(
    'expense', v_expense,
    'batch', v_batch,
    'payout_state', v_payout_state,
    'review_reason', v_review_reason
  );
  v_source_inspected := pg_catalog.jsonb_build_object(
    'allocations', pg_catalog.jsonb_array_length(
      v_expense -> 'allocations'
    ),
    'batches', case when v_batch is null then 0 else 1 end
  );
  v_proof_material := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidate', v_proof_candidate,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'expense_ref', pg_catalog.jsonb_build_object(
      'kind', 'expense', 'id', p_expense_id
    ),
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'proof_kind', 'expense_context_entity',
    'result', v_result
  );
  v_proof_ref := private.agent_p2_expense_hash_ref(
    'ops_proof:v1:',
    v_proof_material
  );
  v_evidence_ref := private.agent_p2_expense_hash_ref(
    'ops_evidence:v1:',
    pg_catalog.jsonb_build_object(
      'proof_kind', 'expense_context_evidence',
      'source_domain', 'expenses',
      'source_type', 'expense',
      'company_id', p_company_id,
      'expense_ref', pg_catalog.jsonb_build_object(
        'kind', 'expense', 'id', p_expense_id
      ),
      'occurred_at', v_expense ->> 'updated_at'
    )
  );

  select revision.source_revision
    into v_current_revision
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'expenses';
  if v_current_revision is distinct from
       (v_source_revisions #>> '{0,source_revision}')::bigint then
    raise exception 'agent_expense_read_stale' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'authorization_candidate', p_authorization_candidate,
    'read_at', v_read_at_text,
    'source_revisions', v_source_revisions,
    'source_inspected', v_source_inspected,
    'result', v_result,
    'proof_ref', v_proof_ref,
    'evidence_ref', v_evidence_ref
  );
end;
$function$;

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
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
  v_variant text;
  v_expected_candidate jsonb;
  v_source_revisions jsonb;
  v_source_ids uuid[] := array[]::uuid[];
  v_source_id uuid;
  v_item jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_card_count integer := 0;
  v_view_scope text;
  v_approve_scope text;
begin
  if p_actor_user_id is null
     or p_company_id is null
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_registered_permission_keys is null
     or p_authorization_candidate is null
     or pg_catalog.jsonb_typeof(p_authorization_candidate)
          is distinct from 'object'
     or p_read_at is null
     or p_read_at is distinct from pg_catalog.date_bin(
       interval '1 millisecond',
       p_read_at,
       timestamptz '2000-01-01 00:00:00+00'
     )
     or p_read_at > statement_timestamp()
     or p_limit not between 1 and 25
     or p_source_limit is distinct from 501
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) key
     ) then
    raise exception 'agent_expense_attention_invalid' using errcode = '22023';
  end if;

  v_variant := p_authorization_candidate ->> 'variant_key';
  if v_variant not in ('pending_approval', 'reimbursement_batches') then
    raise exception 'agent_expense_attention_unauthorized'
      using errcode = '42501';
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (
             where permission.value ->> 'permission' is not null
               and permission.value ->> 'scope' is not null
           ),
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

  v_expected_candidate := private.agent_p2_expense_expected_candidate_v1(
    v_variant,
    v_permissions
  );
  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or v_expected_candidate is null
     or p_authorization_candidate is distinct from v_expected_candidate then
    raise exception 'agent_expense_attention_unauthorized'
      using errcode = '42501';
  end if;
  v_view_scope := v_permissions ->> 'expenses.view';
  v_approve_scope := v_permissions ->> 'expenses.approve';

  select pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'domain', 'expenses',
             'source_revision', revision.source_revision
           )
         )
    into v_source_revisions
  from private.agent_read_domain_revisions revision
  where revision.company_id = p_company_id
    and revision.domain = 'expenses'
    and revision.source_revision between 0 and 9007199254740991;
  if v_source_revisions is null then
    raise exception 'agent_expense_attention_unauthorized'
      using errcode = '42501';
  end if;

  if v_variant = 'pending_approval' then
    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select expense.id,
             coalesce(expense.expense_date, date '0001-01-01')
               as order_date
      from public.expenses expense
      where expense.company_id = p_company_id
        and expense.deleted_at is null
        and expense.status = 'submitted'
      order by order_date desc, expense.id
      limit 501
    ) source;
  else
    select coalesce(
             pg_catalog.array_agg(source.id order by source.order_date desc, source.id),
             array[]::uuid[]
           )
      into v_source_ids
    from (
      select batch.id,
             coalesce(
               batch.period_end,
               batch.period_start,
               date '0001-01-01'
             ) as order_date
      from public.expense_batches batch
      where batch.company_id = p_company_id
        and batch.status in (
          'approved', 'partially_approved', 'auto_approved'
        )
      order by order_date desc, batch.id
      limit 501
    ) source;
  end if;
  if pg_catalog.cardinality(v_source_ids) >= 501 then
    raise exception 'agent_expense_source_query_bound' using errcode = '54000';
  end if;

  foreach v_source_id in array v_source_ids loop
    if v_variant = 'pending_approval' then
      if v_approve_scope = 'assigned'
         and not private.agent_p2_expense_assigned_approver_v1(
           p_actor_user_id,
           p_company_id,
           v_source_id
         ) then
        continue;
      end if;
      v_item := private.agent_p2_expense_item_v1(
        p_company_id,
        v_source_id,
        null,
        25
      );
      v_cards := v_cards || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'card_kind', 'expense_approval',
          'expense_ref', v_item -> 'expense_ref',
          'submitted_by', v_item -> 'submitted_by',
          'expense_date', v_item -> 'expense_date',
          'merchant_name', v_item -> 'merchant_name',
          'amount', v_item -> 'amount',
          'reason_code', 'pending_approval',
          'attention_at', v_item -> 'updated_at',
          'content_kind', 'untrusted_business_data'
        )
      );
    else
      if v_view_scope = 'own' and not exists (
        select 1
        from public.expense_batches batch
        where batch.id = v_source_id
          and batch.company_id = p_company_id
          and batch.submitted_by = p_actor_user_id
      ) then
        continue;
      end if;
      v_item := private.agent_p2_expense_batch_item_v1(
        p_company_id,
        v_source_id,
        true
      );
      if v_item ->> 'disposition' <> 'owed' then
        continue;
      end if;
      v_cards := v_cards || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'card_kind', 'reimbursement',
          'batch_ref', v_item -> 'batch_ref',
          'submitted_by', v_item -> 'submitted_by',
          'period_end', v_item -> 'period_end',
          'reimbursement_amount', v_item -> 'reimbursement_amount',
          'disposition', 'owed',
          'reason_code', 'reimbursement_owed',
          'content_kind', 'untrusted_business_data'
        )
      );
    end if;
    v_card_count := v_card_count + 1;
    exit when v_card_count >= p_limit;
  end loop;

  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_source_revisions,
    'authorization_candidate', p_authorization_candidate,
    'cards', v_cards
  );
end;
$function$;

revoke all on function private.agent_p2_expense_hash_ref(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_money_v1(numeric,text)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_expected_candidate_v1(text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_proof_candidate_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_read_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_project_assigned_v1(
  uuid,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_assigned_approver_v1(
  uuid,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_batch_assigned_approver_v1(
  uuid,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,text,integer,integer,integer,timestamptz,jsonb,date,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_context_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,integer,integer,integer,integer
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_expense_attention_v1(
  uuid,uuid,text,text[],jsonb,timestamptz,integer,integer
) from public, anon, authenticated, service_role;

create or replace function public.read_agent_expenses_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_view_kind text,
  p_project_id uuid,
  p_batch_disposition text,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_order_date date,
  p_after_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_expense_service_role_required'
      using errcode = '42501';
  end if;
  return private.agent_p2_expense_list_v1(
    p_request_id,
    p_company_id,
    p_actor_user_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidate,
    p_view_kind,
    p_project_id,
    p_batch_disposition,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_order_date,
    p_after_id
  );
end;
$function$;

create or replace function public.read_agent_expense_context_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidate jsonb,
  p_expense_id uuid,
  p_source_limit integer,
  p_allocation_limit integer,
  p_allocation_fetch_limit integer,
  p_review_reason_character_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'agent_expense_service_role_required'
      using errcode = '42501';
  end if;
  return private.agent_p2_expense_context_v1(
    p_request_id,
    p_company_id,
    p_actor_user_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidate,
    p_expense_id,
    p_source_limit,
    p_allocation_limit,
    p_allocation_fetch_limit,
    p_review_reason_character_limit
  );
end;
$function$;

alter function private.agent_p2_expense_hash_ref(text,jsonb)
  owner to current_user;
alter function private.agent_p2_expense_money_v1(numeric,text)
  owner to current_user;
alter function private.agent_p2_expense_expected_candidate_v1(text,jsonb)
  owner to current_user;
alter function private.agent_p2_expense_proof_candidate_v1(jsonb)
  owner to current_user;
alter function private.agent_p2_expense_read_context_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text
) owner to current_user;
alter function private.agent_p2_expense_project_assigned_v1(
  uuid,uuid,uuid
) owner to current_user;
alter function private.agent_p2_expense_assigned_approver_v1(
  uuid,uuid,uuid
) owner to current_user;
alter function private.agent_p2_expense_batch_assigned_approver_v1(
  uuid,uuid,uuid
) owner to current_user;
alter function private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)
  owner to current_user;
alter function private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)
  owner to current_user;
alter function private.agent_p2_expense_list_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,text,integer,integer,integer,timestamptz,jsonb,date,uuid
) owner to current_user;
alter function private.agent_p2_expense_context_v1(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,integer,integer,integer,integer
) owner to current_user;
alter function private.agent_p2_expense_attention_v1(
  uuid,uuid,text,text[],jsonb,timestamptz,integer,integer
) owner to current_user;
alter function public.read_agent_expenses_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,text,integer,integer,integer,timestamptz,jsonb,date,uuid
) owner to current_user;
alter function public.read_agent_expense_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,integer,integer,integer,integer
) owner to current_user;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_expense_hash_ref(text,jsonb)',
    'private.agent_p2_expense_money_v1(numeric,text)',
    'private.agent_p2_expense_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_expense_proof_candidate_v1(jsonb)',
    'private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)',
    'private.agent_p2_expense_project_assigned_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_batch_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)',
    'private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)',
    'private.agent_p2_expense_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_expense_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)',
    'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
    'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'public.read_agent_expense_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_expense_acl_function_missing:%', v_signature
        using errcode = '55000';
    end if;
    for v_acl in
      select distinct acl.grantee,
             case when acl.grantee = 0 then 'public'
               else role_row.rolname end as role_name
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = v_function_oid
        and acl.grantee <> function_row.proowner
    loop
      if v_acl.role_name is null then
        raise exception 'agent_expense_acl_role_missing:%', v_signature
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name) end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

revoke all on function public.read_agent_expenses_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,text,integer,integer,integer,timestamptz,jsonb,date,uuid
) from public, anon, authenticated;
grant execute on function public.read_agent_expenses_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,text,integer,integer,integer,timestamptz,jsonb,date,uuid
) to service_role;

revoke all on function public.read_agent_expense_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,integer,integer,integer,integer
) from public, anon, authenticated;
grant execute on function public.read_agent_expense_context_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  uuid,integer,integer,integer,integer
) to service_role;

do $acl_postflight$
declare
  v_signature text;
  v_acl_entries text[];
  v_expected text[];
begin
  foreach v_signature in array array[
    'private.agent_p2_expense_hash_ref(text,jsonb)',
    'private.agent_p2_expense_money_v1(numeric,text)',
    'private.agent_p2_expense_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_expense_proof_candidate_v1(jsonb)',
    'private.agent_p2_expense_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,text)',
    'private.agent_p2_expense_project_assigned_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_batch_assigned_approver_v1(uuid,uuid,uuid)',
    'private.agent_p2_expense_item_v1(uuid,uuid,uuid,integer)',
    'private.agent_p2_expense_batch_item_v1(uuid,uuid,boolean)',
    'private.agent_p2_expense_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_expense_context_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)',
    'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
    'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'public.read_agent_expense_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)'
  ]::text[] loop
    select coalesce(
             pg_catalog.array_agg(entry.value order by entry.value),
             array[]::text[]
           )
      into v_acl_entries
    from (
      select distinct
        case when acl.grantee = 0 then 'PUBLIC'
          else coalesce(
            role_row.rolname, 'OID:' || acl.grantee::text
          ) end || ':' || acl.privilege_type || ':' ||
          acl.is_grantable::text as value
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl
      left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
      where function_row.oid = pg_catalog.to_regprocedure(v_signature)::oid
        and acl.grantee <> function_row.proowner
    ) entry;
    v_expected := case when v_signature like 'public.%'
      then array['service_role:EXECUTE:false']::text[]
      else array[]::text[]
    end;
    if v_acl_entries is distinct from v_expected then
      raise exception 'agent_expense_acl_not_canonical:%:%',
        v_signature, v_acl_entries using errcode = '55000';
    end if;
  end loop;
end;
$acl_postflight$;

do $postflight$
declare
  v_valid boolean;
  v_signature text;
begin
  select pg_catalog.count(*) = 2
     and pg_catalog.bool_and(procedure.prosecdef)
     and pg_catalog.bool_and(procedure.provolatile = 's')
     and pg_catalog.bool_and(
       procedure.proconfig @> array['search_path=""']::text[]
     )
    into v_valid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'read_agent_expenses_as_system',
      'read_agent_expense_context_as_system'
    );
  if not coalesce(v_valid, false) then
    raise exception 'agent_expense_public_function_catalog_invalid'
      using errcode = '55000';
  end if;

  foreach v_signature in array array[
    'public.read_agent_expenses_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,text,integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'public.read_agent_expense_context_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,integer,integer,integer,integer)'
  ] loop
    if pg_catalog.has_function_privilege('public', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated', v_signature, 'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role', v_signature, 'EXECUTE'
       ) then
      raise exception 'agent_expense_public_function_acl_invalid: %',
        v_signature using errcode = '55000';
    end if;
  end loop;

  select pg_catalog.count(*) = 13
     and pg_catalog.bool_and(not procedure.prosecdef)
     and pg_catalog.bool_and(
       procedure.proconfig @> array['search_path=""']::text[]
     )
    into v_valid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname in (
      'agent_p2_expense_hash_ref',
      'agent_p2_expense_money_v1',
      'agent_p2_expense_expected_candidate_v1',
      'agent_p2_expense_proof_candidate_v1',
      'agent_p2_expense_read_context_v1',
      'agent_p2_expense_project_assigned_v1',
      'agent_p2_expense_assigned_approver_v1',
      'agent_p2_expense_batch_assigned_approver_v1',
      'agent_p2_expense_item_v1',
      'agent_p2_expense_batch_item_v1',
      'agent_p2_expense_list_v1',
      'agent_p2_expense_context_v1',
      'agent_p2_expense_attention_v1'
    );
  if not coalesce(v_valid, false) then
    raise exception 'agent_expense_private_function_catalog_invalid'
      using errcode = '55000';
  end if;

  if pg_catalog.has_function_privilege(
       'service_role',
       'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'private.agent_p2_expense_attention_v1(uuid,uuid,text,text[],jsonb,timestamp with time zone,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'agent_expense_attention_acl_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
