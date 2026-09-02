\set ON_ERROR_STOP on

begin;

update public.expense_settings
set forecast_obligations_confirmed_through = '2026-09-30',
    forecast_obligations_confirmed_at = '2026-09-01 15:30:00+00'
where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

update public.recurring_expenses
set obligation_kind = case
      when id = '30000000-0000-4000-8000-000000000001' then 'payroll'
      else 'other'
    end,
    due_time_local = case
      when id = '30000000-0000-4000-8000-000000000001' then '09:00:00'::time
      else '17:00:00'::time
    end
where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

create function pg_temp.payroll_snapshot()
returns jsonb
language sql
volatile
as $function$
  select public.read_agent_payroll_readiness_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('b', 32),
    array[
      'ops.company.read',
      'ops.expenses.read',
      'ops.financial_documents.read',
      'ops.financials.read',
      'ops.payments.read'
    ],
    'sha256:' || repeat('a', 64),
    '2026-09-01.capability-manifest.v14',
    '2026-09-01.mcp-exposure.v8',
    'check_payroll_readiness',
    'check_payroll_readiness:2026-09-01.v1',
    '2026-09-01 16:00:00+00',
    '2026-09-15',
    40,
    50,
    100,
    500
  );
$function$;

do $assert_function_security$
declare
  v_function regprocedure :=
    'public.read_agent_payroll_readiness_as_system(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text,timestamp with time zone,date,integer,integer,integer,integer)'::regprocedure;
  v_private_function regprocedure :=
    'private.assert_agent_payroll_readiness_authority(uuid,uuid,uuid,uuid,text,text[],text,text,text,text,text)'::regprocedure;
  v_volatile "char";
  v_security_definer boolean;
  v_configuration text[];
begin
  select procedure.provolatile, procedure.prosecdef, procedure.proconfig
    into v_volatile, v_security_definer, v_configuration
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_function;
  if v_volatile <> 's'
     or not v_security_definer
     or v_configuration is distinct from array['search_path=""']::text[]
     or not pg_catalog.has_function_privilege(
       'service_role', v_function, 'execute'
     )
     or pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or pg_catalog.has_function_privilege(
       'authenticated', v_function, 'execute'
     ) then
    raise exception 'payroll readiness public function security drifted';
  end if;
  select procedure.provolatile, procedure.prosecdef, procedure.proconfig
    into v_volatile, v_security_definer, v_configuration
  from pg_catalog.pg_proc procedure
  where procedure.oid = v_private_function;
  if v_volatile <> 's'
     or not v_security_definer
     or v_configuration is distinct from array['search_path=""']::text[]
     or pg_catalog.has_function_privilege(
       'service_role', v_private_function, 'execute'
     ) then
    raise exception 'payroll readiness private function security drifted';
  end if;
end;
$assert_function_security$;

do $assert_golden_snapshot$
declare
  v_snapshot jsonb := pg_temp.payroll_snapshot();
