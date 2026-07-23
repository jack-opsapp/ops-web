-- Preserve the canonical exact-recovery RPC names while binding the lifecycle
-- exception to the exact locked correspondence event. Historical notification
-- rows are inert only when a later meaningful event already owns the source
-- high-water and no active notification could have been caused by the message
-- being moved.

begin;

alter function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) set schema private;

alter function private.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) rename to reparent_email_message_exact_delegate;

alter function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) set schema private;

alter function private.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) rename to create_target_reparent_email_exact_delegate;

revoke all on function private.reparent_email_message_exact_delegate(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) from public, anon, authenticated, service_role;

revoke all on function private.create_target_reparent_email_exact_delegate(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) from public, anon, authenticated, service_role;

create or replace function private.exact_recovery_notification_history_is_inert(
  p_moved_event_occurred_at timestamptz,
  p_latest_event_occurred_at timestamptz,
  p_latest_active_notification_created_at timestamptz
) returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_moved_event_occurred_at is not null
    and p_latest_event_occurred_at > p_moved_event_occurred_at
    and (
      p_latest_active_notification_created_at is null
      or p_latest_active_notification_created_at <
        p_moved_event_occurred_at
    );
$function$;

revoke all on function private.exact_recovery_notification_history_is_inert(
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create or replace function private.assert_exact_message_lifecycle_recomputable(
  p_company_id uuid,
  p_opportunity_id uuid
) returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_state public.opportunity_lifecycle_state%rowtype;
  v_context_event_id uuid;
  v_context_event_occurred_at timestamptz;
  v_latest_event_id uuid;
  v_latest_event_occurred_at timestamptz;
  v_latest_event_direction text;
  v_latest_active_notification_created_at timestamptz;
begin
  -- The caller already holds the company, opportunity, event, and activity
  -- locks. Fence every lifecycle writer only after that established lock
  -- order, then retain the table locks through transaction end.
  lock table
    public.opportunity_lifecycle_action_audit,
    public.opportunity_lifecycle_state,
    public.opportunity_follow_up_drafts,
    public.notifications
  in share row exclusive mode;

  select state.*
  into v_state
  from public.opportunity_lifecycle_state state
  where state.company_id = p_company_id
    and state.opportunity_id = p_opportunity_id
  for update;

  if (
    v_state.opportunity_id is not null
    and (
      v_state.unanswered_follow_up_count <> 0
      or v_state.second_follow_up_sent_at is not null
      or v_state.operator_follow_up_miss_at is not null
      or v_state.stale_status is not null
      or v_state.stale_status_at is not null
      or v_state.protected_until is not null
    )
  ) or exists (
    select 1
    from public.opportunity_follow_up_drafts draft
    where draft.company_id = p_company_id
      and draft.opportunity_id = p_opportunity_id
  ) or exists (
    select 1
    from public.opportunity_lifecycle_action_audit action
    where action.company_id = p_company_id
      and action.opportunity_id = p_opportunity_id
      and action.status = 'applied'
  ) then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.notifications notification
    where notification.company_id = p_company_id::text
      and notification.type = 'leads_waiting'
      and notification.dedupe_key =
        'lead_lifecycle:operator_follow_up_miss:' || p_opportunity_id::text
  ) then
    return;
  end if;

  begin
    v_context_event_id := nullif(
      pg_catalog.current_setting('ops.exact_recovery_event_id', true),
      ''
    )::uuid;
  exception
    when invalid_text_representation then
      v_context_event_id := null;
  end;
  if v_context_event_id is null then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;

  select event.occurred_at
  into v_context_event_occurred_at
  from public.opportunity_correspondence_events event
  where event.id = v_context_event_id
    and event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.is_meaningful is true
    and event.opportunity_projection_applied is true
  for share;
  if not found then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;

  select event.id, event.occurred_at, event.direction
  into
    v_latest_event_id,
    v_latest_event_occurred_at,
    v_latest_event_direction
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.is_meaningful is true
    and event.opportunity_projection_applied is true
  order by event.occurred_at desc, event.id desc
  limit 1
  for share;

  select max(notification.created_at)
  into v_latest_active_notification_created_at
  from public.notifications notification
  where notification.company_id = p_company_id::text
    and notification.type = 'leads_waiting'
    and notification.dedupe_key =
      'lead_lifecycle:operator_follow_up_miss:' || p_opportunity_id::text
    and notification.resolved_at is null;

  if v_state.opportunity_id is null
    or v_latest_event_id is null
    or v_latest_event_id = v_context_event_id
    or v_state.last_meaningful_event_id is distinct from v_latest_event_id
    or v_state.last_meaningful_at is distinct from
      v_latest_event_occurred_at
    or v_state.last_meaningful_direction is distinct from
      v_latest_event_direction
    or not private.exact_recovery_notification_history_is_inert(
      v_context_event_occurred_at,
      v_latest_event_occurred_at,
      v_latest_active_notification_created_at
    )
  then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_exact_message_lifecycle_recomputable(
  uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.reparent_opportunity_email_message_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_source_opportunity_id uuid,
  p_target_opportunity_id uuid,
  p_expected_activity_id uuid,
  p_expected_correspondence_event_id uuid,
  p_target_email text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_expected_source_updated_at timestamptz,
  p_expected_target_updated_at timestamptz,
  p_expected_source_stage text,
  p_expected_target_stage text,
  p_expected_source_stage_manually_set boolean,
  p_expected_target_stage_manually_set boolean,
  p_expected_source_assigned_to uuid,
  p_expected_target_assigned_to uuid,
  p_expected_source_assignment_version bigint,
  p_expected_target_assignment_version bigint,
  p_expected_source_project_id uuid,
  p_expected_target_project_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_previous_event_context text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_previous_event_context := pg_catalog.current_setting(
    'ops.exact_recovery_event_id',
    true
  );
  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    p_expected_correspondence_event_id::text,
    true
  );

  begin
    v_result := private.reparent_email_message_exact_delegate(
      p_actor_user_id,
      p_company_id,
      p_connection_id,
      p_provider_thread_id,
      p_provider_message_id,
      p_source_opportunity_id,
      p_target_opportunity_id,
      p_expected_activity_id,
      p_expected_correspondence_event_id,
      p_target_email,
      p_manifest_sha256,
      p_entry_sha256,
      p_expected_source_updated_at,
      p_expected_target_updated_at,
      p_expected_source_stage,
      p_expected_target_stage,
      p_expected_source_stage_manually_set,
      p_expected_target_stage_manually_set,
      p_expected_source_assigned_to,
      p_expected_target_assigned_to,
      p_expected_source_assignment_version,
      p_expected_target_assignment_version,
      p_expected_source_project_id,
      p_expected_target_project_id
    );
  exception
    when others then
      perform pg_catalog.set_config(
        'ops.exact_recovery_event_id',
        coalesce(v_previous_event_context, ''),
        true
      );
      raise;
  end;

  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    coalesce(v_previous_event_context, ''),
    true
  );
  return v_result;
