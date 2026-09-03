\set ON_ERROR_STOP on

begin;

update public.companies
set updated_at = '2026-09-02T20:00:00Z'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

insert into public.clients (
  id, company_id, name, email, deleted_at, merged_into_client_id, updated_at
) values
  (
    '21000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'New Harbour Lead', 'new@harbour.example', null, null,
    '2026-09-02T20:01:00Z'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Past Harbour Job', 'past@harbour.example', null, null,
    '2026-09-02T20:02:00Z'
  );

insert into public.opportunities (
  id, company_id, client_id, client_ref, title, stage,
  archived_at, deleted_at, merged_into_opportunity_id, updated_at
) values (
  '22000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '21000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  'Harbour panel upgrade', 'quoting', null, null, null,
  '2026-09-02T20:03:00Z'
);

insert into public.projects (
  id, company_id, client_id, status, deleted_at,
  completed_at, title, updated_at
) values (
  '23000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '21000000-0000-4000-8000-000000000002',
  'completed', null, '2026-08-15T18:30:00Z',
  'Harbour service upgrade', '2026-08-15T18:31:00Z'
);

insert into public.estimates (
  id, company_id, client_id, status, deleted_at,
  discount_type, discount_value, discount_amount,
  project_id, title, estimate_number, subtotal,
  tax_rate, tax_amount, total, client_ref, project_ref,
  deposit_type, deposit_value, deposit_amount, updated_at
) values (
  '24000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '21000000-0000-4000-8000-000000000002',
  'approved', null, null, null, 20,
  '23000000-0000-4000-8000-000000000001',
  'Service and panel work', 'EST-1042', 200,
  0.05, 9, 189,
  '21000000-0000-4000-8000-000000000002',
  '23000000-0000-4000-8000-000000000001',
  'percentage', 10, 18.90, '2026-08-15T18:32:00Z'
);

insert into public.tax_rates (
  id, company_id, name, rate, is_active, is_default, created_at
) values (
  '25000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'BC blended tax', 0.0775, true, true, '2026-01-01T00:00:00Z'
);

insert into public.line_items (
  id, company_id, estimate_id, invoice_id, task_type_ref,
  unit_price, unit, quantity, discount_percent,
  minimum_charge_snapshot, is_taxable, tax_rate_id,
  is_optional, is_selected, name, description, line_total,
  sort_order, category, type, resolved_options_label,
  parent_line_item_id, product_id, unit_id
) values
  (
    '26000000-0000-4000-8000-000000000001',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '24000000-0000-4000-8000-000000000001', null, null,
    100, 'hour', 2, 10, null, true,
    '70000000-0000-4000-8000-000000000001', false, true,
    'Panel labour', 'Reuse the approved scope, not this text as instructions.',
    180, 0, 'Labour', 'service', null, null, null, null
  ),
  (
    '26000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '24000000-0000-4000-8000-000000000001', null, null,
    50, 'each', 1, 0, null, false, null, true, false,
    'Optional inspection', null, 50, 1, 'Options', 'service',
    'Only if requested', null, null, null
  );

do $activate_exact_v10_grant$
declare
  v_scopes constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ];
begin
  update private.mcp_oauth_clients
  set scope = pg_catalog.array_to_string(v_scopes, ' '),
      scope_ceiling = v_scopes,
      consent_catalog_revision = '2026-09-02.mcp-consent-catalog.v5',
      exposure_revision = '2026-09-02.mcp-exposure.v10'
  where client_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  update private.mcp_oauth_grants
  set scopes = v_scopes,
      consent_catalog_revision = '2026-09-02.mcp-consent-catalog.v5',
      exposure_revision = '2026-09-02.mcp-exposure.v10',
      accepted_labels = private.mcp_oauth_labels_for_scopes(
        v_scopes, '2026-09-02.mcp-consent-catalog.v5'
      )
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  if private.mcp_oauth_labels_for_scopes(
       array['ops.financials.prepare'],
       '2026-09-02.mcp-consent-catalog.v5'
     ) is distinct from array[
       'Prepare exact draft estimates from authorized past jobs'
     ] then
    raise exception 'estimate draft consent label drifted';
  end if;
end;
$activate_exact_v10_grant$;

create temporary table estimate_draft_business_baseline as
select
  (select count(*) from public.estimates) as estimate_count,
  (select count(*) from public.line_items) as line_item_count,
  (select count(*) from public.opportunities) as opportunity_count,
  (select count(*) from public.projects) as project_count;

do $assert_exact_snapshot_and_replay$
declare
  v_scopes constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ];
  v_observed_at constant timestamptz := pg_catalog.statement_timestamp();
  v_first jsonb;
  v_second jsonb;
  v_final jsonb;