begin
  if v_snapshot ->> 'observed_at' <> '2026-09-01T16:00:00.000000Z'
     or v_snapshot ->> 'business_date' <> '2026-09-01'
     or v_snapshot ->> 'target_date' <> '2026-09-15'
     or v_snapshot #>> '{context,timezone}' <> 'America/Vancouver'
     or v_snapshot #>> '{context,currency_code}' <> 'CAD'
     or (v_snapshot #>> '{source_revisions,company}')::bigint <> 7
     or (v_snapshot #>> '{source_counts,recurring_obligations}')::integer <> 2
     or (v_snapshot #>> '{source_counts,reimbursement_batches}')::integer <> 1
     or (v_snapshot #>> '{source_counts,receivables}')::integer <> 1
     or (v_snapshot #>> '{source_counts,payer_history}')::integer <> 5
     or v_snapshot #>> '{settings,cash_balance}' <> '10000'
     or pg_catalog.jsonb_array_length(v_snapshot -> 'recurring_obligations') <> 2
     or pg_catalog.jsonb_array_length(v_snapshot -> 'payer_history') <> 5
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '30000000-0000-4000-8000-000000000003'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'payer_history'
       ) row(value)
       where row.value ->> 'invoice_id' =
         '50000000-0000-4000-8000-000000000004'
         and (row.value ->> 'delay_days')::integer = 2
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'receivables') row(value)
       where row.value ->> 'invoice_id' =
         '50000000-0000-4000-8000-000000000001'
         and row.value ->> 'calculated_balance' = '3000'
         and (row.value ->> 'identity_conflict')::boolean is false
     ) then
    raise exception 'payroll readiness golden snapshot drifted: %', v_snapshot;
  end if;
end;
$assert_golden_snapshot$;

do $assert_microsecond_confirmation_ordering$
declare
  v_snapshot jsonb;
begin
  update public.expense_settings
  set forecast_obligations_confirmed_at =
        '2026-09-01 15:30:00.000001+00'
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  update public.recurring_expenses
  set updated_at = '2026-09-01 15:30:00.000002+00'
  where id = '30000000-0000-4000-8000-000000000001';

  v_snapshot := pg_temp.payroll_snapshot();
  if v_snapshot #>> '{settings,obligations_confirmed_at}' <>
       '2026-09-01T15:30:00.000001Z'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '30000000-0000-4000-8000-000000000001'
         and row.value ->> 'updated_at' =
           '2026-09-01T15:30:00.000002Z'
     ) then
    raise exception 'microsecond confirmation ordering was truncated: %',
      v_snapshot;
  end if;

  update public.expense_settings
  set forecast_obligations_confirmed_at = '2026-09-01 15:30:00+00'
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  update public.recurring_expenses
  set updated_at = '2026-08-30 12:00:00+00'
  where id = '30000000-0000-4000-8000-000000000001';
end;
$assert_microsecond_confirmation_ordering$;

do $assert_reimbursement_owed_semantics$
declare
  v_snapshot jsonb;
  v_case record;
  v_actual numeric;
begin
  for v_case in
    select status_value, approved_value, expected_value, ordinal
    from (values
      ('partially_approved'::text, null::numeric, 10::numeric, 1),
      ('partially_approved', 0, 0, 2),
      ('partially_approved', 5, 5, 3),
      ('approved', null, 10, 4),
      ('approved', 0, 10, 5),
      ('approved', 5, 5, 6),
      ('auto_approved', null, 10, 7),
      ('auto_approved', 0, 10, 8),
      ('auto_approved', 5, 5, 9)
    ) cases(status_value, approved_value, expected_value, ordinal)
  loop
    insert into public.expense_batches values (
      ('42000000-0000-4000-8000-' ||
       pg_catalog.lpad(v_case.ordinal::text, 12, '0'))::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      v_case.status_value,
      10,
      v_case.approved_value,
      '2026-08-29 12:00:00+00',
      '2026-08-30 12:00:00+00',
      null
    );
    insert into public.expenses values (
      ('43000000-0000-4000-8000-' ||
       pg_catalog.lpad(v_case.ordinal::text, 12, '0'))::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ('42000000-0000-4000-8000-' ||
       pg_catalog.lpad(v_case.ordinal::text, 12, '0'))::uuid,
      'CAD',
      null
    );
  end loop;

  v_snapshot := pg_temp.payroll_snapshot();
  for v_case in
    select status_value, approved_value, expected_value, ordinal
    from (values
      ('partially_approved'::text, null::numeric, 10::numeric, 1),
      ('partially_approved', 0, 0, 2),
      ('partially_approved', 5, 5, 3),
      ('approved', null, 10, 4),
      ('approved', 0, 10, 5),
      ('approved', 5, 5, 6),
      ('auto_approved', null, 10, 7),
      ('auto_approved', 0, 10, 8),
      ('auto_approved', 5, 5, 9)
    ) cases(status_value, approved_value, expected_value, ordinal)
  loop
    select (row.value ->> 'owed_amount')::numeric
      into v_actual
    from pg_catalog.jsonb_array_elements(
      v_snapshot -> 'reimbursement_batches'
    ) row(value)
    where row.value ->> 'id' =
      '42000000-0000-4000-8000-' ||
      pg_catalog.lpad(v_case.ordinal::text, 12, '0');
    if v_actual is distinct from v_case.expected_value then
      raise exception 'reimbursement owed semantics drifted for status %, approved %: expected %, got %',
        v_case.status_value, v_case.approved_value,
        v_case.expected_value, v_actual;
    end if;
  end loop;

  delete from public.expenses
  where id::text like '43000000-0000-4000-8000-%';
  delete from public.expense_batches
  where id::text like '42000000-0000-4000-8000-%';
end;
$assert_reimbursement_owed_semantics$;

do $assert_reimbursement_currency_normalization$
declare
  v_snapshot jsonb;
begin
  insert into public.expense_batches values (
    '44000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'approved', 10, null, '2026-08-29 12:00:00+00',
    '2026-08-30 12:00:00+00', null
  );
  insert into public.expenses values (
    '45000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '44000000-0000-4000-8000-000000000001', repeat('z', 64), null
  );

  v_snapshot := pg_temp.payroll_snapshot();
  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'reimbursement_batches'
       ) row(value)
       where row.value ->> 'id' =
         '44000000-0000-4000-8000-000000000001'
         and row.value -> 'currency_codes' = '["__mismatch__"]'::jsonb
     ) then
    raise exception 'reimbursement currency was not safely normalized: %',
      v_snapshot;
  end if;

  delete from public.expenses
  where id = '45000000-0000-4000-8000-000000000001';
  delete from public.expense_batches
  where id = '44000000-0000-4000-8000-000000000001';
