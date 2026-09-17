\set ON_ERROR_STOP on
-- Disposable account-closure fixture data. Never apply to an OPS database.
-- Two companies with the same complete expense accounting shape: company 1 is
-- closed by the runtime test, company 2 is the bystander whose rows must not
-- change. Financial history is produced through the real released functions
-- (approval, Mark paid, settings, provider worker), not inserted by hand.

create function pg_temp.cx(p_company integer, p_item integer) returns uuid
language sql immutable as $$
  select ('72000000-0000-4000-8000-' || lpad((p_company * 10000 + p_item)::text, 12, '0'))::uuid;
$$;

create function pg_temp.seed_company(c integer) returns void language plpgsql as $$
declare
  v_company uuid := pg_temp.cx(c, 1);
  v_owner uuid := pg_temp.cx(c, 10);
  v_crew uuid := pg_temp.cx(c, 11);
  v_connection public.accounting_connections;
  v_queue public.accounting_sync_queue;
begin
  -- Maintenance context: direct seeding as the database owner.
  perform set_config('request.jwt.claims', '', false);

  insert into public.companies(id, currency_code) values (v_company, 'CAD');
  insert into public.users(id, company_id, firebase_uid, is_active, is_company_admin) values
    (v_owner, v_company, 'closure-owner-' || c, true, true),
    (v_crew, v_company, 'closure-crew-' || c, true, false);
  insert into public.user_permission_overrides(user_id, company_id, permission, scope, granted) values
    (v_crew, v_company, 'expenses.view', 'own', true),
    (v_crew, v_company, 'expenses.edit', 'own', true);
  insert into public.expense_categories(id, company_id, name, is_active)
    values (pg_temp.cx(c, 400), v_company, 'Fuel', true);
  insert into public.expense_settings(company_id, review_frequency, auto_approve_threshold)
    values (v_company, 'monthly', 0);
  insert into public.projects(id, company_id, title, status)
    values (pg_temp.cx(c, 500), v_company, 'Closure project', 'active');
  insert into public.accounting_connections(id, company_id, provider, is_connected, sync_enabled,
    sync_direction, provider_environment, realm_id_lookup)
    values (pg_temp.cx(c, 30), v_company::text, 'quickbooks', true, true, 'push_only', 'sandbox',
      repeat(chr(96 + c), 64))
    returning * into v_connection;

  -- Provider settings and every mapping kind, through the released settings RPC.
  perform public.save_expense_accounting_settings(v_owner, v_connection.id,
    '{"currency":"CAD"}',
    jsonb_build_array(jsonb_build_object('categoryId', pg_temp.cx(c, 400), 'externalAccountId', 'account-' || c)),
    jsonb_build_array(jsonb_build_object('userId', v_crew, 'externalEmployeeId', 'employee-' || c)),
    jsonb_build_array(jsonb_build_object('taxRate', 5, 'externalTaxCodeId', 'tax-' || c)),
    v_connection.provider, v_connection.provider_environment, v_connection.realm_id_lookup,
    jsonb_build_array(jsonb_build_object('projectId', pg_temp.cx(c, 500), 'externalProjectId', 'job-' || c)));

  insert into public.expense_batches(id, company_id, submitted_by, status, batch_number, amendment_number) values
    (pg_temp.cx(c, 100), v_company, v_crew, 'open', 'CLOSE-' || c || '-1', 0),
    (pg_temp.cx(c, 101), v_company, v_crew, 'open', 'CLOSE-' || c || '-2', 0);
  insert into public.expenses(id, company_id, submitted_by, batch_id, status, amount, tax_amount,
    currency, expense_date, payment_method, category_id) values
    (pg_temp.cx(c, 200), v_company, v_crew, pg_temp.cx(c, 100), 'submitted', 105, 5, 'CAD', current_date, 'personal_card', pg_temp.cx(c, 400)),
    (pg_temp.cx(c, 201), v_company, v_crew, pg_temp.cx(c, 100), 'submitted', 40, 0, 'CAD', current_date, 'cash', null),
    (pg_temp.cx(c, 202), v_company, v_crew, pg_temp.cx(c, 100), 'submitted', 60, 0, 'CAD', current_date, 'company_card', null),
    (pg_temp.cx(c, 203), v_company, v_crew, pg_temp.cx(c, 101), 'submitted', 30, 0, 'CAD', current_date, 'personal_card', null);
  insert into public.expense_project_allocations(id, expense_id, project_id, amount, percentage)
    values (pg_temp.cx(c, 300), pg_temp.cx(c, 200), pg_temp.cx(c, 500)::text, 105, 100);

  -- Approval and Mark paid as the owner: accruals, a purchase, settlements and
  -- their provider queue work.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', 'closure-owner-' || c, 'role', 'authenticated')::text, false);
  perform public.approve_expense_batch(pg_temp.cx(c, 100));
  perform public.mark_expense_batch_paid(pg_temp.cx(c, 100));
  perform set_config('request.jwt.claims', '', false);

  -- A legacy provider id forces a review event.
  insert into public.expenses(id, company_id, submitted_by, batch_id, status, amount, tax_amount,
    currency, expense_date, payment_method, accounting_sync_id)
    values (pg_temp.cx(c, 204), v_company, v_crew, pg_temp.cx(c, 101), 'submitted', 125, 0, 'CAD',
      current_date, 'personal_card', 'legacy-provider-' || c);
  update public.expenses set status = 'approved' where id = pg_temp.cx(c, 204);

  -- An expense already tombstoned before closure, still holding an allocation.
  insert into public.expenses(id, company_id, submitted_by, batch_id, status, amount, tax_amount,
    currency, expense_date, payment_method)
    values (pg_temp.cx(c, 205), v_company, v_crew, pg_temp.cx(c, 101), 'submitted', 20, 0, 'CAD',
      current_date, 'personal_card');
  insert into public.expense_project_allocations(id, expense_id, project_id, amount, percentage)
    values (pg_temp.cx(c, 301), pg_temp.cx(c, 205), pg_temp.cx(c, 500)::text, 20, 100);
  update public.expenses set deleted_at = clock_timestamp() where id = pg_temp.cx(c, 205);

  -- A recurring reimbursement and this month's approved line.
  insert into public.expense_recurring_reimbursements(id, company_id, user_id, name, amount, currency,
    first_period, next_period, created_by, updated_by)
    values (pg_temp.cx(c, 600), v_company, v_crew, 'Vehicle advertising', 350, 'CAD',
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + interval '1 month')::date, v_owner, v_owner);
  insert into public.expenses(id, company_id, submitted_by, batch_id, status, amount, tax_amount,
    currency, expense_date, payment_method, recurring_reimbursement_id, recurring_period)
    values (pg_temp.cx(c, 206), v_company, v_crew, pg_temp.cx(c, 101), 'approved', 350, 0, 'CAD',
      current_date, 'personal_card', pg_temp.cx(c, 600), date_trunc('month', current_date)::date);

  -- Provider worker: one finalized posting, one frozen but unfinished.
  select * into v_queue from public.accounting_sync_queue
    where company_id = v_company and entity_type = 'expense' order by created_at, id limit 1;
  update public.accounting_sync_queue set status = 'claimed', locked_by = 'closure-worker', locked_at = now()
    where id = v_queue.id;
  perform public.prepare_expense_accounting_write(v_queue.id, 'closure-worker',
    '{"document":"closure"}', '{"debits":[],"credits":[]}');
  perform public.finalize_expense_accounting_sync(v_queue.id, 'closure-worker', 'provider-' || c, '0', now());
  insert into public.accounting_sync_events(company_id, connection_id, queue_id, direction, entity_type,
    operation, status, source)
    values (v_company, v_connection.id, v_queue.id, 'ops_to_qb', 'expense', 'create', 'succeeded', 'worker');

  select * into v_queue from public.accounting_sync_queue
    where company_id = v_company and entity_type = 'expense' and status = 'pending'
    order by created_at, id limit 1;
  update public.accounting_sync_queue set status = 'claimed', locked_by = 'closure-worker', locked_at = now()
    where id = v_queue.id;
  perform public.prepare_expense_accounting_write(v_queue.id, 'closure-worker',
    '{"document":"frozen"}', '{"debits":[],"credits":[]}');

  -- A platform alert delivered to this company's rail, with its Try OPS receipt.
  insert into public.notifications(id, user_id, company_id, type, title, body, is_read, persistent)
    values (pg_temp.cx(c, 700), v_owner::text, v_company::text, 'tryops_experiment_health',
      'Experiment health', 'Closure fixture', false, false);
  insert into public.tryops_health_notifications(dedupe_key, reason, payload, delivered_at, notification_id)
    values ('closure-health-' || c, 'fixture', '{}', now(), pg_temp.cx(c, 700));
