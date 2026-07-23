-- Atomic correspondence event insert + opportunity counter projection.
--
-- Root cause of the 2026-07-22 outage: the event insert and its opportunity
-- counter projection were TWO separate PostgREST transactions. Sync inserted an
-- `opportunity_correspondence_events` row with `opportunity_projection_applied
-- = false`, and a later, independent `apply_opportunity_correspondence_event`
-- call was meant to flip it. A thread-parent conflict threw in between (two
-- duplicate leads claimed one Gmail thread), so one row committed durable but
-- unprojected and every hourly replay died at the same seam — freezing the
-- mailbox cursor for 20+ hours while the unbounded pending guard escalated the
-- stranded row into a 40001 retry storm.
--
-- This RPC collapses both writes into ONE transaction under the opportunity
-- row lock. The invariant it establishes:
--   * A meaningful correspondence event can no longer COMMIT unprojected — a
--     durable event is, by construction, a projected event. No write path in
--     this function ever persists `opportunity_projection_applied = false`.
--   * `opportunity_projection_applied = false` can now only describe rows that
--     pre-date this RPC. The 60-second-bounded guard
--     `private.opportunity_has_pending_meaningful_email` degrades to a legacy
--     backstop for exactly those rows.
--   * Commercial RPCs (conversion, deferral, merge) serialize against ingestion
--     via the same opportunity FOR UPDATE lock instead of racing a two-step
--     write.
-- Its return shape carries the counter columns identical to
-- `apply_opportunity_correspondence_event` so callers can drive stage
-- evaluation from either RPC.

begin;

