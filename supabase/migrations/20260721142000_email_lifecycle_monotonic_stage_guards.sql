-- Email lifecycle hardening: correspondence never unlocks a manual stage,
-- `new_lead` is never reintroduced, and every other automated active-stage
-- transition is bound to the exact stage/assignment snapshot under row lock.

begin;

-- Provider ingestion persists the child event before projecting its counters.
-- Take the canonical opportunity lock at the insertion boundary so conversion,
-- deferral, merge, and projection all observe one serial order. A conversion
-- that owns the lock linearizes before a later event; an event that owns it
-- becomes visible (including its pending-projection state) before conversion.
create or replace function private.lock_opportunity_for_correspondence_insert()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  perform 1
  from public.opportunities opportunity
  where opportunity.id = new.opportunity_id
    and opportunity.company_id = new.company_id
    and opportunity.deleted_at is null
  for update;

  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  return new;
end;
$function$;

revoke all on function private.lock_opportunity_for_correspondence_insert()
  from public, anon, authenticated, service_role;

drop trigger if exists opportunity_correspondence_events_lock_opportunity_insert
  on public.opportunity_correspondence_events;
create trigger opportunity_correspondence_events_lock_opportunity_insert
before insert on public.opportunity_correspondence_events
for each row execute function private.lock_opportunity_for_correspondence_insert();

-- PostgreSQL cannot replace an existing RETURNS TABLE shape in place. Drop the
-- exact RPC identity transactionally before adding assignment_version below.
drop function if exists public.apply_opportunity_correspondence_event(
  uuid, uuid, uuid, text
);

