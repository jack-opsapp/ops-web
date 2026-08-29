-- Runtime contract for the durable, multi-instance MCP capability limiter.
--
-- Run only against an isolated PostgreSQL 17 fixture after the MCP OAuth
-- authorization-server and consent-catalog migrations. Every mutation is
-- rolled back. The migration replay below must preserve its generated HMAC
-- key and all live counters.

\set ON_ERROR_STOP on

begin;

select set_config(
  'ops_test.rate_limit_key_before_replay',
  encode(key_row.key_material, 'hex'),
  false
)
from private.agent_mcp_rate_limit_keys key_row
where key_row.key_id = 'mcp-rate-limit-hmac:2026-08-23.v1';

insert into private.agent_mcp_rate_limit_buckets (
  bucket_digest,
  bucket_kind,
  policy_id,
  window_start,
  units_used,
  expires_at
) values (
  extensions.digest(convert_to('replay-sentinel', 'UTF8'), 'sha256'),
  'actor',
  'mcp-lightweight-read:2026-08-23.v1',
  date_trunc('minute', statement_timestamp()),
  7,
  statement_timestamp() + interval '10 minutes'
);

grant select on table private.agent_mcp_rate_limit_keys to pg_monitor;
grant select on table private.agent_mcp_rate_limit_buckets to pg_monitor;
grant execute on function private.agent_mcp_rate_limit_bucket_digest(
  text, uuid, uuid, uuid, text, text, timestamptz
) to pg_monitor with grant option;
grant execute on function public.consume_agent_mcp_rate_limit_as_system(
  text, uuid, uuid, uuid, text, text, integer, text
) to pg_monitor with grant option;

\ir ../../supabase/migrations/20260823072843_agent_mcp_durable_rate_limit.sql

do $assert$
declare
  v_role text;
  v_signature constant text :=
    'public.consume_agent_mcp_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)';
begin
  if current_setting('server_version_num')::integer < 170000
     or current_setting('server_version_num')::integer >= 180000 then
    raise exception 'runtime_requires_postgresql_17';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, v_signature, 'execute') then
      raise exception 'application_role_can_consume_rate_limit:%', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', v_signature, 'execute') then
    raise exception 'service_role_cannot_consume_rate_limit';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl_entry
    where relation.oid in (
      'private.agent_mcp_rate_limit_keys'::regclass,
      'private.agent_mcp_rate_limit_buckets'::regclass
    )
      and acl_entry.grantee = 'pg_monitor'::regrole::oid
  ) or exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) acl_entry
    where procedure.oid in (
      'private.agent_mcp_rate_limit_bucket_digest(text,uuid,uuid,uuid,text,text,timestamp with time zone)'::regprocedure,
      v_signature::regprocedure
    )
      and acl_entry.grantee = 'pg_monitor'::regrole::oid
  ) then
    raise exception 'unexpected_rate_limit_acl_survived_replay';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(
      v_role,
      'private.agent_mcp_rate_limit_buckets',
      'select,insert,update,delete'
    ) or has_table_privilege(
      v_role,
      'private.agent_mcp_rate_limit_keys',
      'select,insert,update,delete'
    ) then
      raise exception 'application_role_has_rate_limit_table_access:%', v_role;
    end if;
  end loop;

  if (
    select count(*)
    from private.agent_mcp_rate_limit_keys key_row
    where key_row.key_id = 'mcp-rate-limit-hmac:2026-08-23.v1'
      and octet_length(key_row.key_material) = 32
      and encode(key_row.key_material, 'hex') = current_setting(
        'ops_test.rate_limit_key_before_replay'
      )
  ) <> 1 then
    raise exception 'rate_limit_hmac_key_missing_or_rotated_on_replay';
  end if;

  if (
    select count(*)
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.bucket_digest = extensions.digest(
        convert_to('replay-sentinel', 'UTF8'),
        'sha256'
      )
      and bucket.units_used = 7
  ) <> 1 then
    raise exception 'rate_limit_counter_lost_on_replay';
  end if;
end;
$assert$;

set local request.jwt.claim.role = 'service_role';

