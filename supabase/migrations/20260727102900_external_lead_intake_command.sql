begin;

-- One fixed, service-role-only transaction for an original external inquiry.
-- No source is enabled by this migration and no storage resource is provisioned.

do $prerequisites$
begin
  if to_regclass('private.external_api_principals') is null
    or to_regclass('private.lead_intake_sources') is null
    or to_regclass('private.external_intake_upload_intents') is null
    or to_regclass('private.external_lead_handles') is null
    or to_regclass('public.unassigned_lead_assignment_deliveries') is null
    or to_regprocedure(
      'private.require_external_intake_credential(uuid,uuid,uuid,smallint,bytea,text,bigint)'
    ) is null
    or to_regprocedure(
      'private.append_external_lead_projection_foundation(uuid,uuid,smallint,text,jsonb,jsonb,timestamp with time zone)'
    ) is null
    or to_regprocedure(
      'private.change_opportunity_assignment_core(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean,uuid,jsonb)'
    ) is null
  then
    raise exception 'external_lead_intake_command_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Normalized customer identities -------------------------------------------

create table private.external_contact_identities (
  company_id uuid not null
    references public.companies (id) on delete restrict,
  entity_kind text not null,
  entity_id uuid not null,
  normalized_email text,
  normalized_phone text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (entity_kind, entity_id),
  constraint external_contact_identities_kind_check
    check (entity_kind in ('client', 'sub_client')),
  constraint external_contact_identities_email_check
    check (
      normalized_email is null
      or (
        normalized_email = lower(btrim(normalized_email))
        and char_length(normalized_email) between 3 and 320
        and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      )
    ),
  constraint external_contact_identities_phone_check
    check (
      normalized_phone is null
      or normalized_phone ~ '^[+][1-9][0-9]{7,14}$'
    )
);

create index external_contact_identities_email_idx
  on private.external_contact_identities (company_id, normalized_email)
  where normalized_email is not null;

create index external_contact_identities_phone_idx
  on private.external_contact_identities (company_id, normalized_phone)
  where normalized_phone is not null;

create or replace function private.sync_external_contact_identity()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_kind text := case
    when tg_table_name = 'clients' then 'client'
    else 'sub_client'
  end;
  v_email text;
  v_phone text;
begin
  if tg_op = 'DELETE' then
    delete from private.external_contact_identities identity
    where identity.entity_kind = v_kind
      and identity.entity_id = old.id;
    return old;
  end if;

  if new.deleted_at is not null then
    delete from private.external_contact_identities identity
    where identity.entity_kind = v_kind
      and identity.entity_id = new.id;
    return new;
  end if;

  v_email := case
    when new.email is not null
      and lower(btrim(new.email))
        ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      then lower(btrim(new.email))
    else null
  end;
  -- SQL never guesses a region. Local-format phones are backfilled by the
  -- application only when reliable region evidence is available.
  v_phone := case
    when btrim(coalesce(new.phone_number, '')) ~ '^[+][1-9][0-9]{7,14}$'
      then btrim(new.phone_number)
    else null
  end;

  insert into private.external_contact_identities (
    company_id,
    entity_kind,
    entity_id,
    normalized_email,
    normalized_phone
  ) values (
    new.company_id,
    v_kind,
    new.id,
    v_email,
    v_phone
  )
  on conflict (entity_kind, entity_id)
  do update
  set company_id = excluded.company_id,
      normalized_email = excluded.normalized_email,
      normalized_phone = excluded.normalized_phone,
      updated_at = clock_timestamp();

  return new;
end;
$function$;

