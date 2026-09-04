begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '60s';

select set_config('request.jwt.claim.role', 'service_role', true);

create temp table public_mcp_tool_request_contract_results (
  check_name text primary key,
  passed boolean not null,
  details text
) on commit drop;

insert into public_mcp_tool_request_contract_results (
  check_name,
  passed,
  details
)
select
  'catalog_is_private_and_service_only',
  relation.relrowsecurity
    and relation.relforcerowsecurity
    and function_row.prosecdef
    and function_row.provolatile = 'v'
    and function_row.proconfig = array[
      'search_path=pg_catalog, public, private, extensions, pg_temp'
    ]::text[]
    and has_function_privilege(
      'service_role',
      'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)',
      'EXECUTE'
    )
    and exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl_row
      where acl_row.grantee = ('service_role'::regrole)::oid
        and acl_row.privilege_type = 'EXECUTE'
    )
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          function_row.proacl,
          pg_catalog.acldefault('f', function_row.proowner)
        )
      ) acl_row
      where acl_row.grantee not in (
        function_row.proowner,
        ('service_role'::regrole)::oid
      )
    )
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) acl_row
      where acl_row.grantee <> relation.relowner
    )
    and not exists (
      select 1
      from pg_catalog.pg_policy policy_row
      where policy_row.polrelid = relation.oid
    ),
  pg_catalog.jsonb_build_object(
    'rls', relation.relrowsecurity,
    'force_rls', relation.relforcerowsecurity,
    'security_definer', function_row.prosecdef,
    'volatility', function_row.provolatile,
    'config', function_row.proconfig
  )::text
from pg_catalog.pg_class relation
join pg_catalog.pg_namespace namespace
  on namespace.oid = relation.relnamespace
cross join lateral (
  select procedure_row.*
  from pg_catalog.pg_proc procedure_row
  where procedure_row.oid =
    'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)'::regprocedure
) function_row
where namespace.nspname = 'private'
  and relation.relname = 'mcp_tool_request_rate_limit_windows'
  and relation.relkind = 'r';

insert into public_mcp_tool_request_contract_results (
  check_name,
  passed,
  details
)
select
  'catalog_comments_are_exact',
  pg_catalog.obj_description(
    'private.mcp_tool_request_rate_limit_windows'::regclass,
    'pg_class'
  ) =
    'Durable anonymous MCP tool-request rate windows. Stores only digests of server-generated HMAC identities; never raw IP or email values.'
  and pg_catalog.obj_description(
    'public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)'::regprocedure,
    'pg_proc'
  ) =
    'Atomically creates or replays one public MCP tool request after durable network and email rate checks. Service role only; caller identities must already be domain-separated HMAC values.',
  null;

do $authorization$
declare
  v_rejected boolean := false;
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform public.submit_public_mcp_tool_request_as_system(
      '01000000-0000-4000-8000-000000000001'::uuid,
      'operator@example.com',
      'Show the deck geometry and calculate every material quantity.',
      repeat('A', 43),
      repeat('B', 43),
      '2026-09-03.mcp-exposure.v10'
    );
  exception
    when sqlstate '42501' then
      v_rejected := sqlerrm = 'access_denied';
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed
  ) values ('helper_rejects_non_service_claim', v_rejected);
end;
$authorization$;

set local role service_role;

select result.outcome
from public.submit_public_mcp_tool_request_as_system(
  '01000000-0000-4000-8000-000000000002'::uuid,
  'service-role@example.com',
  'Create one request through the granted service-role execution boundary.',
  repeat('h', 43),
  repeat('i', 43),
  '2026-09-03.mcp-exposure.v10'
) result;

reset role;

insert into public_mcp_tool_request_contract_results (
  check_name,
  passed
)
select
  'service_role_executes_definer_boundary',
  exists (
    select 1
    from public.feature_requests request_row
    where request_row.id =
      'mcp-tool:01000000-0000-4000-8000-000000000002'
      and request_row.user_id = 'public:mcp-tool-request'
      and request_row.company_id = 'public:mcp-tool-request'
  );

do $strict_projection_and_replay$
declare
  v_outcome text;
  v_submission_id uuid;
  v_feature_request_id text;
  v_retry_after_seconds integer;
  v_counts_before integer;
  v_counts_after integer;
  v_conflict_rejected boolean := false;
  v_invalid_rejected boolean := false;
  v_row public.feature_requests%rowtype;