create or replace function public.apply_opportunity_correspondence_event(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_message_id text
) returns table (
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
  v_event_id uuid;
  v_event_opportunity_id uuid;
  v_direction text;
  v_occurred_at timestamptz;
  v_projection_applied boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
    or p_opportunity_id is null
    or p_connection_id is null
    or nullif(btrim(p_provider_message_id), '') is null
  then
    raise exception 'company, opportunity, connection, and provider message ids are required'
      using errcode = '22023';
  end if;

  -- Match merge/conversion lock order: opportunity first, child event second.
  perform 1
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.company_id = p_company_id
    and opportunity.deleted_at is null
  for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  select
    event.id,
    event.opportunity_id,
    event.direction,
    event.occurred_at,
    event.opportunity_projection_applied
  into
    v_event_id,
    v_event_opportunity_id,
    v_direction,
    v_occurred_at,
    v_projection_applied
  from public.opportunity_correspondence_events event
  where event.company_id = p_company_id
    and event.connection_id = p_connection_id
    and event.provider_message_id = p_provider_message_id
  for update;

  if not found then
    raise exception 'correspondence_event_not_found' using errcode = 'P0002';
  end if;
  if v_event_opportunity_id is distinct from p_opportunity_id then
    raise exception 'correspondence event belongs to another opportunity'
      using errcode = '23503';
  end if;

  if not v_projection_applied then
    update public.opportunities opportunity
    set
      correspondence_count = coalesce(opportunity.correspondence_count, 0) + 1,
      inbound_count = coalesce(opportunity.inbound_count, 0)
        + case when v_direction = 'inbound' then 1 else 0 end,
      outbound_count = coalesce(opportunity.outbound_count, 0)
        + case when v_direction = 'outbound' then 1 else 0 end,
      last_message_direction = case
        when v_occurred_at >= coalesce(
          greatest(opportunity.last_inbound_at, opportunity.last_outbound_at),
          '-infinity'::timestamptz
        )
        then case when v_direction = 'inbound' then 'in' else 'out' end
        else opportunity.last_message_direction
      end,
      last_activity_at = case
        when opportunity.last_activity_at is null
          or v_occurred_at > opportunity.last_activity_at
        then v_occurred_at
        else opportunity.last_activity_at
      end,
      last_inbound_at = case
        when v_direction = 'inbound'
          and (
            opportunity.last_inbound_at is null
            or v_occurred_at > opportunity.last_inbound_at
          )
        then v_occurred_at
        else opportunity.last_inbound_at
      end,
      last_outbound_at = case
        when v_direction = 'outbound'
          and (
            opportunity.last_outbound_at is null
            or v_occurred_at > opportunity.last_outbound_at
          )
        then v_occurred_at
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
    where id = v_event_id
      and company_id = p_company_id;
  end if;

  return query
  select
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

revoke all on function public.apply_opportunity_correspondence_event(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.apply_opportunity_correspondence_event(
  uuid, uuid, uuid, text
) to service_role;

drop function if exists public.apply_email_opportunity_stage_transition(
  uuid, uuid, text, text
);

create or replace function public.apply_email_opportunity_stage_transition(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_to_stage text,
  p_expected_stage text,
  p_expected_assignment_version bigint,
  p_ai_signal text default null::text
) returns table (
  changed boolean,
  stage text,
  stage_manually_set boolean,
  guard_reason text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_from_stage text;
  v_stage_entered_at timestamptz;
  v_stage_manually_set boolean;
  v_assignment_version bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_company_id is null
    or p_opportunity_id is null
    or p_expected_stage is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
  then
    raise exception 'company, opportunity, stage, and assignment snapshots are required'
      using errcode = '22023';
  end if;
  if p_to_stage is null or p_to_stage not in (
    'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'
  ) then
    raise exception 'invalid active opportunity stage'
      using errcode = '22023';
  end if;

  select opportunity.stage,
         opportunity.stage_entered_at,
         opportunity.stage_manually_set,
         opportunity.assignment_version
    into v_from_stage, v_stage_entered_at, v_stage_manually_set,
         v_assignment_version
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  -- Reassignment and a later operator stage pin always outrank retry handling.
  -- The first successful call does not change either guard, so an unchanged
  -- retry can still bypass only the stage snapshot that it changed itself.
  if v_assignment_version is distinct from p_expected_assignment_version then
    return query select
      false, v_from_stage, v_stage_manually_set,
      'assignment_snapshot_mismatch'::text;
    return;
  end if;
  if coalesce(v_stage_manually_set, false) then
    return query select
      false, v_from_stage, v_stage_manually_set, 'manual_stage_override'::text;
    return;
  end if;
  if v_from_stage = p_to_stage then
    return query select
      false, v_from_stage, v_stage_manually_set, 'already_applied'::text;
    return;
  end if;
  if v_from_stage is distinct from p_expected_stage then
    return query select
      false, v_from_stage, v_stage_manually_set, 'snapshot_mismatch'::text;
    return;
  end if;
  if v_from_stage in ('won', 'lost', 'discarded') then
    return query select
      false, v_from_stage, v_stage_manually_set, 'terminal_stage'::text;
    return;
  end if;
  if p_to_stage = 'new_lead' and v_from_stage <> 'new_lead' then
    return query select
      false, v_from_stage, v_stage_manually_set,
      'new_lead_regression_blocked'::text;
    return;
  end if;

  update public.opportunities
     set stage = p_to_stage,
         stage_entered_at = now(),
         win_probability = case p_to_stage
           when 'new_lead' then 10
           when 'qualifying' then 20
           when 'quoting' then 40
           when 'quoted' then 60
           when 'follow_up' then 50
           when 'negotiation' then 75
         end,
         ai_stage_confidence = case
           when nullif(btrim(p_ai_signal), '') is not null then 1.0
           else ai_stage_confidence
         end,
         ai_stage_signals = case
           when nullif(btrim(p_ai_signal), '') is not null
             then array[p_ai_signal]
           else ai_stage_signals
         end,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id;

  insert into public.stage_transitions (
    company_id, opportunity_id, from_stage, to_stage, transitioned_at,
    transitioned_by, duration_in_stage
  ) values (
    p_company_id, p_opportunity_id, v_from_stage, p_to_stage, now(), null,
    now() - coalesce(v_stage_entered_at, now())
  );

  return query select true, p_to_stage, v_stage_manually_set, null::text;
end;
$function$;

revoke all on function public.apply_email_opportunity_stage_transition(
  uuid, uuid, text, text, bigint, text
) from public, anon, authenticated;
grant execute on function public.apply_email_opportunity_stage_transition(
  uuid, uuid, text, text, bigint, text
) to service_role;

commit;
