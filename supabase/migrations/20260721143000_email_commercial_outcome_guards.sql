-- Email commercial outcomes are committed only from durable, tenant-scoped
-- correspondence evidence. This migration is forward-only: it does not
-- backfill or mutate historical opportunities when applied.

begin;

-- Email dedupe needs a conservative street identity, not a global change to
-- address formatting. Number-led civic addresses stop after the first
-- canonical street-type token so an optional locality suffix cannot hide an
-- existing project, but explicit unit/suite/apartment/# identifiers are read
-- from the raw value before the shared normalizer intentionally strips them.
-- Non-civic/free-form addresses retain the complete global normalization and
-- therefore continue to fail closed on partial similarity.
create or replace function private.normalize_email_project_dedupe_address(
  p_address text
) returns text
language sql
immutable
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  with normalized as (
    select private.normalize_address(p_address) as value
  ), unit_identity as (
    select lower((regexp_match(
      coalesce(p_address, ''),
      '(^|[,\s]+)(apartment|suite|unit|ste|apt|#)\s*\.?\s*#?\s*([0-9a-z]+([-/][0-9a-z]+)*)',
      'i'
    ))[3]) as unit_identifier
  ), tokens as (
    select token.value, token.ordinality
    from normalized,
         regexp_split_to_table(normalized.value, '[[:space:]]+')
           with ordinality as token(value, ordinality)
    where token.value <> ''
  ), boundary as (
    select min(tokens.ordinality) as street_type_ordinality
    from tokens
    where tokens.value in (
      'avenue', 'street', 'road', 'boulevard', 'drive', 'crescent',
      'highway', 'place', 'court', 'lane', 'terrace', 'parkway', 'square'
    )
  ), street as (
    select case
      when normalized.value ~ '^[0-9]+[a-z]?([-/][0-9a-z]+)?[[:space:]]+'
        and boundary.street_type_ordinality is not null
      then (
        select string_agg(tokens.value, ' ' order by tokens.ordinality)
        from tokens
        where tokens.ordinality <= boundary.street_type_ordinality
      )
      else normalized.value
    end as street_identity
    from normalized cross join boundary
  )
  select case
    when unit_identity.unit_identifier is null then street.street_identity
    else street.street_identity || ' unit ' || unit_identity.unit_identifier
  end
  from street cross join unit_identity;
$function$;

revoke all on function private.normalize_email_project_dedupe_address(text)
  from public, anon, authenticated, service_role;

-- Actorless conversion and every active-project identity mutation use this
-- client-scoped transaction key. All acquisition sites fail with SQLSTATE
-- 40001 instead of waiting, so retryable serialization never forms a lock
-- cycle with the existing project/opportunity link triggers.
create or replace function private.email_project_dedupe_lock_key(
  p_company_id uuid,
  p_client_id uuid
) returns bigint
language sql
immutable
parallel safe
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select hashtextextended(
    'email-project-dedupe:'
      || p_company_id::text
      || ':' || p_client_id::text,
    0
  );
$function$;

