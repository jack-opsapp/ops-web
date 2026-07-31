begin;

create or replace function public.catalog_guided_setup_begin_commit(
  p_session_id uuid,
  p_approval_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'private', 'extensions', 'pg_temp'
as $function$
declare
  v_company_id uuid := private.get_user_company_id();
  v_user_id uuid;
  v_session public.catalog_guided_setup_sessions%rowtype;
  v_action jsonb;
  v_action_type text;
  v_action_key text;
  v_action_hash text;
  v_operation_id uuid;
  v_allowed_types constant text[] := array[
    'upsert_product',
    'upsert_product_option',
    'upsert_product_option_value',
    'upsert_catalog_family',
    'upsert_catalog_option',
    'upsert_catalog_option_value',
    'upsert_catalog_variant',
    'replace_variant_option_values',
    'map_product_catalog_option',
    'upsert_product_material',
    'upsert_material_quantity_rule',
    'upsert_supplier_cost_profile',
    'upsert_capability_binding',
    'reuse_task_type',
    'create_task_type',
    'upsert_tax_rate',
    'move_catalog_variant',
    'archive_catalog_variant',
    'archive_catalog_option',
    'create_verification_item'
  ];
begin
  if v_company_id is null then
    raise exception 'Unauthorized: company not found';
  end if;

  select u.id
    into v_user_id
    from public.users u
   where u.company_id = v_company_id
     and u.deleted_at is null
     and (
       u.auth_id = (auth.jwt() ->> 'sub')
       or u.firebase_uid = (auth.jwt() ->> 'sub')
     )
   limit 1;

  if v_user_id is null
     or not public.has_permission(v_user_id, 'catalog.run_setup', 'all') then
    raise exception 'Forbidden: catalog.run_setup';
  end if;

  select *
    into v_session
    from public.catalog_guided_setup_sessions
   where id = p_session_id
     and company_id = v_company_id
   for update;

  if not found then
    raise exception 'Guided setup session not found';
  end if;

  if v_session.status = 'complete' then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'operationId', v_session.commit_operation_id,
      'status', v_session.status,
      'readback', v_session.readback
    );
  end if;

  if v_session.status not in ('review', 'approved', 'committing', 'attention') then
    raise exception 'Guided setup is not ready to commit';
  end if;
  if v_session.proposed_plan is null
     or coalesce((v_session.proposed_plan ->> 'ready')::boolean, false) is not true then
    raise exception 'Guided setup plan is not reviewable';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(
        coalesce(v_session.proposed_plan -> 'issues', '[]'::jsonb)
      ) issue
     where issue ->> 'severity' = 'blocker'
  ) then
    raise exception 'Guided setup plan contains blockers';
  end if;
  if nullif(btrim(coalesce(p_approval_hash, '')), '') is null
     or p_approval_hash is distinct from v_session.proposed_plan_hash then
    raise exception 'Approval hash does not match the reviewed plan';
  end if;

  v_operation_id := coalesce(v_session.commit_operation_id, gen_random_uuid());

  for v_action in
    select value
      from jsonb_array_elements(
        coalesce(v_session.proposed_plan -> 'actions', '[]'::jsonb)
      )
  loop
    v_action_type := v_action ->> 'actionType';
    v_action_key := v_action ->> 'actionKey';
    if v_action_type is null
       or not (v_action_type = any(v_allowed_types)) then
      raise exception 'Unsupported action type: %', coalesce(v_action_type, '<null>');
    end if;
    if nullif(btrim(coalesce(v_action_key, '')), '') is null then
      raise exception 'Catalog action key is required';
    end if;

    v_action_hash := encode(
      extensions.digest(convert_to(v_action::text, 'utf8'), 'sha256'),
      'hex'
    );

    insert into public.catalog_guided_setup_actions (
      company_id,
      session_id,
      action_key,
      action_hash,
      action_type,
      target_kind,
      target_id,
      status,
      source_fingerprint,
      commit_operation_id,
      request
    ) values (
      v_company_id,
      p_session_id,
      v_action_key,
      v_action_hash,
      v_action_type,
      v_action ->> 'targetKind',
      case
        when coalesce(v_action ->> 'existingId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (v_action ->> 'existingId')::uuid
        else null
      end,
      'planned',
      v_action ->> 'sourceFingerprint',
      v_operation_id,
      v_action
    )
    on conflict (session_id, action_key) do update
      set action_hash = excluded.action_hash,
          action_type = excluded.action_type,
          target_kind = excluded.target_kind,
          target_id = coalesce(
            public.catalog_guided_setup_actions.target_id,
            excluded.target_id
          ),
          source_fingerprint = excluded.source_fingerprint,
          commit_operation_id = excluded.commit_operation_id,
          request = excluded.request,
          status = case
            when public.catalog_guided_setup_actions.status = 'verified'
              then 'verified'
            else 'planned'
          end,
          error = case
            when public.catalog_guided_setup_actions.status = 'verified'
              then public.catalog_guided_setup_actions.error
            else null
          end,
          updated_at = now();
  end loop;

  update public.catalog_guided_setup_sessions
     set status = 'committing',
         approval_hash = p_approval_hash,
         approved_at = coalesce(approved_at, now()),
         commit_operation_id = v_operation_id,
         updated_at = now()
   where id = p_session_id;

  return jsonb_build_object(
    'ok', true,
    'replayed', v_session.status in ('committing', 'attention'),
    'operationId', v_operation_id,
    'status', 'committing',
    'planHash', p_approval_hash
  );
end;
$function$;

create or replace function public.catalog_guided_setup_finish_commit(
  p_session_id uuid,
  p_operation_id uuid,
  p_success boolean,
  p_readback jsonb,
  p_commit_journal jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid := private.get_user_company_id();
  v_user_id uuid;
  v_status text;
begin
  if v_company_id is null then
    raise exception 'Unauthorized: company not found';
  end if;
  select u.id
    into v_user_id
    from public.users u
   where u.company_id = v_company_id
     and u.deleted_at is null
     and (
       u.auth_id = (auth.jwt() ->> 'sub')
       or u.firebase_uid = (auth.jwt() ->> 'sub')
     )
   limit 1;
  if v_user_id is null
     or not public.has_permission(v_user_id, 'catalog.run_setup', 'all') then
    raise exception 'Forbidden: catalog.run_setup';
  end if;
  if jsonb_typeof(coalesce(p_readback, '{}'::jsonb)) <> 'object' then
    raise exception 'Readback must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(p_commit_journal, '[]'::jsonb)) <> 'array' then
    raise exception 'Commit journal must be a JSON array';
  end if;

  v_status := case when p_success then 'complete' else 'attention' end;
  update public.catalog_guided_setup_sessions
     set status = v_status,
         readback = coalesce(p_readback, '{}'::jsonb),
         commit_journal = coalesce(p_commit_journal, '[]'::jsonb),
         completed_at = case when p_success then now() else null end,
         updated_at = now()
   where id = p_session_id
     and company_id = v_company_id
     and commit_operation_id = p_operation_id
     and status in ('committing', 'attention', 'complete');
  if not found then
    raise exception 'Guided setup commit operation not found';
  end if;

  return jsonb_build_object(
    'ok', p_success,
    'status', v_status,
    'readback', coalesce(p_readback, '{}'::jsonb)
  );
end;
$function$;

create or replace function public.catalog_guided_setup_archive_variant(
  p_session_id uuid,
  p_action_key text
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid := private.get_user_company_id();
  v_user_id uuid;
  v_variant_id uuid;
  v_references jsonb;
begin
  if v_company_id is null then
    raise exception 'Unauthorized: company not found';
  end if;
  select u.id
    into v_user_id
    from public.users u
   where u.company_id = v_company_id
     and u.deleted_at is null
     and (
       u.auth_id = (auth.jwt() ->> 'sub')
       or u.firebase_uid = (auth.jwt() ->> 'sub')
     )
   limit 1;
  if v_user_id is null
     or not public.has_permission(v_user_id, 'catalog.run_setup', 'all') then
    raise exception 'Forbidden: catalog.run_setup';
  end if;

  select action_row.target_id
    into v_variant_id
    from public.catalog_guided_setup_actions action_row
    join public.catalog_guided_setup_sessions session_row
      on session_row.id = action_row.session_id
   where action_row.session_id = p_session_id
     and action_row.action_key = p_action_key
     and action_row.company_id = v_company_id
     and action_row.action_type = 'archive_catalog_variant'
     and session_row.company_id = v_company_id
     and session_row.status in ('committing', 'attention', 'complete')
   for update of action_row;

  if v_variant_id is null then
    raise exception 'Catalog variant archive action not found';
  end if;

  select coalesce(
    jsonb_object_agg(reference_row.table_name, reference_row.reference_count)
      filter (where reference_row.reference_count > 0),
    '{}'::jsonb
  )
    into v_references
    from (
      select 'catalog_order_items'::text table_name,
        count(*)::integer reference_count
        from public.catalog_order_items where catalog_variant_id = v_variant_id
      union all
      select 'catalog_snapshot_items',
        count(*)::integer
        from public.catalog_snapshot_items where original_variant_id = v_variant_id
      union all
      select 'catalog_stock_unit_events',
        count(*)::integer
        from public.catalog_stock_unit_events where catalog_variant_id = v_variant_id
      union all
      select 'catalog_stock_units',
        count(*)::integer
        from public.catalog_stock_units
       where catalog_variant_id = v_variant_id and deleted_at is null
      union all
      select 'catalog_variant_option_values',
        count(*)::integer
        from public.catalog_variant_option_values
       where variant_id = v_variant_id and deleted_at is null
      union all
      select 'catalog_supplier_cost_profiles',
        count(*)::integer
        from public.catalog_supplier_cost_profiles
       where catalog_variant_id = v_variant_id and deleted_at is null
      union all
      select 'inventory_deductions',
        count(*)::integer
        from public.inventory_deductions where catalog_variant_id = v_variant_id
      union all
      select 'line_item_materials',
        count(*)::integer
        from public.line_item_materials where catalog_variant_id = v_variant_id
      union all
      select 'product_materials',
        count(*)::integer
        from public.product_materials
       where catalog_variant_id = v_variant_id and deleted_at is null
      union all
      select 'project_material_demands',
        count(*)::integer
        from public.project_material_demands where catalog_variant_id = v_variant_id
      union all
      select 'project_material_snapshot_items',
        count(*)::integer
        from public.project_material_snapshot_items where catalog_variant_id = v_variant_id
      union all
      select 'task_material_allocations',
        count(*)::integer
        from public.task_material_allocations where catalog_variant_id = v_variant_id
      union all
      select 'task_materials',
        count(*)::integer
        from public.task_materials where catalog_variant_id = v_variant_id
    ) reference_row;

  if v_references <> '{}'::jsonb then
    update public.catalog_guided_setup_actions
       set status = 'failed',
           error = jsonb_build_object(
             'code', 'variant_has_references',
             'references', v_references
           ),
           attempt_count = attempt_count + 1,
           updated_at = now()
     where session_id = p_session_id
       and action_key = p_action_key
       and company_id = v_company_id;
    return jsonb_build_object(
      'ok', false,
      'archived', false,
      'variantId', v_variant_id,
      'references', v_references
    );
  end if;

  update public.catalog_variants
     set deleted_at = now(),
         is_active = false,
         updated_at = now()
   where id = v_variant_id
     and company_id = v_company_id
     and deleted_at is null;

  update public.catalog_guided_setup_actions
     set status = 'verified',
         response = jsonb_build_object(
           'archived', true,
           'variantId', v_variant_id,
           'references', '{}'::jsonb
         ),
         error = null,
         attempt_count = attempt_count + 1,
         committed_at = coalesce(committed_at, now()),
         verified_at = now(),
         updated_at = now()
   where session_id = p_session_id
     and action_key = p_action_key
     and company_id = v_company_id;

  return jsonb_build_object(
    'ok', true,
    'archived', true,
    'variantId', v_variant_id,
    'references', '{}'::jsonb
  );
end;
$function$;

revoke all on function public.catalog_guided_setup_begin_commit(uuid, text)
  from public;
revoke all on function public.catalog_guided_setup_finish_commit(
  uuid, uuid, boolean, jsonb, jsonb
) from public;
revoke all on function public.catalog_guided_setup_archive_variant(uuid, text)
  from public;
grant execute on function public.catalog_guided_setup_begin_commit(uuid, text)
  to authenticated, anon;
grant execute on function public.catalog_guided_setup_finish_commit(
  uuid, uuid, boolean, jsonb, jsonb
) to authenticated, anon;
grant execute on function public.catalog_guided_setup_archive_variant(uuid, text)
  to authenticated, anon;

comment on function public.catalog_guided_setup_begin_commit(uuid, text) is
  'Locks an approved server-owned Phase C plan and journals its allowlisted actions. No browser action plan is accepted.';
comment on function public.catalog_guided_setup_finish_commit(
  uuid, uuid, boolean, jsonb, jsonb
) is
  'Marks a Phase C commit complete only after readback, or attention for a recoverable partial result.';
comment on function public.catalog_guided_setup_archive_variant(uuid, text) is
  'Archives a planned blank variant only after a broad company-scoped dependent-record preflight.';

commit;
