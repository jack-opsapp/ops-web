begin;

-- Durable one-shot ledger for provider resource creation. Every new draft or
-- Microsoft 365 subscription is claimed before the provider boundary. Once a
-- result becomes ambiguous, only exact-resource reconciliation may continue.
create or replace function private.email_provider_mutation_safe_uuid(
  p_value text
) returns uuid
language plpgsql
immutable
security definer
set search_path = ''
as $function$
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null
     or btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception when invalid_text_representation then
  return null;
end;
$function$;

revoke all on function private.email_provider_mutation_safe_uuid(text)
  from public, anon, authenticated, service_role;

create table public.email_provider_mutation_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid references public.email_connections(id) on delete set null,
  connection_id_snapshot uuid not null,
  connection_type_snapshot text not null,
  provider_snapshot text not null,
  mailbox_address_snapshot text not null,
  owner_user_id_snapshot uuid references public.users(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete restrict,
  operation_kind text not null,
  operation_key text not null,
  request_fingerprint text not null,
  status text not null default 'prepared',
  attempt_count integer not null default 0,
  provider_resource_id text,
  provider_secondary_resource_id text,
  provider_result jsonb not null default '{}'::jsonb,
  last_error text,
  provider_attempted_at timestamptz,
  provider_accepted_at timestamptz,
  reconciliation_required_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (connection_id_snapshot, operation_kind, operation_key),
  constraint email_provider_mutation_connection_snapshot_check
    check (connection_id is null or connection_id = connection_id_snapshot),
  constraint email_provider_mutation_connection_type_check
    check (connection_type_snapshot in ('company', 'individual')),
  constraint email_provider_mutation_provider_check
    check (provider_snapshot in ('gmail', 'microsoft365')),
  constraint email_provider_mutation_mailbox_check
    check (length(btrim(mailbox_address_snapshot)) between 3 and 320),
  constraint email_provider_mutation_owner_check
    check (
      (connection_type_snapshot = 'individual' and owner_user_id_snapshot is not null)
      or (connection_type_snapshot = 'company' and owner_user_id_snapshot is null)
    ),
  constraint email_provider_mutation_kind_check
    check (operation_kind in ('draft_create', 'webhook_setup', 'webhook_renewal')),
  constraint email_provider_mutation_key_check
    check (length(btrim(operation_key)) between 1 and 240),
  constraint email_provider_mutation_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint email_provider_mutation_status_check
    check (status in (
      'prepared',
      'attempting',
      'provider_rejected',
      'provider_accepted',
      'reconciliation_required',
      'completed'
    )),
  constraint email_provider_mutation_attempt_count_check
    check (attempt_count >= 0),
  constraint email_provider_mutation_result_check
    check (jsonb_typeof(provider_result) = 'object'),
  constraint email_provider_mutation_accepted_identity_check
    check (
      status not in ('provider_accepted', 'completed')
      or (
        nullif(btrim(provider_resource_id), '') is not null
        and provider_accepted_at is not null
      )
    )
);

comment on table public.email_provider_mutation_attempts is
  'Service-only one-shot provider mutation ledger. Connection authority is server-derived; accepted identities reconcile without replaying provider creation.';

create index email_provider_mutation_reconciliation_idx
  on public.email_provider_mutation_attempts (status, updated_at, id)
  where status in ('attempting', 'provider_accepted', 'reconciliation_required');

alter table public.email_provider_mutation_attempts enable row level security;
revoke all on table public.email_provider_mutation_attempts
  from public, anon, authenticated, service_role;

