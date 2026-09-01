-- Restore durable iOS analytics delivery while retaining a bounded compatibility
-- bridge for already-shipped direct-upsert clients.

begin;

set local search_path = public, private, pg_temp;

-- The invoker wrapper must be able to reach its privileged implementation, but
-- granting client roles USAGE on the shared private schema would expose every
-- legacy PUBLIC-executable function there. Isolate this one callable boundary.
create schema if not exists analytics_ingest;
revoke all on schema analytics_ingest from public, anon, authenticated, service_role;
grant usage on schema analytics_ingest to anon, authenticated;
alter default privileges in schema analytics_ingest revoke execute on functions from public;

create table if not exists private.analytics_event_hourly_quota (
  user_id uuid not null,
  window_start timestamptz not null,
  event_count integer not null check (event_count >= 0),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, window_start)
);

alter table private.analytics_event_hourly_quota enable row level security;
revoke all on table private.analytics_event_hourly_quota
  from public, anon, authenticated, service_role;

create or replace function private.consume_analytics_event_quota(
  p_user_id uuid,
  p_event_count integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_allowed boolean;
  v_window timestamptz := pg_catalog.date_trunc('hour', pg_catalog.statement_timestamp());
  v_hourly_limit constant integer := 5000;
begin
  if p_user_id is null
     or p_event_count is null
     or p_event_count < 1
     or p_event_count > v_hourly_limit then
    return false;
  end if;

  delete from private.analytics_event_hourly_quota
  where user_id = p_user_id
    and window_start < v_window - interval '7 days';

  insert into private.analytics_event_hourly_quota as quota (
    user_id,
    window_start,
    event_count,
    updated_at
  ) values (
    p_user_id,
    v_window,
    p_event_count,
    pg_catalog.now()
  )
  on conflict (user_id, window_start) do update
    set event_count = quota.event_count + excluded.event_count,
        updated_at = pg_catalog.now()
    where quota.event_count + excluded.event_count <= v_hourly_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end
$function$;

revoke all on function private.consume_analytics_event_quota(uuid, integer)
  from public, anon, authenticated, service_role;

-- pg_input_is_valid was added in PostgreSQL 16, while long-lived Supabase
-- projects may still run PostgreSQL 15. Keep validation migration-safe by
-- attempting only a server-owned regtype cast and converting data exceptions
-- to false.
create or replace function private.analytics_value_is_valid(
  p_value text,
  p_type regtype
)
returns boolean
language plpgsql
stable
set search_path = ''
as $function$
begin
  if p_value is null then
    return false;
  end if;

  execute pg_catalog.format('select $1::%s', p_type::text) using p_value;
  return true;
exception
  when data_exception then
    return false;
end
$function$;

revoke all on function private.analytics_value_is_valid(text, regtype)
  from public, anon, authenticated, service_role;

-- The compatibility policies use the same canonical signed-sub lookup as the
-- append RPC. A NULL company is a supported onboarding state.
create or replace function private.analytics_events_request_matches_identity(
  p_user_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_user_id is not null
    and count(*) = 1
    and count(*) filter (
      where u.id = p_user_id
        and p_company_id is not distinct from u.company_id
    ) = 1
  from public.users as u
  where nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '') is not null
    and (
      u.auth_id = nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '')
      or u.firebase_uid = nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '')
    )
    and u.deleted_at is null
    and u.is_active is true
$function$;

revoke all on function private.analytics_events_request_matches_identity(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.analytics_events_request_matches_identity(uuid, uuid)
  to anon, authenticated;

-- BEFORE INSERT is the only safe place to repair already-shipped direct-upsert
-- payloads before their RLS WITH CHECK runs. It executes only for a PostgREST
-- table POST under the actual anon/authenticated database role. Stale-account,
-- malformed, ambiguous, and over-quota rows return NULL: Postgres skips those
-- rows without failing the old client's entire batch or assigning them to the
-- newly signed-in account.
create or replace function private.prepare_legacy_analytics_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_database_role text := pg_catalog.current_setting('role', true);
  v_subject text := nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '');
  v_user_id uuid;
  v_company_id uuid;
  v_role text;
  v_plan text;
  v_match_count bigint;