create or replace function private.change_opportunity_assignment_core(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_source text,
  p_actor_user_id uuid,
  p_actor_company_id uuid,
  p_is_system boolean,
  p_suggestion_id uuid,
  p_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_opportunity public.opportunities%rowtype;
  v_scope text;
  v_event_id uuid;
  v_new_version bigint;
  v_new_notify boolean;
  v_previous_access_after boolean;
begin
  if p_opportunity_id is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
  then
    raise exception 'invalid_assignment_expectation'
      using errcode = '22023';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'assignment_metadata_must_be_object'
      using errcode = '22023';
  end if;

  if p_is_system is null then
    raise exception 'assignment_principal_kind_required'
      using errcode = '22023';
  elsif p_is_system then
    if p_source not in (
      'personal_mailbox',
      'company_mailbox_default',
      'external_intake_default',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    ) then
      raise exception 'invalid_system_assignment_source'
        using errcode = '22023';
    end if;
  elsif p_source is null
    or p_source not in ('manual', 'suggestion_accept')
  then
    raise exception 'invalid_human_assignment_source'
      using errcode = '22023';
  end if;

  select opportunity.*
  into v_opportunity
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
  for update;

  if not found or v_opportunity.deleted_at is not null then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if p_actor_company_id is distinct from v_opportunity.company_id then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_actor_user_id is not null then
    perform 1
    from public.users actor
    where actor.id = p_actor_user_id
      and actor.company_id = v_opportunity.company_id
      and actor.deleted_at is null
      and coalesce(actor.is_active, false)
    for share;
    if not found then
      raise exception 'assignment_actor_ineligible'
        using errcode = '42501';
    end if;
  end if;

  if not p_is_system then
    if p_actor_user_id is null then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    v_scope := private.current_user_scope_for('pipeline.assign');
    if v_scope is null
      and private.should_use_pipeline_manage_compat(
        p_actor_user_id,
        p_actor_company_id,
        'pipeline.assign'
      )
    then
      v_scope := 'all';
    end if;

    if v_scope is null or v_scope not in ('all', 'assigned') then
      raise exception 'access_denied'
        using errcode = '42501';
    end if;

    if v_scope = 'assigned'
      and v_opportunity.assigned_to is distinct from p_actor_user_id
    then
      raise exception 'assignment_access_lost'
        using errcode = '42501';
    end if;
  end if;

  if v_opportunity.assignment_version
      is distinct from p_expected_assignment_version
    or v_opportunity.assigned_to is distinct from p_expected_assigned_to
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if v_opportunity.assigned_to is not distinct from p_new_assigned_to then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'assigned_to', v_opportunity.assigned_to,
      'assignment_version', v_opportunity.assignment_version,
      'event_id', null
    );
  end if;

  if not p_is_system and v_scope = 'assigned' then
    if p_new_assigned_to is null then
      raise exception 'assigned_scope_cannot_unassign'
        using errcode = '42501';
    end if;
    if v_opportunity.archived_at is not null
      or v_opportunity.stage in ('won', 'lost', 'discarded')
    then
      raise exception 'assigned_scope_terminal_transfer_forbidden'
        using errcode = '42501';
    end if;
  end if;

  if p_new_assigned_to is not null then
    perform 1
    from public.users target
    where target.id = p_new_assigned_to
      and target.company_id = v_opportunity.company_id
      and target.deleted_at is null
      and coalesce(target.is_active, false)
      and public.has_permission(
        p_new_assigned_to,
        'pipeline.view',
        'assigned'
      )
    for share;
    if not found then
      raise exception 'assignment_target_ineligible'
        using errcode = '22023';
    end if;
  end if;

  if p_source = 'suggestion_accept' then
    if p_suggestion_id is null
      or not exists (
        select 1
        from public.opportunity_assignment_suggestions suggestion
        where suggestion.id = p_suggestion_id
          and suggestion.company_id = v_opportunity.company_id
          and suggestion.opportunity_id = p_opportunity_id
          and suggestion.suggested_user_id = p_new_assigned_to
          and suggestion.resolution_state = 'pending'
      )
    then
      raise exception 'assignment_suggestion_invalid'
        using errcode = '22023';
    end if;
  elsif p_suggestion_id is not null then
    raise exception 'suggestion_id_requires_suggestion_accept'
      using errcode = '22023';
  end if;

  v_new_version := v_opportunity.assignment_version + 1;

  insert into private.opportunity_assignment_write_tokens (
    transaction_id,
    backend_pid,
    opportunity_id,
    operation,
    assigned_to,
    assignment_version
  ) values (
    txid_current(),
    pg_backend_pid(),
    p_opportunity_id,
    'update',
    p_new_assigned_to,
    v_new_version
  );

  update public.opportunities
  set assigned_to = p_new_assigned_to,
      assignment_version = assignment_version + 1,
      updated_at = now()
  where id = p_opportunity_id
  returning assignment_version into v_new_version;

  insert into public.opportunity_assignment_events (
    company_id,
    opportunity_id,
    previous_assignee_id,
    new_assignee_id,
    actor_user_id,
    source,
    suggestion_id,
    assignment_version,
    previous_assignee_snapshot,
    new_assignee_snapshot,
    actor_snapshot,
    metadata
  ) values (
    v_opportunity.company_id,
    p_opportunity_id,
    v_opportunity.assigned_to,
    p_new_assigned_to,
    p_actor_user_id,
    p_source,
    p_suggestion_id,
    v_new_version,
    private.user_assignment_snapshot(v_opportunity.assigned_to),
    private.user_assignment_snapshot(p_new_assigned_to),
    private.user_assignment_snapshot(p_actor_user_id),
    p_metadata
  )
  returning id into v_event_id;

  update public.opportunity_assignment_suggestions
  set resolution_state = case
        when id = p_suggestion_id and p_source = 'suggestion_accept'
          then 'accepted'
        else 'superseded'
      end,
      resolved_at = now(),
      resolved_by = p_actor_user_id,
      resolution_event_id = v_event_id,
      resolution_metadata = jsonb_build_object(
        'assignment_source', p_source,
        'assignment_version', v_new_version
      ),
      updated_at = now()
  where company_id = v_opportunity.company_id
    and opportunity_id = p_opportunity_id
    and resolution_state = 'pending';

  if v_opportunity.assigned_to is not null
    and v_opportunity.assigned_to is distinct from p_new_assigned_to
  then
    v_previous_access_after := exists (
      select 1
      from public.users prior_user
      where prior_user.id = v_opportunity.assigned_to
        and prior_user.company_id = v_opportunity.company_id
        and prior_user.deleted_at is null
        and coalesce(prior_user.is_active, false)
        and (
          public.has_permission(
            v_opportunity.assigned_to,
            'pipeline.view',
            'all'
          )
          or private.should_use_pipeline_manage_compat(
            v_opportunity.assigned_to,
            v_opportunity.company_id,
            'pipeline.view'
          )
        )
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      v_opportunity.assigned_to,
      v_previous_access_after,
      false
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  if p_new_assigned_to is not null
    and p_new_assigned_to is distinct from v_opportunity.assigned_to
  then
    v_new_notify := not (
      not p_is_system
      and p_new_assigned_to = p_actor_user_id
    );

    insert into public.opportunity_assignment_deliveries (
      assignment_event_id,
      company_id,
      opportunity_id,
      assignment_version,
      recipient_user_id,
      access_after,
      notify
    ) values (
      v_event_id,
      v_opportunity.company_id,
      p_opportunity_id,
      v_new_version,
      p_new_assigned_to,
      true,
      v_new_notify
    )
    on conflict (assignment_event_id, recipient_user_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'assigned_to', p_new_assigned_to,
    'assignment_version', v_new_version,
    'event_id', v_event_id
  );
end;
$function$;


create or replace function private.change_assignment_system_company_serialized_internal(
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_new_assigned_to uuid,
  p_system_source text,
  p_actor_user_id uuid default null,
  p_suggestion_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_company_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_system_source is null or p_system_source not in (
    'personal_mailbox',
    'company_mailbox_default',
    'external_intake_default',
    'deactivation',
    'permission_change',
    'admin_correction',
    'system_repair'
  ) then
    raise exception 'invalid_system_assignment_source'
      using errcode = '22023';
  end if;

  select opportunity.company_id
  into v_company_id
  from public.opportunities opportunity
  where opportunity.id = p_opportunity_id
    and opportunity.deleted_at is null;

  if not found then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null
    and not exists (
      select 1
      from public.users actor
      where actor.id = p_actor_user_id
        and actor.company_id = v_company_id
        and actor.deleted_at is null
        and coalesce(actor.is_active, false)
    )
  then
    raise exception 'assignment_actor_ineligible'
      using errcode = '22023';
  end if;

  return private.change_opportunity_assignment_core(
    p_opportunity_id,
    p_expected_assignment_version,
    p_expected_assigned_to,
    p_new_assigned_to,
    p_system_source,
    p_actor_user_id,
    v_company_id,
    true,
    p_suggestion_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

-- Source-generic unassigned-owner delivery ---------------------------------

alter table public.unassigned_lead_assignment_deliveries
  add column source_kind text,
  add column source_id uuid;

update public.unassigned_lead_assignment_deliveries delivery
set source_kind = 'email_connection',
    source_id = delivery.connection_id;

alter table public.unassigned_lead_assignment_deliveries
  alter column source_kind set not null,
  alter column source_id set not null,
  alter column connection_id drop not null;

alter table public.unassigned_lead_assignment_deliveries
  add constraint unassigned_lead_assignment_deliveries_source_kind_check
  check (source_kind in ('email_connection', 'external_intake')),
  add constraint unassigned_lead_assignment_deliveries_source_shape_check
  check (
    (
      source_kind = 'email_connection'
      and connection_id is not null
      and source_id = connection_id
    )
    or
    (
      source_kind = 'external_intake'
      and connection_id is null
    )
  );

create index unassigned_lead_assignment_deliveries_source_idx
  on public.unassigned_lead_assignment_deliveries (
    company_id,
    source_kind,
    source_id
  );

create or replace function private.guard_unassigned_lead_delivery_source()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.source_kind = 'email_connection' then
    perform 1
    from public.email_connections connection
    where connection.id = new.source_id
      and private.try_parse_uuid(connection.company_id) = new.company_id;
  else
    perform 1
    from private.lead_intake_sources source
    where source.id = new.source_id
      and source.company_id = new.company_id;
  end if;

  if not found then
    raise exception 'unassigned_lead_delivery_source_invalid'
      using errcode = '23503';
  end if;
  return new;
end;
$function$;

create trigger unassigned_lead_assignment_deliveries_guard_source
before insert or update of company_id, source_kind, source_id, connection_id
on public.unassigned_lead_assignment_deliveries
for each row execute function private.guard_unassigned_lead_delivery_source();

create or replace function private.enqueue_unassigned_lead_assignment_deliveries(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_source_kind text,
  p_source_id uuid
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
    or p_source_kind not in ('email_connection', 'external_intake')
    or p_source_id is null
  then
    raise exception 'unassigned_lead_prompt_identity_required'
      using errcode = '22023';
  end if;

  insert into public.unassigned_lead_assignment_deliveries (
    company_id,
    opportunity_id,
    connection_id,
    source_kind,
    source_id,
    recipient_user_id,
    assignment_version
  )
  select
    p_company_id,
    p_opportunity_id,
    case when p_source_kind = 'email_connection' then p_source_id else null end,
    p_source_kind,
    p_source_id,
    recipient.id,
    0
  from public.users recipient
  where recipient.company_id = p_company_id
    and recipient.deleted_at is null
    and coalesce(recipient.is_active, false)
    and private.permission_user_is_admin(recipient.id, p_company_id)
    and private.raw_pipeline_scope_for_user(
      recipient.id,
      p_company_id,
      'pipeline.view'
    ) = 'all'
    and private.raw_pipeline_scope_for_user(
      recipient.id,
      p_company_id,
      'pipeline.edit'
    ) = 'all'
    and private.raw_pipeline_scope_for_user(
      recipient.id,
      p_company_id,
      'pipeline.assign'
    ) = 'all'
  on conflict (opportunity_id, recipient_user_id) do nothing;

  select count(*)::integer
  into v_prompt_count
  from public.unassigned_lead_assignment_deliveries delivery
  where delivery.company_id = p_company_id
    and delivery.opportunity_id = p_opportunity_id
    and delivery.source_kind = p_source_kind
    and delivery.source_id = p_source_id
    and delivery.disposition is distinct from 'assigned';

  return coalesce(v_prompt_count, 0);
end;
$function$;

create or replace function private.enqueue_unassigned_lead_assignment_deliveries(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
) returns integer
language sql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select private.enqueue_unassigned_lead_assignment_deliveries(
    p_company_id,
    p_opportunity_id,
    'email_connection',
    p_connection_id
  );
$function$;

-- The immutable assignment event source is extended before the core can emit
-- an external-intake default-owner assignment.
alter table public.opportunity_assignment_events
  drop constraint if exists opportunity_assignment_events_source_check;
alter table public.opportunity_assignment_events
  add constraint opportunity_assignment_events_source_check
  check (source in (
    'manual',
    'suggestion_accept',
    'manual_create',
    'personal_mailbox',
    'company_mailbox_default',
    'external_intake_default',
    'deactivation',
    'permission_change',
    'admin_correction',
    'system_repair'
  ));

alter table public.opportunity_assignment_events
  drop constraint if exists opportunity_assignment_events_actor_required;
alter table public.opportunity_assignment_events
  add constraint opportunity_assignment_events_actor_required
  check (
    actor_user_id is not null
    or source in (
      'personal_mailbox',
      'company_mailbox_default',
      'external_intake_default',
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    )
  );

create trigger clients_sync_external_contact_identity
after insert or update or delete on public.clients
for each row execute function private.sync_external_contact_identity();

create trigger sub_clients_sync_external_contact_identity
after insert or update or delete on public.sub_clients
for each row execute function private.sync_external_contact_identity();

-- Seed every identity that can be normalized without guessing a phone region.
-- Local-format phones are filled by the application backfill only when it has
-- reliable region evidence; email and already-E.164 values are safe here.
insert into private.external_contact_identities (
  company_id,
  entity_kind,
  entity_id,
  normalized_email,
  normalized_phone
)
select
  customer.company_id,
  customer.entity_kind,
  customer.entity_id,
  customer.normalized_email,
  customer.normalized_phone
from (
  select
    client.company_id,
    'client'::text as entity_kind,
    client.id as entity_id,
    case
      when lower(btrim(coalesce(client.email, '')))
        ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        then lower(btrim(client.email))
      else null
    end as normalized_email,
    case
      when btrim(coalesce(client.phone_number, ''))
        ~ '^[+][1-9][0-9]{7,14}$'
        then btrim(client.phone_number)
      else null
    end as normalized_phone
  from public.clients client
  where client.deleted_at is null

  union all

  select
    sub_client.company_id,
    'sub_client'::text,
    sub_client.id,
    case
      when lower(btrim(coalesce(sub_client.email, '')))
        ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        then lower(btrim(sub_client.email))
      else null
    end,
    case
      when btrim(coalesce(sub_client.phone_number, ''))
        ~ '^[+][1-9][0-9]{7,14}$'
        then btrim(sub_client.phone_number)
      else null
    end
  from public.sub_clients sub_client
  where sub_client.deleted_at is null
) customer
where customer.normalized_email is not null
  or customer.normalized_phone is not null;

-- Immutable original-submission evidence -----------------------------------

create table private.external_intake_submissions (
  id uuid primary key default gen_random_uuid(),
  public_submission_id uuid not null default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  principal_id uuid not null,
  credential_id uuid not null,
  source_id uuid not null,
  form_id uuid not null,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  matched_client_id uuid
    references public.clients (id) on delete restrict,
  matched_sub_client_id uuid
    references public.sub_clients (id) on delete restrict,
  normalized_email text,
  normalized_phone text,
  customer_outcome text not null,
  evidence_schema_version smallint not null,
  canonicalization_version smallint not null,
  canonical_request_hash bytea not null,
  original_contact jsonb not null,
  original_organization jsonb not null,
  original_work jsonb not null,
  original_service_address jsonb not null,
  ordered_answers jsonb not null,
  raw_attribution jsonb not null,
  raw_source_payload jsonb not null,
  external_reference jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  personal_evidence_erased_at timestamptz,
  personal_evidence_tombstone jsonb,
  constraint external_intake_submissions_public_key
    unique (public_submission_id),
  constraint external_intake_submissions_company_identity_key
    unique (id, company_id),
  constraint external_intake_submissions_opportunity_key
    unique (company_id, opportunity_id),
  constraint external_intake_submissions_principal_company_fkey
    foreign key (principal_id, company_id)
    references private.external_api_principals (id, company_id)
    on delete restrict,
  constraint external_intake_submissions_credential_company_fkey
    foreign key (credential_id, company_id)
    references private.external_api_credentials (id, company_id)
    on delete restrict,
  constraint external_intake_submissions_source_company_fkey
    foreign key (source_id, company_id)
    references private.lead_intake_sources (id, company_id)
    on delete restrict,
  constraint external_intake_submissions_form_company_fkey
    foreign key (form_id, company_id)
    references private.lead_intake_forms (id, company_id)
    on delete restrict,
  constraint external_intake_submissions_customer_outcome_check
    check (
      customer_outcome in (
        'created',
        'matched',
        'created_possible_duplicate'
      )
    ),
  constraint external_intake_submissions_versions_check
    check (evidence_schema_version > 0 and canonicalization_version > 0),
  constraint external_intake_submissions_hash_check
    check (octet_length(canonical_request_hash) = 32),
  constraint external_intake_submissions_email_check
    check (
      normalized_email is null
      or normalized_email = lower(btrim(normalized_email))
    ),
  constraint external_intake_submissions_phone_check
    check (
      normalized_phone is null
      or normalized_phone ~ '^[+][1-9][0-9]{7,14}$'
    ),
  constraint external_intake_submissions_evidence_check
    check (
      jsonb_typeof(original_contact) = 'object'
      and jsonb_typeof(original_organization) = 'object'
      and jsonb_typeof(original_work) = 'object'
      and jsonb_typeof(original_service_address) = 'object'
      and jsonb_typeof(ordered_answers) = 'array'
      and jsonb_array_length(ordered_answers) <= 100
      and jsonb_typeof(raw_attribution) = 'object'
      and jsonb_typeof(raw_source_payload) = 'object'
      and jsonb_typeof(external_reference) = 'object'
      and octet_length(original_contact::text) <= 4096
      and octet_length(original_organization::text) <= 1024
      and octet_length(original_work::text) <= 24576
      and octet_length(original_service_address::text) <= 4096
      and octet_length(ordered_answers::text) <= 131072
      and octet_length(raw_attribution::text) <= 16384
      and octet_length(raw_source_payload::text) <= 8192
      and octet_length(external_reference::text) <= 2048
    ),
  constraint external_intake_submissions_erasure_check
    check (
      (
        personal_evidence_erased_at is null
        and personal_evidence_tombstone is null
      )
      or (
        personal_evidence_erased_at is not null
        and jsonb_typeof(personal_evidence_tombstone) = 'object'
        and personal_evidence_tombstone
          = '{"state":"privacy_erased"}'::jsonb
      )
    )
);

create table private.external_intake_submission_replay_digests (
  submission_id uuid not null,
  company_id uuid not null,
  identity_kind text not null,
  digest_version smallint not null,
  identity_digest bytea not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (submission_id, identity_kind),
  constraint external_intake_submission_replay_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_submission_replay_kind_check
    check (
      identity_kind in ('principal_idempotency', 'source_external_id')
    ),
  constraint external_intake_submission_replay_version_check
    check (digest_version > 0),
  constraint external_intake_submission_replay_digest_check
    check (octet_length(identity_digest) = 32),
  constraint external_intake_submission_replay_lookup_key
    unique (
      company_id,
      identity_kind,
      digest_version,
      identity_digest
    )
);

create table private.external_intake_submission_uploads (
  submission_id uuid not null,
  company_id uuid not null,
  intent_id uuid not null,
  public_upload_id uuid not null,
  ordinal integer not null,
  attachment_state text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (submission_id, intent_id),
  constraint external_intake_submission_uploads_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_submission_uploads_intent_company_fkey
    foreign key (intent_id, company_id)
    references private.external_intake_upload_intents (id, company_id)
    on delete restrict,
  constraint external_intake_submission_uploads_intent_key unique (intent_id),
  constraint external_intake_submission_uploads_public_key
    unique (public_upload_id),
  constraint external_intake_submission_uploads_ordinal_key
    unique (submission_id, ordinal),
  constraint external_intake_submission_uploads_ordinal_check
    check (ordinal between 1 and 10),
  constraint external_intake_submission_uploads_state_check
    check (
      attachment_state in (
        'accepted',
        'pending_inspection',
        'rejected',
        'missing',
        'expired'
      )
    )
);

create table private.external_intake_submission_attribution (
  submission_id uuid not null,
  company_id uuid not null,
  dimension text not null,
  dictionary_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (submission_id, dimension),
  constraint external_intake_submission_attribution_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_submission_attribution_dictionary_company_fkey
    foreign key (dictionary_id, company_id)
    references private.external_attribution_dictionary (id, company_id)
    on delete restrict,
  constraint external_intake_submission_attribution_dimension_check
    check (
      dimension in (
        'campaign',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'landing_path',
        'referrer_path'
      )
    )
);

create table private.external_intake_possible_duplicates (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  company_id uuid not null,
  candidate_entities jsonb not null,
  matched_signals jsonb not null,
  review_state text not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  constraint external_intake_possible_duplicates_submission_key
    unique (submission_id),
  constraint external_intake_possible_duplicates_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_possible_duplicates_evidence_check
    check (
      jsonb_typeof(candidate_entities) = 'array'
      and jsonb_array_length(candidate_entities) between 2 and 100
      and jsonb_typeof(matched_signals) = 'array'
      and jsonb_array_length(matched_signals) between 1 and 2
      and octet_length(candidate_entities::text) <= 32768
      and octet_length(matched_signals::text) <= 2048
    ),
  constraint external_intake_possible_duplicates_state_check
    check (review_state in ('pending', 'resolved_not_duplicate', 'merged'))
);

create table private.external_intake_post_commit_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  submission_id uuid not null,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  event_type text not null default 'external_intake_created',
  event_payload jsonb not null,
  state text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint external_intake_post_commit_submission_company_fkey
    foreign key (submission_id, company_id)
    references private.external_intake_submissions (id, company_id)
    on delete restrict,
  constraint external_intake_post_commit_submission_key
    unique (submission_id, event_type),
  constraint external_intake_post_commit_event_check
    check (event_type = 'external_intake_created'),
  constraint external_intake_post_commit_payload_check
    check (
      jsonb_typeof(event_payload) = 'object'
      and octet_length(event_payload::text) <= 8192
    ),
  constraint external_intake_post_commit_state_check
    check (state in ('pending', 'processing', 'complete')),
  constraint external_intake_post_commit_attempt_check
    check (attempt_count >= 0),
  constraint external_intake_post_commit_lease_check
    check (
      (state = 'processing' and lease_token is not null and lease_expires_at is not null)
      or
      (state <> 'processing' and lease_token is null and lease_expires_at is null)
    ),
  constraint external_intake_post_commit_completion_check
    check (
      (state = 'complete' and completed_at is not null)
      or (state <> 'complete' and completed_at is null)
    )
);

create index external_intake_post_commit_ready_idx
  on private.external_intake_post_commit_outbox (
    state,
    available_at,
    lease_expires_at,
    created_at
  )
  where state <> 'complete';

create table private.external_intake_submission_erasure_write_tokens (
  transaction_id bigint not null,
  backend_pid integer not null,
  submission_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (transaction_id, backend_pid, submission_id)
);

create or replace function private.guard_external_intake_submission_evidence()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_token_consumed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
    or new.public_submission_id is distinct from old.public_submission_id
    or new.company_id is distinct from old.company_id
    or new.principal_id is distinct from old.principal_id
    or new.credential_id is distinct from old.credential_id
    or new.source_id is distinct from old.source_id
    or new.form_id is distinct from old.form_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.matched_client_id is distinct from old.matched_client_id
    or new.matched_sub_client_id is distinct from old.matched_sub_client_id
    or new.normalized_email is distinct from old.normalized_email
    or new.normalized_phone is distinct from old.normalized_phone
    or new.customer_outcome is distinct from old.customer_outcome
    or new.evidence_schema_version is distinct from old.evidence_schema_version
    or new.canonicalization_version is distinct from old.canonicalization_version
    or new.canonical_request_hash is distinct from old.canonical_request_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  delete from private.external_intake_submission_erasure_write_tokens token
  where token.transaction_id = txid_current()
    and token.backend_pid = pg_backend_pid()
    and token.submission_id = old.id
  returning true into v_token_consumed;

  if not found or not coalesce(v_token_consumed, false) then
    raise exception 'external_intake_submission_evidence_immutable'
      using errcode = '42501';
  end if;

  if new.personal_evidence_erased_at is null
    or old.personal_evidence_erased_at is not null
    or new.personal_evidence_tombstone
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_contact
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_organization
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_work
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.original_service_address
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.ordered_answers is distinct from '[]'::jsonb
    or new.raw_attribution
      is distinct from '{"state":"privacy_erased"}'::jsonb
    or new.raw_source_payload is distinct from old.raw_source_payload
    or new.external_reference
      is distinct from '{"state":"privacy_erased"}'::jsonb
  then
    raise exception 'external_intake_submission_erasure_invalid'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create trigger external_intake_submissions_guard_evidence
before update or delete on private.external_intake_submissions
for each row execute function private.guard_external_intake_submission_evidence();

create or replace function private.reject_external_intake_immutable_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  raise exception 'external_intake_submission_evidence_immutable'
    using errcode = '42501';
end;
$function$;

create trigger external_intake_replay_digests_immutable
before update or delete on private.external_intake_submission_replay_digests
for each row execute function private.reject_external_intake_immutable_mutation();

create trigger external_intake_submission_uploads_immutable
before update or delete on private.external_intake_submission_uploads
for each row execute function private.reject_external_intake_immutable_mutation();

create trigger external_intake_submission_attribution_immutable
before update or delete on private.external_intake_submission_attribution
for each row execute function private.reject_external_intake_immutable_mutation();

create trigger external_intake_possible_duplicates_immutable
before update or delete on private.external_intake_possible_duplicates
for each row execute function private.reject_external_intake_immutable_mutation();

-- Fixed helper primitives --------------------------------------------------

create or replace function private.external_opaque_uuid(
  p_prefix text,
  p_value uuid
) returns text
language plpgsql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
declare
  v_encoded text;
begin
  if p_prefix not in ('src', 'frm', 'upl', 'sub', 'lead', 'cmp', 'attr', 'path')
  then
    raise exception 'external_opaque_prefix_invalid'
      using errcode = '22023';
  end if;
  v_encoded := encode(uuid_send(p_value), 'base64');
  v_encoded := replace(replace(rtrim(v_encoded, '='), '+', '-'), '/', '_');
  return p_prefix || '_' || v_encoded;
end;
$function$;

create or replace function private.external_intake_minute(
  p_value timestamptz
) returns timestamptz
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select date_trunc('minute', p_value);
$function$;

create or replace function private.external_intake_attachment_state(
  p_state text
) returns text
language sql
immutable
strict
set search_path to 'pg_catalog', 'pg_temp'
as $function$
  select case
    when p_state = 'accepted' then 'accepted'
    when p_state in ('uploaded', 'claimed', 'pending_inspection')
      then 'pending_inspection'
    when p_state = 'rejected' then 'rejected'
    when p_state in ('issued', 'closed_missing') then 'missing'
    when p_state = 'expired' then 'expired'
    else 'missing'
  end;
$function$;

create or replace function private.external_intake_submission_result(
  p_submission_id uuid,
  p_replayed boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_submission private.external_intake_submissions%rowtype;
  v_public_lead_id uuid;
  v_attachments jsonb;
begin
  select submission.*
  into v_submission
  from private.external_intake_submissions submission
  where submission.id = p_submission_id;

  if not found then
    raise exception 'external_intake_submission_not_found'
      using errcode = 'P0002';
  end if;

  select handle.public_lead_id
  into v_public_lead_id
  from private.external_lead_handles handle
  where handle.company_id = v_submission.company_id
    and handle.opportunity_id = v_submission.opportunity_id;

  if v_public_lead_id is null then
    raise exception 'external_intake_public_lead_missing'
      using errcode = '55000';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'public_upload_id', upload.public_upload_id,
        'caller_file_id', intent.caller_file_id,
        'state', upload.attachment_state,
        'safe_code', intent.safe_code
      )
      order by upload.ordinal
    ),
    '[]'::jsonb
  )
  into v_attachments
  from private.external_intake_submission_uploads upload
  join private.external_intake_upload_intents intent
    on intent.id = upload.intent_id
   and intent.company_id = upload.company_id
  where upload.submission_id = v_submission.id;

  return jsonb_build_object(
    'status', case when p_replayed then 'replayed' else 'created' end,
    'public_submission_id', v_submission.public_submission_id,
    'public_lead_id', v_public_lead_id,
    'customer_outcome', v_submission.customer_outcome,
    'lead_created_at', (
      select opportunity.created_at
      from public.opportunities opportunity
      where opportunity.id = v_submission.opportunity_id
    ),
    'initial_lead_stage', 'new_lead',
    'replayed', p_replayed,
    'attachments', v_attachments
  );
end;
$function$;

-- Submission may close an object that is genuinely absent. This is the only
-- added state edge; all immutable identity and observed-version fences remain.
create or replace function private.guard_external_intake_upload_transition()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.id is distinct from old.id
    or new.company_id is distinct from old.company_id
    or new.batch_id is distinct from old.batch_id
    or new.public_upload_id is distinct from old.public_upload_id
    or new.ordinal is distinct from old.ordinal
    or new.caller_file_id is distinct from old.caller_file_id
    or new.original_filename is distinct from old.original_filename
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.declared_content_type is distinct from old.declared_content_type
    or new.expected_checksum_sha256 is distinct from old.expected_checksum_sha256
    or new.storage_object_key is distinct from old.storage_object_key
    or new.created_at is distinct from old.created_at
  then
    raise exception 'external_intake_upload_identity_immutable'
      using errcode = '42501';
  end if;

  if old.object_version_id is not null
    and (
      new.object_version_id is distinct from old.object_version_id
      or new.observed_size_bytes is distinct from old.observed_size_bytes
      or new.observed_checksum_sha256 is distinct from old.observed_checksum_sha256
      or new.uploaded_at is distinct from old.uploaded_at
    )
  then
    raise exception 'external_intake_upload_object_conflict'
      using errcode = '23505';
  end if;

  if new.state <> old.state
    and not (
      (old.state = 'issued' and new.state in ('uploaded', 'closed_missing', 'expired'))
      or (old.state = 'uploaded' and new.state in ('claimed', 'closed_missing', 'expired'))
      or (old.state = 'claimed' and new.state in ('pending_inspection', 'closed_missing', 'expired'))
      or (
        old.state = 'pending_inspection'
        and new.state in ('accepted', 'rejected', 'closed_missing', 'expired')
      )
    )
  then
    raise exception 'external_intake_upload_transition_invalid'
      using errcode = '23514';
  end if;

  if (
      new.capability_expires_at is distinct from old.capability_expires_at
      or new.delete_not_before is distinct from old.delete_not_before
    )
    and old.state <> 'issued'
  then
    raise exception 'external_intake_upload_capability_immutable'
      using errcode = '42501';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$function$;

-- Guarded server-side context used only to HEAD exact immutable object keys.
create or replace function public.resolve_external_intake_submission_context_as_system(
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_source_public_id uuid,
  p_form_public_id uuid,
  p_public_upload_ids uuid[],
  p_requested_origin text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_source private.lead_intake_sources%rowtype;
  v_form private.lead_intake_forms%rowtype;
  v_upload_count integer;
  v_scoped_count integer;
  v_uploads jsonb;
begin
  perform private.require_external_api_service_role();
  perform private.require_external_intake_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch
  );

  if p_source_public_id is null
    or p_form_public_id is null
    or p_public_upload_ids is null
    or cardinality(p_public_upload_ids) > 10
    or array_position(p_public_upload_ids, null) is not null
    or (
      select count(distinct upload_id)
      from unnest(p_public_upload_ids) upload_id
    ) <> cardinality(p_public_upload_ids)
  then
    raise exception 'external_intake_submission_context_invalid'
      using errcode = '22023';
  end if;

  select source.*
  into v_source
  from private.lead_intake_sources source
  join private.external_api_principal_sources source_grant
    on source_grant.source_id = source.id
   and source_grant.company_id = source.company_id
  where source.public_source_id = p_source_public_id
    and source.company_id = p_company_id
    and source.status = 'active'
    and source_grant.principal_id = p_principal_id
  for share of source, source_grant;

  if not found
    or (
      p_requested_origin is not null
      and not (p_requested_origin = any(v_source.allowed_browser_origins))
    )
  then
    return jsonb_build_object('status', 'source_not_allowed');
  end if;

  select form_row.*
  into v_form
  from private.lead_intake_forms form_row
  where form_row.public_form_id = p_form_public_id
    and form_row.company_id = p_company_id
    and form_row.source_id = v_source.id
    and form_row.is_active
  for share;

  if not found then
    return jsonb_build_object('status', 'form_not_allowed');
  end if;

  v_upload_count := cardinality(p_public_upload_ids);
  if v_upload_count > 0 then
    select count(*)
    into v_scoped_count
    from private.external_intake_upload_intents intent
    where intent.public_upload_id = any(p_public_upload_ids);

    if v_scoped_count <> v_upload_count then
      return jsonb_build_object('status', 'upload_not_found');
    end if;

    select count(*)
    into v_scoped_count
    from private.external_intake_upload_intents intent
    join private.external_intake_upload_batches batch
      on batch.id = intent.batch_id
     and batch.company_id = intent.company_id
    where intent.public_upload_id = any(p_public_upload_ids)
      and intent.company_id = p_company_id
      and batch.principal_id = p_principal_id
      and batch.source_id = v_source.id
      and batch.form_id = v_form.id;

    if v_scoped_count <> v_upload_count then
      return jsonb_build_object('status', 'upload_scope_mismatch');
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'public_upload_id', intent.public_upload_id,
        'storage_object_key', intent.storage_object_key,
        'state', intent.state,
        'expected_size_bytes', intent.expected_size_bytes,
        'expected_checksum_sha256', case
          when intent.expected_checksum_sha256 is null then null
          else encode(intent.expected_checksum_sha256, 'hex')
        end,
        'object_version_id', intent.object_version_id,
        'observed_size_bytes', intent.observed_size_bytes,
        'observed_checksum_sha256', case
          when intent.observed_checksum_sha256 is null then null
          else encode(intent.observed_checksum_sha256, 'hex')
        end
      )
      order by requested.ordinal
    ),
    '[]'::jsonb
  )
  into v_uploads
  from unnest(p_public_upload_ids) with ordinality
    as requested(public_upload_id, ordinal)
  join private.external_intake_upload_intents intent
    on intent.public_upload_id = requested.public_upload_id;

  return jsonb_build_object(
    'status', 'ready',
    'source_id', v_source.id,
    'form_id', v_form.id,
    'default_phone_region', v_source.default_phone_region,
    'uploads', v_uploads
  );