end;
$$;

select pg_temp.seed_company(1);
select pg_temp.seed_company(2);

-- Every table the closure proof inspects holds rows for both companies.
do $seed_shape$
declare
  v_company integer;
  v_id uuid;
  v_check record;
begin
  for v_company in 1..2 loop
    v_id := pg_temp.cx(v_company, 1);
    for v_check in
      select * from (values
        ('expense_accounting_settings', (select count(*) from public.expense_accounting_settings where company_id = v_id)),
        ('expense_accounting_payee_mappings', (select count(*) from public.expense_accounting_payee_mappings where company_id = v_id)),
        ('expense_accounting_category_mappings', (select count(*) from public.expense_accounting_category_mappings where company_id = v_id)),
        ('expense_accounting_project_mappings', (select count(*) from public.expense_accounting_project_mappings where company_id = v_id)),
        ('expense_accounting_tax_mappings', (select count(*) from public.expense_accounting_tax_mappings where company_id = v_id)),
        ('expense_accounting_events', (select count(*) from public.expense_accounting_events where company_id = v_id)),
        ('expense_accounting_events:review', (select count(*) from public.expense_accounting_events where company_id = v_id and kind = 'review')),
        ('expense_accounting_events:settlement', (select count(*) from public.expense_accounting_events where company_id = v_id and kind = 'settlement')),
        ('expense_accounting_postings', (select count(*) from public.expense_accounting_postings where company_id = v_id)),
        ('private.expense_accounting_state', (select count(*) from private.expense_accounting_state where company_id = v_id)),
        ('accounting_sync_queue', (select count(*) from public.accounting_sync_queue where company_id = v_id)),
        ('accounting_sync_events', (select count(*) from public.accounting_sync_events where company_id = v_id)),
        ('accounting_connections', (select count(*) from public.accounting_connections where company_id = v_id::text)),
        ('expense_project_allocations', (select count(*) from public.expense_project_allocations a join public.expenses e on e.id = a.expense_id where e.company_id = v_id)),
        ('expense_recurring_reimbursements', (select count(*) from public.expense_recurring_reimbursements where company_id = v_id)),
        ('tryops_health_notifications', (select count(*) from public.tryops_health_notifications h join public.notifications n on n.id = h.notification_id where n.company_id = v_id::text))
      ) as shape(label, row_count)
    loop
      if v_check.row_count < 1 then
        raise exception 'closure seed for company % produced no rows in %', v_company, v_check.label;
      end if;
    end loop;
    if (select count(*) from public.expense_accounting_postings where company_id = v_id) <> 2 then
      raise exception 'closure seed for company % must freeze exactly two postings', v_company;
    end if;
  end loop;
end;
$seed_shape$;

select 'closure seed ready: 2 companies' as result;