begin
  if v_database_role not in ('anon', 'authenticated')
     or pg_catalog.current_setting('request.method', true) <> 'POST'
     or pg_catalog.current_setting('request.path', true) not in (
       'analytics_events', '/analytics_events'
     ) then
    return new;
  end if;

  if v_subject is null then
    return null;
  end if;

  select
    u.id,
    u.company_id,
    u.role,
    c.subscription_plan,
    count(*) over ()
  into v_user_id, v_company_id, v_role, v_plan, v_match_count
  from public.users as u
  left join public.companies as c
    on c.id = u.company_id
   and c.deleted_at is null
  where (u.auth_id = v_subject or u.firebase_uid = v_subject)
    and u.deleted_at is null
    and u.is_active is true
  order by case when u.firebase_uid = v_subject then 0 else 1 end, u.id
  limit 1;

  if coalesce(v_match_count, 0) <> 1 then
    return null;
  end if;

  if new.user_id is not null and new.user_id <> v_user_id then
    return null;
  end if;

  if new.company_id is not null
     and new.company_id is distinct from v_company_id then
    return null;
  end if;

  if new.event_type not in ('screen_view', 'action', 'feature_use', 'lifecycle', 'error')
     or nullif(pg_catalog.btrim(new.event_name), '') is null
     or pg_catalog.length(new.event_name) > 160
     or pg_catalog.octet_length(coalesce(new.properties, '{}'::jsonb)::text) > 16384
     or (new.duration_ms is not null and new.duration_ms < 0)
     or (new.app_version is not null and pg_catalog.length(new.app_version) > 128)
     or (new.device_type is not null and pg_catalog.length(new.device_type) > 128)
     or (new.os_version is not null and pg_catalog.length(new.os_version) > 128)
     or new.created_at < pg_catalog.now() - interval '90 days'
     or new.created_at > pg_catalog.now() + interval '5 minutes' then
    return null;
  end if;

  new.user_id := v_user_id;
  new.company_id := v_company_id;
  new.role := v_role;
  new.plan := v_plan;
  new.platform := 'ios';
  new.event_name := pg_catalog.btrim(new.event_name);
  new.properties := coalesce(new.properties, '{}'::jsonb);

  if not exists (
    select 1 from public.analytics_events as existing where existing.id = new.id
  ) and not private.consume_analytics_event_quota(v_user_id, 1) then
    return null;
  end if;

  return new;
end
$function$;

revoke all on function private.prepare_legacy_analytics_event()
  from public, anon, authenticated, service_role;

drop trigger if exists analytics_events_prepare_legacy_insert
  on public.analytics_events;
create trigger analytics_events_prepare_legacy_insert
before insert on public.analytics_events
for each row
execute function private.prepare_legacy_analytics_event();

