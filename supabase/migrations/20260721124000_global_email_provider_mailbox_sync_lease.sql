-- Serialize provider reads for one physical mailbox even when that mailbox is
-- connected to more than one OPS company.
--
-- The lease key is an irreversible digest of the provider's canonical mailbox
-- identity. The private table stores no tenant id or address, is never exposed
-- to application roles, and is transport coordination only: it must never be
-- used as OPS actor identity or authorization.

begin;

create table private.email_provider_mailbox_sync_leases (
  mailbox_identity_hash bytea primary key
    check (octet_length(mailbox_identity_hash) = 32),
  -- Keep the physical-mailbox lease alive if OPS disconnects the row while a
  -- provider request is still in flight. The orphan remains an opaque,
  -- expiring transport fence and can be stolen normally after expiry.
  connection_id uuid
    references public.email_connections(id) on delete set null,
  owner_id uuid not null,
  lease_seconds integer not null
    check (lease_seconds between 60 and 3600),
  acquired_at timestamptz not null,
  heartbeat_at timestamptz not null,
  expires_at timestamptz not null,
  constraint email_provider_mailbox_sync_leases_connection_unique
    unique (connection_id),
  constraint email_provider_mailbox_sync_leases_owner_unique
    unique (owner_id),
  constraint email_provider_mailbox_sync_leases_time_check
    check (
      acquired_at <= heartbeat_at
      and heartbeat_at < expires_at
    )
);

comment on table private.email_provider_mailbox_sync_leases is
  'Private provider-mailbox read serialization. Identity is SHA-256(provider + NUL + canonical provider-profile address); never an OPS authorization identity.';

revoke all on table private.email_provider_mailbox_sync_leases
  from public, anon, authenticated, service_role;

-- During a rolling deploy, the previous application release path clears only
-- the public mirror. Remove the exact matching private owner in the same
-- transaction so the new application does not report the mailbox busy until
-- the lease TTL expires. A short lock timeout preserves the canonical
-- lease -> connection lock order: an expiry contender already holding the
-- private row wins, this trigger becomes a no-op, and that contender observes
-- the cleared public mirror before installing its successor owner.
create or replace function private.release_legacy_email_connection_sync_lock()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_previous_lock_timeout text := current_setting('lock_timeout');
begin
  if old.sync_lock_owner is not null
    and new.sync_lock_owner is null
    and new.sync_in_progress_at is null
  then
    perform set_config('lock_timeout', '100ms', true);
    begin
      delete from private.email_provider_mailbox_sync_leases
       where connection_id = old.id
         and owner_id = old.sync_lock_owner;
    exception
      when lock_not_available then
        null;
    end;
    perform set_config('lock_timeout', v_previous_lock_timeout, true);
  end if;

  return new;
end;
$function$;

revoke all on function private.release_legacy_email_connection_sync_lock()
  from public, anon, authenticated, service_role;

drop trigger if exists email_connections_release_legacy_provider_mailbox_lease
  on public.email_connections;
create trigger email_connections_release_legacy_provider_mailbox_lease
after update of sync_lock_owner, sync_in_progress_at
on public.email_connections
for each row
execute function private.release_legacy_email_connection_sync_lock();