create or replace function public.prepare_email_provider_mutation_attempt(
  p_connection_id uuid,
  p_operation_kind text,
  p_operation_key text,
  p_request_fingerprint text,
  p_actor_user_id uuid default null
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  connection public.email_connections%rowtype;
  actor public.users%rowtype;
  existing public.email_provider_mutation_attempts%rowtype;
  v_company_id uuid;
  v_connection_type text;
  v_provider text;
  v_mailbox_address text;
  v_owner_user_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_connection_id is null
     or p_operation_kind not in ('draft_create', 'webhook_setup', 'webhook_renewal')
     or length(btrim(coalesce(p_operation_key, ''))) not between 1 and 240
     or coalesce(p_request_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_email_provider_mutation_attempt'
      using errcode = '22023';
  end if;

  select connection_row.* into connection
  from public.email_connections connection_row
  where connection_row.id = p_connection_id
  for share;
  if not found then
    raise exception 'email_provider_mutation_connection_unavailable'
      using errcode = '42501';
  end if;

  v_company_id := private.email_provider_mutation_safe_uuid(connection.company_id);
  v_connection_type := connection.type::text;
  v_provider := lower(btrim(connection.provider::text));
  v_mailbox_address := lower(btrim(connection.email));
  if v_company_id is null
     or v_connection_type not in ('company', 'individual')
     or v_provider not in ('gmail', 'microsoft365')
     or nullif(v_mailbox_address, '') is null then
    raise exception 'email_provider_mutation_connection_invalid'
      using errcode = '42501';
  end if;

  if v_connection_type = 'individual' then
    v_owner_user_id := private.email_provider_mutation_safe_uuid(connection.user_id);
    if v_owner_user_id is null
       or not exists (
         select 1
         from public.users owner
         where owner.id = v_owner_user_id
           and owner.company_id = v_company_id
           and owner.deleted_at is null
           and coalesce(owner.is_active, false)
       ) then
      raise exception 'email_provider_mutation_owner_unavailable'
        using errcode = '42501';
    end if;
  elsif v_connection_type = 'company' then
    -- A company mailbox's legacy connector user_id is transport metadata only.
    v_owner_user_id := null;
  end if;

  if p_actor_user_id is not null then
    select actor_row.* into actor
    from public.users actor_row
    where actor_row.id = p_actor_user_id
      and actor_row.company_id = v_company_id
      and actor_row.deleted_at is null
      and coalesce(actor_row.is_active, false)
    for share;
    if not found then
      raise exception 'email_provider_mutation_actor_unavailable'
        using errcode = '42501';
    end if;
    if v_connection_type = 'individual'
       and p_actor_user_id is distinct from v_owner_user_id then
      raise exception 'email_provider_mutation_actor_not_owner'
        using errcode = '42501';
    end if;
  end if;

  insert into public.email_provider_mutation_attempts (
    company_id,
    connection_id,
    connection_id_snapshot,
    connection_type_snapshot,
    provider_snapshot,
    mailbox_address_snapshot,
    owner_user_id_snapshot,
    actor_user_id,
    operation_kind,
    operation_key,
    request_fingerprint
  ) values (
    v_company_id,
    p_connection_id,
    p_connection_id,
    v_connection_type,
    v_provider,
    v_mailbox_address,
    v_owner_user_id,
    p_actor_user_id,
    p_operation_kind,
    btrim(p_operation_key),
    p_request_fingerprint
  )
  on conflict (connection_id_snapshot, operation_kind, operation_key) do nothing;

  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.connection_id_snapshot = p_connection_id
    and attempt.operation_kind = p_operation_kind
    and attempt.operation_key = btrim(p_operation_key)
  for update;

  if not found
     or existing.company_id is distinct from v_company_id
     or existing.connection_id is distinct from p_connection_id
     or existing.connection_type_snapshot is distinct from v_connection_type
     or existing.provider_snapshot is distinct from v_provider
     or existing.mailbox_address_snapshot is distinct from v_mailbox_address
     or existing.owner_user_id_snapshot is distinct from v_owner_user_id
     or existing.actor_user_id is distinct from p_actor_user_id
     or existing.request_fingerprint is distinct from p_request_fingerprint then
    raise exception 'email_provider_mutation_key_conflict'
      using errcode = '23505';
  end if;

  return existing;
end;
$function$;

create or replace function public.claim_email_provider_mutation_attempt(
  p_attempt_id uuid
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
  connection public.email_connections%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_attempt_id is null then
    raise exception 'invalid_email_provider_mutation_attempt'
      using errcode = '22023';
  end if;

  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found or existing.status not in ('prepared', 'provider_rejected') then
    return null;
  end if;

  select connection_row.* into connection
  from public.email_connections connection_row
  where connection_row.id = existing.connection_id
    and private.email_provider_mutation_safe_uuid(connection_row.company_id) = existing.company_id
    and connection_row.type::text = existing.connection_type_snapshot
    and lower(btrim(connection_row.provider::text)) = existing.provider_snapshot
    and lower(btrim(connection_row.email)) = existing.mailbox_address_snapshot
  for share;
  if not found then
    raise exception 'email_provider_mutation_connection_changed'
      using errcode = '42501';
  end if;
  if existing.connection_type_snapshot = 'individual'
     and (
       private.email_provider_mutation_safe_uuid(connection.user_id)
         is distinct from existing.owner_user_id_snapshot
       or not exists (
         select 1 from public.users owner
         where owner.id = existing.owner_user_id_snapshot
           and owner.company_id = existing.company_id
           and owner.deleted_at is null
           and coalesce(owner.is_active, false)
       )
     ) then
    raise exception 'email_provider_mutation_owner_changed'
      using errcode = '42501';
  end if;
  if existing.actor_user_id is not null
     and not exists (
       select 1 from public.users actor
       where actor.id = existing.actor_user_id
         and actor.company_id = existing.company_id
         and actor.deleted_at is null
         and coalesce(actor.is_active, false)
         and (
           existing.connection_type_snapshot <> 'individual'
           or actor.id = existing.owner_user_id_snapshot
         )
     ) then
    raise exception 'email_provider_mutation_actor_changed'
      using errcode = '42501';
  end if;

  update public.email_provider_mutation_attempts attempt
  set status = 'attempting',
      attempt_count = attempt.attempt_count + 1,
      provider_attempted_at = clock_timestamp(),
      last_error = null,
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

create or replace function public.mark_email_provider_mutation_accepted(
  p_attempt_id uuid,
  p_provider_resource_id text,
  p_provider_secondary_resource_id text,
  p_provider_result jsonb default '{}'::jsonb
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
  v_resource_id text := nullif(btrim(coalesce(p_provider_resource_id, '')), '');
  v_secondary_id text := nullif(btrim(coalesce(p_provider_secondary_resource_id, '')), '');
  v_result jsonb := coalesce(p_provider_result, '{}'::jsonb);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_attempt_id is null
     or v_resource_id is null
     or jsonb_typeof(v_result) <> 'object' then
    raise exception 'invalid_email_provider_mutation_acceptance'
      using errcode = '22023';
  end if;

  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'email_provider_mutation_attempt_missing'
      using errcode = 'P0002';
  end if;

  if existing.status in ('provider_accepted', 'reconciliation_required', 'completed') then
    if existing.provider_resource_id is distinct from v_resource_id
       or existing.provider_secondary_resource_id is distinct from v_secondary_id
       or existing.provider_result is distinct from v_result then
      raise exception 'email_provider_mutation_identity_conflict'
        using errcode = '23505';
    end if;
    return existing;
  end if;
  if existing.status <> 'attempting' then
    raise exception 'email_provider_mutation_not_attempting'
      using errcode = '55000';
  end if;

  update public.email_provider_mutation_attempts attempt
  set status = 'provider_accepted',
      provider_resource_id = v_resource_id,
      provider_secondary_resource_id = v_secondary_id,
      provider_result = v_result,
      provider_accepted_at = clock_timestamp(),
      last_error = null,
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

create or replace function public.mark_email_provider_mutation_rejected(
  p_attempt_id uuid,
  p_error text
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'email_provider_mutation_attempt_missing'
      using errcode = 'P0002';
  end if;
  if existing.status not in ('attempting', 'provider_rejected') then
    raise exception 'email_provider_mutation_rejection_invalid'
      using errcode = '55000';
  end if;
  update public.email_provider_mutation_attempts attempt
  set status = 'provider_rejected',
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'provider rejected request'), 2000),
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

create or replace function public.mark_email_provider_mutation_reconciliation_required(
  p_attempt_id uuid,
  p_provider_resource_id text,
  p_provider_secondary_resource_id text,
  p_provider_result jsonb default '{}'::jsonb,
  p_error text default null
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
  v_resource_id text := nullif(btrim(coalesce(p_provider_resource_id, '')), '');
  v_secondary_id text := nullif(btrim(coalesce(p_provider_secondary_resource_id, '')), '');
  v_result jsonb := coalesce(p_provider_result, '{}'::jsonb);
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_attempt_id is null or jsonb_typeof(v_result) <> 'object' then
    raise exception 'invalid_email_provider_mutation_reconciliation'
      using errcode = '22023';
  end if;

  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'email_provider_mutation_attempt_missing'
      using errcode = 'P0002';
  end if;
  if existing.status = 'completed' then
    return existing;
  end if;
  if existing.status not in ('attempting', 'provider_accepted', 'reconciliation_required') then
    raise exception 'email_provider_mutation_reconciliation_invalid'
      using errcode = '55000';
  end if;
  if existing.provider_resource_id is not null
     and v_resource_id is not null
     and existing.provider_resource_id is distinct from v_resource_id then
    raise exception 'email_provider_mutation_identity_conflict'
      using errcode = '23505';
  end if;
  if existing.provider_secondary_resource_id is not null
     and v_secondary_id is not null
     and existing.provider_secondary_resource_id is distinct from v_secondary_id then
    raise exception 'email_provider_mutation_identity_conflict'
      using errcode = '23505';
  end if;
  if existing.provider_result <> '{}'::jsonb
     and v_result <> '{}'::jsonb
     and existing.provider_result is distinct from v_result then
    raise exception 'email_provider_mutation_identity_conflict'
      using errcode = '23505';
  end if;

  update public.email_provider_mutation_attempts attempt
  set status = 'reconciliation_required',
      provider_resource_id = coalesce(attempt.provider_resource_id, v_resource_id),
      provider_secondary_resource_id = coalesce(
        attempt.provider_secondary_resource_id,
        v_secondary_id
      ),
      provider_result = case
        when attempt.provider_result = '{}'::jsonb then v_result
        else attempt.provider_result
      end,
      provider_accepted_at = case
        when coalesce(attempt.provider_resource_id, v_resource_id) is not null
          then coalesce(attempt.provider_accepted_at, clock_timestamp())
        else attempt.provider_accepted_at
      end,
      reconciliation_required_at = coalesce(
        attempt.reconciliation_required_at,
        clock_timestamp()
      ),
      last_error = left(
        coalesce(nullif(btrim(p_error), ''), 'provider acceptance requires review'),
        2000
      ),
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

create or replace function public.complete_email_provider_mutation_attempt(
  p_attempt_id uuid
) returns public.email_provider_mutation_attempts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  existing public.email_provider_mutation_attempts%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select attempt.* into existing
  from public.email_provider_mutation_attempts attempt
  where attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'email_provider_mutation_attempt_missing'
      using errcode = 'P0002';
  end if;
  if existing.status = 'completed' then
    return existing;
  end if;
  if existing.status not in ('provider_accepted', 'reconciliation_required')
     or nullif(btrim(existing.provider_resource_id), '') is null then
    raise exception 'email_provider_mutation_completion_invalid'
      using errcode = '55000';
  end if;

  update public.email_provider_mutation_attempts attempt
  set status = 'completed',
      completed_at = coalesce(attempt.completed_at, clock_timestamp()),
      last_error = null,
      updated_at = clock_timestamp()
  where attempt.id = p_attempt_id
  returning attempt.* into existing;
  return existing;
end;
$function$;

-- Ambiguous provider results are never silent. Personal mailbox recovery is
-- addressed only to its active canonical OPS owner. Company mailbox recovery
-- fans out only to active integration managers and never uses connector user_id.
create or replace function private.notify_email_provider_mutation_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  user_row public.users%rowtype;
  v_dedupe_key text := 'email-provider-mutation-reconciliation:' || new.id::text;
  v_title text;
  v_body text;
  v_action_url text;
  v_action_label text;
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update public.notifications notification
    set resolved_at = clock_timestamp(),
        is_read = true
    where notification.company_id = new.company_id::text
      and notification.type = 'system'
      and notification.dedupe_key = v_dedupe_key
      and notification.resolved_at is null;
    return new;
  end if;

  if new.status <> 'reconciliation_required'
     or old.status = 'reconciliation_required' then
    return new;
  end if;

  if new.operation_kind = 'draft_create' then
    v_title := 'Draft placement needs review';
    v_body := 'OPS could not confirm one mailbox draft. Check Drafts before creating another.';
  else
    v_title := 'Email connection needs review';
    v_body := 'OPS could not confirm this mailbox update. Review the connection before retrying.';
  end if;

  if new.connection_type_snapshot = 'individual' then
    select active_user.* into user_row
    from public.users active_user
    where active_user.id = new.owner_user_id_snapshot
      and active_user.company_id = new.company_id
      and active_user.deleted_at is null
      and coalesce(active_user.is_active, false)
    limit 1;
    if not found then
      return new;
    end if;
    v_action_url := null;
    v_action_label := null;
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    ) values (
      user_row.id::text, new.company_id::text, 'system', v_title, v_body,
      false, true, v_action_url, v_action_label, v_dedupe_key
    ) on conflict do nothing;
    return new;
  end if;

  if new.connection_type_snapshot = 'company' then
    v_action_url := '/settings?tab=integrations';
    v_action_label := 'Review mailbox';
    insert into public.notifications (
      user_id, company_id, type, title, body, is_read, persistent,
      action_url, action_label, dedupe_key
    )
    select
      user_row.id::text,
      new.company_id::text,
      'system',
      v_title,
      v_body,
      false,
      true,
      v_action_url,
      v_action_label,
      v_dedupe_key
    from public.users user_row
    where user_row.company_id = new.company_id
      and user_row.deleted_at is null
      and coalesce(user_row.is_active, false)
      and public.has_permission(
        user_row.id,
        'settings.integrations',
        'all'
      )
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

revoke all on function private.notify_email_provider_mutation_reconciliation()
  from public, anon, authenticated, service_role;

drop trigger if exists email_provider_mutation_reconciliation_notification
  on public.email_provider_mutation_attempts;
create trigger email_provider_mutation_reconciliation_notification
after update of status on public.email_provider_mutation_attempts
for each row execute function private.notify_email_provider_mutation_reconciliation();

revoke all on function public.prepare_email_provider_mutation_attempt(uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_email_provider_mutation_attempt(uuid, text, text, text, uuid)
  to service_role;
revoke all on function public.claim_email_provider_mutation_attempt(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_provider_mutation_attempt(uuid)
  to service_role;
revoke all on function public.mark_email_provider_mutation_accepted(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_email_provider_mutation_accepted(uuid, text, text, jsonb)
  to service_role;
revoke all on function public.mark_email_provider_mutation_rejected(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_email_provider_mutation_rejected(uuid, text)
  to service_role;
revoke all on function public.mark_email_provider_mutation_reconciliation_required(uuid, text, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_email_provider_mutation_reconciliation_required(uuid, text, text, jsonb, text)
  to service_role;
revoke all on function public.complete_email_provider_mutation_attempt(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_email_provider_mutation_attempt(uuid)
  to service_role;

commit;
