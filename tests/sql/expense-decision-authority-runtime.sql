\set ON_ERROR_STOP on
begin;
select set_config('test.expense_repaired', :'expense_repaired', false);
select set_config('test.expense_cases', '0', false);
create function pg_temp.fixture_id(p_id integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p_id::text, 12, '0'))::uuid;
$$;
create function pg_temp.assert_true(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'Assertion failed: %', p_label; end if;
end;
$$;
-- Each call has its own rollback boundary so later cases see the same fixtures.
create function pg_temp.check_decision(p_label text, p_call text, p_allowed boolean, p_check text default null)
returns void language plpgsql as $$
declare v_error text; v_before jsonb; v_after jsonb; v_ok boolean;
begin
  select jsonb_build_array(
    (select jsonb_agg(to_jsonb(e) order by id) from public.expenses e),
    (select jsonb_agg(to_jsonb(b) order by id) from public.expense_batches b),
    (select jsonb_agg(to_jsonb(n) order by id) from public.notifications n)
  ) into v_before;
  begin
    begin execute p_call; exception when others then v_error := sqlstate; end;
    perform pg_temp.assert_true((v_error is null) = p_allowed, p_label || ' result: ' || coalesce(v_error, 'allowed'));
    if not p_allowed then
      perform pg_temp.assert_true(v_error in ('42501', 'P0001'), p_label || ' authorization/state error');
      select jsonb_build_array(
        (select jsonb_agg(to_jsonb(e) order by id) from public.expenses e),
        (select jsonb_agg(to_jsonb(b) order by id) from public.expense_batches b),
        (select jsonb_agg(to_jsonb(n) order by id) from public.notifications n)
      ) into v_after;
      perform pg_temp.assert_true(v_before = v_after, p_label || ' no mutation');
    elsif p_check is not null then
      execute p_check into v_ok;
      perform pg_temp.assert_true(v_ok, p_label || ' expected effects');
    end if;
    raise exception using errcode = 'ZX001', message = 'rollback synthetic case';
  exception when sqlstate 'ZX001' then null;
  end;
  perform set_config('test.expense_cases', (current_setting('test.expense_cases')::integer + 1)::text, false);
  raise notice 'PASS: %', p_label;
end;
$$;
insert into public.companies(id, deleted_at)
select pg_temp.fixture_id(n), case when n=3 then now() end from generate_series(1,3) n;
insert into public.users(id, company_id, firebase_uid, auth_id, is_active, is_company_admin, deleted_at)
select pg_temp.fixture_id(n), pg_temp.fixture_id(case n when 12 then 2 when 15 then 3 else 1 end),
  'expense-fixture-' || n, 'expense-auth-' || n,
  case when n=13 then false when n=19 then null else true end, n between 11 and 15,
  case when n=14 then now() end
from generate_series(11,19) n;
insert into public.roles(id, company_id, is_preset) values (pg_temp.fixture_id(20), pg_temp.fixture_id(1), false);
insert into public.user_roles(user_id, role_id) values (pg_temp.fixture_id(16)::text, pg_temp.fixture_id(20));
insert into public.role_permissions(role_id, permission, scope) values (pg_temp.fixture_id(20), 'expenses.approve', 'all');
insert into public.user_permission_overrides(user_id,company_id,permission,scope,granted)
values (pg_temp.fixture_id(18),pg_temp.fixture_id(1),'expenses.approve','own',true);
insert into public.expense_batches(id,company_id,status,submitted_by,paid_at,paid_by,total_amount,amendment_number)
select pg_temp.fixture_id(n),pg_temp.fixture_id(case when n in (102,103,108) then 2 else 1 end),
 case when n in (102,103,105,106,110,111) then 'approved' else 'open' end,
 pg_temp.fixture_id(11),case when n in (103,106,111) then now() end,
 case when n in (103,106,111) then pg_temp.fixture_id(11) end,0,0
from generate_series(101,111) n;
insert into public.expenses(id,company_id,submitted_by,batch_id,status,amount,expense_date,deleted_at)
select pg_temp.fixture_id(id),pg_temp.fixture_id(company_id),pg_temp.fixture_id(case company_id when 2 then 12 else 11 end),
 pg_temp.fixture_id(batch_id),status,10,'2026-09-11',case when deleted then now() end
from (values
 (201,1,101,'submitted',false),(202,1,101,'rejected',false),(203,1,101,'approved',false),
 (204,1,101,'reimbursed',false),(205,1,101,'submitted',true),
 (211,2,102,'approved',false),(221,2,103,'reimbursed',false),
 (231,2,104,'submitted',false),(232,1,104,'submitted',false),
 (241,2,105,'approved',false),(251,2,106,'reimbursed',false),
 (261,1,107,'submitted',false),(271,1,108,'submitted',false),
 (281,2,109,'submitted',false),(291,1,110,'approved',false),(301,1,111,'reimbursed',false),
 (311,1,null,'draft',false),(312,2,null,'draft',false),(313,2,null,'draft',true)
) s(id,company_id,batch_id,status,deleted);
select set_config('request.jwt.claims','{"sub":"expense-fixture-11","role":"authenticated"}',false);

do $$
declare v_repaired boolean := current_setting('test.expense_repaired')::boolean; v_actor integer; v_rpc text; v_target integer;
begin
  perform pg_temp.assert_true(public.has_permission(pg_temp.fixture_id(11),'expenses.approve','all'), 'real helper admits admin in own company');
  perform pg_temp.assert_true(public.has_permission(pg_temp.fixture_id(16),'expenses.approve','all'), 'real helper admits role approver');
  -- Ordinary foreign-company approval already fails in the live recalculation guard.
  perform pg_temp.check_decision('existing foreign approve denial','select public.approve_expense_batch(pg_temp.fixture_id(102))',false);
  perform pg_temp.check_decision('existing foreign early clear denial','select public.early_clear_expense_line(pg_temp.fixture_id(211))',false);
  perform pg_temp.check_decision('existing foreign unbatched early clear denial','select public.early_clear_expense_line(pg_temp.fixture_id(312))',false);
  perform pg_temp.check_decision('foreign payout','select public.mark_expense_batch_paid(pg_temp.fixture_id(102))',not v_repaired,
    'select status=''reimbursed'' from public.expenses where id=pg_temp.fixture_id(211)');
  perform pg_temp.check_decision('foreign undo payout','select public.unmark_expense_batch_paid(pg_temp.fixture_id(103))',not v_repaired,
    'select status=''approved'' from public.expenses where id=pg_temp.fixture_id(221)');
  perform pg_temp.check_decision('mixed-company batch approval','select public.approve_expense_batch(pg_temp.fixture_id(104))',not v_repaired,
    'select bool_and(status=''approved'') from public.expenses where batch_id=pg_temp.fixture_id(104)');
  perform pg_temp.check_decision('mixed-company payout','select public.mark_expense_batch_paid(pg_temp.fixture_id(105))',not v_repaired,
    'select status=''reimbursed'' from public.expenses where id=pg_temp.fixture_id(241)');
  perform pg_temp.check_decision('mixed-company undo payout','select public.unmark_expense_batch_paid(pg_temp.fixture_id(106))',not v_repaired,
    'select status=''approved'' from public.expenses where id=pg_temp.fixture_id(251)');
  perform pg_temp.check_decision('foreign line in own-company parent','select public.early_clear_expense_line(pg_temp.fixture_id(281))',not v_repaired,
    'select status=''approved'' from public.expenses where id=pg_temp.fixture_id(281)');
  perform pg_temp.check_decision('own line in foreign parent','select public.early_clear_expense_line(pg_temp.fixture_id(271))',false);
  perform pg_temp.check_decision('own line in mixed parent','select public.early_clear_expense_line(pg_temp.fixture_id(232))',not v_repaired);
  perform pg_temp.check_decision('foreign deleted unbatched line','select public.early_clear_expense_line(pg_temp.fixture_id(313))',not v_repaired);
  foreach v_actor in array array[13,14,15,17,18,19,999] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub','expense-fixture-'||v_actor,'role','authenticated')::text,false);
    foreach v_rpc in array array['approve_expense_batch','early_clear_expense_line','mark_expense_batch_paid','unmark_expense_batch_paid'] loop
      v_target := case v_rpc when 'approve_expense_batch' then 101 when 'early_clear_expense_line' then 261 when 'mark_expense_batch_paid' then 110 else 111 end;
      perform pg_temp.check_decision('invalid actor '||v_actor||' '||v_rpc,format('select public.%I(pg_temp.fixture_id(%s))',v_rpc,v_target),false);
    end loop;
  end loop;
  foreach v_actor in array array[11,16] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub','expense-fixture-'||v_actor,'role','authenticated')::text,false);
    perform pg_temp.check_decision('valid batch approval','select public.approve_expense_batch(pg_temp.fixture_id(101))',true,
      'select b.status=''approved'' and b.reviewed_by=private.get_current_user_id() and b.reviewed_at is not null and b.total_amount=40 and (select array_agg(status order by id) from public.expenses where batch_id=b.id)=array[''approved'',''rejected'',''approved'',''reimbursed'',''submitted''] from public.expense_batches b where b.id=pg_temp.fixture_id(101)');
    perform pg_temp.check_decision('valid early clear and notification','select public.early_clear_expense_line(pg_temp.fixture_id(261))',true,
      'select e.status=''approved'' and b.status=''open'' and b.total_amount=10 and (select count(*)=1 from public.notifications where expense_id=e.id::text and company_id=e.company_id::text and user_id=e.submitted_by::text and type=''expense_approved'') from public.expenses e join public.expense_batches b on b.id=e.batch_id where e.id=pg_temp.fixture_id(261)');
    perform pg_temp.check_decision('valid unbatched early clear uses real placement trigger','select public.early_clear_expense_line(pg_temp.fixture_id(311))',true,
      'select e.status=''approved'' and b.company_id=e.company_id and b.total_amount=10 from public.expenses e join public.expense_batches b on b.id=e.batch_id where e.id=pg_temp.fixture_id(311)');
    perform pg_temp.check_decision('valid payout','select public.mark_expense_batch_paid(pg_temp.fixture_id(110))',true,
      'select b.status=''approved'' and b.paid_at is not null and b.paid_by=private.get_current_user_id() and e.status=''reimbursed'' from public.expense_batches b join public.expenses e on e.batch_id=b.id where b.id=pg_temp.fixture_id(110)');
    perform pg_temp.check_decision('valid undo payout','select public.unmark_expense_batch_paid(pg_temp.fixture_id(111))',true,
      'select b.status=''approved'' and b.paid_at is null and b.paid_by is null and e.status=''approved'' from public.expense_batches b join public.expenses e on e.batch_id=b.id where b.id=pg_temp.fixture_id(111)');
  end loop;
  perform pg_temp.check_decision('unapproved payout rejected','select public.mark_expense_batch_paid(pg_temp.fixture_id(101))',false);
  perform pg_temp.check_decision('double payout rejected','select public.mark_expense_batch_paid(pg_temp.fixture_id(111))',false);
  perform pg_temp.check_decision('undo unpaid rejected','select public.unmark_expense_batch_paid(pg_temp.fixture_id(110))',false);
  foreach v_rpc in array array['approve_expense_batch','early_clear_expense_line','mark_expense_batch_paid','unmark_expense_batch_paid'] loop
    perform pg_temp.check_decision('missing target '||v_rpc,format('select public.%I(pg_temp.fixture_id(999))',v_rpc),false);
  end loop;
  -- Exercise the existing auth_id bridge as well as Firebase subjects.
  perform set_config('request.jwt.claims','{"sub":"expense-auth-11","role":"authenticated"}',false);
  perform pg_temp.check_decision('auth-id bridge','select public.mark_expense_batch_paid(pg_temp.fixture_id(110))',true);
  if v_repaired then
    perform pg_temp.assert_true(not has_function_privilege('authenticated','private.lock_expense_approver_context()','EXECUTE'),'private actor helper not callable by app');
      perform pg_temp.assert_true(not has_function_privilege('authenticated','private.lock_expense_batch_for_approval(uuid,uuid)','EXECUTE'),'private target helper not callable by app');
      perform pg_temp.assert_true(not has_function_privilege('authenticated','private.execute_expense_decision(text,uuid)','EXECUTE'),'private decision dispatcher not callable by app');
    foreach v_rpc in array array['approve_expense_batch','early_clear_expense_line','mark_expense_batch_paid','unmark_expense_batch_paid'] loop
      perform pg_temp.assert_true(has_function_privilege('authenticated','public.'||v_rpc||'(uuid)','EXECUTE'),'existing app RPC allowed');
      perform pg_temp.assert_true(has_function_privilege('anon','public.'||v_rpc||'(uuid)','EXECUTE'),'released anon RPC lane preserved');
      perform pg_temp.assert_true(has_function_privilege('service_role','public.'||v_rpc||'(uuid)','EXECUTE'),'service RPC lane preserved');
    end loop;
  end if;
end;
$$;
-- These are real application-role calls, not merely JWT claims in a postgres
-- session. Owner-only helpers must remain reachable through the definer APIs.
select set_config('request.jwt.claims','{"sub":"expense-fixture-11","role":"authenticated"}',false);
set local lock_timeout = '7s';
set local role authenticated;
select public.approve_expense_batch('00000000-0000-4000-8000-000000000101');
select public.mark_expense_batch_paid('00000000-0000-4000-8000-000000000101');
select public.unmark_expense_batch_paid('00000000-0000-4000-8000-000000000101');
select public.early_clear_expense_line('00000000-0000-4000-8000-000000000261');
reset role;
select pg_temp.assert_true(current_setting('lock_timeout')='7s','caller lock timeout restored after decision');
do $$ begin raise notice 'PASS: all four RPC wrappers under SET ROLE authenticated'; end $$;
select set_config('request.jwt.claims','{"sub":"expense-fixture-11","role":"anon"}',false);
set local role anon;
select public.approve_expense_batch('00000000-0000-4000-8000-000000000101');
select public.mark_expense_batch_paid('00000000-0000-4000-8000-000000000101');
select public.unmark_expense_batch_paid('00000000-0000-4000-8000-000000000101');
select public.early_clear_expense_line('00000000-0000-4000-8000-000000000261');
reset role;
do $$ begin raise notice 'PASS: all four RPC wrappers under SET ROLE anon'; end $$;
select (current_setting('test.expense_cases')::integer + 8)::text || ' expense decision authority cases passed' as result;
rollback;