create or replace function public.acquire_email_connection_sync_lock_as_system(
  p_connection_id uuid,
  p_lease_seconds integer default 600
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_claimed_at timestamptz := clock_timestamp();
  v_owner_id uuid := gen_random_uuid();
  v_connection public.email_connections%rowtype;
  v_provider text;
  v_email text;
  v_mailbox_identity_hash bytea;
  v_lease private.email_provider_mailbox_sync_leases%rowtype;
  v_bridge_connection_id uuid;
  v_bridge_owner_id uuid;
  v_bridge_heartbeat timestamptz;
  v_acquired_owner uuid;
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null then
    raise exception 'connection id is required'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null
    or p_lease_seconds < 60
    or p_lease_seconds > 3600
  then
    raise exception 'lease seconds must be between 60 and 3600'
      using errcode = '22023';
  end if;

  select connection.*
    into v_connection
    from public.email_connections as connection
   where connection.id = p_connection_id;

  if not found then
    raise exception 'email connection does not exist'
      using errcode = '22023';
  end if;

  v_provider := lower(btrim(v_connection.provider));
  v_email := lower(btrim(v_connection.email));

  if v_connection.provider is distinct from v_provider
    or v_provider not in ('gmail', 'microsoft365')
    or v_connection.email is distinct from v_email
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception 'email connection has no canonical provider mailbox identity'
      using errcode = '22023';
  end if;

  -- Setup scans need the setup_incomplete state; every provider-read path must
  -- still be sync-enabled. Paused, errored, disconnected, and reconnect-needed
  -- connections fail before any provider request can start.
  if v_connection.sync_enabled is not true
    or v_connection.status not in ('active', 'setup_incomplete')
  then
    raise exception 'email connection is not usable for provider reads'
      using errcode = '55000';
  end if;

  v_mailbox_identity_hash := extensions.digest(
    convert_to(v_provider, 'UTF8')
      || decode('00', 'hex')
      || convert_to(v_email, 'UTF8'),
    'sha256'
  );

  -- Lock the one provider-mailbox row before examining expiry. Every acquire,
  -- renew, and release follows lease -> connection lock order.
  select lease.*
    into v_lease
    from private.email_provider_mailbox_sync_leases as lease
   where mailbox_identity_hash = v_mailbox_identity_hash
   for update;

  if found then
    if v_lease.expires_at > v_claimed_at then
      return null;
    end if;

    -- Rolling-deploy bridge: the previous application renews only the public
    -- connection mirror. If that exact owner still has a fresh heartbeat,
    -- extend the private lease and refuse the contender without disclosing it.
    select connection.id,
           connection.sync_lock_owner,
           connection.sync_in_progress_at
      into v_bridge_connection_id,
           v_bridge_owner_id,
           v_bridge_heartbeat
      from public.email_connections as connection
     where connection.provider = v_provider
       and connection.email = v_email
       and connection.sync_lock_owner is not null
       and connection.sync_in_progress_at is not null
       and connection.sync_in_progress_at >
         v_claimed_at - make_interval(secs => v_lease.lease_seconds)
     order by connection.sync_in_progress_at desc, connection.id
     limit 1
     for update;

    if found then
      update private.email_provider_mailbox_sync_leases
         set connection_id = v_bridge_connection_id,
             owner_id = v_bridge_owner_id,
             heartbeat_at = v_bridge_heartbeat,
             expires_at = v_bridge_heartbeat
               + make_interval(secs => v_lease.lease_seconds)
       where mailbox_identity_hash = v_mailbox_identity_hash;
      return null;
    end if;

    -- The prior owner is expired. Steal the private lease and clear only its
    -- exact stale public mirror before installing the successor mirror.
    update private.email_provider_mailbox_sync_leases
       set connection_id = p_connection_id,
           owner_id = v_owner_id,
           lease_seconds = p_lease_seconds,
           acquired_at = v_claimed_at,
           heartbeat_at = v_claimed_at,
           expires_at = v_claimed_at
             + make_interval(secs => p_lease_seconds)
     where mailbox_identity_hash = v_mailbox_identity_hash;

    update public.email_connections
       set sync_in_progress_at = null,
           sync_lock_owner = null
     where id = v_lease.connection_id
       and sync_lock_owner = v_lease.owner_id;

    v_acquired_owner := v_owner_id;
  else
    -- The migration may land while an old-version worker is already running.
    -- Materialize any fresh connection mirror into the private lease so the
    -- first global contender cannot overlap it.
    select connection.id,
           connection.sync_lock_owner,
           connection.sync_in_progress_at
      into v_bridge_connection_id,
           v_bridge_owner_id,
           v_bridge_heartbeat
      from public.email_connections as connection
     where connection.provider = v_provider
       and connection.email = v_email
       and connection.sync_lock_owner is not null
       and connection.sync_in_progress_at is not null
       and connection.sync_in_progress_at >
         v_claimed_at - make_interval(secs => p_lease_seconds)
     order by connection.sync_in_progress_at desc, connection.id
     limit 1
     for update;

    if found then
      insert into private.email_provider_mailbox_sync_leases (
        mailbox_identity_hash,
        connection_id,
        owner_id,
        lease_seconds,
        acquired_at,
        heartbeat_at,
        expires_at
      ) values (
        v_mailbox_identity_hash,
        v_bridge_connection_id,
        v_bridge_owner_id,
        p_lease_seconds,
        v_bridge_heartbeat,
        v_bridge_heartbeat,
        v_bridge_heartbeat + make_interval(secs => p_lease_seconds)
      )
      on conflict do nothing;
      return null;
    end if;

    -- Stale mirrors from the old connection-scoped contract cannot become
    -- hidden competing owners after the global lease is established.
    update public.email_connections
       set sync_in_progress_at = null,
           sync_lock_owner = null
     where provider = v_provider
       and email = v_email
       and sync_lock_owner is not null
       and (
         sync_in_progress_at is null
         or sync_in_progress_at <=
           v_claimed_at - make_interval(secs => p_lease_seconds)
       );

    insert into private.email_provider_mailbox_sync_leases (
      mailbox_identity_hash,
      connection_id,
      owner_id,
      lease_seconds,
      acquired_at,
      heartbeat_at,
      expires_at
    ) values (
      v_mailbox_identity_hash,
      p_connection_id,
      v_owner_id,
      p_lease_seconds,
      v_claimed_at,
      v_claimed_at,
      v_claimed_at + make_interval(secs => p_lease_seconds)
    )
    on conflict do nothing
    returning owner_id into v_acquired_owner;

    if v_acquired_owner is null then
      return null;
    end if;
  end if;

  update public.email_connections
     set sync_in_progress_at = v_claimed_at,
         sync_lock_owner = v_owner_id
   where id = p_connection_id
     and provider = v_provider
     and email = v_email
     and sync_enabled is true
     and status in ('active', 'setup_incomplete');

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    -- Raising rolls back the private claim and stale-mirror cleanup together.
    raise exception 'email connection changed during sync lock acquisition'
      using errcode = '55000';
  end if;

  return v_acquired_owner;
end;
$function$;

create or replace function public.renew_email_connection_sync_lock_as_system(
  p_connection_id uuid,
  p_owner_id uuid,
  p_lease_seconds integer default 600
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_renewed_at timestamptz := clock_timestamp();
  v_lease private.email_provider_mailbox_sync_leases%rowtype;
  v_connection public.email_connections%rowtype;
  v_connection_mailbox_identity_hash bytea;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null or p_owner_id is null then
    raise exception 'connection id and owner id are required'
      using errcode = '22023';
  end if;

  if p_lease_seconds is null
    or p_lease_seconds < 60
    or p_lease_seconds > 3600
  then
    raise exception 'lease seconds must be between 60 and 3600'
      using errcode = '22023';
  end if;

  select lease.*
    into v_lease
    from private.email_provider_mailbox_sync_leases as lease
   where connection_id = p_connection_id
     and owner_id = p_owner_id
   for update;

  if not found or v_lease.expires_at <= v_renewed_at then
    return false;
  end if;

  select connection.*
    into v_connection
    from public.email_connections as connection
   where connection.id = p_connection_id
   for update;

  if not found
    or v_connection.sync_enabled is not true
    or v_connection.status not in ('active', 'setup_incomplete')
    or v_connection.provider is distinct from lower(btrim(v_connection.provider))
    or lower(btrim(v_connection.provider)) not in ('gmail', 'microsoft365')
    or v_connection.email is distinct from lower(btrim(v_connection.email))
    or lower(btrim(v_connection.email))
      !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or v_connection.sync_lock_owner is distinct from p_owner_id
    or v_connection.sync_in_progress_at is null
  then
    return false;
  end if;

  v_connection_mailbox_identity_hash := extensions.digest(
    convert_to(lower(btrim(v_connection.provider)), 'UTF8')
      || decode('00', 'hex')
      || convert_to(lower(btrim(v_connection.email)), 'UTF8'),
    'sha256'
  );

  if v_connection_mailbox_identity_hash
    is distinct from v_lease.mailbox_identity_hash
  then
    return false;
  end if;

  update private.email_provider_mailbox_sync_leases
     set lease_seconds = p_lease_seconds,
         heartbeat_at = v_renewed_at,
         expires_at = v_renewed_at + make_interval(secs => p_lease_seconds)
   where mailbox_identity_hash = v_lease.mailbox_identity_hash
     and connection_id = p_connection_id
     and owner_id = p_owner_id;

  update public.email_connections
     set sync_in_progress_at = v_renewed_at
   where id = p_connection_id
     and sync_lock_owner = p_owner_id;

  return true;
end;
$function$;

create or replace function public.release_email_connection_sync_lock_as_system(
  p_connection_id uuid,
  p_owner_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_released_owner uuid;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null or p_owner_id is null then
    raise exception 'connection id and owner id are required'
      using errcode = '22023';
  end if;

  delete from private.email_provider_mailbox_sync_leases
   where owner_id = p_owner_id
     and (
       connection_id = p_connection_id
       or connection_id is null
     )
  returning owner_id into v_released_owner;

  if v_released_owner is null then
    return false;
  end if;

  update public.email_connections
     set sync_in_progress_at = null,
         sync_lock_owner = null
   where id = p_connection_id
     and sync_lock_owner = p_owner_id;

  return true;
end;
$function$;

create or replace function public.persist_email_connection_recovery_checkpoint_as_system(
  p_connection_id uuid,
  p_owner_id uuid,
  p_anchor timestamptz,
  p_page_token text,
  p_target_token text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_written_at timestamptz := clock_timestamp();
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null
    or p_owner_id is null
    or p_anchor is null
    or nullif(btrim(p_target_token), '') is null
    or (
      p_page_token is not null
      and (
        nullif(btrim(p_page_token), '') is null
        or p_page_token is distinct from btrim(p_page_token)
      )
    )
    or p_target_token is distinct from btrim(p_target_token)
  then
    raise exception 'invalid recovery checkpoint'
      using errcode = '22023';
  end if;

  perform 1
    from private.email_provider_mailbox_sync_leases as lease
   where lease.connection_id = p_connection_id
     and lease.owner_id = p_owner_id
     and lease.expires_at > v_written_at
   for update;

  if not found then
    return false;
  end if;

  update public.email_connections
     set history_recovery_anchor = p_anchor,
         history_recovery_page_token = p_page_token,
         history_recovery_target_token = p_target_token
   where id = p_connection_id
     and sync_lock_owner = p_owner_id
     and sync_in_progress_at is not null
     and sync_enabled is true
     and status in ('active', 'setup_incomplete');

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$function$;

create or replace function public.persist_email_connection_sync_completion_as_system(
  p_connection_id uuid,
  p_owner_id uuid,
  p_last_synced_at timestamptz,
  p_history_id text,
  p_clear_recovery boolean default false
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_written_at timestamptz := clock_timestamp();
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null
    or p_owner_id is null
    or p_last_synced_at is null
    or nullif(btrim(p_history_id), '') is null
    or p_history_id is distinct from btrim(p_history_id)
    or p_clear_recovery is null
  then
    raise exception 'invalid sync completion checkpoint'
      using errcode = '22023';
  end if;

  perform 1
    from private.email_provider_mailbox_sync_leases as lease
   where lease.connection_id = p_connection_id
     and lease.owner_id = p_owner_id
     and lease.expires_at > v_written_at
   for update;

  if not found then
    return false;
  end if;

  update public.email_connections
     set last_synced_at = p_last_synced_at,
         history_id = p_history_id,
         history_recovery_anchor = case
           when p_clear_recovery then null
           else history_recovery_anchor
         end,
         history_recovery_page_token = case
           when p_clear_recovery then null
           else history_recovery_page_token
         end,
         history_recovery_target_token = case
           when p_clear_recovery then null
           else history_recovery_target_token
         end
   where id = p_connection_id
     and sync_lock_owner = p_owner_id
     and sync_in_progress_at is not null
     and sync_enabled is true
     and status in ('active', 'setup_incomplete');

  get diagnostics v_updated_count = row_count;
  return v_updated_count = 1;
end;
$function$;

create or replace function public.complete_gmail_import_job_as_system(
  p_connection_id uuid,
  p_owner_id uuid,
  p_job_id uuid,
  p_history_id text,
  p_processed integer,
  p_matched integer,
  p_unmatched integer,
  p_needs_review integer,
  p_clients_created integer,
  p_leads_created integer,
  p_completed_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_completed_at timestamptz := clock_timestamp();
  v_connection_id uuid;
  v_connection_history_id text;
  v_job public.gmail_import_jobs%rowtype;
  v_updated_count integer;
begin
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) <> 'service_role' then
    raise exception 'access_denied'
      using errcode = '42501';
  end if;

  if p_connection_id is null
    or p_owner_id is null
    or p_job_id is null
    or nullif(btrim(p_history_id), '') is null
    or p_history_id is distinct from btrim(p_history_id)
    or p_completed_at is null
    or p_processed is null or p_processed < 0
    or p_matched is null or p_matched < 0
    or p_unmatched is null or p_unmatched < 0
    or p_needs_review is null or p_needs_review < 0
    or p_clients_created is null or p_clients_created < 0
    or p_leads_created is null or p_leads_created < 0
  then
    raise exception 'invalid Gmail import completion'
      using errcode = '22023';
  end if;

  perform 1
    from private.email_provider_mailbox_sync_leases as lease
   where lease.connection_id = p_connection_id
     and lease.owner_id = p_owner_id
     and lease.expires_at > v_completed_at
   for update;

  if not found then
    return false;
  end if;

  select connection.id, connection.history_id
    into v_connection_id, v_connection_history_id
    from public.email_connections as connection
   where connection.id = p_connection_id
     and connection.sync_lock_owner = p_owner_id
     and connection.sync_in_progress_at is not null
     and connection.sync_enabled is true
     and connection.status in ('active', 'setup_incomplete')
   for update;

  if not found then
    return false;
  end if;

  select job.*
    into v_job
    from public.gmail_import_jobs as job
   where job.id = p_job_id
     and job.connection_id = p_connection_id
   for update;

  if not found then
    raise exception 'Gmail import job does not belong to the locked mailbox'
      using errcode = '55000';
  end if;

  -- A network response can disappear after PostgreSQL commits. Repeating the
  -- same completion proves the exact durable outcome and never rewrites it.
  if v_job.status = 'completed' then
    if v_job.processed = p_processed
      and v_job.matched = p_matched
      and v_job.unmatched = p_unmatched
      and v_job.needs_review = p_needs_review
      and v_job.clients_created is not distinct from p_clients_created
      and v_job.leads_created is not distinct from p_leads_created
      and v_connection_history_id is not distinct from p_history_id
    then
      return true;
    end if;
    raise exception 'Gmail import completion conflicts with durable outcome'
      using errcode = '55000';
  end if;

  if v_job.status <> 'running' then
    raise exception 'Gmail import job is not running for the locked mailbox'
      using errcode = '55000';
  end if;

  update public.gmail_import_jobs
     set status = 'completed',
         processed = p_processed,
         matched = p_matched,
         unmatched = p_unmatched,
         needs_review = p_needs_review,
         clients_created = p_clients_created,
         leads_created = p_leads_created,
         completed_at = p_completed_at,
         error_message = null
   where id = p_job_id
     and connection_id = p_connection_id
     and status = 'running';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Gmail import job is not running for the locked mailbox'
      using errcode = '55000';
  end if;

  update public.email_connections
     set history_id = p_history_id
   where id = p_connection_id
     and sync_lock_owner = p_owner_id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Gmail import mailbox ownership changed during completion'
      using errcode = '55000';
  end if;

  return true;
end;
$function$;

revoke all on function public.acquire_email_connection_sync_lock_as_system(
  uuid,
  integer
) from public, anon, authenticated, service_role;

revoke all on function public.renew_email_connection_sync_lock_as_system(
  uuid,
  uuid,
  integer
) from public, anon, authenticated, service_role;

revoke all on function public.release_email_connection_sync_lock_as_system(
  uuid,
  uuid
) from public, anon, authenticated, service_role;

revoke all on function public.persist_email_connection_recovery_checkpoint_as_system(
  uuid,
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.persist_email_connection_sync_completion_as_system(
  uuid,
  uuid,
  timestamptz,
  text,
  boolean
) from public, anon, authenticated, service_role;

revoke all on function public.complete_gmail_import_job_as_system(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.acquire_email_connection_sync_lock_as_system(
  uuid,
  integer
) to service_role;

grant execute on function public.renew_email_connection_sync_lock_as_system(
  uuid,
  uuid,
  integer
) to service_role;

grant execute on function public.release_email_connection_sync_lock_as_system(
  uuid,
  uuid
) to service_role;

grant execute on function public.persist_email_connection_recovery_checkpoint_as_system(
  uuid,
  uuid,
  timestamptz,
  text,
  text
) to service_role;

grant execute on function public.persist_email_connection_sync_completion_as_system(
  uuid,
  uuid,
  timestamptz,
  text,
  boolean
) to service_role;

grant execute on function public.complete_gmail_import_job_as_system(
  uuid,
  uuid,
  uuid,
  text,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  timestamptz
) to service_role;

commit;
