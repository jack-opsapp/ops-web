begin;

do $prerequisites$
begin
  if to_regprocedure(
    'private.require_external_api_service_role()'
  ) is null
  then
    raise exception 'external_api_rate_limit_prerequisites_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create table private.external_api_rate_limit_policies (
  scope text not null,
  window_name text not null,
  request_limit integer not null,
  duration_seconds integer not null,
  primary key (scope, window_name),
  constraint external_api_rate_limit_policies_scope_check
    check (
      scope in (
        'preauth_network',
        'preauth_prefix',
        'principal_intake',
        'principal_analytics',
        'company'
      )
    ),
  constraint external_api_rate_limit_policies_window_check
    check (window_name in ('burst', 'minute', 'day')),
  constraint external_api_rate_limit_policies_limit_check
    check (
      request_limit in (10, 20, 30, 60, 120, 300, 2000, 5000, 12000)
    ),
  constraint external_api_rate_limit_policies_duration_check
    check (duration_seconds in (10, 60, 86400))
);

insert into private.external_api_rate_limit_policies (
  scope,
  window_name,
  request_limit,
  duration_seconds
) values
  ('preauth_network', 'burst', 30, 10),
  ('preauth_network', 'minute', 120, 60),
  ('preauth_prefix', 'burst', 30, 10),
  ('preauth_prefix', 'minute', 120, 60),
  ('principal_intake', 'burst', 20, 10),
  ('principal_intake', 'minute', 120, 60),
  ('principal_intake', 'day', 5000, 86400),
  ('principal_analytics', 'burst', 10, 10),
  ('principal_analytics', 'minute', 60, 60),
  ('principal_analytics', 'day', 2000, 86400),
  ('company', 'burst', 60, 10),
  ('company', 'minute', 300, 60),
  ('company', 'day', 12000, 86400);

alter table private.external_api_rate_limit_policies
  enable row level security;

revoke all on table private.external_api_rate_limit_policies
  from public, anon, authenticated, service_role;

create table private.external_api_rate_limit_windows (
  scope text not null,
  identity_digest text not null,
  window_name text not null,
  window_started_at timestamptz not null,
  duration_seconds integer not null,
  request_limit integer not null,
  request_count bigint not null default 1,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (
    scope,
    identity_digest,
    window_name,
    window_started_at,
    duration_seconds
  ),
  constraint external_api_rate_limit_windows_scope_check
    check (
      scope in (
        'preauth_network',
        'preauth_prefix',
        'principal_intake',
        'principal_analytics',
        'company'
      )
    ),
  constraint external_api_rate_limit_windows_identity_check
    check (
      (
        scope = 'preauth_prefix'
        and identity_digest ~
          '^[A-Za-z0-9_-]{43}\.(missing|malformed|opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{12})$'
      )
      or (
        scope <> 'preauth_prefix'
        and identity_digest ~ '^[A-Za-z0-9_-]{43}$'
      )
    ),
  constraint external_api_rate_limit_windows_name_check
    check (window_name in ('burst', 'minute', 'day')),
  constraint external_api_rate_limit_windows_duration_check
    check (duration_seconds in (10, 60, 86400)),
  constraint external_api_rate_limit_windows_limit_check
    check (
      request_limit in (10, 20, 30, 60, 120, 300, 2000, 5000, 12000)
    ),
  constraint external_api_rate_limit_windows_count_check
    check (request_count >= 1),
  constraint external_api_rate_limit_windows_expiry_check
    check (
      expires_at =
        window_started_at + make_interval(secs => duration_seconds)
    )
);

create index external_api_rate_limit_windows_expiry_idx
  on private.external_api_rate_limit_windows (expires_at);

alter table private.external_api_rate_limit_windows
  enable row level security;

revoke all on table private.external_api_rate_limit_windows
  from public, anon, authenticated, service_role;

