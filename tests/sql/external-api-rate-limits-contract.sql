begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select set_config('request.jwt.claim.role', 'service_role', true);

create temp table external_api_rate_limit_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

do $rate_limit_behavior$
declare
  v_checks jsonb := jsonb_build_array(
    jsonb_build_object(
      'scope', 'preauth_network',
      'identity', repeat('A', 43)
    ),
    jsonb_build_object(
      'scope', 'preauth_prefix',
      'identity', repeat('A', 43) || '.missing'
    )
  );
  v_result jsonb;
  v_ordinal integer;
  v_rejected boolean := false;
begin
  for v_ordinal in 1..30 loop
    v_result :=
      public.consume_external_api_rate_limits_as_system(v_checks);
    if not (v_result ->> 'allowed')::boolean then
      raise exception 'rate limit denied before the configured boundary';
    end if;
  end loop;

  v_result := public.consume_external_api_rate_limits_as_system(v_checks);
  insert into external_api_rate_limit_contract_results (
    check_name,
    passed,
    details
  ) values (
    'exact_boundary_denies',
    not (v_result ->> 'allowed')::boolean
      and (v_result ->> 'remaining')::integer = 0
      and (v_result ->> 'retry_after_seconds')::integer between 1 and 60,
    v_result::text
  );

  begin
    perform public.consume_external_api_rate_limits_as_system(
      jsonb_build_array(
        jsonb_build_object(
          'scope', 'preauth_network',
          'identity', '203.0.113.7'
        ),
        jsonb_build_object(
          'scope', 'preauth_prefix',
          'identity', '203.0.113.7.missing'
        )
      )
    );
  exception
    when sqlstate '22023' then
      v_rejected := sqlerrm =
        'external_api_rate_limit_identity_invalid';
  end;
  insert into external_api_rate_limit_contract_results (
    check_name,
    passed
  ) values ('raw_network_identity_rejected', v_rejected);

  v_rejected := false;
  begin
    perform public.consume_external_api_rate_limits_as_system(
      jsonb_build_array(
        jsonb_build_object(
          'scope', 'company',
          'identity', repeat('B', 43)
        ),
        jsonb_build_object(
          'scope', 'preauth_network',
          'identity', repeat('C', 43)
        )
      )
    );
  exception
    when sqlstate '22023' then
      v_rejected := sqlerrm =
        'external_api_rate_limit_scope_group_invalid';
  end;
  insert into external_api_rate_limit_contract_results (
    check_name,
    passed
  ) values ('mixed_policy_group_rejected', v_rejected);
end;
$rate_limit_behavior$;

insert into external_api_rate_limit_contract_results (
  check_name,
  passed
)
select
  'private_tables_deny_app_roles',
  not has_table_privilege(
    'authenticated',
    'private.external_api_rate_limit_windows',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'private.external_api_rate_limit_windows',
    'SELECT'
  )
  and not has_table_privilege(
    'anon',
    'private.external_api_rate_limit_policies',
    'SELECT'
  );

insert into external_api_rate_limit_contract_results (
  check_name,
  passed
)
select
  'public_wrappers_are_service_only',
  has_function_privilege(
    'service_role',
    'public.consume_external_api_rate_limits_as_system(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.consume_external_api_rate_limits_as_system(jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.purge_external_api_rate_limit_windows_as_system(integer)',
    'EXECUTE'
  );

do $bounded_cleanup$
declare
  v_window_start timestamptz :=
    to_timestamp(
      floor(
        extract(epoch from clock_timestamp() - interval '1 minute') / 10
      ) * 10
    );
  v_deleted integer;
begin
  insert into private.external_api_rate_limit_windows (
    scope,
    identity_digest,
    window_name,
    window_started_at,
    duration_seconds,
    request_limit,
    request_count,
    expires_at
  ) values (
    'company',
    repeat('D', 43),
    'burst',
    v_window_start,
    10,
    60,
    1,
    v_window_start + interval '10 seconds'
  );

  v_deleted :=
    public.purge_external_api_rate_limit_windows_as_system(1);
  insert into external_api_rate_limit_contract_results (
    check_name,
    passed,
    details
  ) values (
    'bounded_cleanup_deletes_expired_window',
    v_deleted = 1,
    v_deleted::text
  );
end;
$bounded_cleanup$;

do $contract$
declare
  v_expected_checks constant text[] := array[
    'bounded_cleanup_deletes_expired_window',
    'exact_boundary_denies',
    'mixed_policy_group_rejected',
    'private_tables_deny_app_roles',
    'public_wrappers_are_service_only',
    'raw_network_identity_rejected'
  ]::text[];
  v_missing_checks text;
  v_unexpected_checks text;
  v_failures text;
begin
  select string_agg(expected.check_name, ', ' order by expected.check_name)
  into v_missing_checks
  from unnest(v_expected_checks) expected(check_name)
  where not exists (
    select 1
    from external_api_rate_limit_contract_results result
    where result.check_name = expected.check_name
  );

  select string_agg(result.check_name, ', ' order by result.check_name)
  into v_unexpected_checks
  from external_api_rate_limit_contract_results result
  where not (result.check_name = any(v_expected_checks));

  if v_missing_checks is not null or v_unexpected_checks is not null then
    raise exception
      'external_api_rate_limit_contract_check_set_changed: missing=%, unexpected=%',
      coalesce(v_missing_checks, 'none'),
      coalesce(v_unexpected_checks, 'none')
      using errcode = '55000';
  end if;

  select string_agg(
    result.check_name || coalesce(': ' || result.details, ''),
    ', '
    order by result.check_name
  )
  into v_failures
  from external_api_rate_limit_contract_results result
  where not result.passed;

  if v_failures is not null then
    raise exception 'external_api_rate_limit_contract_failed: %', v_failures
      using errcode = '55000';
  end if;
end;
$contract$;

select 'OPS_EXTERNAL_API_SQL_CONTRACT_PASS';

select check_name, passed
from external_api_rate_limit_contract_results
order by check_name;

rollback;
