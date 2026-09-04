\set ON_ERROR_STOP on
begin;
\i customer_identity_profile_read.sql
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $t$
declare
  v_company uuid := 'ddee107c-33cd-483e-8278-0f8d8a180181';
  v_staff uuid := '8e811f98-9f2b-4f64-b409-ed56074b7dc8';
  v_tag text := left(replace(gen_random_uuid()::text,'-',''),8);
  v_id uuid; v_id_sub uuid; v_id_named uuid; v_client uuid; v_org uuid; v_sub uuid; r record; m record; v_state text;
begin
  -- no membership yet
  select identity_id into v_id from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'Prof-'||v_tag||'@example.invalid');
  select * into r from public.read_customer_profile_as_system(v_id, v_company);
  raise notice 'P1 none: name=% masked=% state=%', r.display_name, r.contact_email_masked, r.membership_state;
  if r.display_name is not null or r.membership_state <> 'none' or r.contact_email_masked !~ '^p\*\*\*@example\.invalid$' then raise exception 'none wrong'; end if;
  -- created-by-identity client: name is the address -> display null, state active_full
  perform public.resolve_customer_membership_as_system(v_id, v_company);
  select * into r from public.read_customer_profile_as_system(v_id, v_company);
  raise notice 'P1 self-created: name=% state=%', r.display_name, r.membership_state;
  if r.display_name is not null or r.membership_state <> 'active_full' then raise exception 'self-created wrong'; end if;
  -- named client match -> client name
  insert into public.clients (company_id, name, email) values (v_company, 'Pat Named '||v_tag, 'named-'||v_tag||'@example.invalid') returning id into v_client;
  select identity_id into v_id_named from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'named-'||v_tag||'@example.invalid');
  select * into m from public.resolve_customer_membership_as_system(v_id_named, v_company);
  select * into r from public.read_customer_profile_as_system(v_id_named, v_company);
  raise notice 'P1 named client: name=% state=%', r.display_name, r.membership_state;
  if r.display_name <> 'Pat Named '||v_tag or r.membership_state <> 'active_forward_only' then raise exception 'named wrong'; end if;
  -- revoked -> state revoked, no name
  perform public.revoke_customer_membership_as_system(m.membership_id, v_staff, 'test');
  select * into r from public.read_customer_profile_as_system(v_id_named, v_company);
  raise notice 'P1 revoked: name=% state=%', r.display_name, r.membership_state;
  if r.display_name is not null or r.membership_state <> 'revoked' then raise exception 'revoked wrong'; end if;
  -- sub-client match -> contact name
  insert into public.clients (company_id, name) values (v_company, 'Org '||v_tag) returning id into v_org;
  insert into public.sub_clients (company_id, client_id, name, email) values (v_company, v_org, 'Sam Contact', 'sub-'||v_tag||'@example.invalid') returning id into v_sub;
  select identity_id into v_id_sub from public.upsert_customer_identity_as_system(gen_random_uuid()::text, 'sub-'||v_tag||'@example.invalid');
  perform public.resolve_customer_membership_as_system(v_id_sub, v_company);
  select * into r from public.read_customer_profile_as_system(v_id_sub, v_company);
  raise notice 'P1 sub-client: name=% state=%', r.display_name, r.membership_state;
  if r.display_name <> 'Sam Contact' then raise exception 'sub wrong'; end if;
  -- other company -> none
  select * into r from public.read_customer_profile_as_system(v_id_sub, (select id from public.companies where id <> v_company and deleted_at is null order by created_at limit 1));
  raise notice 'P1 other company: state=%', r.membership_state; if r.membership_state <> 'none' then raise exception 'isolation wrong'; end if;
  -- unknown identity -> one row, *** mask, none
  select * into r from public.read_customer_profile_as_system(gen_random_uuid(), v_company);
  raise notice 'P1 unknown identity: name=% masked=% state=%', r.display_name, r.contact_email_masked, r.membership_state;
  if r.contact_email_masked <> '***' or r.membership_state <> 'none' then raise exception 'unknown wrong'; end if;
  -- gate
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.read_customer_profile_as_system(v_id, v_company);
    raise exception 'gate did not fire';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
    raise notice 'P1 gate: % %', v_state, sqlerrm; if v_state <> '42501' then raise exception 'wrong'; end if;
  end;
end $t$;
select indexname from pg_indexes where schemaname='private' and indexname in ('company_client_memberships_by_client','company_client_memberships_by_sub_client','company_client_memberships_by_merged_into','customer_pairwise_refs_by_integration') order by 1;
\echo '=== PROFILE TESTS PASSED (rolling back) ==='
rollback;
