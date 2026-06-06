begin;

do $$
begin
  if to_regprocedure('private.sync_accepted_estimate_project_tasks(uuid)') is null then
    raise exception 'qbo_acceptance_bridge_task_sync_helper_required'
      using errcode = '42883';
  end if;

  if to_regprocedure('private.persist_estimate_material_booking_projection(uuid, uuid)') is null then
    raise exception 'qbo_acceptance_bridge_booking_helper_required'
      using errcode = '42883';
  end if;

  if to_regprocedure('private.persist_catalog_mapping_notifications_from_missing_mappings(uuid, jsonb)') is null then
    raise exception 'qbo_acceptance_bridge_mapping_notification_helper_required'
      using errcode = '42883';
  end if;

  if to_regprocedure('private.try_parse_uuid(text)') is null then
    raise exception 'qbo_acceptance_bridge_try_parse_uuid_required'
      using errcode = '42883';
  end if;
end;
$$;

create or replace function public.accept_estimate_to_job_from_quickbooks(
  p_company_id uuid,
  p_connection_id uuid,
  p_estimate_id uuid,
  p_qb_estimate_id text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_connection public.accounting_connections%rowtype;
  v_estimate public.estimates%rowtype;
  v_company public.companies%rowtype;
  v_actor_id uuid;
  v_actor_auth_id uuid;
  v_existing_request public.accept_estimate_to_job_requests%rowtype;
  v_project_task_result jsonb := '{}'::jsonb;
  v_booking_projection_result jsonb := '{}'::jsonb;
  v_mapping_notification_result jsonb := '{}'::jsonb;
  v_response jsonb;
  v_project_id uuid;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  if p_company_id is null
     or p_connection_id is null
     or p_estimate_id is null
     or nullif(btrim(coalesce(p_qb_estimate_id, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_invalid_input'
    );
  end if;

  select *
    into v_connection
    from public.accounting_connections
   where id = p_connection_id
     and company_id::text = p_company_id::text
     and provider = 'quickbooks'
     and is_connected is true
     and sync_enabled is true
     and sync_direction <> 'push_only'
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_connection_not_active',
      'connection_id', p_connection_id,
      'company_id', p_company_id
    );
  end if;

  select *
    into v_estimate
    from public.estimates
   where id = p_estimate_id
     and company_id = p_company_id
     and qb_id = p_qb_estimate_id
     and deleted_at is null
   for update;

  if not found then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_estimate_not_found',
      'estimate_id', p_estimate_id,
      'qb_estimate_id', p_qb_estimate_id
    );
  end if;

  if v_estimate.opportunity_id is null then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_estimate_not_linked',
      'estimate_id', p_estimate_id,
      'qb_estimate_id', p_qb_estimate_id
    );
  end if;

  select *
    into v_company
    from public.companies
   where id = p_company_id
   for update;

  select u.id, private.try_parse_uuid(u.auth_id)
    into v_actor_id, v_actor_auth_id
    from public.users u
   where u.company_id = p_company_id
     and u.id::text = v_company.account_holder_id
     and coalesce(u.is_active, true) is true
     and u.deleted_at is null
   limit 1;

  if v_actor_id is null then
    select u.id, private.try_parse_uuid(u.auth_id)
      into v_actor_id, v_actor_auth_id
      from public.users u
     where u.company_id = p_company_id
       and u.id::text = any(coalesce(v_company.admin_ids, array[]::text[]))
       and coalesce(u.is_active, true) is true
       and u.deleted_at is null
     order by u.created_at asc
     limit 1;
  end if;

  if v_actor_id is null then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_actor_not_found',
      'estimate_id', p_estimate_id,
      'qb_estimate_id', p_qb_estimate_id
    );
  end if;

  if v_actor_auth_id is null then
    return jsonb_build_object(
      'status', 'needs_review',
      'reason', 'integration_acceptance_actor_auth_not_found',
      'estimate_id', p_estimate_id,
      'qb_estimate_id', p_qb_estimate_id
    );
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor_auth_id::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('ops.accept_estimate_to_job_rpc', 'on', true);

  insert into public.accept_estimate_to_job_requests (
    company_id,
    estimate_id,
    idempotency_key,
    created_by,
    status,
    response,
    error_code,
    created_at,
    updated_at
  ) values (
    p_company_id,
    p_estimate_id,
    p_idempotency_key,
    v_actor_id,
    'in_progress',
    null,
    null,
    v_now,
    v_now
  )
  on conflict (company_id, estimate_id, idempotency_key)
  do update
    set updated_at = v_now
  returning * into v_existing_request;

  if v_existing_request.status = 'completed' and v_existing_request.response is not null then
    return v_existing_request.response
      || jsonb_build_object(
        'status', 'succeeded',
        'source', 'quickbooks_webhook',
        'qb_estimate_id', p_qb_estimate_id,
        'idempotent_replay', true
      );
  end if;

  update public.estimates
     set status = 'approved',
         approved_at = coalesce(approved_at, v_now),
         updated_at = v_now
   where id = p_estimate_id
     and company_id = p_company_id;

  v_project_task_result := private.sync_accepted_estimate_project_tasks(p_estimate_id);
  v_project_id := private.try_parse_uuid(v_project_task_result ->> 'project_id');

  if v_project_id is null then
    raise exception 'accepted_project_id_missing'
      using errcode = '23514';
  end if;

  v_booking_projection_result := private.persist_estimate_material_booking_projection(
    p_estimate_id,
    v_project_id
  );

  -- Mapping notifications are soft warnings created from the P6 missing_mappings
  -- array only. This path creates persistent review evidence, never physical stock
  -- deduction; physical stock deduction remains owned by complete_project_task.
  v_mapping_notification_result :=
    private.persist_catalog_mapping_notifications_from_missing_mappings(
      p_company_id,
      coalesce(v_booking_projection_result -> 'missing_mappings', '[]'::jsonb)
    );

  v_response := jsonb_build_object(
    'ok', true,
    'status', 'succeeded',
    'source', 'quickbooks_webhook',
    'estimate_id', p_estimate_id,
    'project_id', v_project_id,
    'opportunity_id', v_estimate.opportunity_id,
    'actor_user_id', v_actor_id,
    'company_id', p_company_id,
    'connection_id', p_connection_id,
    'qb_estimate_id', p_qb_estimate_id,
    'idempotency_key', p_idempotency_key,
    'idempotent_replay', false,
    'project_task_result', v_project_task_result,
    'booking_projection_result', v_booking_projection_result,
    'mapping_notification_result', v_mapping_notification_result,
    'inventory_mode', v_booking_projection_result -> 'inventory_mode',
    'warnings', coalesce(v_booking_projection_result -> 'warnings', '[]'::jsonb),
    'overruns', coalesce(v_booking_projection_result -> 'overruns', '[]'::jsonb),
    'missing_mappings', coalesce(v_booking_projection_result -> 'missing_mappings', '[]'::jsonb),
    'demand_ids', coalesce(v_booking_projection_result -> 'demand_ids', '[]'::jsonb),
    'accepted_at', v_now
  );

  update public.accept_estimate_to_job_requests
     set status = 'completed',
         response = v_response,
         error_code = null,
         updated_at = v_now
   where id = v_existing_request.id;

  return v_response;
exception
  when others then
    if v_existing_request.id is not null then
      update public.accept_estimate_to_job_requests
         set status = 'in_progress',
             error_code = sqlstate,
             response = jsonb_build_object(
               'status', 'needs_review',
               'reason', 'integration_acceptance_bridge_failed',
               'sqlstate', sqlstate
             ),
             updated_at = now()
       where id = v_existing_request.id;
    end if;
    raise;
end;
$$;

revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) from public;

revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) from anon;

revoke all on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) from authenticated;

grant execute on function public.accept_estimate_to_job_from_quickbooks(
  uuid,
  uuid,
  uuid,
  text,
  text
) to service_role;

commit;