create temporary table runtime_first_consume on commit drop as
select *
from public.consume_agent_mcp_rate_limit_as_system(
  'runtime-first',
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'search_jobs',
  'mcp-evidence-search:2026-08-23.v1',
  1,
  'modern'
);

do $assert$
declare
  v_reset_at timestamptz;
begin
  if (select count(*) from runtime_first_consume) <> 1
     or (select allowed from runtime_first_consume) is distinct from true
     or (select remaining_units from runtime_first_consume) is distinct from 29 then
    raise exception 'first_consume_projection_mismatch';
  end if;

  select reset_at into v_reset_at from runtime_first_consume;
  if v_reset_at <= statement_timestamp()
     or v_reset_at > statement_timestamp() + interval '60 seconds' then
    raise exception 'first_consume_reset_window_invalid';
  end if;

  if (
    select count(*)
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.policy_id = 'mcp-evidence-search:2026-08-23.v1'
      and bucket.window_start = v_reset_at - interval '60 seconds'
      and bucket.units_used = 1
      and octet_length(bucket.bucket_digest) = 32
  ) <> 3 then
    raise exception 'first_consume_bucket_shape_mismatch';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(
      to_jsonb((select bucket from private.agent_mcp_rate_limit_buckets bucket limit 1))
    ) key_name
    where key_name ~ '(company_id|actor_user_id|grant_id|capability_id|request_id|query|token|evidence)'
  ) then
    raise exception 'bucket_persisted_business_identifier_column';
  end if;
end;
$assert$;

-- Reach the evidence/search actor and grant ceiling. All three dimensions
-- advance together while allowed; denial leaves every counter unchanged.
do $consume$
declare
  v_index integer;
  v_row record;
begin
  for v_index in 2..30 loop
    select * into strict v_row
    from public.consume_agent_mcp_rate_limit_as_system(
      'runtime-allow-' || v_index::text,
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'search_jobs',
      'mcp-evidence-search:2026-08-23.v1',
      1,
      'modern'
    );
    if not v_row.allowed then
      raise exception 'allowed_unit_denied_early:%', v_index;
    end if;
  end loop;

  select * into strict v_row
  from public.consume_agent_mcp_rate_limit_as_system(
    'runtime-denied-31',
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'search_jobs',
    'mcp-evidence-search:2026-08-23.v1',
    1,
    'modern'
  );
  if v_row.allowed or v_row.remaining_units <> 0 then
    raise exception 'evidence_ceiling_not_enforced';
  end if;
end;
$consume$;

do $assert$
begin
  if (
    select count(*)
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.policy_id = 'mcp-evidence-search:2026-08-23.v1'
      and bucket.window_start = (select reset_at from runtime_first_consume)
        - interval '60 seconds'
      and bucket.bucket_kind in ('actor', 'grant')
      and bucket.units_used = 30
  ) <> 2 then
    raise exception 'denial_partially_incremented_actor_or_grant';
  end if;

  if (
    select count(*)
    from private.agent_mcp_rate_limit_buckets bucket
    where bucket.policy_id = 'mcp-evidence-search:2026-08-23.v1'
      and bucket.window_start = (select reset_at from runtime_first_consume)
        - interval '60 seconds'
      and bucket.bucket_kind = 'company'
      and bucket.units_used = 30
  ) <> 1 then
    raise exception 'denial_partially_incremented_company';
  end if;

  if (
    select count(*)
    from private.mcp_request_audit audit
    where audit.request_id = 'runtime-denied-31'
      and audit.grant_id = '44444444-4444-4444-8444-444444444444'
      and audit.actor_user_id = '22222222-2222-4222-8222-222222222222'
      and audit.company_id = '33333333-3333-4333-8333-333333333333'
      and audit.tool = 'search_jobs'
      and audit.protocol_era = 'modern'
      and audit.outcome = 'rate_limited'
      and audit.error_code = 'RATE_LIMITED'
      and audit.input_sha256 is null
      and audit.result_bytes is null
      and audit.latency_ms is null
  ) <> 1 then
    raise exception 'durable_denial_audit_not_coupled';
  end if;
end;
$assert$;

