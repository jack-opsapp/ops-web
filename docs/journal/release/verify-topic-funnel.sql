-- Read-only verification after supabase/migrations/*_journal_topic_funnel.sql
-- is applied to production. Safe to run with default_transaction_read_only=on.

-- 1. The radar table exists with row level security on.
select relname, relrowsecurity
from pg_class
where relname = 'journal_trend_signals';
-- expected: journal_trend_signals | true

-- 2. Browser roles hold no privilege on it.
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_name = 'journal_trend_signals' and grantee in ('anon', 'authenticated', 'public')
group by 1;
-- expected: zero rows

-- 3. The four new columns on each table.
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'journal_editorial_settings' and column_name in ('radar_scan_started_at', 'radar_scanned_at', 'radar_sources'))
    or (table_name = 'journal_editorial_assignments' and column_name in ('pitch', 'pitch_claim_token', 'pitches', 'pitched_at')))
order by table_name, column_name;
-- expected: 7 rows; radar_sources not null default '[]'; pitches not null default 0

-- 4. Four new functions, security invoker, pinned search path, service_role only.
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('begin_journal_radar_scan', 'record_journal_radar_scan', 'notify_journal_radar', 'pitch_journal_editorial_assignment')
order by p.proname;
-- expected: 4 rows, security_definer false, config {search_path=""}, anon/authenticated false, service true

-- 5. Nothing scanned or pitched yet.
select radar_scanned_at, jsonb_array_length(radar_sources) as feeds from public.journal_editorial_settings;
select count(*) as signals from public.journal_trend_signals;
select count(*) as pitched from public.journal_editorial_assignments where pitch is not null;
-- expected: null | 0, then 0, then 0

-- 6. After the first deployed tick has scanned (within the hour after deploy):
select radar_scanned_at,
       jsonb_array_length(radar_sources) as feeds,
       (select count(*) from jsonb_array_elements(radar_sources) f where (f->>'ok')::boolean) as feeds_ok,
       (select jsonb_agg(f->>'key' || ':' || (f->>'code')) from jsonb_array_elements(radar_sources) f where not (f->>'ok')::boolean) as failed
from public.journal_editorial_settings;
select sphere, kind, count(*) as signals, max(momentum) as top_momentum, max(comments) as top_replies
from public.journal_trend_signals
group by 1, 2
order by 1, 2;