revoke all on function private.email_project_dedupe_lock_key(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Every active-project identity mutation participates in the same company /
-- client transaction lock used by actorless email conversion. INSERT, UPDATE,
-- and DELETE all use non-blocking acquisition and ask the caller to retry with
-- SQLSTATE 40001 rather than creating a row-lock -> advisory-lock deadlock.
-- This preserves ordinary manual project behavior while making the email
-- scan/create decision serializable against concurrent project creation and
-- identity changes.
create or replace function private.serialize_project_email_identity_change()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_lock_acquired boolean;
begin
  if tg_op <> 'INSERT'
    and old.company_id is not null
    and old.client_id is not null
    and old.deleted_at is null
    and old.status in ('rfq', 'estimated', 'accepted', 'in_progress')
  then
    v_lock_acquired := pg_try_advisory_xact_lock(
      private.email_project_dedupe_lock_key(old.company_id, old.client_id)
    );
    if not v_lock_acquired then
      raise exception 'email_project_identity_busy'
        using errcode = '40001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.company_id is null
    or new.client_id is null
    or new.deleted_at is not null
    or new.status not in ('rfq', 'estimated', 'accepted', 'in_progress')
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_lock_acquired := pg_try_advisory_xact_lock(
      private.email_project_dedupe_lock_key(new.company_id, new.client_id)
    );
    if not v_lock_acquired then
      raise exception 'email_project_identity_busy'
        using errcode = '40001';
    end if;
  else
    v_lock_acquired := pg_try_advisory_xact_lock(
      private.email_project_dedupe_lock_key(new.company_id, new.client_id)
    );
    if not v_lock_acquired then
      raise exception 'email_project_identity_busy'
        using errcode = '40001';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.serialize_project_email_identity_change()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_serialize_email_identity_change
  on public.projects;
create trigger projects_serialize_email_identity_change
before insert or delete or update of
  company_id,
  client_id,
  address,
  status,
  deleted_at,
  opportunity_id,
  opportunity_ref
on public.projects
for each row execute function private.serialize_project_email_identity_change();

-- Opportunities carry an enforced canonical client_ref plus a legacy
-- client_id mirror. Historical rows may have only one side populated. Every
-- email lifecycle identity boundary uses this resolver so either one remains
-- valid while conflicting mirrors fail closed before customer data is trusted
-- or a project is selected/created.
create or replace function private.resolve_opportunity_client_id(
  p_client_ref uuid,
  p_client_id uuid
) returns uuid
language plpgsql
immutable
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if p_client_ref is not null
    and p_client_id is not null
    and p_client_ref is distinct from p_client_id
  then
    raise exception 'opportunity_client_mirrors_disagree'
      using errcode = '23505';
  end if;

  return coalesce(p_client_ref, p_client_id);
end;
$function$;

revoke all on function private.resolve_opportunity_client_id(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Correspondence classification is routing metadata, not identity proof. A
-- customer-authored commercial decision must also come from an address already
-- persisted on the opportunity, its owning client, or one of that client's
-- active alternate contacts. This deliberately excludes arbitrary external CCs
-- and vendor participants even if an upstream classifier labels them customer.
create or replace function private.opportunity_sender_is_persisted_customer(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_from_email text
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.opportunities opportunity
    left join public.clients owning_client
      on owning_client.id = private.resolve_opportunity_client_id(
        opportunity.client_ref,
        opportunity.client_id
      )
     and owning_client.company_id = opportunity.company_id
     and owning_client.deleted_at is null
    where opportunity.id = p_opportunity_id
      and opportunity.company_id = p_company_id
      and opportunity.deleted_at is null
      and nullif(lower(btrim(coalesce(p_from_email, ''))), '') is not null
      and (
        lower(btrim(coalesce(opportunity.contact_email, ''))) =
          lower(btrim(p_from_email))
        or lower(btrim(coalesce(owning_client.email, ''))) =
          lower(btrim(p_from_email))
        or exists (
          select 1
          from public.sub_clients alternate_contact
          where alternate_contact.company_id = opportunity.company_id
            and alternate_contact.client_id =
              private.resolve_opportunity_client_id(
              opportunity.client_ref,
              opportunity.client_id
            )
            and alternate_contact.deleted_at is null
            and lower(btrim(coalesce(alternate_contact.email, ''))) =
              lower(btrim(p_from_email))
        )
      )
  );
$function$;

revoke all on function private.opportunity_sender_is_persisted_customer(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

create or replace function private.opportunity_has_pending_meaningful_email(
  p_company_id uuid,
  p_opportunity_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.opportunity_correspondence_events event
    where event.company_id = p_company_id
      and event.opportunity_id = p_opportunity_id
      and event.is_meaningful is true
      and event.opportunity_projection_applied is false
  );
$function$;

revoke all on function private.opportunity_has_pending_meaningful_email(
  uuid, uuid
) from public, anon, authenticated, service_role;

-- Migration-time pure contract: optional locality text cannot split the same
-- number-led street while the shared normalize_address behavior stays intact.
do $email_dedupe_contract$
begin
  if private.normalize_email_project_dedupe_address('123 Example St')
    is distinct from
    private.normalize_email_project_dedupe_address(
      '123 Example Street, Example City BC'
    )
  then
    raise exception 'email project street identity normalization is inconsistent';
  end if;

  if private.normalize_email_project_dedupe_address(
      '123 Example St, Apartment 2, Example City BC'
    ) is distinct from
    private.normalize_email_project_dedupe_address('123 Example Street Unit 2')
  then
    raise exception 'email project unit identity normalization is inconsistent';
  end if;

  if private.normalize_email_project_dedupe_address('123 Example Street Unit 2')
    is not distinct from
    private.normalize_email_project_dedupe_address('123 Example St #3')
  then
    raise exception 'email project unit identity normalization merged distinct units';
  end if;
end;
$email_dedupe_contract$;

-- Strengthen the existing actorless authorization helper: an email_accept
-- conversion must cite one exact meaningful correspondence event and the
-- opportunity-wide event high-water mark observed by the evaluator. Email
-- text remains untrusted; durable mailbox direction plus persisted customer
-- sender identity are authorization evidence.
create or replace function private.valid_actorless_opportunity_conversion_evidence(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_path text,
  p_evidence jsonb
) returns boolean
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_connection_id uuid;
  v_email_thread_id uuid;
  v_decisive_event_id uuid;
  v_evaluated_through_event_id uuid;
  v_evaluated_through_at timestamptz;
  v_conversion_completed boolean := false;
  v_has_newer_event boolean := false;
begin
  if jsonb_typeof(p_evidence) is distinct from 'object' then
    return false;
  end if;

  v_connection_id := private.try_parse_uuid(p_evidence ->> 'connection_id');
  if v_connection_id is null then
    return false;
  end if;

  if p_source_path = 'email_accept' then
    if not (
      p_evidence ?& array[
        'connection_id',
        'email_thread_id',
        'provider_thread_id',
        'provider_message_id',
        'decisive_event_id',
        'decisive_direction',
        'evaluated_through_event_id',
        'signals',
        'decision'
      ]
      and p_evidence - array[
        'connection_id',
        'email_thread_id',
        'provider_thread_id',
        'provider_message_id',
        'decisive_event_id',
        'decisive_direction',
        'evaluated_through_event_id',
        'signals',
        'decision'
      ]::text[] = '{}'::jsonb
      and p_evidence ->> 'decision' = 'auto_advance_won'
      and p_evidence ->> 'decisive_direction' in ('inbound', 'outbound')
      and nullif(p_evidence ->> 'provider_thread_id', '') is not null
      and nullif(p_evidence ->> 'provider_message_id', '') is not null
      and jsonb_typeof(p_evidence -> 'signals') = 'array'
      and jsonb_array_length(p_evidence -> 'signals') > 0
      and not exists (
        select 1
        from jsonb_array_elements_text(p_evidence -> 'signals') signal(value)
        where signal.value is null
          or signal.value not in (
          'explicit_acceptance',
          'schedule_confirmed',
          'deposit_requested',
          'payment_confirmed',
          'signed_estimate'
        )
      )
    ) then
      return false;
    end if;

    v_email_thread_id := private.try_parse_uuid(
      p_evidence ->> 'email_thread_id'
    );
    -- Provider message ids are opaque. The separate durable event UUID is the
    -- evaluator's mailbox-scoped authorization key.
    v_decisive_event_id := private.try_parse_uuid(
      p_evidence ->> 'decisive_event_id'
    );
    v_evaluated_through_event_id := private.try_parse_uuid(
      p_evidence ->> 'evaluated_through_event_id'
    );
    if v_email_thread_id is null
      or v_decisive_event_id is null
      or v_evaluated_through_event_id is null
    then
      return false;
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
      return false;
    end if;

    select exists (
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
    ) into v_has_newer_event;
    if v_has_newer_event then
      select exists (
        select 1
        from public.opportunity_conversion_events conversion_event
        where conversion_event.company_id = p_company_id
          and conversion_event.opportunity_id = p_opportunity_id
          and conversion_event.event_type = 'converted_to_project'
      ) into v_conversion_completed;
    end if;
    if v_has_newer_event and not v_conversion_completed then
      return false;
    end if;

    return exists (
      select 1
      from public.email_connections connection
      join public.email_threads thread
        on thread.connection_id = connection.id
       and thread.company_id = p_company_id
       and thread.id = v_email_thread_id
       and thread.provider_thread_id = p_evidence ->> 'provider_thread_id'
       and thread.opportunity_id = p_opportunity_id
      join public.opportunity_correspondence_events event
        on event.id = v_decisive_event_id
       and event.connection_id = connection.id
       and event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.provider_thread_id = thread.provider_thread_id
       and event.provider_message_id = p_evidence ->> 'provider_message_id'
       and event.direction = p_evidence ->> 'decisive_direction'
       and event.is_meaningful is true
       and event.opportunity_projection_applied is true
       and (
         (
           event.direction = 'inbound'
           and event.party_role = 'customer'
           and private.opportunity_sender_is_persisted_customer(
             p_company_id,
             p_opportunity_id,
             event.from_email
           )
         )
         or (
           event.direction = 'outbound'
           and event.party_role = 'ops'
           and not (
             p_evidence -> 'signals' ?| array[
               'explicit_acceptance',
               'deposit_requested',
               'signed_estimate'
             ]
           )
         )
       )
       and (
         not (p_evidence -> 'signals' ? 'signed_estimate')
         or exists (
           select 1
           from public.email_attachments attachment
           join public.attachment_inspections inspection
             on inspection.email_attachment_id = attachment.id
            and inspection.company_id = attachment.company_id
            and inspection.connection_id = attachment.connection_id
            and inspection.message_id = attachment.message_id
            and inspection.attachment_id = attachment.attachment_id
            and inspection.provider_thread_id = attachment.provider_thread_id
            and inspection.is_signed_estimate is true
           where attachment.company_id = p_company_id
             and attachment.connection_id = connection.id
             and attachment.message_id = event.provider_message_id
             and attachment.provider_thread_id = thread.provider_thread_id
             and attachment.opportunity_id = p_opportunity_id
             and attachment.attribution_status = 'attributed'
         )
       )
      where connection.id = v_connection_id
        and connection.company_id = p_company_id::text
        and connection.status = 'active'
        and connection.sync_enabled is true
    );
  end if;

  return false;
end;
$function$;

revoke all on function private.valid_actorless_opportunity_conversion_evidence(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.apply_email_opportunity_deferred_disposition(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid,
  p_provider_message_id text,
  p_expected_assignment_version bigint,
  p_expected_stage text,
  p_next_follow_up_at timestamptz,
  p_evidence jsonb default '{}'::jsonb
) returns table (
  changed boolean,
  stage text,
  next_follow_up_at timestamptz,
  disposition_id uuid,
  guard_reason text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_existing_disposition_id uuid;
  v_existing_connection_id uuid;
  v_existing_provider_message_id text;
  v_requested_evidence jsonb;
  v_new_disposition_id uuid;
  v_is_redeferral boolean := false;
  v_has_evidence boolean := false;
  v_evaluated_through_event_id uuid;
  v_evaluated_through_at timestamptz;
  v_decisive_occurred_at timestamptz;
  v_max_follow_up_at timestamptz;
  v_effective_follow_up_at timestamptz;
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
    or p_next_follow_up_at is null
  then
    raise exception 'invalid deferred disposition input'
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
      and p_evidence ->> 'reason_code' = 'budget_timing'
      and jsonb_typeof(p_evidence -> 'signals') = 'array'
      and p_evidence -> 'signals' ? 'budget_timing_deferral'
      and jsonb_typeof(p_evidence -> 'evidence_message_ids') = 'array'
      and p_evidence -> 'evidence_message_ids' ? p_provider_message_id
    )
  then
    raise exception 'invalid deferred disposition evidence'
      using errcode = '22023';
  end if;

  v_evaluated_through_event_id := private.try_parse_uuid(
    p_evidence ->> 'evaluated_through_event_id'
  );
  if v_evaluated_through_event_id is null then
    raise exception 'invalid deferred disposition high-water evidence'
      using errcode = '22023';
  end if;

  -- Serialize every evidence and retry decision behind the same opportunity
  -- lock taken first by correspondence projection and merge paths.
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

  -- Event insertion takes this same opportunity lock. Therefore a pending row
  -- found here is a durable newer fact, while an insertion that starts after
  -- this check is serialized after the disposition transaction.
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
    raise exception 'deferred disposition high-water evidence was not found'
      using errcode = '42501';
  end if;

  select event.occurred_at
    into v_decisive_occurred_at
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
  v_has_evidence := found;
  if not v_has_evidence or v_decisive_occurred_at is null then
    raise exception 'deferred disposition evidence was not found'
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
     and disposition.reason_code = 'budget_timing'
     and disposition.decided_via = 'guarded_lifecycle'
     and disposition.superseded_at is null
   order by disposition.created_at desc, disposition.id desc
   limit 1
   for update;

  -- Reassignment and a later operator stage pin always outrank retry handling.
  -- Neither is changed by this RPC, so a legitimate retry still succeeds while
  -- a stale worker can never hide an intervening ownership/manual decision.
  if v_opp.assignment_version is distinct from p_expected_assignment_version then
    return query select
      false,
      v_opp.stage,
      v_opp.next_follow_up_at,
      v_existing_disposition_id,
      'assignment_snapshot_mismatch'::text;
    return;
  end if;

  if coalesce(v_opp.stage_manually_set, false) then
    return query select
      false,
      v_opp.stage,
      v_opp.next_follow_up_at,
      v_existing_disposition_id,
      'manual_stage_override'::text;
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
      v_opp.next_follow_up_at,
      v_existing_disposition_id,
      'already_applied'::text;
    return;
  end if;

  -- A provider message is the immutable idempotency key inside its mailbox.
  -- The same decisive deferral remains an exact retry even when a later neutral
  -- event expands the evaluator high-water mark. A genuinely new re-deferral
  -- carries a different provider message id and continues through this guard.
  -- A newer event invalidates only a first apply or a new re-deferral.
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
    raise exception 'deferred disposition evidence is stale'
      using errcode = '40001';
  end if;

  if v_opp.stage is distinct from p_expected_stage then
    return query select
      false,
      v_opp.stage,
      v_opp.next_follow_up_at,
      v_existing_disposition_id,
      'snapshot_mismatch'::text;
    return;
  end if;

  v_is_redeferral := v_opp.stage = 'lost'
    and v_existing_disposition_id is not null;

  if v_opp.stage in ('won', 'lost', 'discarded')
    and not v_is_redeferral
  then
    return query select
      false,
      v_opp.stage,
      v_opp.next_follow_up_at,
      v_existing_disposition_id,
      'terminal_stage'::text;
    return;
  end if;

  if p_next_follow_up_at <= v_decisive_occurred_at then
    raise exception 'invalid deferred follow-up date'
      using errcode = '22023';
  end if;

  -- The evaluator and guarded write share one immutable, calendar-month
  -- horizon. Long-term customer timing remains evidence, while the operational
  -- reminder is clamped instead of becoming a permanently failing retry.
  v_max_follow_up_at := (
    (v_decisive_occurred_at at time zone 'UTC') + interval '18 months'
  ) at time zone 'UTC';
  v_effective_follow_up_at := least(
    p_next_follow_up_at,
    v_max_follow_up_at
  );
  v_requested_evidence := p_evidence || jsonb_build_object(
    'connection_id', p_connection_id,
    'provider_message_id', p_provider_message_id,
    'next_follow_up_at', v_effective_follow_up_at,
    'requested_next_follow_up_at', p_next_follow_up_at
  );

  if v_is_redeferral then
    update public.opportunities
       set lost_reason = 'budget_timing',
           lost_notes = 'Customer deferred the work to a future budget cycle.',
           next_follow_up_at = v_effective_follow_up_at,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;
  else
    update public.opportunities
       set stage = 'lost',
           stage_entered_at = now(),
           win_probability = 0,
           lost_reason = 'budget_timing',
           lost_notes = 'Customer deferred the work to a future budget cycle.',
           next_follow_up_at = v_effective_follow_up_at,
           actual_close_date = now()::date,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;

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
    'budget_timing',
    'Customer deferred the work to a future budget cycle.',
    'guarded_lifecycle',
    null,
    v_requested_evidence
  ) returning id into v_new_disposition_id;

  return query select
    not v_is_redeferral,
    'lost'::text,
    v_effective_follow_up_at,
    v_new_disposition_id,
    case when v_is_redeferral then 'follow_up_updated' else null::text end;
end;
$function$;

revoke all on function public.apply_email_opportunity_deferred_disposition(
  uuid, uuid, uuid, text, bigint, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_email_opportunity_deferred_disposition(
  uuid, uuid, uuid, text, bigint, text, timestamptz, jsonb
) to service_role;

-- Retain the hardened conversion wrapper and open its existing-project branch
-- to actorless email conversion only when the same locked row proves exact
-- client, active status, empty opportunity links, and normalized address.
create or replace function public.convert_opportunity_to_project(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_actual_value numeric default null::numeric,
  p_expected_stage text default null::text,
  p_decided_by uuid default null::uuid,
  p_notes text default null::text,
  p_title_override text default null::text,
  p_link_to_project_id uuid default null::uuid,
  p_source_path text default null::text,
  p_win_opportunity boolean default true,
  p_project_status text default null::text,
  p_evidence jsonb default '{}'::jsonb,
  p_expected_assignment_version bigint default null::bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opp public.opportunities%rowtype;
  v_target public.projects%rowtype;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_actor_user_id uuid;
  v_actor_company_id uuid;
  v_result jsonb;
  v_project_id uuid;
  v_link_to_project_id uuid := p_link_to_project_id;
  v_matched_project_id uuid;
  v_candidate_count integer := 0;
  v_candidate_has_conflicting_link boolean := false;
  v_target_legacy_opportunity_id uuid;
  v_initial_client_id uuid;
  v_initial_normalized_address text;
  v_initial_project_id uuid;
  v_conversion_event_id uuid;
  v_existing_conversion_complete boolean := false;
  v_existing_conversion_actor_id uuid;
  v_existing_conversion_evidence jsonb;
  v_exact_completed_retry boolean := false;
  v_existing_linked_existing boolean := false;
  v_project_accessible boolean := false;
  v_dedupe_lock_acquired boolean := false;
begin
  if p_company_id is null or p_opportunity_id is null then
    raise exception 'company and opportunity ids are required'
      using errcode = '22023';
  end if;

  select *
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id;

  if not found or v_opp.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;
  v_initial_client_id := private.resolve_opportunity_client_id(
    v_opp.client_ref,
    v_opp.client_id
  );
  v_initial_normalized_address :=
    private.normalize_email_project_dedupe_address(v_opp.address);
  if v_opp.project_ref is not null
    and v_opp.project_id is not null
    and v_opp.project_ref is distinct from v_opp.project_id
  then
    raise exception 'opportunity project mirrors disagree'
      using errcode = '23505';
  end if;
  v_initial_project_id := coalesce(v_opp.project_ref, v_opp.project_id);

  if v_is_service then
    if p_expected_assignment_version is null
      or p_expected_assignment_version < 0
    then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;

    if p_decided_by is not null then
      if p_source_path not in ('won_dialog', 'approval_queue')
        or not private.user_can_convert_opportunity(
          p_decided_by,
          p_opportunity_id
        )
      then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
      v_actor_user_id := p_decided_by;
    else
      -- Model-only likely-Won labels remain review notifications. Only the
      -- deterministic complete-conversation decision may authorize an
      -- actorless conversion.
      if p_source_path <> 'email_accept' then
        raise exception 'access_denied'
          using errcode = '42501';
      end if;
    end if;
  else
    v_actor_user_id := private.get_current_user_id();
    v_actor_company_id := private.get_user_company_id();

    if v_actor_user_id is null
      or v_actor_company_id is distinct from p_company_id
      or p_source_path not in ('won_dialog', 'approval_queue', 'ios')
      or (
        p_decided_by is not null
        and p_decided_by is distinct from v_actor_user_id
      )
      or not private.user_can_convert_opportunity(
        v_actor_user_id,
        p_opportunity_id
      )
    then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    if p_expected_assignment_version is null
      and p_source_path is distinct from 'ios'
    then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;
    if p_expected_assignment_version < 0 then
      raise exception 'invalid_assignment_snapshot'
        using errcode = '22023';
    end if;
  end if;

  -- Existing-project conversions follow project -> opportunity lock order,
  -- matching the bidirectional link trigger. Every actorless create is also
  -- serialized by client. Addressed leads inspect every active exact-street
  -- match (including already-linked rows); no-address leads inspect every active
  -- client project and may create only when that exhaustive set is empty.
  if v_actor_user_id is null and v_initial_client_id is null then
    raise exception 'project_link_unavailable: dedupe_proof_unavailable'
      using errcode = 'P0002';
  end if;

  if v_initial_project_id is not null then
    select target.*
      into v_target
      from public.projects target
     where target.id = v_initial_project_id
       and target.company_id = p_company_id
       and target.deleted_at is null
     for update;
    if not found then
      raise exception 'project_link_unavailable'
        using errcode = 'P0002';
    end if;
    if v_link_to_project_id is not null
      and v_link_to_project_id is distinct from v_initial_project_id
    then
      raise exception 'opportunity is already linked to another project'
        using errcode = '23505';
    end if;
    v_link_to_project_id := v_initial_project_id;
  elsif v_actor_user_id is null then
    v_dedupe_lock_acquired := pg_try_advisory_xact_lock(
      private.email_project_dedupe_lock_key(
        p_company_id,
        v_initial_client_id
      )
    );
    if not v_dedupe_lock_acquired then
      raise exception 'email_project_identity_busy'
        using errcode = '40001';
    end if;

    -- A caller-proposed existing project is only a hint. Re-prove that it is
    -- the active project for this exact client/street identity.
    if v_link_to_project_id is not null then
      if nullif(v_initial_normalized_address, '') is null then
        raise exception 'project_link_unavailable: dedupe_proof_unavailable'
          using errcode = 'P0002';
      end if;

      select target.*
        into v_target
        from public.projects target
       where target.id = v_link_to_project_id
         and target.company_id = p_company_id
         and target.client_id = v_initial_client_id
         and target.deleted_at is null
         and target.status in ('rfq', 'estimated', 'accepted', 'in_progress')
         and private.normalize_email_project_dedupe_address(target.address) =
           v_initial_normalized_address
       for update;

      if not found then
        raise exception 'project_link_unavailable'
          using errcode = 'P0002';
      end if;
    end if;

    if nullif(v_initial_normalized_address, '') is null then
      for v_target in
        select target.*
        from public.projects target
        where target.company_id = p_company_id
          and target.client_id = v_initial_client_id
          and target.deleted_at is null
          and target.status in ('rfq', 'estimated', 'accepted', 'in_progress')
        order by target.id
        for update
      loop
        v_candidate_count := v_candidate_count + 1;
      end loop;

      if v_candidate_count > 0 then
        raise exception 'project_link_unavailable: dedupe_proof_unavailable'
          using errcode = 'P0002';
      end if;
    else
      for v_target in
        select target.*
        from public.projects target
        where target.company_id = p_company_id
          and target.client_id = v_initial_client_id
          and target.deleted_at is null
          and target.status in ('rfq', 'estimated', 'accepted', 'in_progress')
          and private.normalize_email_project_dedupe_address(target.address) =
            v_initial_normalized_address
        order by target.id
        for update
      loop
        v_candidate_count := v_candidate_count + 1;
        v_matched_project_id := v_target.id;
        v_target_legacy_opportunity_id := private.try_parse_uuid(
          v_target.opportunity_id::text
        );

        -- A non-empty malformed legacy mirror or either mirror pointing at a
        -- different lead makes this street unsafe. A one-way link to this same
        -- opportunity is repairable and remains the sole candidate.
        if (
          nullif(btrim(v_target.opportunity_id::text), '') is not null
          and v_target_legacy_opportunity_id is null
        ) or (
          v_target.opportunity_ref is not null
          and v_target.opportunity_ref is distinct from p_opportunity_id
        ) or (
          v_target_legacy_opportunity_id is not null
          and v_target_legacy_opportunity_id is distinct from p_opportunity_id
        ) then
          v_candidate_has_conflicting_link := true;
        end if;
      end loop;

      if v_candidate_has_conflicting_link then
        raise exception 'project_link_unavailable: matching_project_link_conflict'
          using errcode = 'P0002';
      end if;
      if v_candidate_count > 1 then
        raise exception 'project_link_ambiguous'
          using errcode = 'P0003';
      end if;
      if v_candidate_count = 1 then
        if v_link_to_project_id is not null
          and v_link_to_project_id is distinct from v_matched_project_id
        then
          raise exception 'project_link_unavailable'
            using errcode = 'P0002';
        end if;
        v_link_to_project_id := v_matched_project_id;
      end if;
    end if;
  elsif v_link_to_project_id is not null then
    select target.*
      into v_target
      from public.projects target
     where target.id = v_link_to_project_id
       and target.company_id = p_company_id
       and target.deleted_at is null
     for update;

    if not found then
      raise exception 'project_link_unavailable'
        using errcode = 'P0002';
    end if;
  end if;

  select *
    into v_opp
    from public.opportunities o
   where o.id = p_opportunity_id
     and o.company_id = p_company_id
   for update;

  if not found or v_opp.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;
  if coalesce(v_opp.project_ref, v_opp.project_id) is distinct from
    v_initial_project_id
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;
  if v_actor_user_id is null
    and (
      private.resolve_opportunity_client_id(
        v_opp.client_ref,
        v_opp.client_id
      ) is distinct from v_initial_client_id
      or private.normalize_email_project_dedupe_address(v_opp.address)
        is distinct from
        v_initial_normalized_address
    )
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  -- The BEFORE INSERT correspondence trigger takes the same opportunity lock,
  -- closing the gap between durable insertion and counter projection. Never
  -- decide a commercial outcome while any meaningful event is pending.
  if v_actor_user_id is null
    and private.opportunity_has_pending_meaningful_email(
      p_company_id,
      p_opportunity_id
    )
  then
    raise exception 'meaningful correspondence projection pending'
      using errcode = '40001';
  end if;

  -- Revalidate durable evidence only after the opportunity lock. New
  -- correspondence projections take the same lock, so the high-water check
  -- and conversion are serialized.
  if v_is_service
    and p_decided_by is null
    and not private.valid_actorless_opportunity_conversion_evidence(
      p_company_id,
      p_opportunity_id,
      p_source_path,
      coalesce(p_evidence, '{}'::jsonb)
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  -- Authorization was initially checked before project-first locking. Repeat it
  -- from the locked opportunity snapshot so assignment-scoped and snapshotless
  -- iOS callers cannot win a race with reassignment.
  if v_actor_user_id is not null
    and not private.user_can_convert_opportunity(
      v_actor_user_id,
      p_opportunity_id
    )
  then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_expected_assignment_version is not null
    and v_opp.assignment_version is distinct from p_expected_assignment_version
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'assignment_snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  -- A project pointer is not proof that conversion completed. Only the durable
  -- canonical event establishes completion; its linked disposition binds an
  -- actorless repair retry to the exact original email decision.
  if v_link_to_project_id is not null then
    select event.id,
           event.actor_user_id,
           disposition.evidence
      into v_conversion_event_id,
           v_existing_conversion_actor_id,
           v_existing_conversion_evidence
      from public.opportunity_conversion_events event
      left join public.opportunity_dispositions disposition
        on disposition.id = private.try_parse_uuid(
          event.payload ->> 'disposition_id'
        )
       and disposition.company_id = event.company_id
       and disposition.opportunity_id = event.opportunity_id
       and disposition.converted_project_ref = event.project_id
     where event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.project_id = v_link_to_project_id
       and event.event_type = 'converted_to_project'
     order by event.created_at desc, event.id desc
     limit 1;

    v_existing_conversion_complete := found;
    v_exact_completed_retry := v_existing_conversion_complete
      and v_actor_user_id is null
      and v_existing_conversion_actor_id is null
      and v_opp.stage = 'won'
      and coalesce(
        v_existing_conversion_evidence ->> 'source_path' = 'email_accept'
        and v_existing_conversion_evidence @> coalesce(
          p_evidence,
          '{}'::jsonb
        ),
        false
      );
  end if;

  -- A canonical actorless completion sets the Won stage lock itself. Only an
  -- exact retry of that completion may pass it; a mere project pointer or any
  -- later/different email decision remains subordinate to the operator lock.
  if v_actor_user_id is null
    and coalesce(v_opp.stage_manually_set, false)
    and not v_exact_completed_retry
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'manual_stage_override',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  if p_expected_stage is not null
    and v_opp.stage is distinct from p_expected_stage
    and not v_exact_completed_retry
    and not (
      v_actor_user_id is not null
      and v_initial_project_id is not null
    )
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'snapshot_mismatch',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  -- A guarded budget/timing Lost lead may reopen from new customer evidence.
  -- An OPS-authored schedule confirmation alone is not customer commitment;
  -- an OPS-authored confirmed payment is unequivocal and may reactivate it.
  if v_actor_user_id is null
    and not v_exact_completed_retry
    and (
      v_existing_conversion_complete
      or (
        v_opp.stage in ('won', 'lost', 'discarded')
        and not (
          v_opp.stage = 'lost'
          and exists (
            select 1
            from public.opportunity_dispositions disposition
            where disposition.company_id = p_company_id
              and disposition.opportunity_id = p_opportunity_id
              and disposition.disposition = 'lost'
              and disposition.reason_code = 'budget_timing'
              and disposition.decided_via = 'guarded_lifecycle'
              and disposition.superseded_at is null
          )
          and (
            p_evidence ->> 'decisive_direction' = 'inbound'
            or p_evidence -> 'signals' ? 'payment_confirmed'
          )
        )
      )
    )
  then
    return jsonb_build_object(
      'converted', false,
      'already_converted', false,
      'guard_reason', 'terminal_stage',
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'project_accessible', false
    );
  end if;

  -- The preserved conversion core creates a new project from the legacy
  -- client_id mirror. Repair only a missing side of an already-validated
  -- canonical identity inside this conversion transaction; any failure later
  -- rolls this repair back with the conversion.
  if v_actor_user_id is null
    and (
      v_opp.client_ref is null
      or v_opp.client_id is null
    )
  then
    update public.opportunities opportunity
       set client_ref = v_initial_client_id,
           client_id = v_initial_client_id,
           updated_at = now()
     where opportunity.id = p_opportunity_id
       and opportunity.company_id = p_company_id
       and private.resolve_opportunity_client_id(
         opportunity.client_ref,
         opportunity.client_id
       ) = v_initial_client_id;
    if not found then
      raise exception 'opportunity_client_snapshot_mismatch'
        using errcode = '40001';
    end if;
    v_opp.client_ref := v_initial_client_id;
    v_opp.client_id := v_initial_client_id;
  end if;

  -- Completed conversions may run the canonical idempotent repair core only
  -- after every locked authorization/snapshot/terminal guard above. Preserve
  -- the existing human recovery path, but never mistake an actorless one-way
  -- project link with no conversion event for a completed conversion.
  if v_link_to_project_id is not null
    and (
      (
        v_actor_user_id is null
        and v_exact_completed_retry
      )
      or (
        v_actor_user_id is not null
        and v_initial_project_id is not null
      )
    )
  then
    if (
      v_target.opportunity_ref is not null
      and v_target.opportunity_ref is distinct from p_opportunity_id
    ) or (
      nullif(btrim(v_target.opportunity_id::text), '') is not null
      and private.try_parse_uuid(v_target.opportunity_id::text) is null
    ) or (
      private.try_parse_uuid(v_target.opportunity_id::text) is not null
      and private.try_parse_uuid(v_target.opportunity_id::text)
        is distinct from p_opportunity_id
    ) then
      raise exception 'linked project belongs to another opportunity'
        using errcode = '23505';
    end if;
    v_result := private.execute_opportunity_conversion_core(
      p_company_id,
      p_opportunity_id,
      p_actual_value,
      null,
      case when v_actor_user_id is null then null else v_actor_user_id end,
      p_notes,
      p_title_override,
      v_link_to_project_id,
      p_source_path,
      p_win_opportunity and v_opp.stage = 'won',
      p_project_status,
      coalesce(p_evidence, '{}'::jsonb),
      v_opp.assignment_version
    );

    select event.id,
           coalesce((event.payload ->> 'linked_existing')::boolean, false)
      into v_conversion_event_id, v_existing_linked_existing
      from public.opportunity_conversion_events event
     where event.company_id = p_company_id
       and event.opportunity_id = p_opportunity_id
       and event.project_id = v_link_to_project_id
       and event.event_type = 'converted_to_project'
     order by event.created_at desc, event.id desc
     limit 1;

    return v_result || jsonb_build_object(
      'converted', false,
      'already_converted', true,
      'guard_reason', 'already_converted',
      'project_id', v_link_to_project_id,
      'opportunity_id', p_opportunity_id,
      'assigned_to', v_opp.assigned_to,
      'assignment_version', v_opp.assignment_version,
      'conversion_event_id', coalesce(
        v_conversion_event_id,
        private.try_parse_uuid(v_result ->> 'conversion_event_id')
      ),
      'linked_existing', v_existing_linked_existing,
      'won', v_opp.stage = 'won',
      'project_accessible', false
    );
  end if;

  if v_link_to_project_id is not null then
    if v_actor_user_id is not null then
      if not private.user_can_link_opportunity_to_project(
        v_actor_user_id,
        v_link_to_project_id
      ) then
        raise exception 'project_link_unavailable'
          using errcode = 'P0002';
      end if;
    else
      if v_initial_client_id is null
        or v_target.client_id is distinct from v_initial_client_id
        or (
          v_target.opportunity_ref is not null
          and v_target.opportunity_ref is distinct from p_opportunity_id
        )
        or (
          nullif(btrim(v_target.opportunity_id::text), '') is not null
          and private.try_parse_uuid(v_target.opportunity_id::text) is null
        )
        or (
          private.try_parse_uuid(v_target.opportunity_id::text) is not null
          and private.try_parse_uuid(v_target.opportunity_id::text)
            is distinct from p_opportunity_id
        )
        or v_target.status not in ('rfq', 'estimated', 'accepted', 'in_progress')
        or (
          v_initial_project_id is null
          and (
            private.normalize_email_project_dedupe_address(v_target.address) = ''
            or private.normalize_email_project_dedupe_address(v_target.address)
              is distinct from v_initial_normalized_address
          )
        )
      then
        raise exception 'project_link_unavailable'
          using errcode = 'P0002';
      end if;
    end if;
  end if;

  v_result := private.execute_opportunity_conversion_core(
    p_company_id,
    p_opportunity_id,
    p_actual_value,
    p_expected_stage,
    case when v_actor_user_id is null then null else v_actor_user_id end,
    p_notes,
    p_title_override,
    v_link_to_project_id,
    p_source_path,
    p_win_opportunity,
    p_project_status,
    coalesce(p_evidence, '{}'::jsonb),
    p_expected_assignment_version
  );

  -- Reactivating an engine-owned budget deferral into Won must not leave stale
  -- loss/follow-up state or the deferral date behind on the converted lead.
  if v_opp.stage = 'lost'
    and p_win_opportunity
    and coalesce((v_result ->> 'won')::boolean, false)
  then
    update public.opportunities
       set lost_reason = null,
           lost_notes = null,
           next_follow_up_at = null,
           actual_close_date = now()::date,
           updated_at = now()
     where id = p_opportunity_id
       and company_id = p_company_id;
  end if;

  -- The canonical core historically used the presence of an opportunity-side
  -- project pointer as its `already_converted` signal. Correct the public result
  -- when this call completed a previously unrecorded one-way link and Won it.
  if v_actor_user_id is null
    and v_initial_project_id is not null
    and not v_existing_conversion_complete
  then
    v_result := v_result || jsonb_build_object(
      'converted', true,
      'already_converted', false,
      'guard_reason', null,
      'linked_existing', true
    );
  end if;

  v_project_id := private.try_parse_uuid(v_result ->> 'project_id');
  if v_actor_user_id is not null and v_project_id is not null then
    v_project_accessible := private.user_can_view_project(
      v_actor_user_id,
      v_project_id
    );
  end if;

  return v_result || jsonb_build_object(
    'assigned_to', v_opp.assigned_to,
    'assignment_version', v_opp.assignment_version,
    'project_accessible', coalesce(v_project_accessible, false)
  );
end;
$function$;

revoke all on function public.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) from public, anon, authenticated, service_role;
grant execute on function public.convert_opportunity_to_project(
  uuid, uuid, numeric, text, uuid, text, text, uuid, text, boolean, text, jsonb,
  bigint
) to authenticated, service_role;

commit;
