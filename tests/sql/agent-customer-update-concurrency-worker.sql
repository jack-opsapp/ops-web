\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
set lock_timeout='15s';
set statement_timeout='30s';
begin;
select private.lock_lead_assignment_company(company) from runtime.concurrent_previews where name=:'worker';
-- Reproduce the prepare/commit lock hierarchy and hold the source lock long
-- enough that the other company overlaps. SHARE would deadlock on upgrade.
select private.agent_customer_update_source(actor,company,request) is not null from runtime.concurrent_previews where name=:'worker';
select pg_sleep(1);
select public.commit_agent_customer_update_as_actor(actor,company,(preview->>'action_id')::uuid,(preview->>'change_set_id')::uuid,preview->>'preview_sha256','runtime-concurrent-commit') ->> 'ok' from runtime.concurrent_previews where name=:'worker';
commit;
