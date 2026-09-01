-- Expected-failure replay fixture. The outer harness invokes this once per
-- private table and requires SQLSTATE 55000 plus the corresponding catalog
-- marker. ON_ERROR_STOP disconnects with the transaction aborted, so neither
-- the adversarial trigger nor helper function can survive in the scratch DB.

\set ON_ERROR_STOP on

begin;

create function private.task7_unexpected_rate_limit_trigger()
returns trigger
language plpgsql
as $function$
begin
  return null;
end;
$function$;

\if :trigger_key
  create trigger task7_unexpected_rate_limit_trigger
  before insert on private.agent_mcp_rate_limit_keys
  for each statement execute function
    private.task7_unexpected_rate_limit_trigger();
\else
  create trigger task7_unexpected_rate_limit_trigger
  before insert on private.agent_mcp_rate_limit_buckets
  for each statement execute function
    private.task7_unexpected_rate_limit_trigger();
\endif

\ir ../../supabase/migrations/20260823072843_agent_mcp_durable_rate_limit.sql

do $unexpected_success$
begin
  raise exception 'trigger_collision_replay_was_accepted';
end;
$unexpected_success$;

rollback;