end;
$assert_reimbursement_currency_normalization$;

do $assert_malformed_schedules_remain_visible$
declare
  v_snapshot jsonb;
begin
  insert into public.recurring_expenses (
    id, company_id, amount, currency, cadence, next_due_date, end_date,
    updated_at, obligation_kind, due_time_local
  ) values
    ('31000000-0000-4000-8000-000000000001',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10, 'CAD', 'nonsense',
     '2026-09-10', null, '2026-08-30 12:00:00+00', 'other', '08:00:00'),
    ('31000000-0000-4000-8000-000000000002',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10, 'CAD', 'monthly',
     '2026-09-10', '2026-09-01', '2026-08-30 12:00:00+00',
     'other', '08:00:00'),
    ('31000000-0000-4000-8000-000000000003',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10, 'CAD', '',
     '2026-09-10', null, '2026-08-30 12:00:00+00',
     'other', '08:00:00'),
    ('31000000-0000-4000-8000-000000000004',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10, repeat('x', 64),
     repeat('y', 64), '2026-09-10', null,
     '2026-08-30 12:00:00+00', 'other', '08:00:00');
  v_snapshot := pg_temp.payroll_snapshot();
  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '31000000-0000-4000-8000-000000000001'
         and row.value ->> 'cadence' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '31000000-0000-4000-8000-000000000002'
         and row.value ->> 'end_date' = '2026-09-01'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '31000000-0000-4000-8000-000000000003'
         and row.value ->> 'cadence' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '31000000-0000-4000-8000-000000000004'
         and row.value ->> 'cadence' = '__invalid__'
         and row.value ->> 'currency' = '__mismatch__'
     ) then
    raise exception 'malformed active schedule was hidden: %', v_snapshot;
  end if;
  delete from public.recurring_expenses
  where id in (
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000004'
  );
end;
$assert_malformed_schedules_remain_visible$;

do $assert_nonfinite_financial_and_temporal_values_are_retained$
declare
  v_snapshot jsonb;
