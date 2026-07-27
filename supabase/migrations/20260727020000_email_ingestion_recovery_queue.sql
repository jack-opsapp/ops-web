-- Durable recovery for sync work that is allowed to outlive the provider
-- cursor: exact-message lead classification and idempotent provider labels.

create table public.email_ingestion_recovery_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null
    references public.email_connections(id) on delete cascade,
  recovery_kind text not null,
  operation_key text not null,
  provider_thread_id text not null,
  provider_message_id text not null,
  provider_label_id text,
  status text not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8
    check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  lease_holder text,
  lease_expires_at timestamptz,
  outcome text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, recovery_kind, operation_key),
  constraint email_ingestion_recovery_kind_check
    check (
      recovery_kind in ('lead_classification', 'provider_label_apply')
    ),
  constraint email_ingestion_recovery_status_check
    check (
      status in (
        'pending',
        'processing',
        'retrying',
        'completed',
        'failed',
        'stale'
      )
    ),
  constraint email_ingestion_recovery_identity_check
    check (
      nullif(btrim(operation_key), '') is not null
      and nullif(btrim(provider_thread_id), '') is not null
      and nullif(btrim(provider_message_id), '') is not null
      and (
        (
          recovery_kind = 'lead_classification'
          and provider_label_id is null
        )
        or (
          recovery_kind = 'provider_label_apply'
          and nullif(btrim(provider_label_id), '') is not null
        )
      )
    ),
  constraint email_ingestion_recovery_lease_check
    check (
      (status = 'processing'
        and nullif(btrim(lease_holder), '') is not null
        and lease_expires_at is not null)
      or
      (status <> 'processing'
        and lease_holder is null
        and lease_expires_at is null)
    )
);

create index email_ingestion_recovery_claim_idx
  on public.email_ingestion_recovery_queue (
    available_at,
    created_at,
    id
  )
  where status in ('pending', 'retrying', 'processing');

alter table public.email_ingestion_recovery_queue enable row level security;
revoke all on table public.email_ingestion_recovery_queue
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.email_ingestion_recovery_queue
  to service_role;

comment on table public.email_ingestion_recovery_queue is
  'Service-only exact-message recovery queue for cursor-safe lead classification deferrals and idempotent provider label writes.';

