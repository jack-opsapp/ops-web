\echo '--- ledger row + a recent MCP-applied row for field parity'
select version, name, created_by, idempotency_key, array_length(statements,1) as n from supabase_migrations.schema_migrations where version in ('20260902010242','20260901233021','20260901201256') order by version;
\echo '--- objects'
select 'private tables' k, count(*) from pg_tables where schemaname='private' and (tablename like 'customer_%' or tablename='company_client_memberships')
union all select 'rls enabled on them', count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and (c.relname like 'customer_%' or c.relname='company_client_memberships') and c.relkind='r' and c.relrowsecurity
union all select 'public *customer*_as_system fns', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%customer%_as_system' and p.proname not like 'read_customer_profile%' and p.proname not like 'agent_%'
union all select 'merge trigger', count(*) from pg_trigger where tgname='clients_customer_memberships_follow_merge'
union all select 'handle trigger', count(*) from pg_trigger where tgname='companies_assign_public_handle'
union all select 'clients_id_company_id_key', count(*) from pg_constraint where conname='clients_id_company_id_key'
union all select 'companies with handle', count(public_handle) from public.companies
union all select 'hosted integrations', count(*) from private.customer_integrations where kind='hosted_pages'
union all select 'cron job', count(*) from cron.job where jobname='customer_identity_dormancy_daily' and active;
\echo '--- zero table grants (non-owner) on new private tables'
select coalesce(string_agg(distinct grantee, ','), '<none>') as grantees, count(*) as grants
from information_schema.role_table_grants
where table_schema='private' and (table_name like 'customer_%' or table_name='company_client_memberships') and grantee <> 'postgres';
\echo '--- function grants on the new public RPCs (expect service_role only)'
select p.proname, coalesce((select string_agg(a.grantee::regrole::text, ',') from aclexplode(p.proacl) a where a.privilege_type='EXECUTE'), '<none>') as execute_grantees
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('begin_customer_otp_challenge_as_system','record_customer_otp_attempt_as_system','upsert_customer_identity_as_system','mint_customer_session_as_system','resolve_customer_session_as_system','revoke_customer_session_as_system','revoke_all_customer_sessions_as_system','resolve_customer_membership_as_system','confirm_customer_membership_as_system','revoke_customer_membership_as_system','list_customer_memberships_for_client_as_system','ensure_customer_hosted_integration_as_system','ensure_customer_pairwise_ref_as_system','append_customer_identity_event_as_system')
order by 1;
\echo '--- live gate: real anon role, no service claim'
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
\set ON_ERROR_STOP off
select public.resolve_customer_session_as_system('x');
reset role;
\echo '--- live gate: postgres session with anon claim (definer path reached, gate fires)'
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.resolve_customer_session_as_system('x');
\echo '--- live gate: service_role claim resolves unknown hash (no rows touched)'
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select * from public.resolve_customer_session_as_system(repeat('0',64));
\echo '--- handles sample'
select name, public_handle from public.companies where deleted_at is null order by created_at limit 6;
\echo '--- new private tables row counts (expect all 0 except integrations)'
select 'customer_identities' t, count(*) from private.customer_identities union all select 'customer_sessions', count(*) from private.customer_sessions union all select 'company_client_memberships', count(*) from private.company_client_memberships union all select 'customer_identity_events', count(*) from private.customer_identity_events union all select 'customer_integrations', count(*) from private.customer_integrations;