begin
  select
    result.outcome,
    result.submission_id,
    result.feature_request_id,
    result.retry_after_seconds
  into
    v_outcome,
    v_submission_id,
    v_feature_request_id,
    v_retry_after_seconds
  from public.submit_public_mcp_tool_request_as_system(
    '11111111-1111-4111-8111-111111111111'::uuid,
    '  OPERATOR@Example.COM  ',
    E'  Please expose the Carly Hunter deck design geometry, total railing length, surface area, and linked site visit photos.\r\nInclude the source records.  ',
    repeat('C', 43),
    repeat('D', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  select request_row.*
    into strict v_row
  from public.feature_requests request_row
  where request_row.id =
    'mcp-tool:11111111-1111-4111-8111-111111111111';

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'strict_fixed_projection',
    v_outcome = 'created'
      and v_submission_id =
        '11111111-1111-4111-8111-111111111111'::uuid
      and v_feature_request_id =
        'mcp-tool:11111111-1111-4111-8111-111111111111'
      and v_retry_after_seconds is null
      and v_row.user_id = 'public:mcp-tool-request'
      and v_row.company_id = 'public:mcp-tool-request'
      and v_row.type = 'mcp_tool_request'
      and v_row.title =
        'Please expose the Carly Hunter deck design geometry, total railing length, surface area, and ...'
      and char_length(v_row.title) = 96
      and v_row.description =
        E'Please expose the Carly Hunter deck design geometry, total railing length, surface area, and linked site visit photos.\nInclude the source records.'
      and v_row.source_screen = '/developers/mcp'
      and v_row.status = 'new'
      and v_row.user_email = 'operator@example.com'
      and v_row.user_name is null
      and v_row.app_version = '2026-09-03.mcp-exposure.v10'
      and v_row.platform = 'web',
    pg_catalog.to_jsonb(v_row)::text
  );

  select result.outcome
    into v_outcome
  from public.submit_public_mcp_tool_request_as_system(
    '11111111-1111-4111-8111-111111111113'::uuid,
    'first-line@example.com',
    E'Carly Hunter deck quantities\nShow the geometry and linked site visit evidence.',
    repeat('f', 43),
    repeat('g', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  )
  select
    'title_uses_only_first_normalized_line',
    v_outcome = 'created'
      and request_row.title = 'Carly Hunter deck quantities',
    request_row.title
  from public.feature_requests request_row
  where request_row.id =
    'mcp-tool:11111111-1111-4111-8111-111111111113';

  select coalesce(sum(window_row.request_count), 0)::integer
    into v_counts_before
  from private.mcp_tool_request_rate_limit_windows window_row;

  select result.outcome, result.retry_after_seconds
    into v_outcome, v_retry_after_seconds
  from public.submit_public_mcp_tool_request_as_system(
    '11111111-1111-4111-8111-111111111111'::uuid,
    'operator@example.com',
    E'Please expose the Carly Hunter deck design geometry, total railing length, surface area, and linked site visit photos.\nInclude the source records.',
    repeat('C', 43),
    repeat('D', 43),
    '2026-09-04.mcp-exposure.v11'
  ) result;

  select coalesce(sum(window_row.request_count), 0)::integer
    into v_counts_after
  from private.mcp_tool_request_rate_limit_windows window_row;

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'replay_precedes_rate_consumption',
    v_outcome = 'replayed'
      and v_retry_after_seconds is null
      and v_counts_after = v_counts_before
      and (
        select request_row.app_version
        from public.feature_requests request_row
        where request_row.id =
          'mcp-tool:11111111-1111-4111-8111-111111111111'
      ) = '2026-09-03.mcp-exposure.v10',
    pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'before', v_counts_before,
      'after', v_counts_after
    )::text
  );

  begin
    perform public.submit_public_mcp_tool_request_as_system(
      '11111111-1111-4111-8111-111111111111'::uuid,
      'operator@example.com',
      'A different request must never reuse the same submission identifier.',
      repeat('C', 43),
      repeat('D', 43),
      '2026-09-03.mcp-exposure.v10'
    );
  exception
    when sqlstate '23505' then
      v_conflict_rejected := sqlerrm = 'mcp_tool_request_id_conflict';
  end;

  select coalesce(sum(window_row.request_count), 0)::integer
    into v_counts_after
  from private.mcp_tool_request_rate_limit_windows window_row;

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed
  ) values (
    'conflicting_id_rejected_without_consumption',
    v_conflict_rejected and v_counts_after = v_counts_before
  );

  begin
    perform public.submit_public_mcp_tool_request_as_system(
      '11111111-1111-4111-8111-111111111112'::uuid,
      'operator@example.com',
      'A syntactically valid request body with an invalid raw network value.',
      '203.0.113.7',
      repeat('D', 43),
      '2026-09-03.mcp-exposure.v10'
    );
  exception
    when sqlstate '22023' then
      v_invalid_rejected := sqlerrm =
        'mcp_tool_request_rate_identity_invalid';
  end;

  select coalesce(sum(window_row.request_count), 0)::integer
    into v_counts_after
  from private.mcp_tool_request_rate_limit_windows window_row;

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed
  ) values (
    'raw_rate_identity_rejected_without_consumption',
    v_invalid_rejected and v_counts_after = v_counts_before
  );