begin
  update public.expense_settings
  set forecast_current_balance = 'NaN'::numeric,
      forecast_balance_updated_at = '10000-01-01'::timestamptz,
      forecast_obligations_confirmed_through = '10000-01-01'::date,
      forecast_obligations_confirmed_at = '-infinity'::timestamptz
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  insert into public.recurring_expenses (
    id, company_id, amount, currency, cadence, next_due_date, end_date,
    updated_at, obligation_kind, due_time_local
  ) values
  (
    '32000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'NaN'::numeric, 'CAD', 'monthly',
    'infinity'::date, '-infinity'::date, 'infinity'::timestamptz,
    'other', '08:00:00'
  ),
  (
    '32000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    repeat('9', 65)::numeric, 'CAD', 'monthly', '10000-01-01'::date,
    '10000-02-01'::date, '10000-01-01'::timestamptz,
    'other', '08:00:00'
  );
  insert into public.expense_batches values (
    '46000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'approved', 'NaN'::numeric, null, '2026-08-29 12:00:00+00',
    '2026-08-30 12:00:00+00', null
  );
  insert into public.invoices values
    ('52000000-0000-4000-8000-000000000001',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '60000000-0000-4000-8000-000000000001',
     'NaN'::numeric, 'NaN'::numeric, 'NaN'::numeric, 'sent',
     'infinity'::date, 'infinity'::timestamptz, null, 'nonfinite-open', null),
    ('52000000-0000-4000-8000-000000000002',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '60000000-0000-4000-8000-000000000001',
     10, 10, 0, 'paid', 'infinity'::date,
     '2026-06-01 18:00:00+00', null, 'nonfinite-history', null),
    ('52000000-0000-4000-8000-000000000003',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '60000000-0000-4000-8000-000000000001',
     10, 10, 0, 'paid', '2026-07-01',
     '2026-06-01 18:00:00+00', null, 'nan-history', null),
    ('52000000-0000-4000-8000-000000000004',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '60000000-0000-4000-8000-000000000001',
     10, 10, 0, 'paid', '2026-07-01',
     '2026-06-01 18:00:00+00', null, 'infinity-history', null);
  insert into public.payments values
  (
    '72000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '52000000-0000-4000-8000-000000000002', 10,
    '-infinity'::date, null, 'nonfinite-history-payment', null, null
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '52000000-0000-4000-8000-000000000003', 'NaN'::numeric,
    '2026-07-02', null, 'nan-history-payment', null, null
  ),
  (
    '72000000-0000-4000-8000-000000000003',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '52000000-0000-4000-8000-000000000004', 'Infinity'::numeric,
    '2026-07-02', null, 'infinity-history-payment', null, null
  );

  v_snapshot := pg_temp.payroll_snapshot();
  if v_snapshot #>> '{settings,cash_balance}' <> '__invalid__'
     or v_snapshot #>> '{settings,cash_balance_updated_at}' <> '__invalid__'
     or v_snapshot #>> '{settings,obligations_confirmed_through}' <>
       '__invalid__'
     or v_snapshot #>> '{settings,obligations_confirmed_at}' <> '__invalid__'
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '32000000-0000-4000-8000-000000000001'
         and row.value ->> 'amount' = '__invalid__'
         and row.value ->> 'next_due_date' = '__invalid__'
         and row.value ->> 'end_date' = '__invalid__'
         and row.value ->> 'updated_at' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '32000000-0000-4000-8000-000000000002'
         and row.value ->> 'amount' = '__invalid__'
         and row.value ->> 'next_due_date' = '__invalid__'
         and row.value ->> 'end_date' = '__invalid__'
         and row.value ->> 'updated_at' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'reimbursement_batches'
       ) row(value)
       where row.value ->> 'id' =
         '46000000-0000-4000-8000-000000000001'
         and row.value ->> 'owed_amount' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'receivables')
         row(value)
       where row.value ->> 'invoice_id' =
         '52000000-0000-4000-8000-000000000001'
         and row.value ->> 'total_amount' = '__invalid__'
         and row.value ->> 'stored_amount_paid' = '__invalid__'
         and row.value ->> 'stored_balance_due' = '__invalid__'
         and row.value ->> 'calculated_balance' = '__invalid__'
         and row.value ->> 'due_date' = '__invalid__'
         and row.value ->> 'sent_at' = '__invalid__'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'payer_history')
         row(value)
       where row.value ->> 'invoice_id' =
         '52000000-0000-4000-8000-000000000002'
         and row.value ->> 'due_date' = '__invalid__'
         and row.value ->> 'settled_on' = '__invalid__'
         and (row.value ->> 'amount_valid')::boolean
     )
     or 2 <> (
       select count(*)
       from pg_catalog.jsonb_array_elements(v_snapshot -> 'payer_history')
         row(value)
       where row.value ->> 'invoice_id' in (
         '52000000-0000-4000-8000-000000000003',
         '52000000-0000-4000-8000-000000000004'
       )
         and not (row.value ->> 'amount_valid')::boolean
     ) then
    raise exception 'non-finite source value was hidden or leaked: %',
      v_snapshot;
  end if;

  delete from public.payments
  where id in (
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000003'
  );
  delete from public.invoices
  where id in (
    '52000000-0000-4000-8000-000000000001',
    '52000000-0000-4000-8000-000000000002',
    '52000000-0000-4000-8000-000000000003',
    '52000000-0000-4000-8000-000000000004'
  );
  delete from public.expense_batches
  where id = '46000000-0000-4000-8000-000000000001';
  delete from public.recurring_expenses
  where id in (
    '32000000-0000-4000-8000-000000000001',
    '32000000-0000-4000-8000-000000000002'
  );
  update public.expense_settings
  set forecast_current_balance = 10000,
      forecast_balance_updated_at = '2026-09-01 15:30:00+00',
      forecast_obligations_confirmed_through = '2026-09-30',
      forecast_obligations_confirmed_at = '2026-09-01 15:30:00+00'
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end;
$assert_nonfinite_financial_and_temporal_values_are_retained$;