end;
$function$;

revoke all on function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) to service_role;

create or replace function public.create_target_and_reparent_opportunity_email_message_guarded(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_source_opportunity_id uuid,
  p_expected_activity_id uuid,
  p_expected_correspondence_event_id uuid,
  p_target_email text,
  p_target_source_thread_key text,
  p_target_title text,
  p_target_contact_name text,
  p_manifest_sha256 text,
  p_entry_sha256 text,
  p_expected_source_updated_at timestamptz,
  p_expected_source_stage text,
  p_expected_source_stage_manually_set boolean,
  p_expected_source_assigned_to uuid,
  p_expected_source_assignment_version bigint,
  p_expected_source_project_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_previous_event_context text;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_previous_event_context := pg_catalog.current_setting(
    'ops.exact_recovery_event_id',
    true
  );
  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    p_expected_correspondence_event_id::text,
    true
  );

  begin
    v_result := private.create_target_reparent_email_exact_delegate(
      p_actor_user_id,
      p_company_id,
      p_connection_id,
      p_provider_thread_id,
      p_provider_message_id,
      p_source_opportunity_id,
      p_expected_activity_id,
      p_expected_correspondence_event_id,
      p_target_email,
      p_target_source_thread_key,
      p_target_title,
      p_target_contact_name,
      p_manifest_sha256,
      p_entry_sha256,
      p_expected_source_updated_at,
      p_expected_source_stage,
      p_expected_source_stage_manually_set,
      p_expected_source_assigned_to,
      p_expected_source_assignment_version,
      p_expected_source_project_id
    );
  exception
    when others then
      perform pg_catalog.set_config(
        'ops.exact_recovery_event_id',
        coalesce(v_previous_event_context, ''),
        true
      );
      raise;
  end;

  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    coalesce(v_previous_event_context, ''),
    true
  );
  return v_result;
end;
$function$;

revoke all on function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) to service_role;

-- Compile both wrapper/delegate paths and prove the invariant helpers while
-- this migration can still roll back atomically.
do $verify_event_scoped_recovery$
declare
  v_prior_role text := pg_catalog.current_setting(
    'request.jwt.claim.role',
    true
  );
  v_prior_event_context text := pg_catalog.current_setting(
    'ops.exact_recovery_event_id',
    true
  );
  v_sentinel_context constant text :=
    '00000000-0000-4000-8000-000000000001';
  v_failed_as_expected boolean;
