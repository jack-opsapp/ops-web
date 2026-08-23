set statement_timeout = '10 seconds';
select set_config('request.jwt.claim.role', 'service_role', false);
select pg_advisory_lock_shared(:barrier_key);
\sleep 100 ms
select pg_advisory_unlock_shared(:barrier_key);

select *
from public.consume_agent_mcp_rate_limit_as_system(
  'task7-concurrency-company-' || lpad(:client_id::text, 2, '0'),
  case when :client_id = 0
    then '82000000-0000-4000-8000-000000000001'::uuid
    else '83000000-0000-4000-8000-000000000002'::uuid
  end,
  case when :client_id = 0
    then '84000000-0000-4000-8000-000000000001'::uuid
    else '85000000-0000-4000-8000-000000000002'::uuid
  end,
  '86000000-0000-4000-8000-000000000001',
  'task7_shared_company_race',
  'mcp-evidence-search:2026-08-23.v1',
  1,
  'modern'
);
