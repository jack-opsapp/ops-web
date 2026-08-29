\set ON_ERROR_STOP on

\if :{?agent_mcp_payments_bootstrap}
-- Disposable PostgreSQL 17 bootstrap. Task 14 owns the production-shaped
-- authority, OAuth, company, client, invoice, and job prerequisites.
\set agent_mcp_sales_bootstrap 1
\ir agent-sales-document-reads-runtime.sql
\unset agent_mcp_sales_bootstrap

create table public.payments (
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  client_id uuid not null,
  amount numeric(12,2) not null,
  payment_method text,
  reference_number text,
  notes text,
  payment_date date not null,
  stripe_payment_intent text,
  created_by uuid,
  created_at timestamptz not null default pg_catalog.statement_timestamp(),
  voided_at timestamptz,
  voided_by uuid,
  qb_id text,
  sage_id text,
  constraint payments_payment_method_check check (
    payment_method is null or payment_method in (
      'credit_card', 'debit_card', 'ach', 'cash', 'check',
      'bank_transfer', 'stripe', 'other'
    )
  )
);

insert into private.agent_read_domains(domain) values ('payments');

\ir ../../supabase/migrations/20260829081500_agent_payment_sources.sql
\ir ../../supabase/migrations/20260829081501_agent_payment_read.sql
\endif

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local request.jwt.claim.role = 'service_role';

do $payment_catalog_contract$
declare
  v_signature text;
  v_plan json;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 170000
     or pg_catalog.current_setting('server_version_num')::integer >= 180000 then
    raise exception 'agent_payment_runtime_requires_postgresql_17';
  end if;

  foreach v_signature in array array[
    'private.bump_agent_payment_source_revision()',
    'private.agent_p2_payment_expected_candidate_v1(jsonb)',
    'private.agent_p2_payment_source_v1(uuid,uuid,uuid,text,uuid,date,date,text[],text[],text,timestamp with time zone,integer)',
    'private.agent_p2_payment_authorized_path_v1(uuid,uuid,jsonb,text,uuid,uuid)',
    'private.agent_p2_payment_proof_candidate_v1(jsonb)',
    'private.agent_p2_payment_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb)',
    'private.agent_p2_payment_list_v1(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)',
    'private.agent_p2_payment_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,timestamp with time zone,integer)',
    'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'agent_payment_runtime_function_missing:%', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class index_row
    join pg_catalog.pg_index index_state
      on index_state.indexrelid = index_row.oid
    where index_row.relnamespace = 'public'::regnamespace
      and index_row.relname = 'idx_payments_agent_history_v1'
      and index_state.indisvalid
      and index_state.indisready
  ) then
    raise exception 'agent_payment_runtime_index_invalid';
  end if;

  perform pg_catalog.set_config('enable_seqscan', 'off', true);
  execute $plan$
    explain (format json, costs off)
    select payment.id
    from public.payments payment
    where payment.company_id =
      '11111111-1111-4111-8111-111111111111'::uuid
    order by payment.payment_date desc, payment.id
    limit 501
  $plan$ into v_plan;
  if v_plan::text not like '%idx_payments_agent_history_v1%' then
    raise exception 'payment_keyset_index_plan_failed:%', v_plan;
  end if;
  raise notice 'payment_keyset_index_plan';
end;
$payment_catalog_contract$;

insert into public.companies(id, name, currency_code) values
  ('11111111-1111-4111-8111-111111111111', 'Alpha', 'CAD'),
  ('22222222-2222-4222-8222-222222222222', 'Bravo', 'USD');

insert into public.users(id, company_id) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.user_permission_overrides(
  id, user_id, company_id, permission, scope, granted
) values
  ('a1000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','finances.view','all',true),
  ('a1000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','invoices.view','assigned',true),
  ('a1000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','pipeline.view','assigned',true),
  ('a1000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','projects.view','assigned',true);

insert into public.clients(id, company_id) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd01','11111111-1111-4111-8111-111111111111'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddd02','22222222-2222-4222-8222-222222222222');

insert into public.opportunities(id, company_id) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01','11111111-1111-4111-8111-111111111111'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02','11111111-1111-4111-8111-111111111111');

