begin;

-- New company-mailbox leads must either receive one guarded owner assignment or
-- one durable assignment prompt per authorized administrator. This migration is
-- forward-only: every existing connection starts with a null owner and no
-- historical opportunity is scanned or changed.

do $prerequisites$
begin
  if to_regclass('public.email_connections') is null
    or to_regclass('public.opportunities') is null
    or to_regclass('public.opportunity_assignment_events') is null
    or to_regclass('public.users') is null
    or to_regclass('public.notifications') is null
    or to_regclass('public.notification_preferences') is null
    or to_regprocedure(
      'private.change_opportunity_assignment_core(uuid,bigint,uuid,uuid,text,uuid,uuid,boolean,uuid,jsonb)'
    ) is null
    or to_regprocedure(
      'private.change_assignment_system_company_serialized_internal(uuid,bigint,uuid,uuid,text,uuid,uuid,jsonb)'
    ) is null
    or to_regprocedure('private.lock_lead_assignment_company(uuid)') is null
    or to_regprocedure('private.permission_user_is_admin(uuid,uuid)') is null
    or to_regprocedure(
      'private.raw_pipeline_scope_for_user(uuid,uuid,text)'
    ) is null
    or to_regprocedure('private.try_parse_uuid(text)') is null
  then
    raise exception 'company_mailbox_intake_owner_prerequisites_missing'
      using errcode = '55000';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name in (
        'dedupe_key',
        'deep_link_type',
        'persistent',
        'resolved_at',
        'resolution_reason'
      )
  ) <> 5 then
    raise exception 'company_mailbox_intake_owner_notification_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

alter table public.email_connections
  add column if not exists default_intake_owner_id uuid;

do $owner_fk$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.email_connections'::regclass
      and constraint_row.conname =
        'email_connections_default_intake_owner_id_fkey'
  ) then
    alter table public.email_connections
      add constraint email_connections_default_intake_owner_id_fkey
      foreign key (default_intake_owner_id)
      references public.users (id)
      on delete set null;
  end if;
end;
$owner_fk$;

create index email_connections_default_intake_owner_id_idx
  on public.email_connections (default_intake_owner_id)
  where default_intake_owner_id is not null;

comment on column public.email_connections.default_intake_owner_id is
  'OPS user assigned to new leads from this company mailbox. Null leaves the lead unassigned and enqueues authorized-admin prompts.';

create or replace function private.company_mailbox_intake_owner_is_eligible(
  p_user_id uuid,
  p_company_id uuid
) returns boolean
language sql
stable security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.users owner
    where owner.id = p_user_id
      and owner.company_id = p_company_id
      and owner.deleted_at is null
      and coalesce(owner.is_active, false)
      and public.has_permission(
        p_user_id,
        'pipeline.view',
        'assigned'
      )
      and public.has_permission(
        p_user_id,
        'pipeline.edit',
        'assigned'
      )
      and public.has_permission(
        p_user_id,
        'inbox.send',
        'assigned'
      )
  );
$function$;

create or replace function private.guard_company_mailbox_intake_owner()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  owner public.users%rowtype;
begin
  if new.default_intake_owner_id is null then
    return new;
  end if;

  if new.type::text <> 'company' then
    raise exception 'default_intake_owner_requires_company_mailbox'
      using errcode = '23514';
  end if;

  if private.try_parse_uuid(new.company_id) is null then
    raise exception 'email_connection_company_id_invalid'
      using errcode = '23514';
  end if;

  select user_row.*
  into owner
  from public.users user_row
  where user_row.id = new.default_intake_owner_id
  for share;

  if not found
    or owner.company_id is distinct from private.try_parse_uuid(new.company_id)
  then
    raise exception 'default_intake_owner_company_mismatch'
      using errcode = '23514';
  end if;

  if not private.company_mailbox_intake_owner_is_eligible(
    new.default_intake_owner_id,
    private.try_parse_uuid(new.company_id)
  ) then
    raise exception 'default_intake_owner_ineligible'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

drop trigger if exists email_connections_guard_default_intake_owner
  on public.email_connections;
create trigger email_connections_guard_default_intake_owner
before insert or update of default_intake_owner_id, company_id, type
on public.email_connections
for each row
execute function private.guard_company_mailbox_intake_owner();