end;
$function$;

-- Atomic customer/contact, lead, evidence, upload, projection and assignment.
create or replace function public.create_external_intake_submission_as_system(
  p_request_id uuid,
  p_principal_id uuid,
  p_credential_id uuid,
  p_company_id uuid,
  p_digest_version smallint,
  p_credential_digest bytea,
  p_visible_prefix text,
  p_authorization_epoch bigint,
  p_source_public_id uuid,
  p_form_public_id uuid,
  p_requested_origin text,
  p_idempotency_digest_version smallint,
  p_idempotency_digest bytea,
  p_idempotency_candidates jsonb,
  p_external_submission_digest_version smallint,
  p_external_submission_digest bytea,
  p_external_submission_candidates jsonb,
  p_canonicalization_version smallint,
  p_canonical_request_hash bytea,
  p_evidence_schema_version smallint,
  p_original_evidence jsonb,
  p_canonical_submission jsonb,
  p_normalized_contact jsonb,
  p_upload_ids uuid[],
  p_attribution_candidates jsonb,
  p_route text,
  p_method text,
  p_request_received_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_source private.lead_intake_sources%rowtype;
  v_form private.lead_intake_forms%rowtype;
  v_candidate jsonb;
  v_attribution_candidate jsonb;
  v_invalid_key text;
  v_existing_ids uuid[];
  v_idempotency_submission_id uuid;
  v_external_submission_id uuid;
  v_existing private.external_intake_submissions%rowtype;
  v_identity_key text;
  v_matches jsonb;
  v_match_count integer;
  v_match jsonb;
  v_client_id uuid;
  v_sub_client_id uuid;
  v_submission_id uuid := gen_random_uuid();
  v_public_submission_id uuid := gen_random_uuid();
  v_opportunity_id uuid := gen_random_uuid();
  v_public_lead_id uuid;
  v_customer_outcome text;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_organization_name text;
  v_work_summary text;
  v_preferred_timing text;
  v_service_address text;
  v_source_thread_key text;
  v_created_at timestamptz;
  v_upload_id uuid;
  v_upload_ordinal bigint;
  v_intent private.external_intake_upload_intents%rowtype;
  v_batch private.external_intake_upload_batches%rowtype;
  v_attachment_state text;
  v_dictionary_ids uuid[];
  v_dictionary_id uuid;
  v_dictionary private.external_attribution_dictionary%rowtype;
  v_active_attribution_digest bytea;
  v_attribution_map jsonb := '{}'::jsonb;
  v_prefix text;
  v_handle text;
  v_label text;
  v_public_source jsonb;
  v_normalized_source jsonb;
  v_public_projection jsonb;
  v_assignment_result jsonb;
  v_prompt_count integer := 0;
  v_projection_sequence bigint;
  v_requested_upload_count integer;
begin
  perform private.require_external_api_service_role();

  if p_request_id is null
    or p_principal_id is null
    or p_credential_id is null
    or p_company_id is null
    or p_source_public_id is null
    or p_form_public_id is null
    or p_idempotency_digest_version is null
    or p_idempotency_digest_version <= 0
    or p_idempotency_digest is null
    or octet_length(p_idempotency_digest) <> 32
    or p_idempotency_candidates is null
    or jsonb_typeof(p_idempotency_candidates) <> 'array'
    or jsonb_array_length(p_idempotency_candidates) < 1
    or jsonb_array_length(p_idempotency_candidates) > 32
    or p_external_submission_candidates is null
    or jsonb_typeof(p_external_submission_candidates) <> 'array'
    or p_canonicalization_version is null
    or p_canonicalization_version <= 0
    or p_canonical_request_hash is null
    or octet_length(p_canonical_request_hash) <> 32
    or p_evidence_schema_version is null
    or p_evidence_schema_version <= 0
    or p_original_evidence is null
    or jsonb_typeof(p_original_evidence) <> 'object'
    or octet_length(p_original_evidence::text) > 196608
    or p_canonical_submission is null
    or jsonb_typeof(p_canonical_submission) <> 'object'
    or octet_length(p_canonical_submission::text) > 196608
    or p_normalized_contact is null
    or jsonb_typeof(p_normalized_contact) <> 'object'
    or p_upload_ids is null
    or cardinality(p_upload_ids) > 10
    or array_position(p_upload_ids, null) is not null
    or p_attribution_candidates is null
    or jsonb_typeof(p_attribution_candidates) <> 'array'
    or jsonb_array_length(p_attribution_candidates) > 8
    or p_route is distinct from '/v1/intake/submissions'
    or p_method is distinct from 'POST'
    or p_request_received_at is null
    or p_request_received_at > clock_timestamp() + interval '5 minutes'
  then
    raise exception 'external_intake_submission_arguments_invalid'
      using errcode = '22023';
  end if;

  if (
    p_external_submission_digest_version is null
    or p_external_submission_digest is null
  ) is distinct from (
    jsonb_array_length(p_external_submission_candidates) = 0
  )
    or (
      p_external_submission_digest is not null
      and (
        p_external_submission_digest_version <= 0
        or octet_length(p_external_submission_digest) <> 32
        or jsonb_array_length(p_external_submission_candidates) > 32
      )
    )
  then
    raise exception 'external_intake_external_identity_invalid'
      using errcode = '22023';
  end if;

  if (
    select count(distinct upload_id)
    from unnest(p_upload_ids) upload_id
  ) <> cardinality(p_upload_ids) then
    raise exception 'external_intake_upload_claim_conflict'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_original_evidence) supplied(key)
    where supplied.key not in (
      'sourceId',
      'formId',
      'contact',
      'serviceAddress',
      'workSummary',
      'preferredTiming',
      'answers',
      'attribution',
      'uploadIds',
      'externalSubmissionId'
    )
  ) then
    raise exception 'external_intake_original_evidence_unknown_shape'
      using errcode = '22023';
  end if;

  select supplied.key
  into v_invalid_key
  from jsonb_object_keys(p_normalized_contact) supplied(key)
  where supplied.key not in ('name', 'email', 'phone', 'organizationName')
  order by supplied.key
  fetch first row only;

  if v_invalid_key is not null
    or nullif(btrim(p_normalized_contact ->> 'name'), '') is null
    or (
      nullif(p_normalized_contact ->> 'email', '') is null
      and nullif(p_normalized_contact ->> 'phone', '') is null
    )
    or (
      nullif(p_normalized_contact ->> 'email', '') is not null
      and (
        p_normalized_contact ->> 'email'
          <> lower(btrim(p_normalized_contact ->> 'email'))
        or p_normalized_contact ->> 'email'
          !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      )
    )
    or (
      nullif(p_normalized_contact ->> 'phone', '') is not null
      and p_normalized_contact ->> 'phone' !~ '^[+][1-9][0-9]{7,14}$'
    )
  then
    raise exception 'external_intake_normalized_contact_invalid'
      using errcode = '22023';
  end if;

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(p_idempotency_candidates) candidate(value)
  loop
    if jsonb_typeof(v_candidate) <> 'object'
      or (v_candidate ->> 'kid') !~ '^[1-9][0-9]{0,4}$'
      or char_length(v_candidate ->> 'digest') <> 66
      or left(v_candidate ->> 'digest', 2) <> '\x'
      or substring(v_candidate ->> 'digest' from 3) !~ '^[0-9a-f]{64}$'
    then
      raise exception 'external_intake_replay_candidates_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if not exists (
    select 1
    from jsonb_array_elements(p_idempotency_candidates) candidate(value)
    where (candidate.value ->> 'kid')::smallint
        = p_idempotency_digest_version
      and decode(
        substring(candidate.value ->> 'digest' from 3),
        'hex'
      ) = p_idempotency_digest
  ) then
    raise exception 'external_intake_active_replay_digest_missing'
      using errcode = '22023';
  end if;

  for v_candidate in
    select candidate.value
    from jsonb_array_elements(p_external_submission_candidates) candidate(value)
  loop
    if jsonb_typeof(v_candidate) <> 'object'
      or (v_candidate ->> 'kid') !~ '^[1-9][0-9]{0,4}$'
      or char_length(v_candidate ->> 'digest') <> 66
      or left(v_candidate ->> 'digest', 2) <> '\x'
      or substring(v_candidate ->> 'digest' from 3) !~ '^[0-9a-f]{64}$'
    then
      raise exception 'external_intake_replay_candidates_invalid'
        using errcode = '22023';
    end if;
  end loop;

  if p_external_submission_digest is not null
    and not exists (
      select 1
      from jsonb_array_elements(p_external_submission_candidates)
        candidate(value)
      where (candidate.value ->> 'kid')::smallint
          = p_external_submission_digest_version
        and decode(
          substring(candidate.value ->> 'digest' from 3),
          'hex'
        ) = p_external_submission_digest
    )
  then
    raise exception 'external_intake_active_external_digest_missing'
      using errcode = '22023';
  end if;

  perform private.insert_external_api_authenticated_audit_base(
    p_request_id,
    p_principal_id,
    p_credential_id,
    p_route,
    p_method,
    p_request_received_at
  );
  perform private.require_external_intake_credential(
    p_principal_id,
    p_credential_id,
    p_company_id,
    p_digest_version,
    p_credential_digest,
    p_visible_prefix,
    p_authorization_epoch
  );
  perform private.lock_external_api_company_shared(p_company_id);
  perform private.lock_lead_assignment_company(p_company_id);

  select source.*
  into v_source
  from private.lead_intake_sources source
  join private.external_api_principal_sources source_grant
    on source_grant.source_id = source.id
   and source_grant.company_id = source.company_id
  where source.public_source_id = p_source_public_id
    and source.company_id = p_company_id
    and source.status = 'active'
    and source_grant.principal_id = p_principal_id
  for share of source, source_grant;

  if not found
    or (
      p_requested_origin is not null
      and not (p_requested_origin = any(v_source.allowed_browser_origins))
    )
  then
    return jsonb_build_object('status', 'source_not_allowed');
  end if;

  select form_row.*
  into v_form
  from private.lead_intake_forms form_row
  where form_row.public_form_id = p_form_public_id
    and form_row.company_id = p_company_id
    and form_row.source_id = v_source.id
    and form_row.is_active
  for share;

  if not found then
    return jsonb_build_object('status', 'form_not_allowed');
  end if;

  -- Serialize replay identities before any customer or lead write.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_company_id::text || E'\nprincipal-replay\n'
        || encode(p_idempotency_digest, 'hex'),
      0
    )
  );
  if p_external_submission_digest is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_company_id::text || E'\nexternal-replay\n'
          || encode(p_external_submission_digest, 'hex'),
        0
      )
    );
  end if;

  with candidates as (
    select
      (candidate.value ->> 'kid')::smallint as kid,
      decode(substring(candidate.value ->> 'digest' from 3), 'hex') as digest
    from jsonb_array_elements(p_idempotency_candidates) candidate(value)
  )
  select coalesce(
    array_agg(distinct replay.submission_id order by replay.submission_id),
    '{}'::uuid[]
  )
  into v_existing_ids
  from private.external_intake_submission_replay_digests replay
  join candidates
    on candidates.kid = replay.digest_version
   and candidates.digest = replay.identity_digest
  where replay.company_id = p_company_id
    and replay.identity_kind = 'principal_idempotency';

  if cardinality(v_existing_ids) > 1 then
    raise exception 'external_intake_submission_replay_split_brain'
      using errcode = '55000';
  end if;
  v_idempotency_submission_id := v_existing_ids[1];

  if p_external_submission_digest is not null then
    with candidates as (
      select
        (candidate.value ->> 'kid')::smallint as kid,
        decode(substring(candidate.value ->> 'digest' from 3), 'hex') as digest
      from jsonb_array_elements(p_external_submission_candidates)
        candidate(value)
    )
    select coalesce(
      array_agg(distinct replay.submission_id order by replay.submission_id),
      '{}'::uuid[]
    )
    into v_existing_ids
    from private.external_intake_submission_replay_digests replay
    join candidates
      on candidates.kid = replay.digest_version
     and candidates.digest = replay.identity_digest
    where replay.company_id = p_company_id
      and replay.identity_kind = 'source_external_id';

    if cardinality(v_existing_ids) > 1 then
      raise exception 'external_intake_submission_replay_split_brain'
        using errcode = '55000';
    end if;
    v_external_submission_id := v_existing_ids[1];
  end if;

  if v_idempotency_submission_id is not null
    and v_external_submission_id is not null
    and v_idempotency_submission_id <> v_external_submission_id
  then
    raise exception 'external_intake_submission_replay_split_brain'
      using errcode = '55000';
  end if;

  if v_idempotency_submission_id is not null
    or v_external_submission_id is not null
  then
    select submission.*
    into v_existing
    from private.external_intake_submissions submission
    where submission.id = coalesce(
      v_idempotency_submission_id,
      v_external_submission_id
    )
    for share;

    if v_existing.canonical_request_hash <> p_canonical_request_hash then
      if v_idempotency_submission_id is not null then
        return jsonb_build_object('status', 'idempotency_conflict');
      end if;
      return jsonb_build_object('status', 'external_submission_conflict');
    end if;
    if v_existing.company_id <> p_company_id
      or v_existing.principal_id <> p_principal_id
      or v_existing.source_id <> v_source.id
      or v_existing.form_id <> v_form.id
      or v_existing.canonicalization_version <> p_canonicalization_version
      or v_existing.evidence_schema_version <> p_evidence_schema_version
    then
      raise exception 'external_intake_submission_replay_identity_changed'
        using errcode = '55000';
    end if;

    return private.external_intake_submission_result(v_existing.id, true);
  end if;

  v_contact_name := btrim(p_normalized_contact ->> 'name');
  v_contact_email := nullif(p_normalized_contact ->> 'email', '');
  v_contact_phone := nullif(p_normalized_contact ->> 'phone', '');
  v_organization_name := nullif(
    btrim(p_normalized_contact ->> 'organizationName'),
    ''
  );

  -- Sorted company-scoped identity locks, followed by a repeated lookup.
  for v_identity_key in
    select identity_key
    from (
      values
        (case when v_contact_email is null then null
          else 'email:' || v_contact_email end),
        (case when v_contact_phone is null then null
          else 'phone:' || v_contact_phone end)
    ) identity(identity_key)
    where identity_key is not null
    order by identity_key
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_company_id::text || E'\ncontact-identity\n' || v_identity_key,
        0
      )
    );
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entity_kind', matched.entity_kind,
        'entity_id', matched.entity_id,
        'parent_client_id', matched.parent_client_id
      )
      order by matched.entity_kind, matched.entity_id
    ),
    '[]'::jsonb
  )
  into v_matches
  from (
    select distinct
      identity.entity_kind,
      identity.entity_id,
      case
        when identity.entity_kind = 'client' then client.id
        else sub_client.client_id
      end as parent_client_id
    from private.external_contact_identities identity
    left join public.clients client
      on identity.entity_kind = 'client'
     and client.id = identity.entity_id
     and client.company_id = identity.company_id
     and client.deleted_at is null
    left join public.sub_clients sub_client
      on identity.entity_kind = 'sub_client'
     and sub_client.id = identity.entity_id
     and sub_client.company_id = identity.company_id
     and sub_client.deleted_at is null
    where identity.company_id = p_company_id
      and (
        (
          v_contact_email is not null
          and identity.normalized_email = v_contact_email
        )
        or (
          v_contact_phone is not null
          and identity.normalized_phone = v_contact_phone
        )
      )
      and (
        (identity.entity_kind = 'client' and client.id is not null)
        or
        (identity.entity_kind = 'sub_client' and sub_client.id is not null)
      )
  ) matched;

  v_match_count := jsonb_array_length(v_matches);
  if v_match_count = 1 then
    v_match := v_matches -> 0;
    v_client_id := (v_match ->> 'parent_client_id')::uuid;
    v_sub_client_id := case
      when v_match ->> 'entity_kind' = 'sub_client'
        then (v_match ->> 'entity_id')::uuid
      else null
    end;
    v_customer_outcome := 'matched';
  else
    if v_organization_name is not null then
      insert into public.clients (
        company_id,
        name
      ) values (
        p_company_id,
        v_organization_name
      )
      returning id into v_client_id;

      insert into public.sub_clients (
        company_id,
        client_id,
        name,
        email,
        phone_number
      ) values (
        p_company_id,
        v_client_id,
        v_contact_name,
        v_contact_email,
        v_contact_phone
      )
      returning id into v_sub_client_id;
    else
      insert into public.clients (
        company_id,
        name,
        email,
        phone_number
      ) values (
        p_company_id,
        v_contact_name,
        v_contact_email,
        v_contact_phone
      )
      returning id into v_client_id;
    end if;

    v_customer_outcome := case
      when v_match_count = 0 then 'created'
      else 'created_possible_duplicate'
    end;
  end if;

  v_work_summary := nullif(
    btrim(p_canonical_submission ->> 'workSummary'),
    ''
  );
  v_preferred_timing := nullif(
    btrim(p_canonical_submission ->> 'preferredTiming'),
    ''
  );
  v_service_address := case
    when jsonb_typeof(p_canonical_submission -> 'serviceAddress') = 'object'
    then concat_ws(
      ', ',
      nullif(p_canonical_submission #>> '{serviceAddress,line1}', ''),
      nullif(p_canonical_submission #>> '{serviceAddress,line2}', ''),
      nullif(p_canonical_submission #>> '{serviceAddress,city}', ''),
      nullif(p_canonical_submission #>> '{serviceAddress,region}', ''),
      nullif(p_canonical_submission #>> '{serviceAddress,postalCode}', ''),
      nullif(p_canonical_submission #>> '{serviceAddress,countryCode}', '')
    )
    else null
  end;
  v_source_thread_key := 'external_intake:'
    || v_source.public_source_id::text
    || ':submission:'
    || v_public_submission_id::text;

  insert into public.opportunities (
    id,
    company_id,
    client_id,
    client_ref,
    title,
    description,
    contact_name,
    contact_email,
    contact_phone,
    stage,
    source,
    assigned_to,
    assignment_version,
    address,
    source_metadata,
    source_thread_key,
    stage_entered_at,
    created_at,
    updated_at
  ) values (
    v_opportunity_id,
    p_company_id,
    v_client_id,
    v_client_id,
    left(
      coalesce(v_work_summary, v_organization_name, v_contact_name),
      240
    ),
    concat_ws(
      E'\n\n',
      v_work_summary,
      case
        when v_preferred_timing is null then null
        else 'Preferred timing: ' || v_preferred_timing
      end
    ),
    v_contact_name,
    v_contact_email,
    v_contact_phone,
    'new_lead',
    v_source.default_coarse_source,
    null,
    0,
    nullif(v_service_address, ''),
    jsonb_build_object(
      'integration_type', 'external_intake',
      'public_submission_id',
        private.external_opaque_uuid('sub', v_public_submission_id)
    ),
    v_source_thread_key,
    p_request_received_at,
    p_request_received_at,
    p_request_received_at
  )
  returning created_at into v_created_at;

  insert into private.external_intake_submissions (
    id,
    public_submission_id,
    company_id,
    principal_id,
    credential_id,
    source_id,
    form_id,
    opportunity_id,
    matched_client_id,
    matched_sub_client_id,
    normalized_email,
    normalized_phone,
    customer_outcome,
    evidence_schema_version,
    canonicalization_version,
    canonical_request_hash,
    original_contact,
    original_organization,
    original_work,
    original_service_address,
    ordered_answers,
    raw_attribution,
    raw_source_payload,
    external_reference,
    created_at
  ) values (
    v_submission_id,
    v_public_submission_id,
    p_company_id,
    p_principal_id,
    p_credential_id,
    v_source.id,
    v_form.id,
    v_opportunity_id,
    v_client_id,
    v_sub_client_id,
    v_contact_email,
    v_contact_phone,
    v_customer_outcome,
    p_evidence_schema_version,
    p_canonicalization_version,
    p_canonical_request_hash,
    p_original_evidence -> 'contact',
    case
      when p_original_evidence #>> '{contact,organizationName}' is null
        then '{}'::jsonb
      else jsonb_build_object(
        'name',
        p_original_evidence #>> '{contact,organizationName}'
      )
    end,
    jsonb_strip_nulls(jsonb_build_object(
      'workSummary', p_original_evidence -> 'workSummary',
      'preferredTiming', p_original_evidence -> 'preferredTiming'
    )),
    coalesce(
      p_original_evidence -> 'serviceAddress',
      '{}'::jsonb
    ),
    coalesce(p_original_evidence -> 'answers', '[]'::jsonb),
    coalesce(p_original_evidence -> 'attribution', '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'sourceId', p_original_evidence -> 'sourceId',
      'formId', p_original_evidence -> 'formId',
      'requestedOrigin', to_jsonb(p_requested_origin)
    )),
    case
      when p_original_evidence -> 'externalSubmissionId' is null
        then '{}'::jsonb
      else jsonb_build_object(
        'externalSubmissionId',
        p_original_evidence -> 'externalSubmissionId'
      )
    end,
    p_request_received_at
  );

  insert into private.external_intake_submission_replay_digests (
    submission_id,
    company_id,
    identity_kind,
    digest_version,
    identity_digest
  ) values (
    v_submission_id,
    p_company_id,
    'principal_idempotency',
    p_idempotency_digest_version,
    p_idempotency_digest
  );

  if p_external_submission_digest is not null then
    insert into private.external_intake_submission_replay_digests (
      submission_id,
      company_id,
      identity_kind,
      digest_version,
      identity_digest
    ) values (
      v_submission_id,
      p_company_id,
      'source_external_id',
      p_external_submission_digest_version,
      p_external_submission_digest
    );
  end if;

  if v_match_count > 1 then
    insert into private.external_intake_possible_duplicates (
      submission_id,
      company_id,
      candidate_entities,
      matched_signals
    ) values (
      v_submission_id,
      p_company_id,
      v_matches,
      (
        select jsonb_agg(signal order by signal)
        from (
          values
            (case when v_contact_email is null then null else 'email' end),
            (case when v_contact_phone is null then null else 'phone' end)
        ) signals(signal)
        where signal is not null
      )
    );
  end if;

  -- Claim each opaque upload exactly once. A truly absent object is terminal
  -- for that attachment only and never rolls back the inquiry.
  v_requested_upload_count := cardinality(p_upload_ids);
  for v_upload_id, v_upload_ordinal in
    select requested.public_upload_id, requested.ordinal
    from unnest(p_upload_ids) with ordinality
      requested(public_upload_id, ordinal)
    order by requested.ordinal
  loop
    select intent.*
    into v_intent
    from private.external_intake_upload_intents intent
    join private.external_intake_upload_batches batch
      on batch.id = intent.batch_id
     and batch.company_id = intent.company_id
    where intent.public_upload_id = v_upload_id
    for update of intent, batch;

    if not found then
      return jsonb_build_object('status', 'upload_not_found');
    end if;

    select batch.*
    into v_batch
    from private.external_intake_upload_batches batch
    where batch.id = v_intent.batch_id
      and batch.company_id = v_intent.company_id;

    if v_intent.company_id <> p_company_id
      or v_batch.principal_id <> p_principal_id
      or v_batch.source_id <> v_source.id
      or v_batch.form_id <> v_form.id
    then
      raise exception 'external_intake_upload_scope_mismatch'
        using errcode = '42501';
    end if;
    if exists (
      select 1
      from private.external_intake_submission_uploads claimed
      where claimed.intent_id = v_intent.id
    ) then
      raise exception 'external_intake_upload_claim_conflict'
        using errcode = '23505';
    end if;

    if v_intent.state = 'issued' and v_intent.object_version_id is null then
      update private.external_intake_upload_intents intent
      set state = 'closed_missing',
          safe_code = 'object_missing'
      where intent.id = v_intent.id;
      perform private.release_external_intake_pending_object(v_intent.id);
      v_attachment_state := 'missing';
    elsif v_intent.state = 'uploaded'
      and v_intent.object_version_id is not null
      and v_intent.observed_size_bytes = v_intent.expected_size_bytes
      and (
        v_intent.expected_checksum_sha256 is null
        or v_intent.observed_checksum_sha256
          = v_intent.expected_checksum_sha256
      )
    then
      update private.external_intake_upload_intents intent
      set state = 'claimed'
      where intent.id = v_intent.id;
      v_attachment_state := 'pending_inspection';
    elsif v_intent.state in ('accepted', 'rejected', 'closed_missing', 'expired')
    then
      v_attachment_state :=
        private.external_intake_attachment_state(v_intent.state);
    else
      raise exception 'external_intake_upload_claim_conflict'
        using errcode = '23505';
    end if;

    insert into private.external_intake_submission_uploads (
      submission_id,
      company_id,
      intent_id,
      public_upload_id,
      ordinal,
      attachment_state
    ) values (
      v_submission_id,
      p_company_id,
      v_intent.id,
      v_intent.public_upload_id,
      v_upload_ordinal::integer,
      v_attachment_state
    );
  end loop;

  if (
    select count(*)
    from private.external_intake_submission_uploads upload
    where upload.submission_id = v_submission_id
  ) <> v_requested_upload_count then
    raise exception 'external_intake_upload_claim_conflict'
      using errcode = '23505';
  end if;

  -- Resolve source-scoped attribution through every retained keyed digest.
  if (
    select count(distinct candidate.value ->> 'dimension')
    from jsonb_array_elements(p_attribution_candidates) candidate(value)
  ) <> jsonb_array_length(p_attribution_candidates) then
    raise exception 'external_intake_attribution_candidates_invalid'
      using errcode = '22023';
  end if;

  for v_attribution_candidate in
    select candidate.value
    from jsonb_array_elements(p_attribution_candidates) candidate(value)
    order by candidate.value ->> 'dimension'
  loop
    if jsonb_typeof(v_attribution_candidate) <> 'object'
      or v_attribution_candidate ->> 'dimension' not in (
        'campaign',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'landing_path',
        'referrer_path'
      )
      or (v_attribution_candidate ->> 'activeKid')
        !~ '^[1-9][0-9]{0,4}$'
      or char_length(v_attribution_candidate ->> 'activeDigest') <> 66
      or left(v_attribution_candidate ->> 'activeDigest', 2) <> '\x'
      or substring(v_attribution_candidate ->> 'activeDigest' from 3)
        !~ '^[0-9a-f]{64}$'
      or (v_attribution_candidate ->> 'publicId')::uuid is null
      or jsonb_typeof(v_attribution_candidate -> 'candidates') <> 'array'
      or jsonb_array_length(v_attribution_candidate -> 'candidates')
        not between 1 and 32
    then
      raise exception 'external_intake_attribution_candidates_invalid'
        using errcode = '22023';
    end if;

    v_active_attribution_digest := decode(
      substring(v_attribution_candidate ->> 'activeDigest' from 3),
      'hex'
    );

    if (
      select count(*)
      from jsonb_array_elements(
        v_attribution_candidate -> 'candidates'
      ) candidate(value)
      where jsonb_typeof(candidate.value) = 'object'
        and (candidate.value ->> 'kid') ~ '^[1-9][0-9]{0,4}$'
        and char_length(candidate.value ->> 'digest') = 66
        and left(candidate.value ->> 'digest', 2) = '\x'
        and substring(candidate.value ->> 'digest' from 3)
          ~ '^[0-9a-f]{64}$'
    ) <> jsonb_array_length(v_attribution_candidate -> 'candidates')
      or not exists (
        select 1
        from jsonb_array_elements(
          v_attribution_candidate -> 'candidates'
        ) candidate(value)
        where jsonb_typeof(candidate.value) = 'object'
          and (candidate.value ->> 'kid') ~ '^[1-9][0-9]{0,4}$'
          and char_length(candidate.value ->> 'digest') = 66
          and left(candidate.value ->> 'digest', 2) = '\x'
          and substring(candidate.value ->> 'digest' from 3)
            ~ '^[0-9a-f]{64}$'
          and (candidate.value ->> 'kid')::smallint
            = (v_attribution_candidate ->> 'activeKid')::smallint
          and decode(
            substring(candidate.value ->> 'digest' from 3),
            'hex'
          ) = v_active_attribution_digest
      )
    then
      raise exception 'external_intake_attribution_candidates_invalid'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        p_company_id::text
          || E'\nattribution\n'
          || (v_attribution_candidate ->> 'dimension')
          || E'\n'
          || encode(v_active_attribution_digest, 'hex'),
        0
      )
    );

    with candidates as (
      select
        (candidate.value ->> 'kid')::smallint as kid,
        decode(
          substring(candidate.value ->> 'digest' from 3),
          'hex'
        ) as digest
      from jsonb_array_elements(
        v_attribution_candidate -> 'candidates'
      ) candidate(value)
      where jsonb_typeof(candidate.value) = 'object'
        and (candidate.value ->> 'kid') ~ '^[1-9][0-9]{0,4}$'
        and char_length(candidate.value ->> 'digest') = 66
        and left(candidate.value ->> 'digest', 2) = '\x'
        and substring(candidate.value ->> 'digest' from 3)
          ~ '^[0-9a-f]{64}$'
    )
    select coalesce(
      array_agg(
        distinct lookup.dictionary_id
        order by lookup.dictionary_id
      ),
      '{}'::uuid[]
    )
    into v_dictionary_ids
    from private.external_attribution_lookup_digests lookup
    join candidates
      on candidates.kid = lookup.lookup_key_version
     and candidates.digest = lookup.lookup_digest
    join private.external_attribution_dictionary dictionary
      on dictionary.id = lookup.dictionary_id
     and dictionary.company_id = lookup.company_id
    where lookup.company_id = p_company_id
      and dictionary.source_id = v_source.id
      and dictionary.dimension
        = v_attribution_candidate ->> 'dimension';

    if cardinality(v_dictionary_ids) > 1 then
      raise exception 'external_intake_attribution_split_brain'
        using errcode = '55000';
    end if;

    v_dictionary_id := v_dictionary_ids[1];
    if v_dictionary_id is null then
      insert into private.external_attribution_dictionary (
        company_id,
        source_id,
        dimension,
        public_attribution_id
      ) values (
        p_company_id,
        v_source.id,
        v_attribution_candidate ->> 'dimension',
        (v_attribution_candidate ->> 'publicId')::uuid
      )
      returning id into v_dictionary_id;
    end if;

    insert into private.external_attribution_lookup_digests (
      dictionary_id,
      company_id,
      lookup_key_version,
      lookup_digest
    ) values (
      v_dictionary_id,
      p_company_id,
      (v_attribution_candidate ->> 'activeKid')::smallint,
      v_active_attribution_digest
    )
    on conflict (dictionary_id, lookup_key_version) do nothing;

    perform 1
    from private.external_attribution_lookup_digests lookup
    where lookup.dictionary_id = v_dictionary_id
      and lookup.company_id = p_company_id
      and lookup.lookup_key_version
        = (v_attribution_candidate ->> 'activeKid')::smallint
      and lookup.lookup_digest = v_active_attribution_digest;
    if not found then
      raise exception 'external_intake_attribution_split_brain'
        using errcode = '55000';
    end if;

    select dictionary.*
    into v_dictionary
    from private.external_attribution_dictionary dictionary
    where dictionary.id = v_dictionary_id
      and dictionary.company_id = p_company_id
      and dictionary.source_id = v_source.id
      and dictionary.dimension
        = v_attribution_candidate ->> 'dimension';

    if not found then
      raise exception 'external_intake_attribution_scope_mismatch'
        using errcode = '55000';
    end if;

    insert into private.external_intake_submission_attribution (
      submission_id,
      company_id,
      dimension,
      dictionary_id
    ) values (
      v_submission_id,
      p_company_id,
      v_dictionary.dimension,
      v_dictionary.id
    );

    v_prefix := case
      when v_dictionary.dimension = 'campaign' then 'cmp'
      when v_dictionary.dimension in ('landing_path', 'referrer_path')
        then 'path'
      else 'attr'
    end;
    v_handle := private.external_opaque_uuid(
      v_prefix,
      v_dictionary.public_attribution_id
    );
    v_label := case
      when v_dictionary.label_approved
        then v_dictionary.approved_label
      else null
    end;
    v_attribution_map := v_attribution_map
      || jsonb_build_object(
        v_dictionary.dimension,
        jsonb_build_object(
          'handle', v_handle,
          'label', v_label
        )
      );
  end loop;

  -- Default-owner assignment is an ordinary guarded assignment mutation.
  if v_source.default_intake_owner_id is not null
    and private.company_mailbox_intake_owner_is_eligible(
      v_source.default_intake_owner_id,
      p_company_id
    )
  then
    v_assignment_result := private.change_opportunity_assignment_core(
      v_opportunity_id,
      0,
      null,
      v_source.default_intake_owner_id,
      'external_intake_default',
      null,
      p_company_id,
      true,
      null,
      jsonb_build_object(
        'source_kind', 'external_intake',
        'source_id', v_source.public_source_id,
        'intake_owner_source', 'lead_intake_sources.default_intake_owner_id'
      )
    );
    if not coalesce((v_assignment_result ->> 'ok')::boolean, false)
      or coalesce((v_assignment_result ->> 'conflict')::boolean, false)
    then
      raise exception 'external_intake_default_assignment_failed'
        using errcode = '55000';
    end if;
  else
    v_prompt_count := private.enqueue_unassigned_lead_assignment_deliveries(
      p_company_id,
      v_opportunity_id,
      'external_intake',
      v_source.id
    );
  end if;

  -- Pre-create the opaque lead handle so the first immutable projection can
  -- contain the same public identifier appended by the foundation helper.
  insert into private.external_lead_handles (
    company_id,
    opportunity_id
  ) values (
    p_company_id,
    v_opportunity_id
  )
  on conflict (company_id, opportunity_id) do nothing;

  select handle.public_lead_id
  into strict v_public_lead_id
  from private.external_lead_handles handle
  where handle.company_id = p_company_id
    and handle.opportunity_id = v_opportunity_id;

  v_public_source := jsonb_build_object(
    'sourceChannel', case v_source.default_coarse_source
      when 'social_media' then 'social'
      when 'repeat_client' then 'repeat_business'
      else v_source.default_coarse_source
    end,
    'sourceIntegrationType', 'external_intake',
    'sourceId', private.external_opaque_uuid(
      'src',
      v_source.public_source_id
    ),
    'sourceLabel', v_source.site_label,
    'siteHost', v_source.canonical_host,
    'siteLabel', v_source.site_label,
    'formId', private.external_opaque_uuid('frm', v_form.public_form_id),
    'formLabel', v_form.label,
    'campaign', case
      when v_attribution_map ? 'campaign' then jsonb_build_object(
        'present', true,
        'handle', v_attribution_map #>> '{campaign,handle}',
        'label', v_attribution_map #> '{campaign,label}'
      )
      else '{"present":false,"handle":null,"label":null}'::jsonb
    end,
    'utm', jsonb_build_object(
      'source', case
        when v_attribution_map ? 'utm_source' then jsonb_build_object(
          'present', true,
          'handle', v_attribution_map #>> '{utm_source,handle}',
          'label', v_attribution_map #> '{utm_source,label}'
        )
        else '{"present":false,"handle":null,"label":null}'::jsonb
      end,
      'medium', case
        when v_attribution_map ? 'utm_medium' then jsonb_build_object(
          'present', true,
          'handle', v_attribution_map #>> '{utm_medium,handle}',
          'label', v_attribution_map #> '{utm_medium,label}'
        )
        else '{"present":false,"handle":null,"label":null}'::jsonb
      end,
      'campaign', case
        when v_attribution_map ? 'utm_campaign' then jsonb_build_object(
          'present', true,
          'handle', v_attribution_map #>> '{utm_campaign,handle}',
          'label', v_attribution_map #> '{utm_campaign,label}'
        )
        else '{"present":false,"handle":null,"label":null}'::jsonb
      end,
      'term', case
        when v_attribution_map ? 'utm_term' then jsonb_build_object(
          'present', true,
          'handle', v_attribution_map #>> '{utm_term,handle}',
          'label', v_attribution_map #> '{utm_term,label}'
        )
        else '{"present":false,"handle":null,"label":null}'::jsonb
      end,
      'content', case
        when v_attribution_map ? 'utm_content' then jsonb_build_object(
          'present', true,
          'handle', v_attribution_map #>> '{utm_content,handle}',
          'label', v_attribution_map #> '{utm_content,label}'
        )
        else '{"present":false,"handle":null,"label":null}'::jsonb
      end
    ),
    'click', jsonb_build_object(
      'providerCode',
        p_canonical_submission #>> '{attribution,clickProviderCode}',
      'captured',
        nullif(p_canonical_submission #>> '{attribution,clickId}', '')
          is not null
    ),
    'landingPage', case
      when v_attribution_map ? 'landing_path' then jsonb_build_object(
        'host',
          p_canonical_submission #>> '{attribution,landingPage,host}',
        'pathHandle', v_attribution_map #>> '{landing_path,handle}',
        'routeLabel', v_attribution_map #> '{landing_path,label}'
      )
      else null
    end,
    'referrer', case
      when v_attribution_map ? 'referrer_path' then jsonb_build_object(
        'host', p_canonical_submission #>> '{attribution,referrer,host}',
        'pathHandle', v_attribution_map #>> '{referrer_path,handle}',
        'routeLabel', v_attribution_map #> '{referrer_path,label}'
      )
      else null
    end,
    'inquiryReceivedAt',
      private.external_intake_minute(p_request_received_at),
    'leadCreatedAt', private.external_intake_minute(v_created_at),
    'attributionCapturedAt',
      private.external_intake_minute(p_request_received_at),
    'timingSource', 'authenticated_request',
    'timingQuality', 'exact',
    'completeness', jsonb_build_object(
      'channelKnown', true,
      'authenticatedSite', true,
      'configuredForm', true,
      'campaignObserved', v_attribution_map ? 'campaign',
      'utmSetObserved', (
        v_attribution_map ? 'utm_source'
        or v_attribution_map ? 'utm_medium'
        or v_attribution_map ? 'utm_campaign'
        or v_attribution_map ? 'utm_term'
        or v_attribution_map ? 'utm_content'
      ),
      'landingPageObserved', v_attribution_map ? 'landing_path',
      'referrerObserved', v_attribution_map ? 'referrer_path'
    )
  );

  v_normalized_source := jsonb_build_object(
    'source_id', v_source.id,
    'form_id', v_form.id,
    'submission_id', v_submission_id,
    'request_received_at', p_request_received_at,
    'configured_coarse_source', v_source.default_coarse_source,
    'attribution_dictionary', v_attribution_map
  );

  v_public_projection := jsonb_build_object(
    'operation', 'upsert',
    'publicLeadId', private.external_opaque_uuid(
      'lead',
      v_public_lead_id
    ),
    'inquiryReceivedAt',
      private.external_intake_minute(p_request_received_at),
    'createdAt', private.external_intake_minute(v_created_at),
    'updatedAt', private.external_intake_minute(v_created_at),
    'currentStageEnteredAt',
      private.external_intake_minute(p_request_received_at),
    'terminalAt', null,
    'currentStage', 'new_lead',
    'disposition', null,
    'recordState', 'active',
    'mergeTargetPublicLeadId', null,
    'source', v_public_source,
    'firstResponseAt', null,
    'firstResponseMinutes', null,
    'wonAt', null,
    'lostAt', null,
    'disqualifiedAt', null,
    'discardedAt', null,
    'projectConvertedAt', null,
    'minutesToDecision', null,
    'minutesToWin', null,
    'minutesToProjectConversion', null,
    'reached', jsonb_build_object(
      'qualifying', false,
      'quoting', false,
      'quoted', false,
      'followUp', false,
      'negotiation', false,
      'won', false,
      'lost', false,
      'projectConverted', false
    )
  );

  select projection.change_sequence
  into v_projection_sequence
  from private.append_external_lead_projection_foundation(
    p_company_id,
    v_opportunity_id,
    1::smallint,
    'upsert',
    v_normalized_source,
    v_public_projection,
    v_created_at
  ) projection;

  insert into private.external_intake_post_commit_outbox (
    company_id,
    submission_id,
    opportunity_id,
    event_payload
  ) values (
    p_company_id,
    v_submission_id,
    v_opportunity_id,
    jsonb_build_object(
      'public_submission_id',
        private.external_opaque_uuid('sub', v_public_submission_id),
      'public_lead_id',
        private.external_opaque_uuid('lead', v_public_lead_id),
      'source_id',
        private.external_opaque_uuid('src', v_source.public_source_id),
      'projection_sequence', v_projection_sequence,
      'assignment_prompt_count', v_prompt_count
    )
  );

  return private.external_intake_submission_result(v_submission_id, false);
exception
  when unique_violation then
    -- Every natural replay/identity path is locked and handled above. A
    -- remaining uniqueness collision is an invariant failure, never a retry
    -- that is allowed to create a second customer or lead.
    raise exception 'external_intake_atomic_uniqueness_conflict'
      using errcode = '40001';
end;
$function$;

create or replace function private.unassigned_lead_delivery_source_is_active(
  p_company_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_opportunity_source text
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select case
    when p_source_kind = 'email_connection' then exists (
      select 1
      from public.email_connections connection
      where connection.id = p_source_id
        and private.try_parse_uuid(connection.company_id) = p_company_id
        and connection.type::text = 'company'
        and connection.status = 'active'
        and p_opportunity_source = 'email'
    )
    when p_source_kind = 'external_intake' then exists (
      select 1
      from private.lead_intake_sources source
      where source.id = p_source_id
        and source.company_id = p_company_id
        and source.status = 'active'
        and source.default_coarse_source = p_opportunity_source
    )
    else false
  end;
$function$;

drop function public.claim_unassigned_lead_assignment_deliveries(
  uuid, integer, integer
);

create function public.claim_unassigned_lead_assignment_deliveries(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns table (
  delivery_id uuid,
  delivery_lease_token uuid,
  company_id uuid,
  opportunity_id uuid,
  source_kind text,
  source_id uuid,
  recipient_user_id uuid,
  notification_id uuid,
  lead_title text,
  should_push boolean,
  requires_notification boolean,
  disposition text
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  delivery public.unassigned_lead_assignment_deliveries%rowtype;
  opportunity public.opportunities%rowtype;
  recipient public.users%rowtype;
  preference public.notification_preferences%rowtype;
  v_company_id uuid;
  v_limit integer := greatest(0, least(coalesce(p_limit, 25), 100));
  v_lease_seconds integer :=
    greatest(30, least(coalesce(p_lease_seconds, 180), 900));
  v_claimed integer := 0;
  v_lease_token uuid;
  v_notification_id uuid;
  v_dedupe_key text;
  v_lead_title text;
  v_preference_push jsonb;
  v_should_push boolean;
  v_disposition text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_worker_id is null then
    raise exception 'unassigned_lead_delivery_worker_id_required'
      using errcode = '22023';
  end if;
  if v_limit = 0 then
    return;
  end if;

  for v_company_id in
    select candidate.company_id
    from public.unassigned_lead_assignment_deliveries candidate
    where (
      (
        candidate.state in ('pending', 'failed')
        and candidate.available_at <= now()
        and candidate.attempts < candidate.max_attempts
      )
      or (
        candidate.state = 'processing'
        and candidate.lease_expires_at <= now()
      )
    )
    group by candidate.company_id
    order by candidate.company_id
    fetch first v_limit rows only
  loop
    perform private.lock_lead_assignment_company(v_company_id);

    for delivery in
      select candidate.*
      from public.unassigned_lead_assignment_deliveries candidate
      where candidate.company_id = v_company_id
        and (
          (
            candidate.state in ('pending', 'failed')
            and candidate.available_at <= now()
            and candidate.attempts < candidate.max_attempts
          )
          or (
            candidate.state = 'processing'
            and candidate.lease_expires_at <= now()
          )
        )
      order by
        case
          when candidate.state = 'processing'
            then candidate.lease_expires_at
          else candidate.available_at
        end,
        candidate.created_at,
        candidate.id
      for update of candidate skip locked
      fetch first greatest(0, v_limit - v_claimed) rows only
    loop
      if v_claimed >= v_limit then
        exit;
      end if;
      v_claimed := v_claimed + 1;

      if delivery.state = 'processing'
        and delivery.attempts >= delivery.max_attempts
      then
        update public.unassigned_lead_assignment_deliveries row
        set state = 'failed',
            claimed_at = null,
            claimed_by = null,
            lease_token = null,
            lease_expires_at = null,
            disposition = 'terminal_failure',
            push_state = 'failed',
            available_at = 'infinity'::timestamptz,
            terminal_at = now(),
            last_error = coalesce(
              row.last_error,
              'lease expired after maximum attempts'
            ),
            updated_at = now()
        where row.id = delivery.id;

        return query values (
          delivery.id,
          null::uuid,
          delivery.company_id,
          delivery.opportunity_id,
          delivery.source_kind,
          delivery.source_id,
          delivery.recipient_user_id,
          delivery.notification_id,
          'New lead'::text,
          false,
          false,
          'terminal_failure'::text
        );
        continue;
      end if;

      select opportunity_row.*
      into opportunity
      from public.opportunities opportunity_row
      where opportunity_row.id = delivery.opportunity_id
      for share;

      select user_row.*
      into recipient
      from public.users user_row
      where user_row.id = delivery.recipient_user_id
      for share;

      select preferences.*
      into preference
      from public.notification_preferences preferences
      where preferences.user_id = delivery.recipient_user_id
        and preferences.company_id = delivery.company_id
      for share;

      v_disposition := null;
      if opportunity.id is null
        or opportunity.company_id is distinct from delivery.company_id
        or opportunity.deleted_at is not null
        or opportunity.archived_at is not null
        or opportunity.stage in ('won', 'lost', 'discarded')
        or opportunity.assigned_to is not null
        or opportunity.assignment_version <> 0
        or not private.unassigned_lead_delivery_source_is_active(
          delivery.company_id,
          delivery.source_kind,
          delivery.source_id,
          opportunity.source
        )
      then
        v_disposition := 'stale';
      elsif recipient.id is null
        or recipient.company_id is distinct from delivery.company_id
        or recipient.deleted_at is not null
        or not coalesce(recipient.is_active, false)
        or not private.permission_user_is_admin(
          delivery.recipient_user_id,
          delivery.company_id
        )
        or private.raw_pipeline_scope_for_user(
          delivery.recipient_user_id,
          delivery.company_id,
          'pipeline.view'
        ) <> 'all'
        or private.raw_pipeline_scope_for_user(
          delivery.recipient_user_id,
          delivery.company_id,
          'pipeline.edit'
        ) <> 'all'
        or private.raw_pipeline_scope_for_user(
          delivery.recipient_user_id,
          delivery.company_id,
          'pipeline.assign'
        ) <> 'all'
      then
        v_disposition := 'inaccessible';
      end if;

      if v_disposition is not null then
        if delivery.notification_id is not null then
          update public.notifications notification
          set is_read = true,
              resolved_at = now(),
              resolution_reason = 'lead_assignment_prompt_suppressed'
          where notification.id = delivery.notification_id
            and notification.dedupe_key =
              'unassigned-lead-assignment-delivery:' || delivery.id::text;
        end if;

        update public.unassigned_lead_assignment_deliveries row
        set state = 'delivered',
            attempts = row.attempts + 1,
            claimed_at = null,
            claimed_by = null,
            lease_token = null,
            lease_expires_at = null,
            disposition = v_disposition,
            push_state = 'suppressed',
            delivered_at = now(),
            terminal_at = null,
            last_error = case v_disposition
              when 'stale' then 'suppressed stale owner prompt'
              else 'suppressed owner prompt for inaccessible recipient'
            end,
            updated_at = now()
        where row.id = delivery.id;

        return query values (
          delivery.id,
          null::uuid,
          delivery.company_id,
          delivery.opportunity_id,
          delivery.source_kind,
          delivery.source_id,
          delivery.recipient_user_id,
          delivery.notification_id,
          coalesce(nullif(btrim(opportunity.title), ''), 'New lead'),
          false,
          false,
          v_disposition
        );
        continue;
      end if;

      v_lead_title := coalesce(
        nullif(btrim(opportunity.title), ''),
        'New lead'
      );
      v_dedupe_key :=
        'unassigned-lead-assignment-delivery:' || delivery.id::text;
      v_notification_id := null;

      insert into public.notifications (
        user_id,
        company_id,
        type,
        title,
        body,
        is_read,
        persistent,
        action_url,
        action_label,
        project_id,
        deep_link_type,
        dedupe_key
      ) values (
        delivery.recipient_user_id::text,
        delivery.company_id::text,
        'lead_assignment_required',
        'Lead needs an owner',
        left('Assign ' || v_lead_title, 140),
        false,
        true,
        '/pipeline?opportunityId=' || delivery.opportunity_id::text,
        'Assign lead',
        null,
        'lead',
        v_dedupe_key
      )
      on conflict do nothing
      returning id into v_notification_id;

      if v_notification_id is null then
        select notification.id
        into v_notification_id
        from public.notifications notification
        where notification.dedupe_key = v_dedupe_key
          and notification.user_id = delivery.recipient_user_id::text
          and notification.company_id = delivery.company_id::text
          and notification.type = 'lead_assignment_required';
      end if;

      if v_notification_id is null then
        raise exception 'lead_assignment_required_notification_missing'
          using errcode = '55000';
      end if;

      v_preference_push :=
        preference.channel_preferences #> '{lead_assignments,push}';
      v_should_push := coalesce(preference.push_enabled, true)
        and case
          when jsonb_typeof(v_preference_push) = 'boolean'
            then (v_preference_push #>> '{}')::boolean
          else true
        end;

      v_lease_token := gen_random_uuid();
      update public.unassigned_lead_assignment_deliveries row
      set state = 'processing',
          attempts = row.attempts + 1,
          claimed_at = now(),
          claimed_by = p_worker_id,
          lease_token = v_lease_token,
          lease_expires_at =
            now() + make_interval(secs => v_lease_seconds),
          notification_id = v_notification_id,
          disposition = 'ready',
          push_state = 'pending',
          terminal_at = null,
          last_error = null,
          updated_at = now()
      where row.id = delivery.id;

      return query values (
        delivery.id,
        v_lease_token,
        delivery.company_id,
        delivery.opportunity_id,
        delivery.source_kind,
        delivery.source_id,
        delivery.recipient_user_id,
        v_notification_id,
        v_lead_title,
        v_should_push,
        true,
        'ready'::text
      );
    end loop;

    exit when v_claimed >= v_limit;
  end loop;
end;
$function$;

create or replace function public.complete_unassigned_lead_assignment_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_push_state text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  delivery public.unassigned_lead_assignment_deliveries%rowtype;
  opportunity public.opportunities%rowtype;
  recipient public.users%rowtype;
  v_company_id uuid;
  v_dedupe_key text;
  v_stale boolean;
  v_inaccessible boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_delivery_id is null
    or p_lease_token is null
    or p_push_state not in ('sent', 'suppressed')
  then
    raise exception 'unassigned_lead_delivery_completion_arguments_invalid'
      using errcode = '22023';
  end if;

  select row.company_id
  into v_company_id
  from public.unassigned_lead_assignment_deliveries row
  where row.id = p_delivery_id;

  if not found then
    raise exception 'unassigned_lead_assignment_delivery_not_found'
      using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select row.*
  into delivery
  from public.unassigned_lead_assignment_deliveries row
  where row.id = p_delivery_id
    and row.company_id = v_company_id
  for update;

  if not found then
    raise exception 'unassigned_lead_assignment_delivery_not_found'
      using errcode = 'P0002';
  end if;

  if delivery.state = 'delivered'
    and delivery.disposition = 'assigned'
  then
    return jsonb_build_object(
      'ok', true,
      'delivery_id', delivery.id,
      'notification_id', delivery.notification_id,
      'suppressed', true,
      'push_state', delivery.push_state
    );
  end if;

  if delivery.state <> 'processing'
    or delivery.lease_token is distinct from p_lease_token
    or delivery.lease_expires_at <= now()
  then
    raise exception 'unassigned_lead_assignment_delivery_lease_inactive'
      using errcode = '55000';
  end if;

  select opportunity_row.*
  into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = delivery.opportunity_id
  for share;

  select user_row.*
  into recipient
  from public.users user_row
  where user_row.id = delivery.recipient_user_id
  for share;

  v_stale := opportunity.id is null
    or opportunity.company_id is distinct from delivery.company_id
    or opportunity.deleted_at is not null
    or opportunity.archived_at is not null
    or opportunity.stage in ('won', 'lost', 'discarded')
    or opportunity.assigned_to is not null
    or opportunity.assignment_version <> 0
    or not private.unassigned_lead_delivery_source_is_active(
      delivery.company_id,
      delivery.source_kind,
      delivery.source_id,
      opportunity.source
    );

  v_inaccessible := recipient.id is null
    or recipient.company_id is distinct from delivery.company_id
    or recipient.deleted_at is not null
    or not coalesce(recipient.is_active, false)
    or not private.permission_user_is_admin(
      delivery.recipient_user_id,
      delivery.company_id
    )
    or private.raw_pipeline_scope_for_user(
      delivery.recipient_user_id,
      delivery.company_id,
      'pipeline.view'
    ) <> 'all'
    or private.raw_pipeline_scope_for_user(
      delivery.recipient_user_id,
      delivery.company_id,
      'pipeline.edit'
    ) <> 'all'
    or private.raw_pipeline_scope_for_user(
      delivery.recipient_user_id,
      delivery.company_id,
      'pipeline.assign'
    ) <> 'all';

  v_dedupe_key :=
    'unassigned-lead-assignment-delivery:' || delivery.id::text;
  if delivery.notification_id is null
    or not exists (
      select 1
      from public.notifications notification
      where notification.id = delivery.notification_id
        and notification.user_id = delivery.recipient_user_id::text
        and notification.company_id = delivery.company_id::text
        and notification.type = 'lead_assignment_required'
        and notification.title = 'Lead needs an owner'
        and notification.persistent is true
        and notification.action_url =
          '/pipeline?opportunityId=' || delivery.opportunity_id::text
        and notification.deep_link_type = 'lead'
        and notification.dedupe_key = v_dedupe_key
    )
  then
    raise exception 'lead_assignment_required_notification_proof_missing'
      using errcode = '55000';
  end if;

  if v_stale or v_inaccessible then
    update public.notifications notification
    set is_read = true,
        resolved_at = now(),
        resolution_reason = 'lead_assignment_prompt_suppressed'
    where notification.id = delivery.notification_id
      and notification.dedupe_key = v_dedupe_key;

    update public.unassigned_lead_assignment_deliveries row
    set state = 'delivered',
        claimed_at = null,
        claimed_by = null,
        lease_token = null,
        lease_expires_at = null,
        disposition = case
          when v_stale then 'stale'
          else 'inaccessible'
        end,
        push_state = p_push_state,
        delivered_at = now(),
        terminal_at = null,
        last_error = case
          when v_stale then
            'lead changed before owner prompt completion'
          else
            'recipient access changed before owner prompt completion'
        end,
        updated_at = now()
    where row.id = delivery.id;

    return jsonb_build_object(
      'ok', true,
      'delivery_id', delivery.id,
      'notification_id', delivery.notification_id,
      'suppressed', true,
      'push_state', p_push_state
    );
  end if;

  update public.unassigned_lead_assignment_deliveries row
  set state = 'delivered',
      claimed_at = null,
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      disposition = 'notified',
      push_state = p_push_state,
      delivered_at = now(),
      terminal_at = null,
      last_error = null,
      updated_at = now()
  where row.id = delivery.id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', delivery.id,
    'notification_id', delivery.notification_id,
    'suppressed', false,
    'push_state', p_push_state
  );
end;
$function$;

-- Private relations never become Data API surfaces.
alter table private.external_contact_identities enable row level security;
alter table private.external_intake_submissions enable row level security;
alter table private.external_intake_submission_replay_digests
  enable row level security;
alter table private.external_intake_submission_uploads
  enable row level security;
alter table private.external_intake_submission_attribution
  enable row level security;
alter table private.external_intake_possible_duplicates
  enable row level security;
alter table private.external_intake_post_commit_outbox
  enable row level security;
alter table private.external_intake_submission_erasure_write_tokens
  enable row level security;

revoke all on table private.external_contact_identities
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_submissions
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_submission_replay_digests
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_submission_uploads
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_submission_attribution
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_possible_duplicates
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_post_commit_outbox
  from public, anon, authenticated, service_role;
revoke all on table private.external_intake_submission_erasure_write_tokens
  from public, anon, authenticated, service_role;

revoke all on function private.sync_external_contact_identity()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_unassigned_lead_delivery_source()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_unassigned_lead_assignment_deliveries(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.enqueue_unassigned_lead_assignment_deliveries(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.guard_external_intake_submission_evidence()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_external_intake_immutable_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.external_opaque_uuid(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.external_intake_minute(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.external_intake_attachment_state(text)
  from public, anon, authenticated, service_role;
revoke all on function private.external_intake_submission_result(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.unassigned_lead_delivery_source_is_active(
  uuid, text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.change_opportunity_assignment_core(
  uuid, bigint, uuid, uuid, text, uuid, uuid, boolean, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.change_assignment_system_company_serialized_internal(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.resolve_external_intake_submission_context_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, uuid[], text
) from public, anon, authenticated, service_role;
grant execute on function public.resolve_external_intake_submission_context_as_system(
  uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, uuid[], text
) to service_role;

revoke all on function public.create_external_intake_submission_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, text,
  smallint, bytea, jsonb, smallint, bytea, jsonb, smallint, bytea, smallint,
  jsonb, jsonb, jsonb, uuid[], jsonb, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.create_external_intake_submission_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, text,
  smallint, bytea, jsonb, smallint, bytea, jsonb, smallint, bytea, smallint,
  jsonb, jsonb, jsonb, uuid[], jsonb, text, text, timestamptz
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

comment on table private.external_intake_submissions is
  'Append-only original external inquiry evidence. Only the audited privacy-erasure token path may tombstone personal evidence.';
comment on function public.create_external_intake_submission_as_system(
  uuid, uuid, uuid, uuid, smallint, bytea, text, bigint, uuid, uuid, text,
  smallint, bytea, jsonb, smallint, bytea, jsonb, smallint, bytea, smallint,
  jsonb, jsonb, jsonb, uuid[], jsonb, text, text, timestamptz
) is
  'Service-only atomic external intake command. Creates no partial customer, lead, upload claim, assignment, projection, or outbox state.';

commit;
