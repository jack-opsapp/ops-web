-- W3 security posture sweep — revoke the erroneous anon/authenticated TABLE grants
-- on the eight App Store Connect analytics tables (asc_*).
--
-- These tables are flagged `rls_enabled_no_policy` (RLS on, no policy → anon is
-- already denied at the row layer). But unlike the other no-policy tables (which
-- are granted to service_role only, the correct "internal-only" shape), the asc_*
-- tables also carry FULL anon + authenticated table grants
-- (SELECT/INSERT/UPDATE/DELETE/...). That is a latent landmine: a single future
-- permissive policy — or an accidental `alter table ... disable row level security`
-- — would instantly expose operator analytics to any anon caller holding the public
-- key. The grants are unused: the only readers/writers are the operator sync/query
-- code in lib/admin/app-store-*.ts, which runs with service_role.
--
-- Revoke the anon/authenticated grants (defense in depth alongside RLS).
-- service_role keeps full access and bypasses RLS.

begin;

do $do$
declare
  t text;
  asc_tables constant text[] := array[
    'asc_discovery_engagement', 'asc_downloads', 'asc_raw_rows', 'asc_report_instances',
    'asc_report_requests', 'asc_report_segments', 'asc_reports', 'asc_sync_status'
  ];
begin
  foreach t in array asc_tables loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end
$do$;

-- Sentinel: none of the eight tables may retain any anon/authenticated privilege,
-- and service_role must keep access.
do $do$
declare
  v_leak int;
  v_svc int;
  asc_tables constant text[] := array[
    'asc_discovery_engagement', 'asc_downloads', 'asc_raw_rows', 'asc_report_instances',
    'asc_report_requests', 'asc_report_segments', 'asc_reports', 'asc_sync_status'
  ];
begin
  select count(*) into v_leak
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any (asc_tables)
    and grantee in ('anon', 'authenticated');
  if v_leak <> 0 then
    raise exception 'sec_w3_asc_grants_sentinel: % residual anon/authenticated grant(s)', v_leak;
  end if;

  select count(distinct table_name) into v_svc
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = any (asc_tables)
    and grantee = 'service_role'
    and privilege_type = 'SELECT';
  if v_svc <> 8 then
    raise exception 'sec_w3_asc_grants_sentinel: service_role lost access (expected 8 tables, found %)', v_svc;
  end if;
end
$do$;

commit;