create or replace function public.configure_company_mailbox_intake_owner_as_system(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_expected_owner_id uuid,
  p_new_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  current_connection public.email_connections%rowtype;
  v_company_id uuid;
  v_connection_company_id uuid;
  v_previous_owner_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_actor_user_id is null or p_connection_id is null then
    raise exception 'intake_owner_configuration_arguments_required'
      using errcode = '22023';
  end if;

  select actor.company_id
  into v_company_id
  from public.users actor
  where actor.id = p_actor_user_id
    and actor.deleted_at is null
    and coalesce(actor.is_active, false);

  if not found then
    raise exception 'intake_owner_configuration_actor_ineligible'
      using errcode = '42501';
  end if;

  if not public.has_permission(
    p_actor_user_id,
    'settings.integrations',
    'all'
  ) or not public.has_permission(
    p_actor_user_id,
    'pipeline.assign',
    'all'
  ) then
    raise exception 'intake_owner_configuration_access_denied'
      using errcode = '42501';
  end if;

  select private.try_parse_uuid(connection.company_id)
  into v_connection_company_id
  from public.email_connections connection
  where connection.id = p_connection_id;

  if not found then
    raise exception 'email_connection_not_found'
      using errcode = 'P0002';
  end if;
  if v_connection_company_id is distinct from v_company_id then
    raise exception 'email_connection_company_mismatch'
      using errcode = '42501';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select connection.*
  into current_connection
  from public.email_connections connection
  where connection.id = p_connection_id
  for update;

  if not found
    or private.try_parse_uuid(current_connection.company_id)
      is distinct from v_company_id
  then
    raise exception 'email_connection_company_changed'
      using errcode = '40001';
  end if;
  if current_connection.type::text <> 'company' then
    raise exception 'default_intake_owner_requires_company_mailbox'
      using errcode = '22023';
  end if;

  if current_connection.default_intake_owner_id
    is distinct from p_expected_owner_id
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'reason', 'stale_owner',
      'connection_id', current_connection.id,
      'default_intake_owner_id',
        current_connection.default_intake_owner_id
    );
  end if;

  if p_new_owner_id is not null
    and not private.company_mailbox_intake_owner_is_eligible(
      p_new_owner_id,
      v_company_id
    )
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', false,
      'reason', 'owner_ineligible',
      'connection_id', current_connection.id,
      'default_intake_owner_id',
        current_connection.default_intake_owner_id
    );
  end if;

  v_previous_owner_id := current_connection.default_intake_owner_id;

  if current_connection.default_intake_owner_id
    is not distinct from p_new_owner_id
  then
    return jsonb_build_object(
      'ok', true,
      'conflict', false,
      'reason', 'unchanged',
      'connection_id', current_connection.id,
      'previous_owner_id', v_previous_owner_id,
      'default_intake_owner_id', p_new_owner_id
    );
  end if;

  update public.email_connections connection
  set default_intake_owner_id = p_new_owner_id,
      updated_at = now()
  where connection.id = current_connection.id;

  return jsonb_build_object(
    'ok', true,
    'conflict', false,
    'reason', 'updated',
    'connection_id', current_connection.id,
    'previous_owner_id', v_previous_owner_id,
    'default_intake_owner_id', p_new_owner_id
  );
end;
$function$;

-- Extend every immutable source gate before the new guarded caller can emit the
-- company-mailbox assignment event.
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
      'deactivation',
      'permission_change',
      'admin_correction',
      'system_repair'
    )
  );

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

create table public.unassigned_lead_assignment_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.companies (id) on delete restrict,
  opportunity_id uuid not null
    references public.opportunities (id) on delete restrict,
  connection_id uuid not null
    references public.email_connections (id) on delete restrict,
  recipient_user_id uuid not null
    references public.users (id) on delete restrict,
  assignment_version bigint not null default 0
    check (assignment_version = 0),
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0
    check (attempts >= 0),
  max_attempts integer not null default 8
    check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  notification_id uuid
    references public.notifications (id) on delete restrict,
  disposition text check (
    disposition is null
    or disposition in (
      'ready',
      'notified',
      'assigned',
      'stale',
      'inaccessible',
      'terminal_failure'
    )
  ),
  push_state text not null default 'pending'
    check (push_state in ('pending', 'sent', 'suppressed', 'failed')),
  last_error text,
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, recipient_user_id),
  check (
    (
      state = 'processing'
      and lease_token is not null
      and lease_expires_at is not null
      and claimed_by is not null
      and claimed_at is not null
    )
    or (
      state <> 'processing'
      and lease_token is null
      and lease_expires_at is null
      and claimed_by is null
      and claimed_at is null
    )
  ),
  check (
    (state = 'delivered' and delivered_at is not null)
    or (state <> 'delivered' and delivered_at is null)
  )
);

alter table public.unassigned_lead_assignment_deliveries
  enable row level security;
alter table public.unassigned_lead_assignment_deliveries
  force row level security;
revoke all on table public.unassigned_lead_assignment_deliveries
  from public, anon, authenticated, service_role;

