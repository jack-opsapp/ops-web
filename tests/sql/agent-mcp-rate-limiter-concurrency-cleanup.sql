\set ON_ERROR_STOP on

begin;

select set_config('ops_test.rate_limit_race_window', :'race_window', false);

delete from private.mcp_request_audit
where request_id like 'task7-concurrency-%';

do $cleanup$
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
begin
  delete from private.agent_mcp_rate_limit_buckets bucket
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
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'actor', v_company, v_actor_one, null,
      'task7_shared_company_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'grant', v_company, v_actor_one, v_grant_one,
      'task7_shared_company_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'actor', v_company, v_actor_two, null,
      'task7_shared_company_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'grant', v_company, v_actor_two, v_grant_two,
      'task7_shared_company_race', v_policy, v_window
    ),
    private.agent_mcp_rate_limit_bucket_digest(
      'company', v_company, null, null,
      'task7_shared_company_race', v_policy, v_window
    )
  );
end;
$cleanup$;

delete from private.mcp_oauth_tokens
where grant_id in (
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);
delete from private.mcp_oauth_authorization_codes
where client_id = '81000000-0000-4000-8000-000000000001';
delete from private.mcp_oauth_grants
where id in (
  '82000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000002'
);
delete from private.mcp_oauth_clients
where client_id = '81000000-0000-4000-8000-000000000001';

commit;