do $assert_subsecond_cutoff_transport$
declare
  v_snapshot jsonb;
begin
  update public.recurring_expenses
  set due_time_local = '09:00:00.000001'
  where id = '30000000-0000-4000-8000-000000000001';
  update public.recurring_expenses
  set next_due_date = '2026-09-15',
      due_time_local = '09:00:00.000002'
  where id = '30000000-0000-4000-8000-000000000002';

  v_snapshot := pg_temp.payroll_snapshot();
  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '30000000-0000-4000-8000-000000000001'
         and row.value ->> 'due_time_local' = '09:00:00.000001'
     )
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'recurring_obligations'
       ) row(value)
       where row.value ->> 'id' =
         '30000000-0000-4000-8000-000000000002'
         and row.value ->> 'due_time_local' = '09:00:00.000002'
     ) then
    raise exception 'subsecond obligation timing was truncated: %', v_snapshot;
  end if;

  update public.recurring_expenses
  set due_time_local = '09:00:00'
  where id = '30000000-0000-4000-8000-000000000001';
  update public.recurring_expenses
  set next_due_date = '2026-09-10',
      due_time_local = '17:00:00'
  where id = '30000000-0000-4000-8000-000000000002';
end;
$assert_subsecond_cutoff_transport$;

do $assert_net_settlement_history$
declare
  v_snapshot jsonb;
begin
  insert into public.invoices values
    ('51000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 500, 500, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'adjusted-underpaid', null),
    ('51000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 0, 1000, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'same-day-net-zero', null),
    ('51000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '60000000-0000-4000-8000-000000000001', 1000, 1000, 0, 'paid', '2026-07-01', '2026-06-01 18:00:00+00', null, 'recovered-after-reversal', null);
  insert into public.payments values
    ('71000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000001', 1000, '2026-07-02', null, 'adjusted-positive', null, null),
    ('71000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000001', -500, '2026-07-03', null, 'adjusted-negative', null, null),
    ('71000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000002', 1000, '2026-07-02', null, 'same-day-positive', null, null),
    ('71000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000002', -1000, '2026-07-02', null, 'same-day-negative', null, null),
    ('71000000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000003', 1000, '2026-07-02', null, 'recovery-positive-1', null, null),
    ('71000000-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000003', -1000, '2026-07-03', null, 'recovery-negative', null, null),
    ('71000000-0000-4000-8000-000000000007', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '51000000-0000-4000-8000-000000000003', 1000, '2026-07-07', null, 'recovery-positive-2', null, null);

  v_snapshot := pg_temp.payroll_snapshot();
  if exists (
       select 1 from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'payer_history'
       ) row(value)
       where row.value ->> 'invoice_id' in (
         '51000000-0000-4000-8000-000000000001',
         '51000000-0000-4000-8000-000000000002'
       )
     )
     or not exists (
       select 1 from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'payer_history'
       ) row(value)
       where row.value ->> 'invoice_id' =
         '51000000-0000-4000-8000-000000000003'
         and row.value ->> 'settled_on' = '2026-07-07'
         and (row.value ->> 'delay_days')::integer = 6
     ) then
    raise exception 'net settlement history drifted: %', v_snapshot;
  end if;

  delete from public.payments
  where invoice_id in (
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000003'
  );
  delete from public.invoices
  where id in (
    '51000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000002',
    '51000000-0000-4000-8000-000000000003'
  );
end;
$assert_net_settlement_history$;

do $assert_future_payments_are_not_observed$
declare
  v_snapshot jsonb;
begin
  insert into public.invoices values
    ('51000000-0000-4000-8000-000000000004',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '60000000-0000-4000-8000-000000000001',
     1000, 1000, 0, 'paid', '2026-08-31',
     '2026-08-20 18:00:00+00', null, 'future-only-history', null);
  insert into public.payments values
    ('71000000-0000-4000-8000-000000000008',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '50000000-0000-4000-8000-000000000001',
     3000, '2026-09-02', null, 'future-open-payment', null, null),
    ('71000000-0000-4000-8000-000000000009',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '51000000-0000-4000-8000-000000000004',
     1000, '2026-09-02', null, 'future-history-payment', null, null);

  v_snapshot := pg_temp.payroll_snapshot();
  if not exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'receivables'
       ) row(value)
       where row.value ->> 'invoice_id' =
         '50000000-0000-4000-8000-000000000001'
         and row.value ->> 'calculated_balance' = '3000'
     )
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         v_snapshot -> 'payer_history'
       ) row(value)
       where row.value ->> 'invoice_id' =
         '51000000-0000-4000-8000-000000000004'
     ) then
    raise exception 'future-dated payment leaked into as-of snapshot: %',
      v_snapshot;
  end if;

  delete from public.payments where id in (
    '71000000-0000-4000-8000-000000000008',
    '71000000-0000-4000-8000-000000000009'
  );
  delete from public.invoices
  where id = '51000000-0000-4000-8000-000000000004';