create index unassigned_lead_assignment_deliveries_claim_idx
  on public.unassigned_lead_assignment_deliveries (
    company_id,
    available_at,
    lease_expires_at,
    created_at,
    id
  )
  where state in ('pending', 'processing', 'failed');

create index unassigned_lead_assignment_deliveries_connection_idx
  on public.unassigned_lead_assignment_deliveries (connection_id);

create index unassigned_lead_assignment_deliveries_recipient_idx
  on public.unassigned_lead_assignment_deliveries (recipient_user_id);

create index unassigned_lead_assignment_deliveries_notification_idx
  on public.unassigned_lead_assignment_deliveries (notification_id)
  where notification_id is not null;

create unique index
  notifications_unassigned_lead_assignment_delivery_dedupe_idx
  on public.notifications (dedupe_key)
  where dedupe_key like 'unassigned-lead-assignment-delivery:%';

create or replace function private.enqueue_unassigned_lead_assignment_deliveries(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_connection_id uuid
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
    and delivery.connection_id = p_connection_id
    and delivery.disposition is distinct from 'assigned';

  return coalesce(v_prompt_count, 0);
end;
$function$;

create or replace function private.assign_new_company_mailbox_opportunity_internal(
  p_connection_id uuid,
  p_opportunity_id uuid,
  p_expected_assignment_version bigint,
  p_expected_assigned_to uuid,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  current_connection public.email_connections%rowtype;
  opportunity public.opportunities%rowtype;
  v_company_id uuid;
  v_owner_id uuid;
  v_prompt_count integer := 0;
  v_assignment_result jsonb;
  v_assignment_metadata jsonb;
  v_reason text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null
    or p_opportunity_id is null
    or p_expected_assignment_version is null
    or p_expected_assignment_version < 0
  then
    raise exception 'company_mailbox_assignment_arguments_invalid'
      using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'assignment_metadata_must_be_object'
      using errcode = '22023';
  end if;
  if p_metadata ? 'provider_mutations_disabled'
    and jsonb_typeof(p_metadata -> 'provider_mutations_disabled') <> 'boolean'
  then
    raise exception 'provider_mutations_disabled_must_be_boolean'
      using errcode = '22023';
  end if;

  select private.try_parse_uuid(connection.company_id)
  into v_company_id
  from public.email_connections connection
  where connection.id = p_connection_id;

  if not found or v_company_id is null then
    raise exception 'email_connection_not_found'
      using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select connection.*
  into current_connection
  from public.email_connections connection
  where connection.id = p_connection_id
  for update;

  if not found
    or private.try_parse_uuid(current_connection.company_id)
      is distinct from v_company_id
  then
    raise exception 'email_connection_company_changed'
      using errcode = '40001';
  end if;
  if current_connection.type::text <> 'company' then
    raise exception 'company_mailbox_required'
      using errcode = '22023';
  end if;
  if current_connection.status <> 'active'
    or not coalesce(current_connection.sync_enabled, false)
  then
    raise exception 'company_mailbox_inactive'
      using errcode = '55000';
  end if;

  select opportunity_row.*
  into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = p_opportunity_id
  for update;

  if not found
    or opportunity.company_id is distinct from v_company_id
    or opportunity.deleted_at is not null
  then
    raise exception 'opportunity_not_found'
      using errcode = 'P0002';
  end if;

  if opportunity.assignment_version
      is distinct from p_expected_assignment_version
    or opportunity.assigned_to is distinct from p_expected_assigned_to
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'assigned_to', opportunity.assigned_to,
      'assignment_version', opportunity.assignment_version,
      'event_id', null,
      'reason', 'assignment_conflict',
      'prompt_count', 0
    );
  end if;

  v_owner_id := current_connection.default_intake_owner_id;

  if opportunity.assignment_version <> 0
    or opportunity.assigned_to is not null
  then
    if opportunity.assigned_to is not null
      and opportunity.assigned_to is not distinct from v_owner_id
    then
      return jsonb_build_object(
        'ok', true,
        'conflict', false,
        'assigned_to', opportunity.assigned_to,
        'assignment_version', opportunity.assignment_version,
        'event_id', null,
        'reason', 'already_assigned',
        'prompt_count', 0
      );
    end if;

    return jsonb_build_object(
      'ok', false,
      'conflict', false,
      'assigned_to', opportunity.assigned_to,
      'assignment_version', opportunity.assignment_version,
      'event_id', null,
      'reason', 'manual_override',
      'prompt_count', 0
    );
  end if;

  if opportunity.source is distinct from 'email'
    or opportunity.archived_at is not null
    or opportunity.stage in ('won', 'lost', 'discarded')
  then
    return jsonb_build_object(
      'ok', false,
      'conflict', false,
      'assigned_to', opportunity.assigned_to,
      'assignment_version', opportunity.assignment_version,
      'event_id', null,
      'reason', 'not_new_email_opportunity',
      'prompt_count', 0
    );
  end if;

  if v_owner_id is null then
    v_prompt_count :=
      private.enqueue_unassigned_lead_assignment_deliveries(
        v_company_id,
        p_opportunity_id,
        p_connection_id
      );
    return jsonb_build_object(
      'ok', false,
      'conflict', false,
      'assigned_to', null,
      'assignment_version', opportunity.assignment_version,
      'event_id', null,
      'reason', 'owner_missing',
      'prompt_count', v_prompt_count
    );
  end if;

  if not private.company_mailbox_intake_owner_is_eligible(
    v_owner_id,
    v_company_id
  ) then
    v_prompt_count :=
      private.enqueue_unassigned_lead_assignment_deliveries(
        v_company_id,
        p_opportunity_id,
        p_connection_id
      );
    return jsonb_build_object(
      'ok', false,
      'conflict', false,
      'assigned_to', null,
      'assignment_version', opportunity.assignment_version,
      'event_id', null,
      'reason', 'owner_ineligible',
      'prompt_count', v_prompt_count
    );
  end if;

  -- Preserve every caller-supplied recovery fence, including
  -- provider_mutations_disabled, while making the database-owned mailbox
  -- identity authoritative.
  v_assignment_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'connection_id', p_connection_id,
      'intake_owner_source', 'email_connections.default_intake_owner_id'
    );

  v_assignment_result :=
    private.change_assignment_system_company_serialized_internal(
      p_opportunity_id => p_opportunity_id,
      p_expected_assignment_version => p_expected_assignment_version,
      p_expected_assigned_to => p_expected_assigned_to,
      p_new_assigned_to => v_owner_id,
      p_system_source => 'company_mailbox_default',
      p_actor_user_id => null,
      p_suggestion_id => null,
      p_metadata => v_assignment_metadata
    );

  v_reason := case
    when coalesce((v_assignment_result ->> 'conflict')::boolean, false)
      then 'assignment_conflict'
    when coalesce((v_assignment_result ->> 'ok')::boolean, false)
      then 'assigned'
    else 'assignment_failed'
  end;

  return v_assignment_result || jsonb_build_object(
    'reason', v_reason,
    'prompt_count', 0
  );
