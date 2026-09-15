\set ON_ERROR_STOP on
-- Disposable synthetic fixture only. Run with -v expense_sequence_repaired=false
-- against the original P5 migration, then true after the release repair. The
-- expense-accounting-fixture must run BEFORE P5 to reproduce live defaults.
select set_config('test.expense_sequence_repaired', :'expense_sequence_repaired', false);
do $test$
declare
  v_sequence regclass:=pg_get_serial_sequence('public.expense_accounting_events','sequence')::regclass;
  v_role text;
  v_repaired boolean:=current_setting('test.expense_sequence_repaired')::boolean;
  v_denied boolean;
  v_before bigint;
  v_after bigint;
  v_tests integer:=0;
begin
  if v_sequence is null then raise exception 'Missing expense event identity sequence'; end if;
  -- Establish a known positive sequence state as its owner. No event is added.
  v_before:=nextval(v_sequence);
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_sequence_privilege(v_role,v_sequence,'USAGE,SELECT,UPDATE') is distinct from (not v_repaired) then
      raise exception 'Unexpected effective sequence ACL for %',v_role;
    end if;
    execute format('set local role %I',v_role);
    v_denied:=false;
    begin
      perform nextval(v_sequence);
    exception when insufficient_privilege then v_denied:=true;
    end;
    execute 'reset role';
    if v_denied is distinct from v_repaired then
      raise exception 'Unexpected nextval result for %: denied=%',v_role,v_denied;
    end if;
    v_tests:=v_tests+1;
    execute format('set local role %I',v_role);
    v_denied:=false;
    begin
      perform setval(v_sequence,v_before,true);
    exception when insufficient_privilege then v_denied:=true;
    end;
    execute 'reset role';
    if v_denied is distinct from v_repaired then
      raise exception 'Unexpected setval result for %: denied=%',v_role,v_denied;
    end if;
    v_tests:=v_tests+1;
    if pg_sequence_last_value(v_sequence) is distinct from v_before then
      raise exception 'Sequence state changed after role checks';
    end if;
  end loop;
  v_after:=nextval(v_sequence);
  if v_after<>v_before+1 then raise exception 'Owner sequence allocation failed'; end if;
  raise notice '% actual role sequence calls checked; owner allocation preserved; repaired=%',v_tests,v_repaired;
end;
$test$;