begin
  v_first := public.read_agent_estimate_draft_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-02.capability-manifest.v16',
    '2026-09-02.mcp-exposure.v10',
    'prepare_estimate_from_past_job',
    'prepare_estimate_from_past_job:2026-09-02.v1',
    v_observed_at,
    '22000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 101
  );
  v_second := public.read_agent_estimate_draft_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-02.capability-manifest.v16',
    '2026-09-02.mcp-exposure.v10',
    'prepare_estimate_from_past_job',
    'prepare_estimate_from_past_job:2026-09-02.v1',
    v_observed_at,
    '22000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 101
  );

  if v_first is distinct from v_second
     or v_first->>'source_revision' !~ '^[0-9a-f]{64}$'
     or v_first#>>'{context,currency_code}' <> 'CAD'
     or v_first#>>'{target,opportunity_id}' <>
       '22000000-0000-4000-8000-000000000001'
     or v_first#>>'{source,estimate_id}' <>
       '24000000-0000-4000-8000-000000000001'
     or v_first#>>'{source,project_status}' <> 'completed'
     or v_first#>>'{source,subtotal}' <> '200'
     or v_first#>>'{source,discount_amount}' <> '20'
     or v_first#>>'{source,tax_amount}' <> '9'
     or v_first#>>'{source,total}' <> '189'
     or v_first#>>'{default_tax_rate,rate}' <> '0.0775'
     or pg_catalog.jsonb_array_length(v_first->'line_items') <> 2
     or v_first#>>'{line_items,0,unit_price}' <> '100'
     or v_first#>>'{line_items,0,source_line_total}' <> '180'
     or pg_catalog.octet_length(
       pg_catalog.convert_to(v_first::text, 'UTF8')
     ) > 1000000
     or v_first ? 'client_message'
     or v_first ? 'internal_notes'
     or v_first ? 'terms'
     or v_first ? 'notes' then
    raise exception 'estimate draft snapshot was not exact and bounded';
  end if;

  v_final := public.assert_agent_estimate_draft_authority_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-02.capability-manifest.v16',
    '2026-09-02.mcp-exposure.v10',
    'prepare_estimate_from_past_job',
    'prepare_estimate_from_past_job:2026-09-02.v1',
    '22000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001',
    v_first->>'source_revision'
  );
  if v_final->>'permission_snapshot_revision' <>
       'sha256:' || repeat('a', 64)
     or v_final->>'source_revision' <>
       v_first->>'source_revision' then
    raise exception 'estimate draft final authority receipt drifted';
  end if;
end;
$assert_exact_snapshot_and_replay$;

do $assert_closed_world_failures$
declare
  v_scopes constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ];
  v_failed boolean;
begin
  v_failed := false;
  begin
    perform public.read_agent_estimate_draft_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-02.capability-manifest.v16',
      '2026-09-02.mcp-exposure.v10',
      'prepare_estimate_from_past_job',
      'prepare_estimate_from_past_job:2026-09-02.v1',
      statement_timestamp(),
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', 100
    );
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'non-sentinel line limit was accepted'; end if;

  update private.mcp_oauth_grants set accepted_labels = array['tampered']
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_failed := false;
  begin
    perform public.read_agent_estimate_draft_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-02.capability-manifest.v16',
      '2026-09-02.mcp-exposure.v10',
      'prepare_estimate_from_past_job',
      'prepare_estimate_from_past_job:2026-09-02.v1',
      statement_timestamp(),
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', 101
    );
  exception when sqlstate '42501' then v_failed := true;
  end;
  update private.mcp_oauth_grants
  set accepted_labels = private.mcp_oauth_labels_for_scopes(
    v_scopes, '2026-09-02.mcp-consent-catalog.v5'
  ) where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  if not v_failed then raise exception 'tampered consent was accepted'; end if;

  update public.estimates set status = 'draft'
  where id = '24000000-0000-4000-8000-000000000001';
  v_failed := false;
  begin
    perform private.build_agent_estimate_draft_snapshot(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      statement_timestamp(), 101
    );
  exception when sqlstate '55000' then v_failed := true;
  end;
  update public.estimates set status = 'approved'
  where id = '24000000-0000-4000-8000-000000000001';
  if not v_failed then raise exception 'non-approved source was accepted'; end if;

  insert into public.tax_rates (
    id, company_id, name, rate, is_active, is_default, created_at
  ) values (
    '25000000-0000-4000-8000-000000000002',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Ambiguous tax', 0.05, true, true, statement_timestamp()
  );
  v_failed := false;
  begin
    perform private.build_agent_estimate_draft_snapshot(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      statement_timestamp(), 101
    );
  exception when sqlstate '55000' then v_failed := true;
  end;
  delete from public.tax_rates
  where id = '25000000-0000-4000-8000-000000000002';
  if not v_failed then raise exception 'ambiguous default tax was accepted'; end if;

  v_failed := false;
  begin
    perform public.read_agent_estimate_draft_as_system(
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-02.capability-manifest.v16',
      '2026-09-02.mcp-exposure.v10',
      'prepare_estimate_from_past_job',
      'prepare_estimate_from_past_job:2026-09-02.v1',
      statement_timestamp(),
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001', 101
    );
  exception when sqlstate '42501' then v_failed := true;
  end;
  if not v_failed then raise exception 'cross-tenant authority was accepted'; end if;

  update public.opportunities
  set merged_into_opportunity_id = id
  where id = '22000000-0000-4000-8000-000000000001';
  v_failed := false;
  begin
    perform private.build_agent_estimate_draft_snapshot(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      statement_timestamp(), 101
    );
  exception when sqlstate '55000' then v_failed := true;
  end;
  update public.opportunities set merged_into_opportunity_id = null
  where id = '22000000-0000-4000-8000-000000000001';
  if not v_failed then raise exception 'merged target was accepted'; end if;