end;
$strict_projection_and_replay$;

do $network_hour_limit$
declare
  v_ordinal integer;
  v_outcome text;
  v_retry_after_seconds integer;
  v_expected_retry integer;
  v_network_count integer;
  v_denied_email_rows integer;
begin
  for v_ordinal in 1..5 loop
    select result.outcome
      into v_outcome
    from public.submit_public_mcp_tool_request_as_system(
      (
        '20000000-0000-4000-8000-' ||
          pg_catalog.lpad(v_ordinal::text, 12, '0')
      )::uuid,
      pg_catalog.format('network-hour-%s@example.com', v_ordinal),
      'Request a bounded MCP tool for network-hour contract verification.',
      repeat('E', 43),
      repeat(chr(70 + v_ordinal), 43),
      '2026-09-03.mcp-exposure.v10'
    ) result;

    if v_outcome <> 'created' then
      raise exception 'network hour denied before boundary';
    end if;
  end loop;

  select result.outcome, result.retry_after_seconds
    into v_outcome, v_retry_after_seconds
  from public.submit_public_mcp_tool_request_as_system(
    '20000000-0000-4000-8000-000000000006'::uuid,
    'network-hour-6@example.com',
    'Request a bounded MCP tool for the denied network-hour attempt.',
    repeat('E', 43),
    repeat('L', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  v_expected_retry := greatest(
    1,
    ceil(extract(epoch from (
      pg_catalog.to_timestamp(
        floor(extract(epoch from statement_timestamp()) / 3600) * 3600
      ) + interval '1 hour' - statement_timestamp()
    )))::integer
  );

  select window_row.request_count
    into strict v_network_count
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_kind = 'network'
    and window_row.window_kind = 'hour'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'network',
          repeat('E', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    );

  select count(*)::integer
    into v_denied_email_rows
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_kind = 'email'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'email',
          repeat('L', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    );

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'network_hour_limit_is_atomic',
    v_outcome = 'rate_limited'
      and v_retry_after_seconds = v_expected_retry
      and v_network_count = 5
      and v_denied_email_rows = 0
      and not exists (
        select 1
        from public.feature_requests request_row
        where request_row.id =
          'mcp-tool:20000000-0000-4000-8000-000000000006'
      ),
    pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'retry_after', v_retry_after_seconds,
      'expected_retry', v_expected_retry,
      'network_count', v_network_count,
      'denied_email_rows', v_denied_email_rows
    )::text
  );
end;
$network_hour_limit$;

do $email_day_limit$
declare
  v_ordinal integer;
  v_outcome text;
  v_retry_after_seconds integer;
  v_expected_retry integer;
  v_email_count integer;
  v_denied_network_rows integer;
