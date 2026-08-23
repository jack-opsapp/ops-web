-- Post-race assertions. A pgbench process can finish after a SQL error, so
-- durable rows and coupled denial audits are the final authority.

\set ON_ERROR_STOP on

select set_config('ops_test.rate_limit_race_window', :'race_window', false);

do $verify$
declare
  v_window timestamptz := current_setting(
    'ops_test.rate_limit_race_window'
  )::timestamptz;
  v_policy constant text := 'mcp-evidence-search:2026-08-23.v1';
  v_company constant uuid := '86000000-0000-4000-8000-000000000001';
  v_actor_one constant uuid := '84000000-0000-4000-8000-000000000001';
  v_actor_two constant uuid := '85000000-0000-4000-8000-000000000002';
  v_grant_one constant uuid := '82000000-0000-4000-8000-000000000001';
  v_grant_two constant uuid := '83000000-0000-4000-8000-000000000002';
  same_bucket_allowed_count integer;
  same_bucket_denial_count integer;
  same_bucket_audit_count integer;
  same_bucket_row_count integer;
  same_bucket_min_units integer;
  same_bucket_max_units integer;
  shared_company_units integer;
  shared_actor_one_units integer;
  shared_actor_two_units integer;
  shared_actor_units integer;
  shared_grant_one_units integer;
  shared_grant_two_units integer;
  shared_grant_units integer;
  shared_company_audit_count integer;
begin
  select
    count(*)::integer,
    min(bucket.units_used)::integer,
    max(bucket.units_used)::integer
  into
    same_bucket_row_count,
    same_bucket_min_units,
    same_bucket_max_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest in (
    private.agent_mcp_rate_limit_bucket_digest(
      'actor', v_company, v_actor_one, null,
      'task7_same_bucket_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'grant', v_company, v_actor_one, v_grant_one,
      'task7_same_bucket_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'company', v_company, null, null,
      'task7_same_bucket_race', v_policy, v_window
    )
  )
    and bucket.policy_id = v_policy
    and bucket.window_start = v_window;

  select count(*)::integer
    into same_bucket_audit_count
  from private.mcp_request_audit audit
  where audit.request_id like 'task7-concurrency-same-%'
    and audit.company_id = v_company
    and audit.actor_user_id = v_actor_one
    and audit.grant_id = v_grant_one
    and audit.tool = 'task7_same_bucket_race'
    and audit.protocol_era = 'modern'
    and audit.outcome = 'rate_limited'
    and audit.error_code = 'RATE_LIMITED'
    and audit.input_sha256 is null
    and audit.result_bytes is null
    and audit.latency_ms is null;

  same_bucket_denial_count := same_bucket_audit_count;
  same_bucket_allowed_count := 31 - same_bucket_denial_count;

  if same_bucket_allowed_count <> 30
     or same_bucket_denial_count <> 1
     or same_bucket_audit_count <> 1
     or same_bucket_row_count <> 3
     or same_bucket_min_units is distinct from 30
     or same_bucket_max_units is distinct from 30 then
    raise exception
      'same_bucket_race_invalid:allowed=% denied=% audit=% rows=% min=% max=%',
      same_bucket_allowed_count,
      same_bucket_denial_count,
      same_bucket_audit_count,
      same_bucket_row_count,
      same_bucket_min_units,
      same_bucket_max_units;
  end if;

  select bucket.units_used
    into shared_company_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest = private.agent_mcp_rate_limit_bucket_digest(
      'company', v_company, null, null,
      'task7_shared_company_race', v_policy, v_window
    );
  select bucket.units_used
    into shared_actor_one_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest = private.agent_mcp_rate_limit_bucket_digest(
      'actor', v_company, v_actor_one, null,
      'task7_shared_company_race', v_policy, v_window
    );
  select bucket.units_used
    into shared_actor_two_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest = private.agent_mcp_rate_limit_bucket_digest(
      'actor', v_company, v_actor_two, null,
      'task7_shared_company_race', v_policy, v_window
    );
  select bucket.units_used
    into shared_grant_one_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest = private.agent_mcp_rate_limit_bucket_digest(
      'grant', v_company, v_actor_one, v_grant_one,
      'task7_shared_company_race', v_policy, v_window
    );
  select bucket.units_used
    into shared_grant_two_units
  from private.agent_mcp_rate_limit_buckets bucket
  where bucket.bucket_digest = private.agent_mcp_rate_limit_bucket_digest(
      'grant', v_company, v_actor_two, v_grant_two,
      'task7_shared_company_race', v_policy, v_window
    );

  shared_actor_units := shared_actor_one_units + shared_actor_two_units;
  shared_grant_units := shared_grant_one_units + shared_grant_two_units;

  select count(*)::integer
    into shared_company_audit_count
  from private.mcp_request_audit audit
  where audit.request_id like 'task7-concurrency-company-%'
    and audit.company_id = v_company
    and audit.actor_user_id in (v_actor_one, v_actor_two)
    and audit.grant_id in (v_grant_one, v_grant_two)
    and audit.tool = 'task7_shared_company_race'
    and audit.protocol_era = 'modern'
    and audit.outcome = 'rate_limited'
    and audit.error_code = 'RATE_LIMITED'
    and audit.input_sha256 is null
    and audit.result_bytes is null
    and audit.latency_ms is null;

  if shared_company_units is distinct from 120
     or shared_actor_units is distinct from 1
     or shared_grant_units is distinct from 1
     or shared_actor_one_units is distinct from shared_grant_one_units
     or shared_actor_two_units is distinct from shared_grant_two_units
     or shared_company_audit_count <> 1 then
    raise exception
      'shared_company_race_invalid:company=% actors=(%,%) grants=(%,%) audit=%',
      shared_company_units,
      shared_actor_one_units,
      shared_actor_two_units,
      shared_grant_one_units,
      shared_grant_two_units,
      shared_company_audit_count;
  end if;
end;
$verify$;
