-- Allow exact-message recovery to move the current lifecycle high-water only
-- when the lifecycle is passive, the state points exactly at the moved event,
-- no active lifecycle notification remains, and an earlier meaningful event
-- can deterministically become the new high-water. Every non-passive or
-- incomplete case continues to fail closed for separately reviewed repair.

begin;

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
  v_context_event_direction text;
  v_latest_event_id uuid;
  v_latest_event_occurred_at timestamptz;
  v_latest_event_direction text;
  v_projected_latest_event_id uuid;
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

  select event.occurred_at, event.direction
  into v_context_event_occurred_at, v_context_event_direction
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

  select event.id
  into v_projected_latest_event_id
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.opportunity_id = p_opportunity_id
    and event.id <> v_context_event_id
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
  then
    raise exception 'exact_recovery_lifecycle_not_reconstructible'
      using errcode = '55000';
  end if;

  if v_latest_event_id is not distinct from v_context_event_id then
    if not (
      v_state.last_meaningful_event_id is not distinct from
        v_context_event_id
      and v_state.last_meaningful_at is not distinct from
        v_context_event_occurred_at
      and v_state.last_meaningful_direction is not distinct from
        v_context_event_direction
      and v_projected_latest_event_id is not null
      and v_latest_active_notification_created_at is null
    )
    then
      raise exception 'exact_recovery_lifecycle_not_reconstructible'
        using errcode = '55000';
    end if;
    return;
  end if;

  if not (
    v_latest_event_id is distinct from v_context_event_id
    and v_state.last_meaningful_event_id is not distinct from
      v_latest_event_id
    and v_state.last_meaningful_at is not distinct from
      v_latest_event_occurred_at
    and v_state.last_meaningful_direction is not distinct from
      v_latest_event_direction
    and private.exact_recovery_notification_history_is_inert(
        v_context_event_occurred_at,
        v_latest_event_occurred_at,
        v_latest_active_notification_created_at
      )
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

commit;