end;
$assert_future_payments_are_not_observed$;

do $assert_authority$
begin
  begin
    perform public.read_agent_payroll_readiness_as_system(
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.company.read','ops.expenses.read','ops.financial_documents.read','ops.financials.read','ops.payments.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v14',
      '2026-09-01.mcp-exposure.v8',
      'check_payroll_readiness',
      'check_payroll_readiness:2026-09-01.v1',
      '2026-09-01 16:00:00+00', '2026-09-15', 40, 50, 100, 500
    );
    raise exception 'tenant mismatch did not fail closed';
  exception when insufficient_privilege then null;
  end;

  update private.mcp_oauth_grants
  set revoked_at = '2026-09-01 15:59:00+00'
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  begin
    perform pg_temp.payroll_snapshot();
    raise exception 'revoked grant did not fail closed';
  exception when insufficient_privilege then null;
  end;
  update private.mcp_oauth_grants set revoked_at = null
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  delete from private.test_authority_permissions
  where permission = 'invoices.view';
  begin
    perform pg_temp.payroll_snapshot();
    raise exception 'missing invoice permission did not fail closed';
  exception when insufficient_privilege then null;
  end;
  insert into private.test_authority_permissions values ('invoices.view');

  begin
    perform public.read_agent_payroll_readiness_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.company.read','ops.expenses.read','ops.financial_documents.read','ops.financials.read','ops.payments.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v13',
      '2026-09-01.mcp-exposure.v7',
      'check_payroll_readiness',
      'check_payroll_readiness:2026-09-01.v1',
      '2026-09-01 16:00:00+00', '2026-09-15', 40, 50, 100, 500
    );
    raise exception 'wrong manifest and exposure did not fail closed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.read_agent_payroll_readiness_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('b', 32),
      array['ops.company.read','ops.expenses.read','ops.financial_documents.read','ops.financials.read','ops.payments.read'],
      'sha256:' || repeat('a', 64),
      '2026-09-01.capability-manifest.v14',
      '2026-09-01.mcp-exposure.v8',
      'check_payroll_readiness',
      'check_payroll_readiness:2026-09-01.v1',
      '2026-09-01 16:00:00+00', '2026-08-31', 40, 50, 100, 500
    );
    raise exception 'past target did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm <> 'AGENT_PAYROLL_READINESS_TARGET_DATE_INVALID' then
      raise exception 'target transport message drifted: %', sqlerrm;
    end if;
  end;
end;
$assert_authority$;

do $assert_revision_triggers$
declare
  v_before bigint;
  v_after bigint;
