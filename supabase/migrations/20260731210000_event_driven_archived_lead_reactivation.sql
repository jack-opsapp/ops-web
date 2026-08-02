-- A new, exact-thread, meaningful customer inbound is the reactivation event.
-- Process it inside the correspondence insert transaction so a later outbound
-- in the same catch-up batch cannot hide it from lifecycle evaluation.

begin;

do $prerequisites$
begin
  if to_regclass('public.opportunity_correspondence_events') is null
    or to_regclass('public.opportunity_email_threads') is null
    or to_regclass('public.unassigned_lead_assignment_deliveries') is null
    or to_regprocedure(
      'private.company_mailbox_intake_owner_is_eligible(uuid,uuid)'
    ) is null
    or to_regprocedure(
      'private.change_assignment_system_company_serialized_internal(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure('private.try_parse_uuid(text)') is null
  then
    raise exception 'event_driven_reactivation_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Keep the canonical opportunity-first lock order in the latest lifecycle
-- definition. Reactivation runs from the child insert, so correspondence
-- insertion and projection must continue to serialize behind the opportunity.
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
set search_path to 'pg_catalog', 'pg_temp'
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
) from public, anon, authenticated, service_role;
grant execute on function public.apply_opportunity_correspondence_event(
  uuid, uuid, uuid, text
) to service_role;

-- Assignment-required deliveries must be scoped to the exact assignment
-- version. A previously archived lead can legitimately have version > 0, and
-- an older prompt must never become authoritative after another reassignment.
alter table public.unassigned_lead_assignment_deliveries
  drop constraint if exists
    unassigned_lead_assignment_deliveries_assignment_version_check;

alter table public.unassigned_lead_assignment_deliveries
  add constraint
    unassigned_lead_assignment_deliveries_assignment_version_check
  check (assignment_version >= 0);

alter table public.unassigned_lead_assignment_deliveries
  drop constraint if exists
    unassigned_lead_assignment_de_opportunity_id_recipient_user_key;

alter table public.unassigned_lead_assignment_deliveries
  drop constraint if exists
    unassigned_lead_assignment_deliveries_opportunity_recipient_version_key;

alter table public.unassigned_lead_assignment_deliveries
  add constraint
    unassigned_lead_assignment_deliveries_opportunity_recipient_version_key
  unique (opportunity_id, recipient_user_id, assignment_version);