end;
$function$;

create or replace function public.create_company_mailbox_email_opportunity_as_system(
  p_connection_id uuid,
  p_opportunity jsonb,
  p_provider_thread_id text,
  p_ingestion_source text,
  p_provider_mutations_disabled boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  current_connection public.email_connections%rowtype;
  opportunity public.opportunities%rowtype;
  v_company_id uuid;
  v_client_id uuid;
  v_source_thread_key text;
  v_title text;
  v_stage text;
  v_assignment_result jsonb;
  v_assignment_reason text;
  v_prompt_count integer;
  v_assignment_metadata jsonb;
  v_unique_constraint text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_connection_id is null
    or p_opportunity is null
    or jsonb_typeof(p_opportunity) <> 'object'
    or nullif(btrim(p_provider_thread_id), '') is null
    or p_provider_thread_id is distinct from btrim(p_provider_thread_id)
    or p_ingestion_source is null
    or p_ingestion_source not in ('email_sync', 'email_recovery')
    or p_provider_mutations_disabled is null
  then
    raise exception 'company_mailbox_opportunity_arguments_invalid'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_opportunity) payload_key
    where payload_key not in (
      'client_id',
      'title',
      'stage',
      'source_thread_key',
      'contact_name',
      'contact_email',
      'contact_phone',
      'address',
      'estimated_value',
      'detected_value',
      'description',
      'source_email_id',
      'source_message_id',
      'source_metadata',
      'tags',
      'ai_stage_signals',
      'ai_stage_confidence'
    )
  ) then
    raise exception 'company_mailbox_opportunity_payload_field_forbidden'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_each(p_opportunity) payload
    where payload.key in (
      'client_id',
      'title',
      'stage',
      'source_thread_key',
      'contact_name',
      'contact_email',
      'contact_phone',
      'address',
      'description',
      'source_email_id',
      'source_message_id'
    )
      and jsonb_typeof(payload.value) not in ('string', 'null')
  ) or (
    p_opportunity ? 'source_metadata'
    and jsonb_typeof(p_opportunity -> 'source_metadata')
      not in ('object', 'null')
  ) or (
    p_opportunity ? 'tags'
    and jsonb_typeof(p_opportunity -> 'tags') not in ('array', 'null')
  ) or (
    p_opportunity ? 'ai_stage_signals'
    and jsonb_typeof(p_opportunity -> 'ai_stage_signals')
      not in ('array', 'null')
  ) or exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_opportunity -> 'tags') = 'array'
          then p_opportunity -> 'tags'
        else '[]'::jsonb
      end
    ) tag_element(value)
    where jsonb_typeof(tag_element.value) <> 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_opportunity -> 'ai_stage_signals') = 'array'
          then p_opportunity -> 'ai_stage_signals'
        else '[]'::jsonb
      end
    ) signal_element(value)
    where jsonb_typeof(signal_element.value) <> 'string'
  ) or exists (
    select 1
    from jsonb_each(p_opportunity) payload
    where payload.key in (
      'estimated_value',
      'detected_value',
      'ai_stage_confidence'
    )
      and jsonb_typeof(payload.value) not in ('number', 'null')
  ) then
    raise exception 'company_mailbox_opportunity_payload_type_invalid'
      using errcode = '22023';
  end if;

  v_client_id := private.try_parse_uuid(p_opportunity ->> 'client_id');
  v_title := p_opportunity ->> 'title';
  v_stage := p_opportunity ->> 'stage';
  v_source_thread_key := p_opportunity ->> 'source_thread_key';

  if v_client_id is null
    or nullif(btrim(v_title), '') is null
    or v_title is distinct from btrim(v_title)
    or length(v_title) > 500
    or v_stage is null
    or v_stage not in (
      'new_lead',
      'qualifying',
      'quoting',
      'quoted',
      'follow_up',
      'negotiation'
    )
    or nullif(btrim(v_source_thread_key), '') is null
    or v_source_thread_key is distinct from btrim(v_source_thread_key)
  then
    raise exception 'company_mailbox_opportunity_identity_invalid'
      using errcode = '22023';
  end if;

  if p_opportunity ? 'detected_value'
    and jsonb_typeof(p_opportunity -> 'detected_value') = 'number'
    and (p_opportunity ->> 'detected_value') !~ '^-?[0-9]+$'
  then
    raise exception 'company_mailbox_opportunity_detected_value_invalid'
      using errcode = '22023';
  end if;
  if p_opportunity ? 'ai_stage_confidence'
    and jsonb_typeof(p_opportunity -> 'ai_stage_confidence') = 'number'
    and (
      (p_opportunity ->> 'ai_stage_confidence')::numeric < 0
      or (p_opportunity ->> 'ai_stage_confidence')::numeric > 1
    )
  then
    raise exception 'company_mailbox_opportunity_confidence_invalid'
      using errcode = '22023';
  end if;

  select private.try_parse_uuid(connection.company_id)
  into v_company_id
  from public.email_connections connection
  where connection.id = p_connection_id;

  if not found or v_company_id is null then
    raise exception 'email_connection_not_found'
      using errcode = 'P0002';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select connection.*
  into current_connection
  from public.email_connections connection
  where connection.id = p_connection_id
  for update;

  if not found
    or private.try_parse_uuid(current_connection.company_id)
      is distinct from v_company_id
  then
    raise exception 'email_connection_company_changed'
      using errcode = '40001';
  end if;
  if current_connection.type::text <> 'company' then
    raise exception 'company_mailbox_required'
      using errcode = '22023';
  end if;
  if current_connection.status <> 'active'
    or not coalesce(current_connection.sync_enabled, false)
  then
    raise exception 'company_mailbox_inactive'
      using errcode = '55000';
  end if;
  if split_part(v_source_thread_key, ':', 1) <> 'email'
    or split_part(v_source_thread_key, ':', 2)
      is distinct from lower(current_connection.provider::text)
    or split_part(v_source_thread_key, ':', 3)
      is distinct from p_connection_id::text
    or split_part(v_source_thread_key, ':', 4)
      not in ('thread', 'message')
    or nullif(split_part(v_source_thread_key, ':', 5), '') is null
    or cardinality(string_to_array(v_source_thread_key, ':')) <> 5
    or (
      split_part(v_source_thread_key, ':', 4) = 'thread'
      and split_part(v_source_thread_key, ':', 5)
        is distinct from p_provider_thread_id
    )
  then
    raise exception 'company_mailbox_opportunity_source_key_mismatch'
      using errcode = '23514';
  end if;

  select opportunity_row.*
  into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.company_id = v_company_id
    and opportunity_row.source_thread_key = v_source_thread_key
  for update;

  if found then
    if opportunity.company_id is distinct from v_company_id
      or opportunity.source_thread_key is distinct from v_source_thread_key
      or opportunity.client_id is null
      or opportunity.deleted_at is not null
      or opportunity.source is distinct from 'email'
    then
      raise exception 'company_mailbox_opportunity_source_key_conflict'
      using errcode = '23505';
    end if;
    -- Exact-key retries only adopt the existing identity. They never backfill
    -- assignment or prompts onto historical/external opportunity creation.
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'reason', 'source_key_exists',
      'opportunity', jsonb_build_object(
        'id', opportunity.id,
        'client_id', opportunity.client_id,
        'assigned_to', opportunity.assigned_to,
        'assignment_version', opportunity.assignment_version
      ),
      'assignment', null
    );
  end if;

  perform 1
  from public.clients client
  where client.id = v_client_id
    and client.company_id = v_company_id
    and client.deleted_at is null
  for share;
  if not found then
    raise exception 'company_mailbox_opportunity_client_not_found'
      using errcode = 'P0002';
  end if;

  begin
    insert into public.opportunities (
      company_id,
      client_id,
      title,
      stage,
      source,
      source_thread_key,
      contact_name,
      contact_email,
      contact_phone,
      address,
      estimated_value,
      detected_value,
      description,
      source_email_id,
      source_message_id,
      source_metadata,
      tags,
      ai_stage_signals,
      ai_stage_confidence
    ) values (
      v_company_id,
      v_client_id,
      v_title,
      v_stage,
      'email',
      v_source_thread_key,
      p_opportunity ->> 'contact_name',
      p_opportunity ->> 'contact_email',
      p_opportunity ->> 'contact_phone',
      p_opportunity ->> 'address',
      case
        when jsonb_typeof(p_opportunity -> 'estimated_value') = 'number'
          then (p_opportunity ->> 'estimated_value')::numeric
        else null
      end,
      case
        when jsonb_typeof(p_opportunity -> 'detected_value') = 'number'
          then (p_opportunity ->> 'detected_value')::integer
        else null
      end,
      p_opportunity ->> 'description',
      p_opportunity ->> 'source_email_id',
      p_opportunity ->> 'source_message_id',
      case
        when jsonb_typeof(p_opportunity -> 'source_metadata') = 'object'
          then p_opportunity -> 'source_metadata'
        else null
      end,
      case
        when jsonb_typeof(p_opportunity -> 'tags') = 'array'
          then array(
            select jsonb_array_elements_text(p_opportunity -> 'tags')
          )
        else array['email-import']::text[]
      end,
      case
        when jsonb_typeof(p_opportunity -> 'ai_stage_signals') = 'array'
          then array(
            select jsonb_array_elements_text(
              p_opportunity -> 'ai_stage_signals'
            )
          )
        else null
      end,
      case
        when jsonb_typeof(p_opportunity -> 'ai_stage_confidence') = 'number'
          then (p_opportunity ->> 'ai_stage_confidence')::numeric
        else null
      end
    )
    returning * into opportunity;
  exception
    when unique_violation then
      get stacked diagnostics v_unique_constraint = constraint_name;
      if v_unique_constraint is distinct from
        'opportunities_company_source_thread_key_key'
      then
        raise;
      end if;

      select opportunity_row.*
      into opportunity
      from public.opportunities opportunity_row
      where opportunity_row.company_id = v_company_id
        and opportunity_row.source_thread_key = v_source_thread_key
      for update;
      if not found
        or opportunity.company_id is distinct from v_company_id
        or opportunity.source_thread_key is distinct from v_source_thread_key
        or opportunity.client_id is null
        or opportunity.deleted_at is not null
        or opportunity.source is distinct from 'email'
      then
        raise exception 'company_mailbox_opportunity_create_race'
          using errcode = '40001';
      end if;

      -- An exact source-key winner is an idempotent retry result. Never assign
      -- or enqueue here: this migration is forward-only and performs no
      -- assignment backfill for an opportunity another transaction created.
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'reason', 'source_key_exists',
        'opportunity', jsonb_build_object(
          'id', opportunity.id,
          'client_id', opportunity.client_id,
          'assigned_to', opportunity.assigned_to,
          'assignment_version', opportunity.assignment_version
        ),
        'assignment', null
      );
  end;

  v_assignment_metadata := jsonb_build_object(
    'connection_id', p_connection_id,
    'provider_thread_id', p_provider_thread_id,
    'ingestion_source', p_ingestion_source,
    'provider_mutations_disabled', p_provider_mutations_disabled
  );
  v_assignment_result :=
    private.assign_new_company_mailbox_opportunity_internal(
      p_connection_id => p_connection_id,
      p_opportunity_id => opportunity.id,
      p_expected_assignment_version => 0,
      p_expected_assigned_to => null,
      p_metadata => v_assignment_metadata
    );

  v_assignment_reason := v_assignment_result ->> 'reason';
  v_prompt_count := coalesce(
    (v_assignment_result ->> 'prompt_count')::integer,
    0
  );
  if v_assignment_reason not in (
    'assigned',
    'owner_missing',
    'owner_ineligible'
  ) or (
    v_assignment_reason = 'assigned'
    and v_prompt_count <> 0
  ) or (
    v_assignment_reason in ('owner_missing', 'owner_ineligible')
    and v_prompt_count < 1
  ) then
    raise exception 'company_mailbox_atomic_assignment_failed'
      using errcode = '40001',
        detail = coalesce(v_assignment_result::text, 'null');
  end if;

  select opportunity_row.*
  into opportunity
  from public.opportunities opportunity_row
  where opportunity_row.id = opportunity.id
    and opportunity_row.company_id = v_company_id
  for update;
  if not found then
    raise exception 'company_mailbox_opportunity_disappeared'
      using errcode = '40001';
  end if;

  if (
    v_assignment_reason = 'assigned'
    and (
      coalesce((v_assignment_result ->> 'ok')::boolean, false) is not true
      or coalesce(
        (v_assignment_result ->> 'conflict')::boolean,
        false
      ) is true
      or opportunity.assigned_to is null
      or opportunity.assignment_version < 1
      or nullif(v_assignment_result ->> 'event_id', '') is null
    )
  ) or (
    v_assignment_reason in ('owner_missing', 'owner_ineligible')
    and (
      opportunity.assigned_to is not null
      or opportunity.assignment_version <> 0
      or (v_assignment_result ->> 'event_id') is not null
    )
  ) then
    raise exception 'company_mailbox_atomic_assignment_inconsistent'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'reason', case
      when v_assignment_reason = 'assigned' then 'created_assigned'
      else 'created_prompted'
    end,
    'opportunity', jsonb_build_object(
      'id', opportunity.id,
      'client_id', opportunity.client_id,
      'assigned_to', opportunity.assigned_to,
      'assignment_version', opportunity.assignment_version
    ),
    'assignment', jsonb_build_object(
      'outcome', v_assignment_reason,
      'event_id', v_assignment_result ->> 'event_id',
      'prompt_count', v_prompt_count
    )
  );