-- A retry is another attempted unit, remains denied without counter churn,
-- and receives its own immutable denial record.
select *
from public.consume_agent_mcp_rate_limit_as_system(
  'runtime-denied-retry',
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'search_jobs',
  'mcp-evidence-search:2026-08-23.v1',
  1,
  'modern'
);

do $assert$
begin
  if (
    select count(*)
    from private.mcp_request_audit
    where request_id = 'runtime-denied-retry'
      and outcome = 'rate_limited'
  ) <> 1 then
    raise exception 'denied_retry_audit_missing';
  end if;
end;
$assert$;

-- Capability and policy are independent bucket dimensions.
do $assert$
declare
  v_other_capability record;
  v_other_policy record;
begin
  select * into strict v_other_capability
  from public.consume_agent_mcp_rate_limit_as_system(
    'runtime-other-capability',
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'search_customers',
    'mcp-evidence-search:2026-08-23.v1',
    1,
    'modern'
  );
  if not v_other_capability.allowed
     or v_other_capability.remaining_units <> 29 then
    raise exception 'capability_bucket_binding_missing';
  end if;

  select * into strict v_other_policy
  from public.consume_agent_mcp_rate_limit_as_system(
    'runtime-other-policy',
    '44444444-4444-4444-8444-444444444444',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'search_jobs',
    'mcp-lightweight-read:2026-08-23.v1',
    1,
    'modern'
  );
  if not v_other_policy.allowed or v_other_policy.remaining_units <> 119 then
    raise exception 'policy_bucket_binding_missing';
  end if;
end;
$assert$;

-- Bad units, policies, capabilities, and stale grant bindings fail before a
-- bucket can be created.
do $assert$
begin
  begin
    perform * from public.consume_agent_mcp_rate_limit_as_system(
      'runtime-bad-units',
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'search_jobs',
      'mcp-evidence-search:2026-08-23.v1',
      2,
      'modern'
    );
    raise exception 'variable_units_accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform * from public.consume_agent_mcp_rate_limit_as_system(
      'runtime-bad-policy',
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'search_jobs',
      'caller-policy',
      1,
      'modern'
    );
    raise exception 'open_policy_accepted';
  exception when invalid_parameter_value then null;
  end;

  begin
    perform * from public.consume_agent_mcp_rate_limit_as_system(
      'runtime-bad-capability',
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'query_table',
      'mcp-evidence-search:2026-08-23.v1',
      1,
      'modern'
    );
    raise exception 'generic_capability_accepted';
  exception when invalid_parameter_value then null;
  end;

  update private.mcp_oauth_grants
  set revoked_at = statement_timestamp()
  where id = '44444444-4444-4444-8444-444444444444';

  begin
    perform * from public.consume_agent_mcp_rate_limit_as_system(
      'runtime-revoked-grant',
      '44444444-4444-4444-8444-444444444444',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'list_scheduled_jobs',
      'mcp-lightweight-read:2026-08-23.v1',
      1,
      'modern'
    );
    raise exception 'revoked_grant_accepted';
  exception when insufficient_privilege then null;
  end;

  update private.mcp_oauth_grants
  set revoked_at = null
  where id = '44444444-4444-4444-8444-444444444444';
end;
$assert$;

-- Cleanup is a hard 64-row indexed batch, never an unbounded request sweep.
insert into private.agent_mcp_rate_limit_buckets (
  bucket_digest,
  bucket_kind,
  policy_id,
  window_start,
  units_used,
  expires_at
)
select
  extensions.digest(convert_to('expired-' || value::text, 'UTF8'), 'sha256'),
  'actor',
  'mcp-lightweight-read:2026-08-23.v1',
  statement_timestamp() - interval '10 minutes',
  1,
  statement_timestamp() - interval '5 minutes'
from generate_series(1, 70) value;

select *
from public.consume_agent_mcp_rate_limit_as_system(
  'runtime-cleanup',
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'list_customer_jobs',
  'mcp-lightweight-read:2026-08-23.v1',
  1,
  'modern'
);

do $assert$
begin
  if (
    select count(*)
    from private.agent_mcp_rate_limit_buckets
    where expires_at <= statement_timestamp()
  ) <> 6 then
    raise exception 'cleanup_batch_not_exactly_bounded';
  end if;
end;
$assert$;

rollback;