create or replace function analytics_ingest.append_analytics_events(
  p_events jsonb,
  p_expected_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_subject text := nullif(pg_catalog.btrim(auth.jwt() ->> 'sub'), '');
  v_user_id uuid;
  v_company_id uuid;
  v_role text;
  v_plan text;
  v_match_count bigint;
  v_received integer;
  v_chargeable integer;
  v_inserted integer;
begin
  if v_subject is null then
    raise exception 'analytics_auth_required' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_expected_subject), '') is distinct from v_subject then
    raise exception 'analytics_subject_changed' using errcode = '42501';
  end if;

  select
    u.id,
    u.company_id,
    u.role,
    c.subscription_plan,
    count(*) over ()
  into v_user_id, v_company_id, v_role, v_plan, v_match_count
  from public.users as u
  left join public.companies as c
    on c.id = u.company_id
   and c.deleted_at is null
  where (u.auth_id = v_subject or u.firebase_uid = v_subject)
    and u.deleted_at is null
    and u.is_active is true
  order by case when u.firebase_uid = v_subject then 0 else 1 end, u.id
  limit 1;

  if coalesce(v_match_count, 0) = 0 then
    raise exception 'analytics_user_not_found' using errcode = '42501';
  end if;
  if v_match_count <> 1 then
    raise exception 'analytics_identity_ambiguous' using errcode = '42501';
  end if;

  if p_events is null then
    raise exception 'analytics_payload_required' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_events) <> 'array' then
    raise exception 'analytics_payload_must_be_array' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_events::text) > 262144 then
    raise exception 'analytics_payload_too_large' using errcode = '22023';
  end if;

  v_received := pg_catalog.jsonb_array_length(p_events);
  if v_received > 50 then
    raise exception 'analytics_batch_too_large' using errcode = '22023';
  end if;
  if v_received = 0 then
    return pg_catalog.jsonb_build_object('received', 0, 'inserted', 0, 'duplicates', 0);
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_events) as payload(event)
    where pg_catalog.jsonb_typeof(event) <> 'object'
  ) then
    raise exception 'analytics_event_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_events) as payload(event)
    where
      pg_catalog.jsonb_typeof(event -> 'id') <> 'string'
      or not private.analytics_value_is_valid(event ->> 'id', 'uuid'::regtype)
      or pg_catalog.jsonb_typeof(event -> 'session_id') <> 'string'
      or not private.analytics_value_is_valid(event ->> 'session_id', 'uuid'::regtype)
      or pg_catalog.jsonb_typeof(event -> 'created_at') <> 'string'
      or not private.analytics_value_is_valid(
        event ->> 'created_at', 'timestamp with time zone'::regtype
      )
      or case
        when private.analytics_value_is_valid(
          event ->> 'created_at', 'timestamp with time zone'::regtype
        )
        then (event ->> 'created_at')::timestamptz < pg_catalog.now() - interval '90 days'
          or (event ->> 'created_at')::timestamptz > pg_catalog.now() + interval '5 minutes'
        else false
      end
      or pg_catalog.jsonb_typeof(event -> 'event_type') <> 'string'
      or coalesce(event ->> 'event_type', '') not in (
        'screen_view', 'action', 'feature_use', 'lifecycle', 'error'
      )
      or pg_catalog.jsonb_typeof(event -> 'event_name') <> 'string'
      or nullif(pg_catalog.btrim(event ->> 'event_name'), '') is null
      or pg_catalog.length(event ->> 'event_name') > 160
      or (
        event ? 'properties'
        and event -> 'properties' <> 'null'::jsonb
        and (
          pg_catalog.jsonb_typeof(event -> 'properties') <> 'object'
          or pg_catalog.octet_length((event -> 'properties')::text) > 16384
        )
      )
      or (
        event ? 'duration_ms'
        and event -> 'duration_ms' <> 'null'::jsonb
        and not case
          when pg_catalog.jsonb_typeof(event -> 'duration_ms') = 'number'
            and private.analytics_value_is_valid(event ->> 'duration_ms', 'integer'::regtype)
          then (event ->> 'duration_ms')::integer >= 0
          else false
        end
      )
      or (
        event ? 'app_version' and event -> 'app_version' <> 'null'::jsonb
        and (pg_catalog.jsonb_typeof(event -> 'app_version') <> 'string'
          or pg_catalog.length(event ->> 'app_version') > 128)
      )
      or (
        event ? 'device_type' and event -> 'device_type' <> 'null'::jsonb
        and (pg_catalog.jsonb_typeof(event -> 'device_type') <> 'string'
          or pg_catalog.length(event ->> 'device_type') > 128)
      )
      or (
        event ? 'os_version' and event -> 'os_version' <> 'null'::jsonb
        and (pg_catalog.jsonb_typeof(event -> 'os_version') <> 'string'
          or pg_catalog.length(event ->> 'os_version') > 128)
      )
      or (
        event ? 'user_id' and event -> 'user_id' <> 'null'::jsonb
        and case
          when pg_catalog.jsonb_typeof(event -> 'user_id') = 'string'
            and private.analytics_value_is_valid(event ->> 'user_id', 'uuid'::regtype)
          then (event ->> 'user_id')::uuid is distinct from v_user_id
          else true
        end
      )
      or (
        event ? 'company_id' and event -> 'company_id' <> 'null'::jsonb
        and case
          when pg_catalog.jsonb_typeof(event -> 'company_id') = 'string'
            and private.analytics_value_is_valid(event ->> 'company_id', 'uuid'::regtype)
          then (event ->> 'company_id')::uuid is distinct from v_company_id
          else true
        end
      )
  ) then
    raise exception 'analytics_event_invalid' using errcode = '22023';
  end if;

  select count(*)
  into v_chargeable
  from pg_catalog.jsonb_array_elements(p_events) as payload(event)
  where not exists (
    select 1
    from public.analytics_events as existing
    where existing.id = (event ->> 'id')::uuid
  );

  if v_chargeable > 0
     and not private.consume_analytics_event_quota(v_user_id, v_chargeable) then
    raise exception 'analytics_quota_exceeded' using errcode = '53300';
  end if;

  insert into public.analytics_events (
    id, user_id, company_id, role, plan, event_type, event_name, platform,
    app_version, device_type, os_version, session_id, properties, duration_ms, created_at
  )
  select
    (event ->> 'id')::uuid,
    v_user_id,
    v_company_id,
    v_role,
    v_plan,
    event ->> 'event_type',
    pg_catalog.btrim(event ->> 'event_name'),
    'ios',
    nullif(pg_catalog.btrim(event ->> 'app_version'), ''),
    nullif(pg_catalog.btrim(event ->> 'device_type'), ''),
    nullif(pg_catalog.btrim(event ->> 'os_version'), ''),
    (event ->> 'session_id')::uuid,
    case when event -> 'properties' is null or event -> 'properties' = 'null'::jsonb
      then '{}'::jsonb else event -> 'properties' end,
    nullif(event ->> 'duration_ms', '')::integer,
    (event ->> 'created_at')::timestamptz
  from pg_catalog.jsonb_array_elements(p_events) as payload(event)
  on conflict (id) do nothing;

  get diagnostics v_inserted = row_count;
  return pg_catalog.jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'duplicates', v_received - v_inserted
  );