insert into public.projects(id, company_id) values
  ('f1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
  ('f2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');

insert into private.test_entity_access values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','opportunity','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','opportunity','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',false),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','project','f1111111-1111-4111-8111-111111111111',true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','project','f2222222-2222-4222-8222-222222222222',false);

insert into public.invoices(
  id, company_id, opportunity_id, project_id, project_ref, client_id,
  client_ref, invoice_number, subject, status, issue_date, due_date,
  total, amount_paid, balance_due, updated_at
) values
  ('20000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111',null,'f1111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','INV-001','Assigned project','awaiting_payment','2026-08-01','2026-08-31',5000.00,1000.00,4000.00,'2026-08-24 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',null,null,'dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','INV-002','Assigned opportunity','awaiting_payment','2026-08-01','2026-08-31',3000.00,500.00,2500.00,'2026-08-23 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111',null,null,null,'dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','INV-003','Unlinked','awaiting_payment','2026-08-01','2026-08-31',2000.00,250.00,1750.00,'2026-08-22 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111',null,'f2222222-2222-4222-8222-222222222222','f2222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddd01','dddddddd-dddd-4ddd-8ddd-dddddddddd01','INV-004','Hidden project','awaiting_payment','2026-08-01','2026-08-31',1000.00,100.00,900.00,'2026-08-21 12:00:00+00'),
  ('20000000-0000-4000-8000-000000000005','22222222-2222-4222-8222-222222222222',null,null,null,'dddddddd-dddd-4ddd-8ddd-dddddddddd02','dddddddd-dddd-4ddd-8ddd-dddddddddd02','INV-005','Other company','awaiting_payment','2026-08-01','2026-08-31',1000.00,100.00,900.00,'2026-08-20 12:00:00+00');

insert into public.payments(
  id, company_id, invoice_id, client_id, amount, payment_method,
  reference_number, notes, payment_date, stripe_payment_intent,
  created_by, voided_at, voided_by, qb_id, sage_id
) values
  ('30000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddd01',250.00,'credit_card','SECRET-REF-1','SECRET-NOTE-1','2026-08-24','pi_secret_1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'QB-SECRET-1','SAGE-SECRET-1'),
  ('30000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000002','dddddddd-dddd-4ddd-8ddd-dddddddddd01',125.00,'ach',null,null,'2026-08-23',null,null,null,null,null,null),
  ('30000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000003','dddddddd-dddd-4ddd-8ddd-dddddddddd01',75.00,'cash',null,null,'2026-08-22',null,null,'2026-08-22 16:00:00+00','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null),
  ('30000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000004','dddddddd-dddd-4ddd-8ddd-dddddddddd01',50.00,'check',null,null,'2026-08-21',null,null,null,null,null,null),
  ('30000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001','dddddddd-dddd-4ddd-8ddd-dddddddddd01',25.00,null,null,null,'2026-08-20',null,null,null,null,null,null);

insert into private.agent_operational_read_revisions(
  company_id, source_revision
) values
  ('11111111-1111-4111-8111-111111111111', 17),
  ('22222222-2222-4222-8222-222222222222', 23);

insert into private.mcp_oauth_clients(
  client_id, scope_ceiling, consent_catalog_revision, exposure_revision
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['ops.payments.read']::text[],
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

insert into private.mcp_oauth_grants(
  id, user_id, company_id, client_id, scopes, revision, accepted_labels,
  consent_catalog_revision, exposure_revision
) values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['ops.payments.read']::text[],
  pg_catalog.repeat('a', 32),
  private.mcp_oauth_labels_for_scopes(
    array['ops.payments.read']::text[],
    '2026-08-22.mcp-consent-catalog.v1'
  ),
  '2026-08-22.mcp-consent-catalog.v1',
  '2026-08-22.mcp-exposure.v1'
);

create function pg_temp.task15_keys()
returns text[]
language sql immutable set search_path = ''
as $$
  select array[
    'finances.view','invoices.view','pipeline.view','projects.view'
  ]::text[];
$$;

create function pg_temp.task15_snapshot()
returns text
language sql stable set search_path = ''
as $$
  select permission_snapshot_revision
  from private.resolve_agent_actor_authority(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    pg_temp.task15_keys()
  );
$$;

create function pg_temp.task15_candidate()
returns jsonb
language sql stable set search_path = ''
as $$
  with permission_map as (
    select coalesce(
             pg_catalog.jsonb_object_agg(
               permission.permission,
               permission.scope
               order by permission.permission
             ),
             '{}'::jsonb
           ) as value
    from public.user_permission_overrides permission
    where permission.user_id =
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      and permission.company_id =
            '11111111-1111-4111-8111-111111111111'::uuid
      and permission.granted
      and permission.permission = any(pg_temp.task15_keys())
  )
  select private.agent_p2_payment_expected_candidate_v1(value)
  from permission_map;
$$;

create function pg_temp.task15_read(
  p_limit integer default 25,
  p_cursor_read_at timestamptz default null,
  p_cursor_revisions jsonb default '[]'::jsonb,
  p_after_date date default null,
  p_after_id uuid default null,
  p_invoice_id uuid default null,
  p_client_id uuid default null,
  p_job_kind text default null,
  p_job_id uuid default null,
  p_start_date date default null,
  p_end_date date default null,
  p_methods text[] default array['bank','card','cash','check','other']::text[],
  p_states text[] default array['applied','voided']::text[]
) returns jsonb
language sql stable set search_path = ''
as $$
  select public.read_agent_payments_as_system(
    'task15-runtime',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    pg_catalog.repeat('a', 32),
    array['ops.payments.read']::text[],
    pg_temp.task15_snapshot(),
    pg_temp.task15_keys(),
    '2026-08-22.capability-manifest.v8',
    'list_payments',
    'list_payments:2026-08-22.v1',
    pg_temp.task15_candidate(),
    p_invoice_id,
    p_client_id,
    p_job_kind,
    p_job_id,
    p_start_date,
    p_end_date,
    p_methods,
    p_states,
    p_limit,
    p_limit + 1,
    501,
    p_cursor_read_at,
    p_cursor_revisions,
    p_after_date,
    p_after_id
  );
$$;

do $payment_revision_contract$
declare
  v_before bigint;
  v_after bigint;
  v_old_before bigint;
  v_new_before bigint;
begin
  select source_revision into v_before
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-4111-8111-111111111111'
    and domain = 'payments';
  update public.payments set amount = amount + 1
  where id = '30000000-0000-4000-8000-000000000001';
  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-4111-8111-111111111111'
    and domain = 'payments';
  if v_after is distinct from v_before + 1 then
    raise exception 'payment_relevant_update_bumps_failed';
  end if;
  raise notice 'payment_relevant_update_bumps';

  v_before := v_after;
  update public.payments set notes = 'PRIVATE-CHANGED'
  where id = '30000000-0000-4000-8000-000000000001';
  select source_revision into v_after
  from private.agent_read_domain_revisions
  where company_id = '11111111-1111-4111-8111-111111111111'
    and domain = 'payments';
  if v_after is distinct from v_before then
    raise exception 'payment_private_update_does_not_bump_failed';
  end if;
  raise notice 'payment_private_update_does_not_bump';

  insert into public.payments(
    id, company_id, invoice_id, client_id, amount, payment_date
  ) values (
    '39999999-9999-4999-8999-999999999999',
    '11111111-1111-4111-8111-111111111111',
    '20000000-0000-4000-8000-000000000001',
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    1.00,
    '2026-08-01'
  );
  select coalesce((
           select source_revision
           from private.agent_read_domain_revisions
           where company_id = '11111111-1111-4111-8111-111111111111'
             and domain = 'payments'
         ), 0)
    into v_old_before;
  select coalesce((
           select source_revision
           from private.agent_read_domain_revisions
           where company_id = '22222222-2222-4222-8222-222222222222'
             and domain = 'payments'
         ), 0)
    into v_new_before;
  update public.payments
  set company_id = '22222222-2222-4222-8222-222222222222'
  where id = '39999999-9999-4999-8999-999999999999';
  if (select source_revision from private.agent_read_domain_revisions
      where company_id = '11111111-1111-4111-8111-111111111111'
        and domain = 'payments') is distinct from v_old_before + 1
     or (select source_revision from private.agent_read_domain_revisions
         where company_id = '22222222-2222-4222-8222-222222222222'
           and domain = 'payments') is distinct from v_new_before + 1 then
    raise exception 'payment_old_and_new_company_fanout_failed';
  end if;
  delete from public.payments
  where id = '39999999-9999-4999-8999-999999999999';
  raise notice 'payment_old_and_new_company_fanout';
end;
$payment_revision_contract$;

do $payment_visibility_contract$
declare
  v_result jsonb;
  v_ids uuid[];
begin
  v_result := pg_temp.task15_read();
  select pg_catalog.array_agg((row.value #>> '{item,payment_ref,id}')::uuid
           order by row.ordinality)
    into v_ids
  from pg_catalog.jsonb_array_elements(v_result -> 'rows')
    with ordinality row(value, ordinality);
  if v_ids is distinct from array[
       '30000000-0000-4000-8000-000000000001'::uuid,
       '30000000-0000-4000-8000-000000000002'::uuid,
       '30000000-0000-4000-8000-000000000005'::uuid
     ] then
    raise exception 'payment_assigned_visibility_failed:%', v_ids;
  end if;

  update public.user_permission_overrides set scope = 'all'
  where permission = 'invoices.view';
  v_result := pg_temp.task15_read();
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 4
     or not exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_result -> 'rows') row(value)
       where row.value #>> '{item,payment_ref,id}' =
         '30000000-0000-4000-8000-000000000003'
     ) then
    raise exception 'payment_all_visibility_failed:%', v_result;
  end if;
  update public.user_permission_overrides set scope = 'assigned'
  where permission = 'invoices.view';
  raise notice 'payment_all_and_assigned_visibility';
end;
$payment_visibility_contract$;

do $payment_finance_contract$
declare
  v_candidate jsonb := pg_temp.task15_candidate();
begin
  update public.user_permission_overrides set scope = 'assigned'
  where permission = 'finances.view';
  begin
    perform public.read_agent_payments_as_system(
      'task15-finance','11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pg_catalog.repeat('a',32),
      array['ops.payments.read']::text[],pg_temp.task15_snapshot(),
      pg_temp.task15_keys(),'2026-08-22.capability-manifest.v8',
      'list_payments','list_payments:2026-08-22.v1',v_candidate,
      null,null,null,null,null,null,
      array['bank','card','cash','check','other']::text[],
      array['applied','voided']::text[],25,26,501,null,'[]'::jsonb,null,null
    );
    raise exception 'payment_finances_all_required_missing';
  exception when insufficient_privilege then
    null;
  end;
  update public.user_permission_overrides set scope = 'all'
  where permission = 'finances.view';
  raise notice 'payment_finances_all_required';
end;
$payment_finance_contract$;

do $payment_filter_contract$
declare
  v_result jsonb;
begin
  v_result := pg_temp.task15_read(
    p_limit => 25,
    p_start_date => '2026-08-23',
    p_end_date => '2026-08-23',
    p_methods => array['bank']::text[],
    p_states => array['applied']::text[]
  );
  if pg_catalog.jsonb_array_length(v_result -> 'rows') <> 1
     or v_result #>> '{rows,0,item,method_category}' <> 'bank'
     or v_result #>> '{rows,0,item,amount,amount_minor}' <> '12500' then
    raise exception 'payment_filters_and_normalization_failed:%', v_result;
  end if;
  v_result := pg_temp.task15_read(
    p_limit => 25,
    p_invoice_id => '20000000-0000-4000-8000-000000000001',
    p_methods => array['other']::text[],
    p_states => array['applied']::text[]
  );
  if v_result #>> '{rows,0,item,method_category}' <> 'other' then
    raise exception 'payment_other_normalization_failed:%', v_result;
  end if;
  raise notice 'payment_filters_and_normalization';
end;
$payment_filter_contract$;

do $payment_future_void_contract$
declare
  v_message text;
begin
  insert into public.payments(
    id, company_id, invoice_id, client_id, amount, payment_method,
    payment_date, voided_at
  ) values (
    '31111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111',
    '20000000-0000-4000-8000-000000000001',
    'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
    1.00,
    'cash',
    '2026-08-24',
    pg_catalog.statement_timestamp() + interval '1 hour'
  );
  begin
    perform pg_temp.task15_read();
    raise exception 'payment_future_void_fails_closed_missing';
  exception when data_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'agent_payment_source_data_invalid' then
      raise;
    end if;
  end;
  delete from public.payments
  where id = '31111111-1111-4111-8111-111111111111';
  raise notice 'payment_future_void_fails_closed';
end;
$payment_future_void_contract$;

do $payment_currency_contract$
declare
  v_message text;
begin
  update public.payments
  set amount = 250.50
  where id = '30000000-0000-4000-8000-000000000001';
  update public.companies
  set currency_code = 'JPY'
  where id = '11111111-1111-4111-8111-111111111111';
  begin
    perform pg_temp.task15_read();
    raise exception 'payment_fractional_zero_decimal_currency_accepted';
  exception when data_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'agent_payment_source_data_invalid' then
      raise;
    end if;
  end;

  update public.payments
  set amount = 250.00
  where id = '30000000-0000-4000-8000-000000000001';
  update public.companies
  set currency_code = 'ZZZ'
  where id = '11111111-1111-4111-8111-111111111111';
  begin
    perform pg_temp.task15_read();
    raise exception 'payment_unknown_currency_accepted';
  exception when data_exception then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'agent_payment_source_data_invalid' then
      raise;
    end if;
  end;

  update public.companies
  set currency_code = 'CAD'
  where id = '11111111-1111-4111-8111-111111111111';
  raise notice 'payment_unlike_currency_fails_closed';
end;
$payment_currency_contract$;

do $payment_keyset_contract$
declare
  v_first jsonb;
  v_second jsonb;
  v_first_id text;
  v_second_id text;
begin
  v_first := pg_temp.task15_read(1);
  v_second := pg_temp.task15_read(
    1,
    (v_first ->> 'read_at')::timestamptz,
    v_first -> 'source_revisions',
    (v_first #>> '{rows,0,predecessor,order,0}')::date,
    (v_first #>> '{rows,0,predecessor,tie_breaker}')::uuid
  );
  v_first_id := v_first #>> '{rows,0,item,payment_ref,id}';
  v_second_id := v_second #>> '{rows,0,item,payment_ref,id}';
  if v_first_id is null
     or v_second_id is null
     or v_first_id = v_second_id
     or v_first_id <> '30000000-0000-4000-8000-000000000001'
     or v_second_id <> '30000000-0000-4000-8000-000000000002' then
    raise exception 'payment_keyset_no_duplicates_failed:%:%',
      v_first, v_second;
  end if;
  raise notice 'payment_keyset_no_duplicates';
end;
$payment_keyset_contract$;

do $payment_stale_contract$
declare
  v_first jsonb;
begin
  v_first := pg_temp.task15_read(1);
  update public.payments set amount = amount + 1
  where id = '30000000-0000-4000-8000-000000000002';
  begin
    perform pg_temp.task15_read(
      1,
      (v_first ->> 'read_at')::timestamptz,
      v_first -> 'source_revisions',
      (v_first #>> '{rows,0,predecessor,order,0}')::date,
      (v_first #>> '{rows,0,predecessor,tie_breaker}')::uuid
    );
    raise exception 'payment_stale_revision_fails_closed_missing';
  exception when serialization_failure then
    null;
  end;
  raise notice 'payment_stale_revision_fails_closed';
end;
$payment_stale_contract$;

do $payment_privacy_attention_contract$
declare
  v_result jsonb;
  v_attention jsonb;
begin
  v_result := pg_temp.task15_read();
  if v_result::text like '%SECRET-REF-1%'
     or v_result::text like '%SECRET-NOTE-1%'
     or v_result::text like '%pi_secret_1%'
     or v_result::text like '%QB-SECRET-1%'
     or v_result::text like '%SAGE-SECRET-1%'
     or v_result::text like '%reference_number%'
     or v_result::text like '%payment_method%'
     or v_result::text like '%created_by%'
     or v_result::text like '%voided_by%' then
    raise exception 'payment_private_fields_absent_failed:%', v_result;
  end if;
  raise notice 'payment_private_fields_absent';

  v_attention := private.agent_p2_payment_attention_v1(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    pg_catalog.repeat('a', 32),
    array['ops.payments.read']::text[],
    pg_temp.task15_snapshot(),
    pg_temp.task15_keys(),
    pg_temp.task15_candidate(),
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp()),
    501
  );
  if pg_catalog.jsonb_array_length(v_attention -> 'summaries') <> 2
     or (v_attention ->> 'source_inspected')::integer >= 501
     or v_attention::text like '%SECRET-%' then
    raise exception 'payment_attention_bounded_failed:%', v_attention;
  end if;
  raise notice 'payment_attention_bounded';
end;
$payment_privacy_attention_contract$;

do $payment_source_bound_contract$
begin
  insert into public.payments(
    id, company_id, invoice_id, client_id, amount, payment_method,
    payment_date
  )
  select (
           '70000000-0000-4000-8000-' ||
           pg_catalog.lpad(source.value::text, 12, '0')
         )::uuid,
         '11111111-1111-4111-8111-111111111111',
         '20000000-0000-4000-8000-000000000001',
         'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
         1.00,
         'cash',
         '2026-08-01'
  from pg_catalog.generate_series(1, 496) source(value);
  begin
    perform pg_temp.task15_read();
    raise exception 'payment_source_501_fails_closed_missing';
  exception when program_limit_exceeded then
    null;
  end;
  delete from public.payments
  where id::text like '70000000-0000-4000-8000-%';
  raise notice 'payment_source_501_fails_closed';
end;
$payment_source_bound_contract$;

do $payment_acl_contract$
declare
  v_signature text :=
    'public.read_agent_payments_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,uuid,uuid,text,uuid,date,date,text[],text[],integer,integer,integer,timestamp with time zone,jsonb,date,uuid)';
begin
  if pg_catalog.has_function_privilege('public', v_signature, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     or pg_catalog.has_function_privilege(
       'authenticated', v_signature, 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role', v_signature, 'EXECUTE'
     ) then
    raise exception 'payment_service_only_acl_failed';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    perform pg_temp.task15_read();
    raise exception 'payment_service_role_runtime_guard_missing';
  exception when insufficient_privilege then
    null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  raise notice 'payment_service_only_acl';
end;
$payment_acl_contract$;

rollback;