create or replace function private.enqueue_unassigned_lead_assignment_deliveries_at_version(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_assignment_version bigint
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_prompt_count integer;
begin
  if p_company_id is null
    or p_opportunity_id is null
    or p_connection_id is null
    or p_assignment_version is null
    or p_assignment_version < 0
  then
    raise exception 'unassigned_lead_prompt_identity_required'
      using errcode = '22023';
  end if;

  insert into public.unassigned_lead_assignment_deliveries (
    company_id,
    opportunity_id,
    connection_id,
    recipient_user_id,
    assignment_version
  )
  select
    p_company_id,
    p_opportunity_id,
    p_connection_id,
    recipient.id,
    p_assignment_version
  from public.users recipient
  where recipient.company_id = p_company_id
    and recipient.deleted_at is null
    and coalesce(recipient.is_active, false)
    and private.permission_user_is_admin(recipient.id, p_company_id)
    and private.raw_pipeline_scope_for_user(
      recipient.id, p_company_id, 'pipeline.view'
    ) = 'all'
    and private.raw_pipeline_scope_for_user(
      recipient.id, p_company_id, 'pipeline.edit'
    ) = 'all'
    and private.raw_pipeline_scope_for_user(
      recipient.id, p_company_id, 'pipeline.assign'
    ) = 'all'
  on conflict (
    opportunity_id, recipient_user_id, assignment_version
  ) do nothing;

  select count(*)::integer
    into v_prompt_count
    from public.unassigned_lead_assignment_deliveries delivery
   where delivery.company_id = p_company_id
     and delivery.opportunity_id = p_opportunity_id
     and delivery.connection_id = p_connection_id
     and delivery.assignment_version = p_assignment_version
     and delivery.disposition is distinct from 'assigned';

  return coalesce(v_prompt_count, 0);
end;
$function$;

-- Preserve the existing three-argument contract for genuinely new company
-- mailbox leads while making its version-zero intent explicit.
create or replace function private.enqueue_unassigned_lead_assignment_deliveries(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
) returns integer
language sql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.enqueue_unassigned_lead_assignment_deliveries_at_version(
    p_company_id,
    p_opportunity_id,
    p_connection_id,
    0
  );
$function$;

-- The delivery worker and its completion fence originally considered every
-- assignment version except zero stale. Replace that exact legacy predicate in
-- both functions and fail closed if repository/live definitions drift.
do $version_fence$
declare
  v_signature regprocedure;
  v_definition text;
  v_name text;
begin
  foreach v_name in array array[
    'public.claim_unassigned_lead_assignment_deliveries(uuid,integer,integer)',
    'public.complete_unassigned_lead_assignment_delivery(uuid,uuid,text)'
  ] loop
    v_signature := to_regprocedure(v_name);
    if v_signature is null then
      raise exception 'unassigned_lead_delivery_function_missing: %', v_name
        using errcode = '55000';
    end if;

    select pg_get_functiondef(v_signature) into v_definition;
    if position(
      'opportunity.assignment_version <> delivery.assignment_version'
      in v_definition
    ) = 0 then
      v_definition := replace(
        v_definition,
        'opportunity.assignment_version <> 0',
        'opportunity.assignment_version <> delivery.assignment_version'
      );
      if position(
        'opportunity.assignment_version <> delivery.assignment_version'
        in v_definition
      ) = 0 then
        raise exception 'unassigned_lead_delivery_version_fence_unrecognized: %',
          v_name using errcode = '55000';
      end if;
      execute v_definition;
    end if;
  end loop;
end;
$version_fence$;

create or replace function private.infer_email_correspondence_thread_relationship()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.linked_contact_kind is null
    and new.direction = 'inbound'
    and new.party_role = 'customer'
    and new.is_meaningful is true
    and new.connection_id is not null
    and exists (
      select 1
      from public.opportunity_email_threads exact_thread
      where exact_thread.opportunity_id = new.opportunity_id
        and exact_thread.connection_id = new.connection_id
        and exact_thread.thread_id = new.provider_thread_id
    )
  then
    new.linked_contact_kind := 'high_confidence_related_contact';
  end if;
  return new;
end;
$function$;

create or replace function private.reactivate_archived_email_opportunity_on_inbound()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  opportunity public.opportunities%rowtype;
  current_connection public.email_connections%rowtype;
  v_candidate_owner_id uuid;
  v_assignment_source text;
  v_assignment_result jsonb;
  v_assignment_version bigint;
  v_prompt_count integer;
begin
  if new.source <> 'sync_activity'
    or new.direction <> 'inbound'
    or new.party_role <> 'customer'
    or new.is_meaningful is not true
    or new.linked_contact_kind not in (
      'related_contact', 'high_confidence_related_contact'
    )
    or new.connection_id is null
  then
    return new;
  end if;

  select opportunity_row.*
    into opportunity
    from public.opportunities opportunity_row
   where opportunity_row.id = new.opportunity_id
     and opportunity_row.company_id = new.company_id
     and opportunity_row.deleted_at is null
   for update;

  if not found
    or opportunity.archived_at is null
    or new.occurred_at <= opportunity.archived_at
    or opportunity.stage not in (
      'new_lead', 'qualifying', 'quoting', 'quoted', 'follow_up', 'negotiation'
    )
    or opportunity.project_id is not null
    or opportunity.project_ref is not null
    or opportunity.merged_into_opportunity_id is not null
  then
    return new;
  end if;

  -- Re-prove the canonical relationship under the same transaction. Neither
  -- names nor contextual address metadata can act as relationship identity.
  if not exists (
    select 1
    from public.opportunity_email_threads exact_thread
    where exact_thread.opportunity_id = new.opportunity_id
      and exact_thread.connection_id = new.connection_id
      and exact_thread.thread_id = new.provider_thread_id
  ) then
    return new;
  end if;

  select connection.*
    into current_connection
    from public.email_connections connection
   where connection.id = new.connection_id
     and private.try_parse_uuid(connection.company_id) = new.company_id
   for share;

  if not found then
    raise exception 'reactivation_email_connection_missing'
      using errcode = '55000';
  end if;

  if opportunity.assigned_to is not null
    and private.company_mailbox_intake_owner_is_eligible(
      opportunity.assigned_to,
      opportunity.company_id
    )
  then
    v_candidate_owner_id := opportunity.assigned_to;
  elsif current_connection.type::text = 'company' then
    v_candidate_owner_id := current_connection.default_intake_owner_id;
    v_assignment_source := 'company_mailbox_default';
  else
    v_candidate_owner_id := private.try_parse_uuid(current_connection.user_id);
    v_assignment_source := 'personal_mailbox';
  end if;

  if v_candidate_owner_id is not null
    and not private.company_mailbox_intake_owner_is_eligible(
      v_candidate_owner_id,
      opportunity.company_id
    )
  then
    v_candidate_owner_id := null;
  end if;

  update public.opportunities opportunity_row
     set archived_at = null,
         updated_at = now()
   where opportunity_row.id = opportunity.id
     and opportunity_row.company_id = opportunity.company_id
     and opportunity_row.archived_at = opportunity.archived_at;

  if not found then
    raise exception 'reactivation_archive_snapshot_changed'
      using errcode = '40001';
  end if;

  v_assignment_version := opportunity.assignment_version;

  if v_candidate_owner_id is not null
    and opportunity.assigned_to is distinct from v_candidate_owner_id
  then
    v_assignment_result :=
      private.change_assignment_system_company_serialized_internal(
        p_opportunity_id => opportunity.id,
        p_expected_assignment_version => opportunity.assignment_version,
        p_expected_assigned_to => opportunity.assigned_to,
        p_new_assigned_to => v_candidate_owner_id,
        p_system_source => v_assignment_source,
        p_actor_user_id => null,
        p_suggestion_id => null,
        p_metadata => jsonb_build_object(
          'reason', 'meaningful_related_inbound_reactivation',
          'correspondence_event_id', new.id,
          'connection_id', new.connection_id,
          'provider_thread_id', new.provider_thread_id,
          'provider_message_id', new.provider_message_id
        )
      );

    if coalesce((v_assignment_result ->> 'ok')::boolean, false) is not true
      or coalesce((v_assignment_result ->> 'conflict')::boolean, false)
      or (v_assignment_result ->> 'assigned_to')::uuid
        is distinct from v_candidate_owner_id
    then
      raise exception 'reactivation_owner_assignment_failed'
        using errcode = '40001', detail = v_assignment_result::text;
    end if;
  elsif v_candidate_owner_id is null then
    if opportunity.assigned_to is not null then
      v_assignment_result :=
        private.change_assignment_system_company_serialized_internal(
          p_opportunity_id => opportunity.id,
          p_expected_assignment_version => opportunity.assignment_version,
          p_expected_assigned_to => opportunity.assigned_to,
          p_new_assigned_to => null,
          p_system_source => 'system_repair',
          p_actor_user_id => null,
          p_suggestion_id => null,
          p_metadata => jsonb_build_object(
            'reason', 'meaningful_related_inbound_reactivation_owner_ineligible',
            'correspondence_event_id', new.id,
            'connection_id', new.connection_id
          )
        );

      if coalesce((v_assignment_result ->> 'ok')::boolean, false) is not true
        or coalesce((v_assignment_result ->> 'conflict')::boolean, false)
        or (v_assignment_result ->> 'assigned_to')::uuid is not null
      then
        raise exception 'reactivation_ineligible_owner_clear_failed'
          using errcode = '40001', detail = v_assignment_result::text;
      end if;
      v_assignment_version :=
        (v_assignment_result ->> 'assignment_version')::bigint;
    end if;

    v_prompt_count :=
      private.enqueue_unassigned_lead_assignment_deliveries_at_version(
        opportunity.company_id,
        opportunity.id,
        new.connection_id,
        v_assignment_version
      );
    if v_prompt_count < 1 then
      raise exception 'reactivated_lead_assignment_review_recipient_missing'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists
  opportunity_correspondence_infer_exact_thread_relationship
  on public.opportunity_correspondence_events;
create trigger opportunity_correspondence_infer_exact_thread_relationship
before insert on public.opportunity_correspondence_events
for each row
execute function private.infer_email_correspondence_thread_relationship();

drop trigger if exists opportunity_correspondence_reactivate_archived_lead
  on public.opportunity_correspondence_events;
create trigger opportunity_correspondence_reactivate_archived_lead
after insert on public.opportunity_correspondence_events
for each row
execute function private.reactivate_archived_email_opportunity_on_inbound();

-- Stage evaluation must never create the impossible active-stage + archived
-- combination. Reactivation above clears archived_at first in the inbound event
-- transaction; every other stage caller receives a stable guard result.
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
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_from_stage text;
  v_stage_entered_at timestamptz;
  v_stage_manually_set boolean;
  v_assignment_version bigint;
  v_archived_at timestamptz;
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
         opportunity.assignment_version,
         opportunity.archived_at
    into v_from_stage, v_stage_entered_at, v_stage_manually_set,
         v_assignment_version, v_archived_at
    from public.opportunities opportunity
   where opportunity.id = p_opportunity_id
     and opportunity.company_id = p_company_id
     and opportunity.deleted_at is null
   for update;
  if not found then
    raise exception 'opportunity_not_found' using errcode = 'P0002';
  end if;

  if v_assignment_version is distinct from p_expected_assignment_version then
    return query select false, v_from_stage, v_stage_manually_set,
      'assignment_snapshot_mismatch'::text;
    return;
  end if;
  if coalesce(v_stage_manually_set, false) then
    return query select false, v_from_stage, v_stage_manually_set,
      'manual_stage_override'::text;
    return;
  end if;
  if v_archived_at is not null then
    return query select false, v_from_stage, v_stage_manually_set,
      'archived_opportunity'::text;
    return;
  end if;
  if v_from_stage = p_to_stage then
    return query select false, v_from_stage, v_stage_manually_set,
      'already_applied'::text;
    return;
  end if;
  if v_from_stage is distinct from p_expected_stage then
    return query select false, v_from_stage, v_stage_manually_set,
      'snapshot_mismatch'::text;
    return;
  end if;
  if v_from_stage in ('won', 'lost', 'discarded') then
    return query select false, v_from_stage, v_stage_manually_set,
      'terminal_stage'::text;
    return;
  end if;
  if p_to_stage = 'new_lead' and v_from_stage <> 'new_lead' then
    return query select false, v_from_stage, v_stage_manually_set,
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

revoke all on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean
) from public, anon, authenticated, service_role;
grant execute on function public.record_opportunity_correspondence_event(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, timestamptz,
  text, uuid, text, text, text, text[], text[], boolean
) to service_role;

revoke all on function public.apply_email_opportunity_stage_transition(
  uuid, uuid, text, text, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_email_opportunity_stage_transition(
  uuid, uuid, text, text, bigint, text
) to service_role;

revoke all on function public.claim_unassigned_lead_assignment_deliveries(
  uuid, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_unassigned_lead_assignment_deliveries(
  uuid, integer, integer
) to service_role;

revoke all on function public.complete_unassigned_lead_assignment_delivery(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_unassigned_lead_assignment_delivery(
  uuid, uuid, text
) to service_role;

revoke all on function private.infer_email_correspondence_thread_relationship()
  from public, anon, authenticated, service_role;
revoke all on function private.reactivate_archived_email_opportunity_on_inbound()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_unassigned_lead_assignment_deliveries_at_version(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated, service_role;

commit;