begin
  if private.exact_recovery_notification_history_is_inert(
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-02T00:00:00Z'::timestamptz,
    null
  ) is distinct from true
    or private.exact_recovery_notification_history_is_inert(
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:00Z'::timestamptz,
      null
    ) is distinct from false
    or private.exact_recovery_notification_history_is_inert(
      '2026-01-01T00:00:00Z'::timestamptz,
      '2026-01-02T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:00Z'::timestamptz
    ) is distinct from false
    or private.exact_recovery_notification_history_is_inert(
      '2026-01-02T00:00:00Z'::timestamptz,
      '2026-01-03T00:00:00Z'::timestamptz,
      '2026-01-01T00:00:00Z'::timestamptz
    ) is distinct from true
  then
    raise exception 'event_scoped_recovery_invariant_self_test_failed';
  end if;

  if has_function_privilege(
    'service_role',
    'private.reparent_email_message_exact_delegate(uuid,uuid,uuid,text,text,uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,text,text,boolean,boolean,uuid,uuid,bigint,bigint,uuid,uuid)'::regprocedure,
    'EXECUTE'
  ) or has_function_privilege(
    'service_role',
    'private.create_target_reparent_email_exact_delegate(uuid,uuid,uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,text,boolean,uuid,bigint,uuid)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'event_scoped_recovery_delegate_acl_self_test_failed';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    'service_role',
    true
  );
  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    v_sentinel_context,
    true
  );

  v_failed_as_expected := false;
  begin
    perform public.reparent_opportunity_email_message_guarded(
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      'compile-thread',
      'compile-message',
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      'compile@example.com',
      repeat('a', 64),
      repeat('b', 64),
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp(),
      'new_lead',
      'new_lead',
      false,
      false,
      null::uuid,
      null::uuid,
      0::bigint,
      0::bigint,
      null::uuid,
      null::uuid
    );
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'recovery_connection_not_found' then
        raise;
      end if;
      v_failed_as_expected := true;
  end;
  if not v_failed_as_expected
    or pg_catalog.current_setting(
      'ops.exact_recovery_event_id',
      true
    ) is distinct from v_sentinel_context
  then
    raise exception 'event_scoped_recovery_reparent_smoke_test_failed';
  end if;

  v_failed_as_expected := false;
  begin
    perform public.create_target_and_reparent_opportunity_email_message_guarded(
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      'compile-thread',
      'compile-message',
      gen_random_uuid(),
      gen_random_uuid(),
      gen_random_uuid(),
      'compile@example.com',
      'email:gmail:00000000-0000-4000-8000-000000000002:message:compile-message',
      'Compile test lead',
      'Compile test',
      repeat('c', 64),
      repeat('d', 64),
      pg_catalog.clock_timestamp(),
      'new_lead',
      false,
      null::uuid,
      0::bigint,
      null::uuid
    );
  exception
    when sqlstate 'P0002' then
      if sqlerrm <> 'recovery_connection_not_found' then
        raise;
      end if;
      v_failed_as_expected := true;
  end;
  if not v_failed_as_expected
    or pg_catalog.current_setting(
      'ops.exact_recovery_event_id',
      true
    ) is distinct from v_sentinel_context
  then
    raise exception 'event_scoped_recovery_create_smoke_test_failed';
  end if;

  perform pg_catalog.set_config(
    'ops.exact_recovery_event_id',
    coalesce(v_prior_event_context, ''),
    true
  );
  perform pg_catalog.set_config(
    'request.jwt.claim.role',
    coalesce(v_prior_role, ''),
    true
  );
exception
  when others then
    perform pg_catalog.set_config(
      'ops.exact_recovery_event_id',
      coalesce(v_prior_event_context, ''),
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claim.role',
      coalesce(v_prior_role, ''),
      true
    );
    raise;
end;
$verify_event_scoped_recovery$;

comment on function public.reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, uuid, text, text, text,
  timestamptz, timestamptz, text, text, boolean, boolean, uuid, uuid,
  bigint, bigint, uuid, uuid
) is
  'Canonical exact-message reparent entrypoint. Binds any historical lifecycle '
  'notification exception to the exact locked correspondence event before '
  'delegating the existing atomic recovery transaction.';

comment on function public.create_target_and_reparent_opportunity_email_message_guarded(
  uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, text, text, text,
  text, text, timestamptz, text, boolean, uuid, bigint, uuid
) is
  'Canonical exact-message target creation and reparent entrypoint with '
  'transaction-local, event-scoped lifecycle evidence.';

commit;