create or replace function public.consume_external_api_rate_limits_as_system(
  p_checks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_check jsonb;
  v_scope text;
  v_identity text;
  v_scopes text[];
  v_policy record;
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_count bigint;
  v_remaining bigint := 12000;
  v_retry_after_seconds integer := 0;
  v_policy_count integer := 0;
  v_check_count integer;
begin
  perform private.require_external_api_service_role();

  if p_checks is null
    or jsonb_typeof(p_checks) <> 'array'
  then
    raise exception 'external_api_rate_limit_checks_invalid'
      using errcode = '22023';
  end if;

  v_check_count := jsonb_array_length(p_checks);
  if v_check_count <> 2 then
    raise exception 'external_api_rate_limit_checks_invalid'
      using errcode = '22023';
  end if;

  select array_agg(check_row.value ->> 'scope' order by check_row.value ->> 'scope')
  into v_scopes
  from jsonb_array_elements(p_checks) check_row(value);

  if v_scopes not in (
    array['preauth_network', 'preauth_prefix']::text[],
    array['company', 'principal_analytics']::text[],
    array['company', 'principal_intake']::text[]
  ) then
    raise exception 'external_api_rate_limit_scope_group_invalid'
      using errcode = '22023';
  end if;

  for v_check in
    select check_row.value
    from jsonb_array_elements(p_checks) check_row(value)
    order by
      case check_row.value ->> 'scope'
        when 'preauth_network' then 1
        when 'company' then 1
        when 'preauth_prefix' then 2
        when 'principal_intake' then 2
        when 'principal_analytics' then 2
        else 3
      end,
      check_row.value ->> 'identity'
  loop
    if jsonb_typeof(v_check) <> 'object'
      or not (v_check ? 'scope')
      or not (v_check ? 'identity')
      or (
        select count(*)
        from jsonb_object_keys(v_check)
      ) <> 2
    then
      raise exception 'external_api_rate_limit_check_invalid'
        using errcode = '22023';
    end if;

    v_scope := v_check ->> 'scope';
    v_identity := v_check ->> 'identity';

    if v_scope not in (
      'preauth_network',
      'preauth_prefix',
      'principal_intake',
      'principal_analytics',
      'company'
    ) then
      raise exception 'external_api_rate_limit_scope_invalid'
        using errcode = '22023';
    end if;

    if v_identity is null
      or (
        v_scope = 'preauth_prefix'
        and v_identity !~
          '^[A-Za-z0-9_-]{43}\.(missing|malformed|opsx_[1-9][0-9]{0,4}_[A-Za-z0-9_-]{12})$'
      )
      or (
        v_scope <> 'preauth_prefix'
        and v_identity !~ '^[A-Za-z0-9_-]{43}$'
      )
    then
      raise exception 'external_api_rate_limit_identity_invalid'
        using errcode = '22023';
    end if;

    v_policy_count := 0;
    for v_policy in
      select
        policy.window_name,
        policy.request_limit,
        policy.duration_seconds
      from private.external_api_rate_limit_policies policy
      where policy.scope = v_scope
      order by policy.duration_seconds
    loop
      v_policy_count := v_policy_count + 1;
      v_window_start := to_timestamp(
        floor(extract(epoch from v_now) / v_policy.duration_seconds)
          * v_policy.duration_seconds
      );
      v_expires_at :=
        v_window_start
        + make_interval(secs => v_policy.duration_seconds);

      insert into private.external_api_rate_limit_windows as window_row (
        scope,
        identity_digest,
        window_name,
        window_started_at,
        duration_seconds,
        request_limit,
        request_count,
        expires_at,
        created_at,
        updated_at
      ) values (
        v_scope,
        v_identity,
        v_policy.window_name,
        v_window_start,
        v_policy.duration_seconds,
        v_policy.request_limit,
        1,
        v_expires_at,
        v_now,
        v_now
      )
      on conflict (
        scope,
        identity_digest,
        window_name,
        window_started_at,
        duration_seconds
      ) do update
      set request_count = window_row.request_count + 1,
          updated_at = v_now
      returning request_count into v_count;

      v_remaining := least(
        v_remaining,
        greatest(v_policy.request_limit::bigint - v_count, 0)
      );
      if v_count > v_policy.request_limit then
        v_retry_after_seconds := greatest(
          v_retry_after_seconds,
          greatest(
            ceil(extract(epoch from (v_expires_at - v_now)))::integer,
            1
          )
        );
      end if;
    end loop;

    if v_policy_count = 0 then
      raise exception 'external_api_rate_limit_scope_invalid'
        using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'allowed', v_retry_after_seconds = 0,
    'remaining', v_remaining,
    'retry_after_seconds', v_retry_after_seconds
  );
end;
$function$;

create or replace function public.purge_external_api_rate_limit_windows_as_system(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private', 'pg_temp'
as $function$
declare
  v_deleted integer;
begin
  perform private.require_external_api_service_role();

  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'external_api_rate_limit_purge_limit_invalid'
      using errcode = '22023';
  end if;

  with expired as (
    select window_row.ctid
    from private.external_api_rate_limit_windows window_row
    where window_row.expires_at <= clock_timestamp()
    order by window_row.expires_at
    for update skip locked
    limit least(p_limit, 5000)
  ),
  deleted as (
    delete from private.external_api_rate_limit_windows window_row
    using expired
    where window_row.ctid = expired.ctid
    returning 1
  )
  select count(*)::integer
  into v_deleted
  from deleted;

  return v_deleted;
end;
$function$;

revoke all on function public.consume_external_api_rate_limits_as_system(jsonb)
  from public, anon, authenticated;
revoke all on function public.purge_external_api_rate_limit_windows_as_system(integer)
  from public, anon, authenticated;

grant execute on function public.consume_external_api_rate_limits_as_system(jsonb)
  to service_role;
grant execute on function public.purge_external_api_rate_limit_windows_as_system(integer)
  to service_role;

comment on table private.external_api_rate_limit_windows is
  'Fixed-window external API quota counters keyed only by HMAC-derived identities.';
comment on function public.consume_external_api_rate_limits_as_system(jsonb) is
  'Atomically consumes the approved pre-auth or authenticated external API quota group.';
comment on function public.purge_external_api_rate_limit_windows_as_system(integer) is
  'Deletes a bounded batch of expired external API quota windows.';

commit;