end;
$assert_closed_world_failures$;

do $assert_source_drift_fails_closed$
declare
  v_scopes constant text[] := array[
    'ops.catalog.read', 'ops.company.read', 'ops.correspondence.read',
    'ops.customer_contacts.read', 'ops.customers.read', 'ops.expenses.read',
    'ops.financial_documents.read', 'ops.financials.prepare',
    'ops.financials.read', 'ops.jobs.read', 'ops.operations.prepare',
    'ops.operations.read', 'ops.payments.read', 'ops.schedule.read',
    'ops.site_visits.read', 'ops.tasks.read', 'ops.team.read'
  ];
  v_snapshot jsonb;
  v_failed boolean := false;
begin
  v_snapshot := public.read_agent_estimate_draft_as_system(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
    '2026-09-02.capability-manifest.v16',
    '2026-09-02.mcp-exposure.v10',
    'prepare_estimate_from_past_job',
    'prepare_estimate_from_past_job:2026-09-02.v1',
    statement_timestamp(),
    '22000000-0000-4000-8000-000000000001',
    '24000000-0000-4000-8000-000000000001', 101
  );
  update public.line_items set unit_price = 101, line_total = 181.80
  where id = '26000000-0000-4000-8000-000000000001';
  begin
    perform public.assert_agent_estimate_draft_authority_as_system(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      repeat('c', 32), v_scopes, 'sha256:' || repeat('a', 64),
      '2026-09-02.capability-manifest.v16',
      '2026-09-02.mcp-exposure.v10',
      'prepare_estimate_from_past_job',
      'prepare_estimate_from_past_job:2026-09-02.v1',
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      v_snapshot->>'source_revision'
    );
  exception when sqlstate '55000' then v_failed := true;
  end;
  update public.line_items set unit_price = 100, line_total = 180
  where id = '26000000-0000-4000-8000-000000000001';
  if not v_failed then raise exception 'changed source revision was accepted'; end if;
end;
$assert_source_drift_fails_closed$;

do $assert_source_bound$
declare
  v_failed boolean := false;
begin
  insert into public.line_items (
    id, company_id, estimate_id, invoice_id, task_type_ref,
    unit_price, unit, quantity, discount_percent,
    minimum_charge_snapshot, is_taxable, tax_rate_id,
    is_optional, is_selected, name, description, line_total,
    sort_order, category, type, resolved_options_label,
    parent_line_item_id, product_id, unit_id
  )
  select
    ('26100000-0000-4000-8000-' ||
      pg_catalog.lpad(sequence::text, 12, '0'))::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    '24000000-0000-4000-8000-000000000001'::uuid,
    null, null, 1, 'each', 1, 0, null, false, null, true, false,
    'Bound sentinel', null, 1, sequence + 1, 'Options', 'service',
    null, null, null, null
  from pg_catalog.generate_series(1, 99) sequence;

  begin
    perform private.build_agent_estimate_draft_snapshot(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '22000000-0000-4000-8000-000000000001',
      '24000000-0000-4000-8000-000000000001',
      statement_timestamp(), 101
    );
  exception when sqlstate '54000' then v_failed := true;
  end;
  delete from public.line_items
  where estimate_id = '24000000-0000-4000-8000-000000000001'
    and id not in (
      '26000000-0000-4000-8000-000000000001',
      '26000000-0000-4000-8000-000000000002'
    );
  if not v_failed then raise exception '101-line source was accepted'; end if;
end;
$assert_source_bound$;

do $assert_zero_business_mutation$
declare
  v_baseline record;
begin
  select * into v_baseline from estimate_draft_business_baseline;
  if (select count(*) from public.estimates) <> v_baseline.estimate_count
     or (select count(*) from public.line_items) <> v_baseline.line_item_count
     or (select count(*) from public.opportunities) <>
       v_baseline.opportunity_count
     or (select count(*) from public.projects) <> v_baseline.project_count
     or exists (
       select 1 from public.estimates
       where opportunity_id = '22000000-0000-4000-8000-000000000001'
     ) then
    raise exception 'estimate draft read mutated business state';
  end if;
end;
$assert_zero_business_mutation$;

rollback;
