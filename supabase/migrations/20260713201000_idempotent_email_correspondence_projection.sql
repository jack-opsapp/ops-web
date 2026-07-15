-- Exactly-once opportunity correspondence counters for provider-backed email.
--
-- The previous sync path inserted an activity/event and then called a separate
-- non-idempotent counter increment. A failure between those writes either left
-- the lead counters stale or double-incremented them when the provider message
-- was retried. Existing correspondence events are assumed already projected;
-- only new provider-ingestion events explicitly opt into the pending state.

begin;

alter table public.opportunity_correspondence_events
  add column if not exists opportunity_projection_applied boolean not null
    default true;

comment on column public.opportunity_correspondence_events.opportunity_projection_applied is
  'False only while a provider-ingestion event is waiting for its exactly-once opportunity counter projection. Legacy/backfill events default true.';

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
          greatest(
            opportunity.last_inbound_at,
            opportunity.last_outbound_at
          ),
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
      stage_manually_set = case
        when v_direction = 'inbound' and opportunity.stage_manually_set
          then false
        else opportunity.stage_manually_set
      end,
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
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.apply_opportunity_correspondence_event(
  uuid,
  uuid,
  uuid,
  text
) to service_role;

commit;