create or replace function public.record_opportunity_correspondence_event(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_activity_id uuid,
  p_connection_id uuid,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_direction text,
  p_party_role text,
  p_is_meaningful boolean,
  p_noise_reason text,
  p_occurred_at timestamptz,
  p_linked_contact_kind text,
  p_linked_contact_id uuid,
  p_source text,
  p_subject text,
  p_from_email text,
  p_to_emails text[],
  p_cc_emails text[],
  p_apply_opportunity_projection boolean
) returns table (
  created boolean,
  event_id uuid,
  correspondence_count integer,
  inbound_count integer,
  outbound_count integer,
  stage text,
  stage_manually_set boolean,
  assignment_version bigint,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_message_direction text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_activity public.activities%rowtype;
  v_dedupe_hit boolean := false;
  v_existing_event_id uuid;
  v_existing_opportunity_id uuid;
  v_existing_activity_id uuid;
  v_existing_connection_id uuid;
  v_existing_provider_thread_id text;
  v_existing_direction text;
  v_existing_occurred_at timestamptz;
  v_existing_projection_applied boolean;
  v_result_event_id uuid;
  v_created boolean;
  v_should_project boolean := false;
  v_projection_direction text;
  v_projection_occurred_at timestamptz;
  v_projection_event_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
    or p_opportunity_id is null
    or p_occurred_at is null
    or p_party_role is null
    or p_source is null
    or nullif(btrim(p_provider_thread_id), '') is null
    or coalesce(p_direction, '') not in ('inbound', 'outbound')
  then
    raise exception 'company, opportunity, occurred_at, party_role, source, provider thread id, and a valid direction are required'
      using errcode = '22023';
  end if;

  -- Join the company-wide lead-assignment lock protocol before taking a parent
  -- opportunity lock. Data-review reparenting takes the same advisory fence
  -- before it locks email children, so neither workflow can form a
  -- parent/child deadlock with the other.
  perform private.lock_lead_assignment_company(p_company_id);

  -- Match merge/conversion lock order: opportunity first, child rows second.
  -- Taking the opportunity lock BEFORE the activity/event work makes the
  -- insert and its counter projection commit or roll back as one unit, and
  -- serializes this ingestion against every commercial RPC that locks the same
  -- row.
  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  -- Activity creation and event projection are separate PostgREST requests.
  -- Re-prove the optional activity under the shared company/opportunity lock so
  -- a concurrent reparent cannot move it between those requests and leave this
  -- event attached to a stale lead. Import-only callers intentionally pass a
  -- null activity id and remain supported.
  if p_activity_id is not null then
    select activity.*
      into v_activity
      from public.activities activity
     where activity.id = p_activity_id
       and activity.company_id = p_company_id
       and activity.opportunity_id = p_opportunity_id
       and activity.type = 'email'
       and activity.email_connection_id is not distinct from p_connection_id
       and activity.email_thread_id = p_provider_thread_id
       and activity.email_message_id is not distinct from p_provider_message_id
       and activity.direction = p_direction
     for share;
    if not found then
      raise exception 'correspondence_activity_identity_conflict'
        using errcode = '23514';
    end if;
  end if;

  -- Dedupe on the provider message identity, mirroring the TS
  -- findProviderMessageEvent exactly: company + provider_message_id, optionally
  -- narrowed to the connection. Only meaningful when a message id is present.
  if nullif(btrim(p_provider_message_id), '') is not null then
    select
      event.id,
      event.opportunity_id,
      event.activity_id,
      event.connection_id,
      event.provider_thread_id,
      event.direction,
      event.occurred_at,
      event.opportunity_projection_applied
    into
      v_existing_event_id,
      v_existing_opportunity_id,
      v_existing_activity_id,
      v_existing_connection_id,
      v_existing_provider_thread_id,
      v_existing_direction,
      v_existing_occurred_at,
      v_existing_projection_applied
    from public.opportunity_correspondence_events event
    where event.company_id = p_company_id
      and event.provider_message_id = p_provider_message_id
      and (p_connection_id is null or event.connection_id = p_connection_id)
    order by event.created_at asc
    limit 1
    for update;

    if found then
      -- A provider identity may be replayed, but it may never silently bind a
      -- different opportunity, activity, mailbox, thread, or direction. Fail
      -- closed so a relationship race is reconciled explicitly instead of
      -- applying lifecycle state to the caller's unrelated opportunity.
      if v_existing_opportunity_id is distinct from p_opportunity_id
        or v_existing_activity_id is distinct from p_activity_id
        or v_existing_connection_id is distinct from p_connection_id
        or v_existing_provider_thread_id is distinct from p_provider_thread_id
        or v_existing_direction is distinct from p_direction
      then
        raise exception 'correspondence_provider_identity_conflict'
          using errcode = '23505';
      end if;
      v_dedupe_hit := true;
      v_created := false;
      v_result_event_id := v_existing_event_id;
      -- Repair a legacy row that committed durable-but-unprojected (the exact
      -- state that stranded the 2026-07-22 outage). New writes can no longer
      -- reach opportunity_projection_applied = false, so this only ever fires
      -- for rows inserted before this RPC existed, and only for the same lead.
      if p_apply_opportunity_projection
        and coalesce(v_existing_projection_applied, true) = false
        and v_existing_opportunity_id = p_opportunity_id
      then
        v_should_project := true;
        v_projection_direction := v_existing_direction;
        v_projection_occurred_at := v_existing_occurred_at;
        v_projection_event_id := v_existing_event_id;
      end if;
    end if;
  end if;

  if not v_dedupe_hit then
    -- A durable event is a projected event: the counter projection runs in THIS
    -- transaction under the opportunity lock, so the pending flag is inserted
    -- true unconditionally. Import paths that seed aggregates themselves pass
    -- apply_opportunity_projection = false and still land a projected row (the
    -- prior two-step path also stored true in that case).
    insert into public.opportunity_correspondence_events (
      company_id,
      opportunity_id,
      activity_id,
      connection_id,
      provider_thread_id,
      provider_message_id,
      direction,
      party_role,
      is_meaningful,
      noise_reason,
      occurred_at,
      linked_contact_kind,
      linked_contact_id,
      source,
      opportunity_projection_applied,
      subject,
      from_email,
      to_emails,
      cc_emails
    ) values (
      p_company_id,
      p_opportunity_id,
      p_activity_id,
      p_connection_id,
      p_provider_thread_id,
      p_provider_message_id,
      p_direction,
      p_party_role,
      p_is_meaningful,
      p_noise_reason,
      p_occurred_at,
      p_linked_contact_kind,
      p_linked_contact_id,
      p_source,
      true,
      p_subject,
      p_from_email,
      coalesce(p_to_emails, '{}'::text[]),
      coalesce(p_cc_emails, '{}'::text[])
    )
    returning id into v_result_event_id;

    v_created := true;
    if p_apply_opportunity_projection then
      v_should_project := true;
      v_projection_direction := p_direction;
      v_projection_occurred_at := p_occurred_at;
      v_projection_event_id := v_result_event_id;
    end if;
  end if;

  if v_should_project then
    update public.opportunities opportunity
    set
      correspondence_count = coalesce(opportunity.correspondence_count, 0) + 1,
      inbound_count = coalesce(opportunity.inbound_count, 0)
        + case when v_projection_direction = 'inbound' then 1 else 0 end,
      outbound_count = coalesce(opportunity.outbound_count, 0)
        + case when v_projection_direction = 'outbound' then 1 else 0 end,
      last_message_direction = case
        when v_projection_occurred_at >= coalesce(
          greatest(opportunity.last_inbound_at, opportunity.last_outbound_at),
          '-infinity'::timestamptz
        )
        then case when v_projection_direction = 'inbound' then 'in' else 'out' end
        else opportunity.last_message_direction
      end,
      last_activity_at = case
        when opportunity.last_activity_at is null
          or v_projection_occurred_at > opportunity.last_activity_at
        then v_projection_occurred_at
        else opportunity.last_activity_at
      end,
      last_inbound_at = case
        when v_projection_direction = 'inbound'
          and (
            opportunity.last_inbound_at is null
            or v_projection_occurred_at > opportunity.last_inbound_at
          )
        then v_projection_occurred_at
        else opportunity.last_inbound_at
      end,
      last_outbound_at = case
        when v_projection_direction = 'outbound'
          and (
            opportunity.last_outbound_at is null
            or v_projection_occurred_at > opportunity.last_outbound_at
          )
        then v_projection_occurred_at
        else opportunity.last_outbound_at
      end,
      -- An inbound is evidence, not permission to erase an operator's lock.
      stage_manually_set = opportunity.stage_manually_set,
      updated_at = now()
    where opportunity.id = p_opportunity_id
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null;
    if not found then
      raise exception 'opportunity_not_found' using errcode = 'P0002';
    end if;

    update public.opportunity_correspondence_events
    set opportunity_projection_applied = true
    where id = v_projection_event_id
      and company_id = p_company_id;
  end if;

  return query
  select
    v_created,
    v_result_event_id,
    opportunity.correspondence_count,
    opportunity.inbound_count,
    opportunity.outbound_count,
    opportunity.stage,
    opportunity.stage_manually_set,
    opportunity.assignment_version,
    opportunity.last_inbound_at,
    opportunity.last_outbound_at,
    opportunity.last_message_direction
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null;
end;
$function$;

revoke all on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean
) from public, anon, authenticated;

grant execute on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean
) to service_role;

comment on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean
) is
  'Insert an opportunity correspondence event and project its counters in one '
  'transaction under the opportunity row lock. A durable event is always a '
  'projected event (opportunity_projection_applied is never persisted false), '
  'closing the two-step insert/projection gap that stranded a pending row and '
  'froze mailbox ingestion during the 2026-07-22 outage. Dedupe on the provider '
  'message id repairs legacy pre-RPC rows that are still unprojected.';

commit;