begin
  select source_revision into v_before
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'payroll_readiness';
  update public.invoices
  set sent_at = sent_at + interval '1 minute'
  where id = '50000000-0000-4000-8000-000000000001';
  insert into public.payments values (
    '70000000-0000-4000-8000-000000000099',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '50000000-0000-4000-8000-000000000001',
    0,
    '2026-09-01',
    null,
    'revision-only',
    null,
    null
  );
  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and domain = 'payroll_readiness';
  if v_after is distinct from v_before + 2 then
    raise exception 'payroll readiness source revision did not advance exactly';
  end if;
end;
$assert_revision_triggers$;

do $assert_metadata_constraint$
begin
  begin
    update public.expense_settings
    set forecast_obligations_confirmed_at = null
    where company_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'unpaired obligation confirmation did not fail';
  exception when check_violation then null;
  end;
end;
$assert_metadata_constraint$;

set local enable_seqscan = off;

do $assert_indexes$
declare
  v_index text;
  v_plan text := '';
  v_line record;
begin
  foreach v_index in array array[
    'recurring_expenses_agent_payroll_due_v1_idx',
    'expense_batches_agent_payroll_due_v1_idx',
    'invoices_agent_payroll_open_v1_idx',
    'payments_agent_payroll_history_v1_idx'
  ] loop
    if pg_catalog.to_regclass('public.' || v_index) is null then
      raise exception 'missing payroll readiness index: %', v_index;
    end if;
  end loop;

  for v_line in execute $plan$
    explain
    select recurring.id
    from public.recurring_expenses recurring
    where recurring.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and recurring.deleted_at is null
      and recurring.next_due_date <= '2026-09-15'
    order by recurring.next_due_date, recurring.id
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%recurring_expenses_agent_payroll_due_v1_idx%'
     or v_plan not like '%next_due_date <=%' then
    raise exception 'recurring-obligation query missed its bounded index: %',
      v_plan;
  end if;

  v_plan := '';
  for v_line in execute $plan$
    explain
    select batch.id
    from public.expense_batches batch
    where batch.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and batch.status in ('approved', 'partially_approved', 'auto_approved')
      and batch.paid_at is null
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%expense_batches_agent_payroll_due_v1_idx%' then
    raise exception 'reimbursement query missed its bounded index: %', v_plan;
  end if;

  v_plan := '';
  for v_line in execute $plan$
    explain
    select invoice.id
    from public.invoices invoice
    where invoice.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and invoice.deleted_at is null
      and invoice.status in (
        'sent', 'awaiting_payment', 'partially_paid', 'past_due'
      )
    order by invoice.due_date, invoice.id
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%invoices_agent_payroll_open_v1_idx%'
     or v_plan like '%Sort%' then
    raise exception 'receivable query missed its bounded index: %', v_plan;
  end if;

  v_plan := '';
  for v_line in execute $plan$
    explain
    select payment.id
    from public.payments payment
    where payment.company_id =
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and payment.invoice_id =
        '50000000-0000-4000-8000-000000000004'
      and payment.voided_at is null
    order by payment.payment_date, payment.id
  $plan$ loop
    v_plan := v_plan || ' ' || v_line."QUERY PLAN";
  end loop;
  if v_plan not like '%payments_agent_payroll_history_v1_idx%'
     or v_plan not like '%invoice_id =%' then
    raise exception 'payer-history query missed its bounded index: %', v_plan;
  end if;
end;
$assert_indexes$;

do $assert_bound$
declare
  v_snapshot jsonb;
begin
  insert into public.recurring_expenses (
    id, company_id, amount, currency, cadence, next_due_date,
    updated_at, obligation_kind, due_time_local
  )
  select (
           '80000000-0000-4000-8000-' ||
           pg_catalog.lpad(series::text, 12, '0')
         )::uuid,
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         1,
         'CAD',
         'monthly',
         '2026-09-12',
         '2026-09-01 15:00:00+00',
         'other',
         '08:00:00'
  from pg_catalog.generate_series(1, 39) series;
  v_snapshot := pg_temp.payroll_snapshot();
  if (v_snapshot #>> '{source_counts,recurring_obligations}')::integer <> 41
     or (v_snapshot #>> '{source_bounds,recurring_obligations}')::boolean is not true
     or pg_catalog.jsonb_array_length(v_snapshot -> 'recurring_obligations') <> 40 then
    raise exception 'recurring source bound did not fail closed: %', v_snapshot;
  end if;
end;
$assert_bound$;

rollback;
