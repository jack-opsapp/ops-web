-- Deterministic OAuth identities and near-ceiling buckets for the true
-- multi-session pgbench harness. The database-name guard lives in the outer
-- executable and this file is never run against production.

\set ON_ERROR_STOP on

begin;

select set_config('ops_test.rate_limit_race_window', :'race_window', false);

delete from private.mcp_request_audit
where request_id like 'task7-concurrency-%';

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

-- This database is dedicated to the concurrency harness. Clearing stale
-- counters prevents a failed prior run from weakening the exact 31-way race.
delete from private.agent_mcp_rate_limit_buckets;

insert into private.mcp_oauth_clients (
  client_id,
  client_name,
  redirect_uris,
  token_endpoint_auth_method,
  grant_types,
  response_types,
  scope,
  registration_source,
  software_id,
  software_version,
  created_at,
  disabled_at,
  scope_ceiling,
  consent_catalog_revision,
  exposure_revision
) values (
  '81000000-0000-4000-8000-000000000001',
  'Task 7 concurrency fixture',
  array['https://fixture.invalid/oauth/callback'],
  'none',
  array['authorization_code', 'refresh_token'],
  array['code'],
  'ops.jobs.read',
  'manual',
  'task7-concurrency-fixture',
  '1',
  statement_timestamp(),
  null,
  array['ops.jobs.read'],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants (
  id,
  user_id,
  company_id,
  client_id,
  scopes,
  revision,
  created_at,
  last_used_at,
  revoked_at,
  accepted_labels,
  consent_catalog_revision,
  exposure_revision
) values
  (
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    array['ops.jobs.read'],
    md5('task7-concurrency-grant-one'),
    statement_timestamp(),
    null,
    null,
    array['See your jobs and their status'],
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '85000000-0000-4000-8000-000000000002',
    '86000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    array['ops.jobs.read'],
    md5('task7-concurrency-grant-two'),
    statement_timestamp(),
    null,
    null,
    array['See your jobs and their status'],
    '2026-08-22.mcp-consent-catalog.v1',
    '2026-08-22.mcp-exposure.v1'
  );

do $setup$
declare
  v_window timestamptz := current_setting(
    'ops_test.rate_limit_race_window'
  )::timestamptz;
  v_expiry timestamptz;
  v_policy constant text := 'mcp-evidence-search:2026-08-23.v1';
  v_capability constant text := 'task7_shared_company_race';
  v_company constant uuid := '86000000-0000-4000-8000-000000000001';
  v_actor_one constant uuid := '84000000-0000-4000-8000-000000000001';
  v_actor_two constant uuid := '85000000-0000-4000-8000-000000000002';
  v_grant_one constant uuid := '82000000-0000-4000-8000-000000000001';
  v_grant_two constant uuid := '83000000-0000-4000-8000-000000000002';
  v_company_units constant integer := 119;
begin
  if v_window is distinct from date_trunc('minute', v_window) then
    raise exception 'task7_concurrency_window_not_minute_aligned';
  end if;
  v_expiry := v_window + interval '6 minutes';

  insert into private.agent_mcp_rate_limit_buckets (
    bucket_digest,
    bucket_kind,
    policy_id,
    window_start,
    units_used,
    expires_at
  ) values
    (
      private.agent_mcp_rate_limit_bucket_digest(
        'actor', v_company, v_actor_one, null,
        v_capability, v_policy, v_window
      ),
      'actor', v_policy, v_window, 0, v_expiry
    ),
    (
      private.agent_mcp_rate_limit_bucket_digest(
        'grant', v_company, v_actor_one, v_grant_one,
        v_capability, v_policy, v_window
      ),
      'grant', v_policy, v_window, 0, v_expiry
    ),
    (
      private.agent_mcp_rate_limit_bucket_digest(
        'actor', v_company, v_actor_two, null,
        v_capability, v_policy, v_window
      ),
      'actor', v_policy, v_window, 0, v_expiry
    ),
    (
      private.agent_mcp_rate_limit_bucket_digest(
        'grant', v_company, v_actor_two, v_grant_two,
        v_capability, v_policy, v_window
      ),
      'grant', v_policy, v_window, 0, v_expiry
    ),
    (
      private.agent_mcp_rate_limit_bucket_digest(
        'company', v_company, null, null,
        v_capability, v_policy, v_window
      ),
      'company', v_policy, v_window, v_company_units, v_expiry
    );
end;
$setup$;

commit;