create or replace function public.enqueue_email_ingestion_recovery_as_system(
  p_company_id uuid,
  p_connection_id uuid,
  p_recovery_kind text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_provider_label_id text default null
) returns public.email_ingestion_recovery_queue
language plpgsql
security definer
set search_path = ''
as $function$
declare
  connection public.email_connections%rowtype;
  v_operation_key text;
  work public.email_ingestion_recovery_queue%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_recovery_kind not in (
    'lead_classification',
    'provider_label_apply'
  )
  or nullif(btrim(coalesce(p_provider_thread_id, '')), '') is null
  or nullif(btrim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'invalid_email_ingestion_recovery_request'
      using errcode = '22023';
  end if;

  select source.* into connection
  from public.email_connections source
  where source.id = p_connection_id
    and source.company_id = p_company_id::text
  for share;
  if not found
     or connection.status <> 'active'
     or connection.sync_enabled <> true then
    raise exception 'email_ingestion_recovery_connection_invalid'
      using errcode = '42501';
  end if;

  if p_recovery_kind = 'lead_classification' then
    if nullif(btrim(coalesce(p_provider_label_id, '')), '') is not null then
      raise exception 'lead_classification_label_not_allowed'
        using errcode = '22023';
    end if;
    v_operation_key :=
      'lead_classification:' || btrim(p_provider_message_id);
  else
    if nullif(btrim(coalesce(p_provider_label_id, '')), '') is null
       or connection.ops_label_id is null
       or connection.ops_label_id <> btrim(p_provider_label_id) then
      raise exception 'provider_label_configuration_invalid'
        using errcode = '42501';
    end if;
    v_operation_key :=
      'provider_label_apply:'
      || btrim(p_provider_message_id)
      || ':'
      || btrim(p_provider_label_id);
  end if;

  insert into public.email_ingestion_recovery_queue (
    company_id,
    connection_id,
    recovery_kind,
    operation_key,
    provider_thread_id,
    provider_message_id,
    provider_label_id
  ) values (
    p_company_id,
    p_connection_id,
    p_recovery_kind,
    v_operation_key,
    btrim(p_provider_thread_id),
    btrim(p_provider_message_id),
    case
      when p_recovery_kind = 'provider_label_apply'
        then btrim(p_provider_label_id)
      else null
    end
  )
  on conflict (connection_id, recovery_kind, operation_key) do update
    set updated_at = now()
  returning * into work;

  return work;
end;
$function$;

revoke all on function public.enqueue_email_ingestion_recovery_as_system(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_ingestion_recovery_as_system(
  uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.claim_email_ingestion_recovery_as_system(
  p_holder text,
  p_company_ids uuid[],
  p_limit integer default 10,
  p_lease_seconds integer default 360
) returns setof public.email_ingestion_recovery_queue
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_holder, '')), '') is null
     or coalesce(cardinality(p_company_ids), 0) = 0
     or p_limit not between 1 and 50
     or p_lease_seconds not between 60 and 900 then
    raise exception 'invalid_email_ingestion_recovery_claim'
      using errcode = '22023';
  end if;

  update public.email_ingestion_recovery_queue work
     set status = 'failed',
         lease_holder = null,
         lease_expires_at = null,
         completed_at = now(),
         outcome = 'attempts_exhausted',
         last_error = coalesce(
           work.last_error,
           'lease expired after maximum attempts'
         ),
         updated_at = now()
   where work.status = 'processing'
     and work.company_id = any(p_company_ids)
     and work.lease_expires_at <= clock_timestamp()
     and work.attempts >= work.max_attempts;

  return query
  with candidates as (
    select candidate.id
    from public.email_ingestion_recovery_queue candidate
    join public.email_connections connection
      on connection.id = candidate.connection_id
     and connection.company_id = candidate.company_id::text
     and connection.status = 'active'
     and connection.sync_enabled = true
    where candidate.company_id = any(p_company_ids)
      and candidate.attempts < candidate.max_attempts
      and (
        (
          candidate.status in ('pending', 'retrying')
          and candidate.available_at <= clock_timestamp()
        )
        or (
          candidate.status = 'processing'
          and candidate.lease_expires_at <= clock_timestamp()
        )
      )
    order by candidate.available_at, candidate.created_at, candidate.id
    for update of candidate skip locked
    limit p_limit
  )
  update public.email_ingestion_recovery_queue work
     set status = 'processing',
         attempts = work.attempts + 1,
         lease_holder = btrim(p_holder),
         lease_expires_at =
           clock_timestamp() + make_interval(secs => p_lease_seconds),
         updated_at = now()
    from candidates
   where work.id = candidates.id
  returning work.*;
end;
$function$;

revoke all on function public.claim_email_ingestion_recovery_as_system(
  text, uuid[], integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_ingestion_recovery_as_system(
  text, uuid[], integer, integer
) to service_role;

create or replace function public.claim_email_ingestion_recovery_by_id_as_system(
  p_queue_id uuid,
  p_holder text,
  p_lease_seconds integer default 360
) returns public.email_ingestion_recovery_queue
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.email_ingestion_recovery_queue%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_holder, '')), '') is null
     or p_lease_seconds not between 60 and 900 then
    raise exception 'invalid_email_ingestion_recovery_direct_claim'
      using errcode = '22023';
  end if;

  select queue.* into work
  from public.email_ingestion_recovery_queue queue
  where queue.id = p_queue_id
  for update;
  if not found then
    return null;
  end if;
  if work.status in ('completed', 'failed', 'stale') then
    return work;
  end if;
  if work.attempts >= work.max_attempts then
    update public.email_ingestion_recovery_queue queue
       set status = 'failed',
           lease_holder = null,
           lease_expires_at = null,
           completed_at = now(),
           outcome = 'attempts_exhausted',
           updated_at = now()
     where queue.id = p_queue_id
    returning * into work;
    return work;
  end if;
  if work.status = 'processing'
     and work.lease_expires_at > clock_timestamp()
     and work.lease_holder <> btrim(p_holder) then
    return null;
  end if;
  if work.status in ('pending', 'retrying')
     and work.available_at > clock_timestamp() then
    return null;
  end if;

  update public.email_ingestion_recovery_queue queue
     set status = 'processing',
         attempts = queue.attempts + 1,
         lease_holder = btrim(p_holder),
         lease_expires_at =
           clock_timestamp() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where queue.id = p_queue_id
  returning * into work;
  return work;
end;
$function$;

