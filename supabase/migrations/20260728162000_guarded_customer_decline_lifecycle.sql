-- Deterministic customer rejection lifecycle.
--
-- Local implementation only. Do not apply without explicit operator approval.
--
-- A decisive inbound rejection may close a nonterminal manual repair or
-- supersede an older engine-owned Lost disposition. It never overrides a
-- manual terminal decision, a Won/discarded terminal stage, a reassignment, or
-- correspondence newer than the evaluator's durable high-water mark.

begin;

create or replace function public.apply_email_opportunity_declined_disposition(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_expected_assignment_version bigint,
  p_expected_stage text,
  p_evidence jsonb default '{}'::jsonb
) returns table (
  changed boolean,
  stage text,
  disposition_id uuid,
  guard_reason text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_reason_code text;
  v_reason_notes text;
  v_evaluated_through_event_id uuid;
  v_evaluated_through_at timestamptz;
  v_decisive_event_id uuid;
  v_decisive_occurred_at timestamptz;
  v_existing_disposition_id uuid;
  v_existing_connection_id uuid;
  v_existing_provider_message_id text;
  v_existing_decisive_event_id uuid;
  v_existing_decisive_occurred_at timestamptz;
  v_is_disposition_update boolean := false;
  v_requested_evidence jsonb;
  v_new_disposition_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_company_id is null
    or p_opportunity_id is null
    or p_connection_id is null
    or nullif(btrim(p_provider_message_id), '') is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
    or nullif(btrim(p_expected_stage), '') is null
  then
    raise exception 'invalid declined disposition input'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_evidence) is distinct from 'object'
    or not (
      p_evidence ?& array[
        'reason_code',
        'signals',
        'evidence_message_ids',
        'evaluated_through_event_id'
      ]
      and p_evidence - array[
        'reason_code',
        'signals',
        'evidence_message_ids',
        'evaluated_through_event_id'
      ]::text[] = '{}'::jsonb
      and p_evidence ->> 'reason_code' in ('customer_declined', 'price')
      and p_evidence -> 'signals' = '["customer_declined"]'::jsonb
      and jsonb_typeof(p_evidence -> 'evidence_message_ids') = 'array'
      and p_evidence -> 'evidence_message_ids' ? p_provider_message_id
    )
  then
    raise exception 'invalid declined disposition evidence'
      using errcode = '22023';
  end if;

  v_reason_code := p_evidence ->> 'reason_code';
  v_reason_notes := case v_reason_code
    when 'price' then
      'Customer chose another provider for financial reasons.'
    else
      'Customer declined the work.'
  end;
  v_evaluated_through_event_id := private.try_parse_uuid(
    p_evidence ->> 'evaluated_through_event_id'
  );
  if v_evaluated_through_event_id is null then
    raise exception 'invalid declined disposition high-water evidence'
      using errcode = '22023';
  end if;

  -- Correspondence projection, assignment, and lifecycle writes share this
  -- opportunity lock. Every precedence decision below is therefore made from
  -- one serialized snapshot.
  select opportunity.*
    into v_opp
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if private.opportunity_has_pending_meaningful_email(
    p_company_id,
    p_opportunity_id
  ) then
    raise exception 'meaningful correspondence projection pending'
      using errcode = '40001';
  end if;

  select head.occurred_at
    into v_evaluated_through_at
    from public.opportunity_correspondence_events head
   where head.id = v_evaluated_through_event_id
     and head.company_id = p_company_id
     and head.opportunity_id = p_opportunity_id
     and head.is_meaningful is true
     and head.opportunity_projection_applied is true;
  if not found then
    raise exception 'declined disposition high-water evidence was not found'
      using errcode = '42501';
  end if;

  select event.id, event.occurred_at
    into v_decisive_event_id, v_decisive_occurred_at
    from public.email_connections connection
    join public.opportunity_correspondence_events event
      on event.connection_id = connection.id
     and event.company_id = p_company_id
     and event.opportunity_id = p_opportunity_id
     and event.provider_message_id = p_provider_message_id
     and event.direction = 'inbound'
     and event.party_role = 'customer'
     and private.opportunity_sender_is_persisted_customer(
       p_company_id,
       p_opportunity_id,
       event.from_email
     )
     and event.is_meaningful is true
     and event.opportunity_projection_applied is true
   where connection.id = p_connection_id
     and connection.company_id = p_company_id::text
     and connection.status = 'active'
     and connection.sync_enabled is true
   order by event.occurred_at desc, event.id desc
   limit 1;
  if not found or v_decisive_occurred_at is null then
    raise exception 'declined disposition evidence was not found'
      using errcode = '42501';
  end if;

  if v_decisive_occurred_at > v_evaluated_through_at
    or (
      v_decisive_occurred_at = v_evaluated_through_at
      and v_decisive_event_id > v_evaluated_through_event_id
    )
  then
    raise exception 'declined disposition high-water precedes decisive evidence'
      using errcode = '42501';
  end if;

  select disposition.id,
         private.try_parse_uuid(disposition.evidence ->> 'connection_id'),
         disposition.evidence ->> 'provider_message_id'
    into v_existing_disposition_id,
         v_existing_connection_id,
         v_existing_provider_message_id
    from public.opportunity_dispositions disposition
   where disposition.company_id = p_company_id
     and disposition.opportunity_id = p_opportunity_id
     and disposition.disposition = 'lost'
     and disposition.decided_via = 'guarded_lifecycle'
     and disposition.superseded_at is null
   order by disposition.created_at desc, disposition.id desc
   limit 1
   for update;

  if v_existing_connection_id is not null
    and nullif(v_existing_provider_message_id, '') is not null
  then
    select event.id, event.occurred_at
      into v_existing_decisive_event_id,
           v_existing_decisive_occurred_at
      from public.opportunity_correspondence_events event
     where event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.connection_id = v_existing_connection_id
       and event.provider_message_id = v_existing_provider_message_id
       and event.is_meaningful is true
       and event.opportunity_projection_applied is true
     order by event.occurred_at desc, event.id desc
     limit 1;
  end if;

  -- Assignment and a true operator terminal decision outrank retries and every
  -- actorless lifecycle write. A nonterminal manual stage remains eligible:
  -- that flag can represent a historical repair and must not suppress newer
  -- decisive customer evidence forever.
  if v_opp.assignment_version is distinct from p_expected_assignment_version then
    return query select
      false,
      v_opp.stage,
      v_existing_disposition_id,
      'assignment_snapshot_mismatch'::text;
    return;
  end if;

  if coalesce(v_opp.stage_manually_set, false)
    and v_opp.stage in ('won', 'lost', 'discarded')
  then
    return query select
      false,
      v_opp.stage,
      v_existing_disposition_id,
      'manual_terminal_stage'::text;
    return;
  end if;

  if v_opp.stage = 'lost'
    and v_existing_disposition_id is not null
    and v_existing_connection_id is not distinct from p_connection_id
    and v_existing_provider_message_id is not distinct from p_provider_message_id
  then
    return query select
      false,
      v_opp.stage,
      v_existing_disposition_id,
      'already_applied'::text;
    return;
  end if;

  -- An exact retry is decided above. Any later durable event invalidates a
  -- first apply or a genuinely new decline decision and forces a full
  -- opportunity-wide re-evaluation.
  if exists (
    select 1
    from public.opportunity_correspondence_events newer
    where newer.company_id = p_company_id
      and newer.opportunity_id = p_opportunity_id
      and newer.is_meaningful is true
      and newer.opportunity_projection_applied is true
      and (
        newer.occurred_at > v_evaluated_through_at
        or (
          newer.occurred_at = v_evaluated_through_at
          and newer.id > v_evaluated_through_event_id
        )
      )
  ) then
    raise exception 'declined disposition evidence is stale'
      using errcode = '40001';
  end if;

  if v_opp.stage is distinct from p_expected_stage then
    return query select
      false,
      v_opp.stage,
      v_existing_disposition_id,
      'snapshot_mismatch'::text;
    return;
  end if;

  if v_opp.stage in ('won', 'discarded') then
    return query select
      false,
      v_opp.stage,
      v_existing_disposition_id,
      'terminal_stage'::text;
    return;
  end if;

  if v_opp.stage = 'lost' then
    if v_existing_disposition_id is null
      or v_existing_decisive_occurred_at is null
    then
      return query select
        false,
        v_opp.stage,
        v_existing_disposition_id,
        'terminal_stage'::text;
      return;
    end if;

    if v_decisive_occurred_at < v_existing_decisive_occurred_at
      or (
        v_decisive_occurred_at = v_existing_decisive_occurred_at
        and v_decisive_event_id <= v_existing_decisive_event_id
      )
    then
      return query select
        false,
        v_opp.stage,
        v_existing_disposition_id,
        'terminal_stage'::text;
      return;
    end if;

    v_is_disposition_update := true;
  end if;

  v_requested_evidence := p_evidence || jsonb_build_object(
    'connection_id', p_connection_id,
    'provider_message_id', p_provider_message_id,
    'decisive_event_id', v_decisive_event_id
  );

  update public.opportunities
     set stage = 'lost',
         stage_entered_at = case
           when v_is_disposition_update then stage_entered_at
           else now()
         end,
         stage_manually_set = false,
         win_probability = 0,
         lost_reason = v_reason_code,
         lost_notes = v_reason_notes,
         next_follow_up_at = null,
         actual_close_date = case
           when v_is_disposition_update
             then coalesce(actual_close_date, now()::date)
           else now()::date
         end,
         updated_at = now()
   where id = p_opportunity_id
     and company_id = p_company_id;

  if not v_is_disposition_update then
    insert into public.stage_transitions (
      company_id,
      opportunity_id,
      from_stage,
      to_stage,
      transitioned_at,
      transitioned_by,
      duration_in_stage
    ) values (
      p_company_id,
      p_opportunity_id,
      v_opp.stage,
      'lost',
      now(),
      null,
      now() - coalesce(v_opp.stage_entered_at, now())
    );
  end if;

  update public.opportunity_dispositions
     set superseded_at = now()
   where opportunity_id = p_opportunity_id
     and company_id = p_company_id
     and superseded_at is null;

  insert into public.opportunity_dispositions (
    company_id,
    opportunity_id,
    disposition,
    reason_code,
    reason_notes,
    decided_via,
    decided_by,
    evidence
  ) values (
    p_company_id,
    p_opportunity_id,
    'lost',
    v_reason_code,
    v_reason_notes,
    'guarded_lifecycle',
    null,
    v_requested_evidence
  ) returning id into v_new_disposition_id;

  return query select
    not v_is_disposition_update,
    'lost'::text,
    v_new_disposition_id,
    case
      when v_is_disposition_update then 'disposition_updated'
      else null::text
    end;
end;
$function$;

revoke all on function public.apply_email_opportunity_declined_disposition(
  uuid, uuid, uuid, text, bigint, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_email_opportunity_declined_disposition(
  uuid, uuid, uuid, text, bigint, text, jsonb
) to service_role;

comment on function public.apply_email_opportunity_declined_disposition(
  uuid, uuid, uuid, text, bigint, text, jsonb
) is
  'Commits an evidence-backed customer rejection without overriding operator terminal truth.';

commit;