end;
$function$;

create or replace function private.resolve_unassigned_lead_assignment_deliveries()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
begin
  if new.new_assignee_id is null then
    return new;
  end if;

  update public.notifications notification
  set is_read = true,
      resolved_at = now(),
      resolution_reason = 'lead_assignment_completed'
  where exists (
    select 1
    from public.unassigned_lead_assignment_deliveries delivery
    where delivery.company_id = new.company_id
      and delivery.opportunity_id = new.opportunity_id
      and delivery.notification_id = notification.id
      and notification.dedupe_key =
        'unassigned-lead-assignment-delivery:' || delivery.id::text
  )
    and notification.resolved_at is null;

  update public.unassigned_lead_assignment_deliveries delivery
  set state = 'delivered',
      claimed_at = null,
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      disposition = 'assigned',
      push_state = case
        when delivery.push_state = 'sent' then 'sent'
        else 'suppressed'
      end,
      delivered_at = coalesce(delivery.delivered_at, now()),
      terminal_at = null,
      last_error = null,
      updated_at = now()
  where delivery.company_id = new.company_id
    and delivery.opportunity_id = new.opportunity_id
    and delivery.disposition is distinct from 'assigned';

  return new;
end;
$function$;

drop trigger if exists opportunity_assignment_events_resolve_unassigned_prompts
  on public.opportunity_assignment_events;
