-- PUBLIC API P2-1 — live verification against production after apply.
\echo '=== 1. ledger row is byte-exact against the repo file ==='
select version, name, array_length(statements,1) as statement_count, md5(statements[1]) as ledger_md5
from supabase_migrations.schema_migrations where version = '20260902190000';

\echo '=== 2. zero non-owner grants on the new private tables ==='
select coalesce(grantee,'(none)') as grantee, coalesce(string_agg(privilege_type,','),'-') as privs
from information_schema.role_table_grants
where table_schema='private' and table_name in ('guest_booking_intents','customer_booking_claims')
  and grantee <> 'postgres'
group by 1;
select count(*) as non_owner_grants_expect_zero
from information_schema.role_table_grants
where table_schema='private' and table_name in ('guest_booking_intents','customer_booking_claims')
  and grantee <> 'postgres';

\echo '=== 3. RLS on, no policies, on the two private tables ==='
select c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname='private' and p.tablename=c.relname) as policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='private' and c.relname in ('guest_booking_intents','customer_booking_claims')
order by 1;

\echo '=== 4. policy table grants + RLS ==='
select grantee, string_agg(privilege_type,',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema='public' and table_name='site_visit_booking_policies' group by 1 order by 1;
select policyname, permissive, roles::text, cmd from pg_policies
where schemaname='public' and tablename='site_visit_booking_policies' order by permissive desc, policyname;

\echo '=== 5. non-service gate live-fired as the real anon role ==='
do $gate$
declare
  v_state text; v_call text; v_n integer := 0;
  v_calls text[] := array[
    $$select * from public.read_public_booking_policy_as_system(gen_random_uuid())$$,
    $$select * from public.read_public_availability_as_system(gen_random_uuid(), current_date, current_date)$$,
    $$select * from public.hold_booking_slot_as_system(gen_random_uuid(), gen_random_uuid(), now(), repeat('a',64))$$,
    $$select * from public.record_guest_booking_contact_as_system(gen_random_uuid(),'n','1:'||repeat('a',64),null,null,'[]'::jsonb)$$,
    $$select public.book_site_visit_as_system(gen_random_uuid(), now() + interval '1 day')$$,
    $$select * from public.confirm_guest_booking_as_system(gen_random_uuid(),'1:'||repeat('a',64),'x@example.invalid','email')$$,
    $$select * from public.confirm_booking_request_as_system(gen_random_uuid(), gen_random_uuid(), null)$$,
    $$select * from public.decline_booking_request_as_system(gen_random_uuid(), gen_random_uuid(), null)$$,
    $$select * from public.reschedule_guest_booking_as_system(gen_random_uuid(), now() + interval '1 day')$$,
    $$select * from public.cancel_guest_booking_as_system(gen_random_uuid(), null)$$,
    $$select * from public.claim_guest_booking_as_system(gen_random_uuid(), gen_random_uuid(), '1:'||repeat('a',64))$$
  ];
begin
  set local role anon;
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  foreach v_call in array v_calls loop
    begin
      execute v_call;
      raise exception 'GATE DID NOT FIRE: %', v_call;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      if v_state <> '42501' then raise exception 'wrong sqlstate % for %', v_state, v_call; end if;
      v_n := v_n + 1;
    end;
  end loop;
  raise notice 'LIVE GATE OK: % of % RPCs refused anon with 42501', v_n, cardinality(v_calls);
  reset role;
end $gate$;
reset role;

\echo '=== 6. anon cannot read or write the policy table ==='
do $rls$
declare v_rows integer; v_state text;
begin
  set local role anon;
  perform set_config('request.jwt.claims','{"role":"anon","sub":"no-such-subject"}',true);
  select count(*) into v_rows from public.site_visit_booking_policies;
  if v_rows <> 0 then raise exception 'anon read % policy rows', v_rows; end if;
  begin
    insert into public.site_visit_booking_policies (company_id, timezone)
    values ('ddee107c-33cd-483e-8278-0f8d8a180181','America/Vancouver');
    raise exception 'anon wrote a policy row';
  exception when insufficient_privilege then
    get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'LIVE RLS OK: anon reads 0 rows, write refused (%)', v_state;
  end;
  reset role;
end $rls$;
reset role;

\echo '=== 7. object inventory ==='
select 'private tables' as kind, count(*)::text as value from pg_tables
 where schemaname='private' and tablename in ('guest_booking_intents','customer_booking_claims')
union all select 'public policy table', count(*)::text from pg_tables
 where schemaname='public' and tablename='site_visit_booking_policies'
union all select 'booking *_as_system rpcs', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
   'read_public_booking_policy_as_system','read_public_availability_as_system',
   'hold_booking_slot_as_system','record_guest_booking_contact_as_system',
   'book_site_visit_as_system','confirm_guest_booking_as_system',
   'confirm_booking_request_as_system','decline_booking_request_as_system',
   'reschedule_guest_booking_as_system','cancel_guest_booking_as_system',
   'claim_guest_booking_as_system')
union all select 'private helpers', count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in (
   'booking_windows_valid','booking_answers_valid','booking_policy_validate',
   'booking_policy_slot_starts','booking_slot_is_open','booking_expire_stale_holds',
   'booking_resolve_guest_client','booking_notify_staff','guest_booking_hold_sweep',
   'run_guest_booking_hold_sweep_controlled')
union all select 'policy rows (expect 0)', count(*)::text from public.site_visit_booking_policies
union all select 'guest intents (expect 0)', count(*)::text from private.guest_booking_intents
union all select 'booking claims (expect 0)', count(*)::text from private.customer_booking_claims;

\echo '=== 8. the staff-actor book_site_visit is untouched ==='
select p.oid::regprocedure::text as sig,
       pg_get_functiondef(p.oid) like '%current_user_can_edit_site_visit%' as still_gated,
       pg_get_functiondef(p.oid) like '%private.get_current_user_id()%' as still_actor_bound
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('book_site_visit','reschedule_site_visit','cancel_site_visit_booking')
order by 1;

\echo '=== 9. cron + assignment allowlist ==='
select jobname, schedule, command, active from cron.job where jobname='guest_booking_hold_sweep_5min';
select conname, pg_get_constraintdef(oid) like '%public_booking_default%' as has_new_source
from pg_constraint where conrelid='public.opportunity_assignment_events'::regclass
  and conname in ('opportunity_assignment_events_source_check','opportunity_assignment_events_actor_required')
order by conname;
select p.proname, pg_get_functiondef(p.oid) like '%public_booking_default%' as has_new_source
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname in
  ('change_assignment_system_company_serialized_internal','change_opportunity_assignment_core')
order by 1;
select p.proname, pg_get_functiondef(p.oid) like '%guest_booking_hold_sweep%' as sweep_allowlisted
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='private' and p.proname='run_scheduled_cron_workload_controlled';

\echo '=== 10. every new function has a pinned search_path ==='
select p.proname, p.proconfig::text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname like '%booking%as_system')
   or (n.nspname='private' and p.proname like 'booking_%')
   or (n.nspname='private' and p.proname like 'guest_booking%')
   or (n.nspname='public' and p.proname='book_site_visit_as_system')
order by 1;
