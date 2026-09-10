-- Read-only verification after supabase/migrations/20260910170000_create_journal_editorial.sql
-- is applied to production. Safe to run with default_transaction_read_only=on.

-- 1. Three tables exist with row level security on.
select relname, relrowsecurity
from pg_class
where relname in ('journal_editorial_settings', 'journal_editorial_assignments', 'journal_editorial_sources')
order by relname;

-- 2. Browser roles hold no table privilege.
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_name like 'journal_editorial_%' and grantee in ('anon', 'authenticated', 'public')
group by 1, 2;
-- expected: zero rows

-- 3. Seventeen functions, all security invoker, executable by service_role only.
select p.proname,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%journal_editorial%'
order by p.proname;
-- expected: 17 rows, security_definer false, anon/authenticated false, service true

-- 4. Settings singleton starts switched off.
select mode, publish_weekday, publish_hour, draft_open_hours, min_veto_minutes, byline
from public.journal_editorial_settings;
-- expected: off | 1 | 6 | 72 | 360 | OPS Team

-- 5. Nothing queued yet; no journal notifications.
select count(*) as assignments from public.journal_editorial_assignments;
select count(*) as journal_notifications from public.notifications where type = 'journal_editorial';