create trigger opportunity_assignment_events_resolve_unassigned_prompts
after insert on public.opportunity_assignment_events
for each row
execute function private.resolve_unassigned_lead_assignment_deliveries();

create or replace function public.claim_unassigned_lead_assignment_deliveries(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 180
) returns table (
  delivery_id uuid,
  delivery_lease_token uuid,
  company_id uuid,
  opportunity_id uuid,
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
  current_connection public.email_connections%rowtype;
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
  v_notification_body text;
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

  -- Companies are visited in stable UUID order. Every row/user/opportunity lock
  -- is taken only after the same company advisory lock used by assignment and
  -- permission mutation.
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
    limit v_limit
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
      limit greatest(0, v_limit - v_claimed)
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

      select connection.*
      into current_connection
      from public.email_connections connection
      where connection.id = delivery.connection_id
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
        or opportunity.source is distinct from 'email'
        or opportunity.stage in ('won', 'lost', 'discarded')
        or opportunity.assigned_to is not null
        or opportunity.assignment_version <> 0
        or current_connection.id is null
        or private.try_parse_uuid(current_connection.company_id)
          is distinct from delivery.company_id
        or current_connection.type::text <> 'company'
        or current_connection.status <> 'active'
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
          delivery.recipient_user_id,
          delivery.notification_id,
          coalesce(
            nullif(btrim(opportunity.title), ''),
            'New lead'
          ),
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
      v_notification_body := left('Assign ' || v_lead_title, 140);
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
        v_notification_body,
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
  current_connection public.email_connections%rowtype;
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

  select connection.*
  into current_connection
  from public.email_connections connection
  where connection.id = delivery.connection_id
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
    or opportunity.source is distinct from 'email'
    or opportunity.stage in ('won', 'lost', 'discarded')
    or opportunity.assigned_to is not null
    or opportunity.assignment_version <> 0
    or current_connection.id is null
    or private.try_parse_uuid(current_connection.company_id)
      is distinct from delivery.company_id
    or current_connection.type::text <> 'company'
    or current_connection.status <> 'active';

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

create or replace function public.fail_unassigned_lead_assignment_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  delivery public.unassigned_lead_assignment_deliveries%rowtype;
  v_company_id uuid;
  v_terminal boolean;
  v_backoff_seconds integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception 'unassigned_lead_delivery_failure_arguments_invalid'
      using errcode = '22023';
  end if;

  select row.company_id
  into v_company_id
  from public.unassigned_lead_assignment_deliveries row
  where row.id = p_delivery_id;

  if not found then
    raise exception 'unassigned_lead_assignment_delivery_lease_inactive'
      using errcode = '55000';
  end if;

  perform private.lock_lead_assignment_company(v_company_id);

  select row.*
  into delivery
  from public.unassigned_lead_assignment_deliveries row
  where row.id = p_delivery_id
    and row.company_id = v_company_id
  for update;

  if delivery.state = 'delivered'
    and delivery.disposition = 'assigned'
  then
    return jsonb_build_object(
      'ok', true,
      'delivery_id', delivery.id,
      'suppressed', true,
      'terminal', false,
      'attempts', delivery.attempts
    );
  end if;

  if not found
    or delivery.state <> 'processing'
    or delivery.lease_token is distinct from p_lease_token
    or delivery.lease_expires_at <= now()
  then
    raise exception 'unassigned_lead_assignment_delivery_lease_inactive'
      using errcode = '55000';
  end if;

  v_terminal := not coalesce(p_retryable, true)
    or delivery.attempts >= delivery.max_attempts;
  v_backoff_seconds := least(
    900,
    15 * power(2, least(delivery.attempts, 6))::integer
  );

  update public.unassigned_lead_assignment_deliveries row
  set state = 'failed',
      claimed_at = null,
      claimed_by = null,
      lease_token = null,
      lease_expires_at = null,
      disposition = case
        when v_terminal then 'terminal_failure'
        else null
      end,
      push_state = case
        when v_terminal then 'failed'
        else 'pending'
      end,
      available_at = case
        when v_terminal then 'infinity'::timestamptz
        else now() + make_interval(secs => v_backoff_seconds)
      end,
      terminal_at = case
        when v_terminal then now()
        else null
      end,
      last_error = left(
        coalesce(nullif(p_error, ''), 'Unknown delivery failure'),
        2000
      ),
      updated_at = now()
  where row.id = delivery.id;

  return jsonb_build_object(
    'ok', true,
    'delivery_id', delivery.id,
    'suppressed', false,
    'terminal', v_terminal,
    'attempts', delivery.attempts
  );
end;
$function$;

-- Function privileges are declared only after every dependency exists.
revoke all on function private.company_mailbox_intake_owner_is_eligible(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_company_mailbox_intake_owner()
  from public, anon, authenticated, service_role;
revoke all on function public.configure_company_mailbox_intake_owner_as_system(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.change_opportunity_assignment_core(
  uuid, bigint, uuid, uuid, text, uuid, uuid, boolean, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.change_assignment_system_company_serialized_internal(
  uuid, bigint, uuid, uuid, text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.enqueue_unassigned_lead_assignment_deliveries(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.assign_new_company_mailbox_opportunity_internal(
  uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_company_mailbox_email_opportunity_as_system(
  uuid, jsonb, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.resolve_unassigned_lead_assignment_deliveries()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_unassigned_lead_assignment_deliveries(
  uuid, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.complete_unassigned_lead_assignment_delivery(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function public.fail_unassigned_lead_assignment_delivery(
  uuid, uuid, text, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.configure_company_mailbox_intake_owner_as_system(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.create_company_mailbox_email_opportunity_as_system(
  uuid, jsonb, text, text, boolean
) to service_role;
grant execute on function public.claim_unassigned_lead_assignment_deliveries(
  uuid, integer, integer
) to service_role;
grant execute on function public.complete_unassigned_lead_assignment_delivery(
  uuid, uuid, text
) to service_role;
grant execute on function public.fail_unassigned_lead_assignment_delivery(
  uuid, uuid, text, boolean
) to service_role;

commit;