begin
  for v_ordinal in 1..3 loop
    select result.outcome
      into v_outcome
    from public.submit_public_mcp_tool_request_as_system(
      (
        '30000000-0000-4000-8000-' ||
          pg_catalog.lpad(v_ordinal::text, 12, '0')
      )::uuid,
      'email-day-limit@example.com',
      'Request a bounded MCP tool for email-day contract verification.',
      repeat(chr(111 + v_ordinal), 43),
      repeat('Q', 43),
      '2026-09-03.mcp-exposure.v10'
    ) result;

    if v_outcome <> 'created' then
      raise exception 'email day denied before boundary';
    end if;
  end loop;

  select result.outcome, result.retry_after_seconds
    into v_outcome, v_retry_after_seconds
  from public.submit_public_mcp_tool_request_as_system(
    '30000000-0000-4000-8000-000000000004'::uuid,
    'email-day-limit@example.com',
    'Request a bounded MCP tool for the denied email-day attempt.',
    repeat('s', 43),
    repeat('Q', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  v_expected_retry := greatest(
    1,
    ceil(extract(epoch from (
      pg_catalog.to_timestamp(
        floor(extract(epoch from statement_timestamp()) / 86400) * 86400
      ) + interval '1 day' - statement_timestamp()
    )))::integer
  );

  select window_row.request_count
    into strict v_email_count
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_kind = 'email'
    and window_row.window_kind = 'day'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'email',
          repeat('Q', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    );

  select count(*)::integer
    into v_denied_network_rows
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.identity_kind = 'network'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'network',
          repeat('s', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    );

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'email_day_limit_is_atomic',
    v_outcome = 'rate_limited'
      and v_retry_after_seconds = v_expected_retry
      and v_email_count = 3
      and v_denied_network_rows = 0
      and not exists (
        select 1
        from public.feature_requests request_row
        where request_row.id =
          'mcp-tool:30000000-0000-4000-8000-000000000004'
      ),
    pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'retry_after', v_retry_after_seconds,
      'expected_retry', v_expected_retry,
      'email_count', v_email_count,
      'denied_network_rows', v_denied_network_rows
    )::text
  );
end;
$email_day_limit$;

do $network_day_limit$
declare
  v_day_start timestamptz := pg_catalog.to_timestamp(
    floor(extract(epoch from statement_timestamp()) / 86400) * 86400
  );
  v_outcome text;
  v_retry_after_seconds integer;
  v_expected_retry integer;
  v_related_rows integer;
begin
  insert into private.mcp_tool_request_rate_limit_windows (
    identity_digest,
    identity_kind,
    window_kind,
    policy_id,
    window_started_at,
    request_count,
    expires_at
  ) values (
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'network',
          repeat('V', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'network',
    'day',
    'mcp-tool-request-public:2026-09-04.v1',
    v_day_start,
    20,
    v_day_start + interval '1 day 5 minutes'
  );

  select result.outcome, result.retry_after_seconds
    into v_outcome, v_retry_after_seconds
  from public.submit_public_mcp_tool_request_as_system(
    '40000000-0000-4000-8000-000000000001'::uuid,
    'network-day-limit@example.com',
    'Request a bounded MCP tool for the denied network-day attempt.',
    repeat('V', 43),
    repeat('W', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  v_expected_retry := greatest(
    1,
    ceil(extract(epoch from (
      v_day_start + interval '1 day' - statement_timestamp()
    )))::integer
  );

  select count(*)::integer
    into v_related_rows
  from private.mcp_tool_request_rate_limit_windows window_row
  where (
    window_row.identity_kind = 'network'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'network',
          repeat('V', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    )
  ) or (
    window_row.identity_kind = 'email'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'email',
          repeat('W', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    )
  );

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'network_day_limit_is_atomic',
    v_outcome = 'rate_limited'
      and v_retry_after_seconds = v_expected_retry
      and v_related_rows = 1
      and not exists (
        select 1
        from public.feature_requests request_row
        where request_row.id =
          'mcp-tool:40000000-0000-4000-8000-000000000001'
      ),
    pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'retry_after', v_retry_after_seconds,
      'expected_retry', v_expected_retry,
      'related_rows', v_related_rows
    )::text
  );
end;
$network_day_limit$;

create function pg_temp.reject_mcp_tool_request_contract_insert()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'pg_temp'
as $function$
begin
  if new.id = 'mcp-tool:50000000-0000-4000-8000-000000000001' then
    raise exception 'contract_insert_rejected';
  end if;
  return new;
end;
$function$;

create trigger reject_mcp_tool_request_contract_insert
before insert on public.feature_requests
for each row
execute function pg_temp.reject_mcp_tool_request_contract_insert();

do $failed_insert_rolls_back_counters$
declare
  v_failed boolean := false;
  v_related_rows integer;
begin
  begin
    perform public.submit_public_mcp_tool_request_as_system(
      '50000000-0000-4000-8000-000000000001'::uuid,
      'insert-failure@example.com',
      'This valid request is rejected by the contract-only insert trigger.',
      repeat('X', 43),
      repeat('Y', 43),
      '2026-09-03.mcp-exposure.v10'
    );
  exception
    when raise_exception then
      v_failed := sqlerrm = 'contract_insert_rejected';
  end;

  select count(*)::integer
    into v_related_rows
  from private.mcp_tool_request_rate_limit_windows window_row
  where (
    window_row.identity_kind = 'network'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'network',
          repeat('X', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    )
  ) or (
    window_row.identity_kind = 'email'
    and window_row.identity_digest = extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'mcp-tool-request-rate-identity:2026-09-04.v1',
          'email',
          repeat('Y', 43)
        )::text,
        'UTF8'
      ),
      'sha256'
    )
  );

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'failed_insert_rolls_back_all_counters',
    v_failed
      and v_related_rows = 0
      and not exists (
        select 1
        from public.feature_requests request_row
        where request_row.id =
          'mcp-tool:50000000-0000-4000-8000-000000000001'
      ),
    pg_catalog.jsonb_build_object(
      'failed', v_failed,
      'related_rows', v_related_rows
    )::text
  );