end
$function$;

revoke all on function analytics_ingest.append_analytics_events(jsonb, text)
  from public, anon, authenticated;
grant execute on function analytics_ingest.append_analytics_events(jsonb, text)
  to anon, authenticated;

comment on function analytics_ingest.append_analytics_events(jsonb, text) is
  'Privileged append-idempotent iOS analytics boundary with canonical signed-sub identity, validation, and per-user quota.';

create or replace function public.append_analytics_events(
  p_events jsonb,
  p_expected_subject text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $function$
  select analytics_ingest.append_analytics_events(p_events, p_expected_subject)
$function$;

revoke all on function public.append_analytics_events(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.append_analytics_events(jsonb, text)
  to anon, authenticated;

comment on function public.append_analytics_events(jsonb, text) is
  'Unprivileged PostgREST wrapper with expected Firebase subject binding.';

alter table public.analytics_events enable row level security;

drop policy if exists "Allow authenticated inserts" on public.analytics_events;
drop policy if exists analytics_events_client_insert on public.analytics_events;
drop policy if exists analytics_events_legacy_client_insert on public.analytics_events;
create policy analytics_events_legacy_client_insert
  on public.analytics_events
  for insert
  to anon, authenticated
  with check (
    private.analytics_events_request_matches_identity(user_id, company_id)
    and pg_catalog.current_setting('request.method', true) = 'POST'
    and pg_catalog.current_setting('request.path', true) in (
      'analytics_events', '/analytics_events'
    )
  );

drop policy if exists analytics_events_legacy_post_returning_select
  on public.analytics_events;
create policy analytics_events_legacy_post_returning_select
  on public.analytics_events
  for select
  to anon, authenticated
  using (
    private.analytics_events_request_matches_identity(user_id, company_id)
    and pg_catalog.current_setting('request.method', true) = 'POST'
    and pg_catalog.current_setting('request.path', true) in (
      'analytics_events', '/analytics_events'
    )
  );

revoke update, delete, truncate, references, trigger
  on table public.analytics_events
  from anon, authenticated;
grant select, insert on table public.analytics_events
  to anon, authenticated;

comment on policy analytics_events_legacy_client_insert
  on public.analytics_events is
  'Temporary shipped-client compatibility. Cleanup gate: remove only after telemetry proves zero supported clients still POST directly to analytics_events.';
comment on policy analytics_events_legacy_post_returning_select
  on public.analytics_events is
  'Temporary table-path POST-only RETURNING bridge. Must be proven on a Supabase branch before production. Cleanup gate: remove with direct table SELECT/INSERT grants after zero supported clients use the legacy route.';

commit;