revoke all on function public.claim_email_ingestion_recovery_by_id_as_system(
  uuid, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_email_ingestion_recovery_by_id_as_system(
  uuid, text, integer
) to service_role;

create or replace function public.reauthorize_email_ingestion_recovery_as_system(
  p_queue_id uuid,
  p_holder text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.email_ingestion_recovery_queue work
    join public.email_connections connection
      on connection.id = work.connection_id
     and connection.company_id = work.company_id::text
     and connection.status = 'active'
     and connection.sync_enabled = true
    where work.id = p_queue_id
      and work.status = 'processing'
      and work.lease_holder = btrim(p_holder)
      and work.lease_expires_at > clock_timestamp()
  );
end;
$function$;

revoke all on function public.reauthorize_email_ingestion_recovery_as_system(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.reauthorize_email_ingestion_recovery_as_system(
  uuid, text
) to service_role;

create or replace function public.complete_email_ingestion_recovery_as_system(
  p_queue_id uuid,
  p_holder text,
  p_outcome text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.email_ingestion_recovery_queue%rowtype;
  v_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_outcome not in (
    'classification_recovered',
    'label_applied',
    'stale_configuration'
  ) then
    raise exception 'invalid_email_ingestion_recovery_outcome'
      using errcode = '22023';
  end if;

  select queue.* into work
  from public.email_ingestion_recovery_queue queue
  where queue.id = p_queue_id
  for update;
  if not found then
    return false;
  end if;
  if work.status = 'completed' then
    return work.outcome = p_outcome;
  elsif work.status = 'stale' then
    return p_outcome = 'stale_configuration'
      and work.outcome = p_outcome;
  end if;
  if work.status <> 'processing'
     or work.lease_holder <> btrim(p_holder)
     or work.lease_expires_at <= clock_timestamp() then
    return false;
  end if;
  if (work.recovery_kind = 'lead_classification'
      and p_outcome <> 'classification_recovered')
     or (work.recovery_kind = 'provider_label_apply'
      and p_outcome not in ('label_applied', 'stale_configuration')) then
    raise exception 'email_ingestion_recovery_outcome_kind_mismatch'
      using errcode = '22023';
  end if;

  v_status := case
    when p_outcome = 'stale_configuration' then 'stale'
    else 'completed'
  end;
  update public.email_ingestion_recovery_queue queue
     set status = v_status,
         outcome = p_outcome,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = now(),
         last_error = null,
         updated_at = now()
   where queue.id = p_queue_id;
  return true;
end;
$function$;

revoke all on function public.complete_email_ingestion_recovery_as_system(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_email_ingestion_recovery_as_system(
  uuid, text, text
) to service_role;

create or replace function public.fail_email_ingestion_recovery_as_system(
  p_queue_id uuid,
  p_holder text,
  p_error text
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  work public.email_ingestion_recovery_queue%rowtype;
  connection_valid boolean;
  v_status text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_error, '')), '') is null then
    raise exception 'email_ingestion_recovery_error_required'
      using errcode = '22023';
  end if;

  select queue.* into work
  from public.email_ingestion_recovery_queue queue
  where queue.id = p_queue_id
    and queue.status = 'processing'
    and queue.lease_holder = btrim(p_holder)
  for update;
  if not found then
    return 'stale';
  end if;

  select exists (
    select 1
    from public.email_connections connection
    where connection.id = work.connection_id
      and connection.company_id = work.company_id::text
      and connection.status = 'active'
      and connection.sync_enabled = true
  ) into connection_valid;

  v_status := case
    when not connection_valid then 'stale'
    when work.attempts >= work.max_attempts then 'failed'
    else 'retrying'
  end;

  update public.email_ingestion_recovery_queue queue
     set status = v_status,
         available_at = case
           when v_status = 'retrying' then
             clock_timestamp() + make_interval(
               secs => least(
                 86400,
                 (power(2, least(work.attempts, 10)) * 60)::integer
               )
             )
           else queue.available_at
         end,
         lease_holder = null,
         lease_expires_at = null,
         completed_at = case
           when v_status in ('failed', 'stale') then now()
           else null
         end,
         outcome = case
           when v_status = 'failed' then 'attempts_exhausted'
           when v_status = 'stale' then 'authorization_stale'
           else null
         end,
         last_error = left(btrim(p_error), 2000),
         updated_at = now()
   where queue.id = p_queue_id;
  return v_status;
end;
$function$;

revoke all on function public.fail_email_ingestion_recovery_as_system(
  uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.fail_email_ingestion_recovery_as_system(
  uuid, text, text
) to service_role;