end;
$failed_insert_rolls_back_counters$;

drop trigger reject_mcp_tool_request_contract_insert
  on public.feature_requests;

do $bounded_cleanup$
declare
  v_ordinal integer;
  v_remaining_expired integer;
  v_outcome text;
begin
  for v_ordinal in 1..33 loop
    insert into private.mcp_tool_request_rate_limit_windows (
      identity_digest,
      identity_kind,
      window_kind,
      policy_id,
      window_started_at,
      request_count,
      expires_at
    ) values (
      extensions.digest(
        pg_catalog.convert_to(
          'expired-contract-row:' || v_ordinal::text,
          'UTF8'
        ),
        'sha256'
      ),
      'network',
      'hour',
      'mcp-tool-request-public:2026-09-04.v1',
      statement_timestamp() - interval '2 hours 5 minutes',
      1,
      statement_timestamp() - interval '1 hour'
    );
  end loop;

  select result.outcome
    into v_outcome
  from public.submit_public_mcp_tool_request_as_system(
    '60000000-0000-4000-8000-000000000001'::uuid,
    'cleanup@example.com',
    'Request a bounded MCP tool while pruning expired limiter windows.',
    repeat('Z', 43),
    repeat('a', 43),
    '2026-09-03.mcp-exposure.v10'
  ) result;

  select count(*)::integer
    into v_remaining_expired
  from private.mcp_tool_request_rate_limit_windows window_row
  where window_row.expires_at <= statement_timestamp();

  insert into public_mcp_tool_request_contract_results (
    check_name,
    passed,
    details
  ) values (
    'cleanup_is_bounded_to_32_expired_rows',
    v_outcome = 'created' and v_remaining_expired = 1,
    pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'remaining_expired', v_remaining_expired
    )::text
  );
end;
$bounded_cleanup$;

do $contract$
declare
  v_expected_checks constant text[] := array[
    'catalog_comments_are_exact',
    'catalog_is_private_and_service_only',
    'cleanup_is_bounded_to_32_expired_rows',
    'conflicting_id_rejected_without_consumption',
    'email_day_limit_is_atomic',
    'failed_insert_rolls_back_all_counters',
    'helper_rejects_non_service_claim',
    'network_day_limit_is_atomic',
    'network_hour_limit_is_atomic',
    'raw_rate_identity_rejected_without_consumption',
    'replay_precedes_rate_consumption',
    'service_role_executes_definer_boundary',
    'strict_fixed_projection',
    'title_uses_only_first_normalized_line'
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
    from public_mcp_tool_request_contract_results result
    where result.check_name = expected.check_name
  );

  select string_agg(result.check_name, ', ' order by result.check_name)
    into v_unexpected_checks
  from public_mcp_tool_request_contract_results result
  where not (result.check_name = any(v_expected_checks));

  if v_missing_checks is not null or v_unexpected_checks is not null then
    raise exception
      'public_mcp_tool_request_contract_check_set_changed: missing=%, unexpected=%',
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
  from public_mcp_tool_request_contract_results result
  where not result.passed;

  if v_failures is not null then
    raise exception 'public_mcp_tool_request_contract_failed: %', v_failures
      using errcode = '55000';
  end if;
end;
$contract$;

select 'OPS_PUBLIC_MCP_TOOL_REQUEST_SQL_CONTRACT_PASS';

select check_name, passed
from public_mcp_tool_request_contract_results
order by check_name;

rollback;
