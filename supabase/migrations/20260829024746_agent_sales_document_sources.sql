begin;

set local timezone = 'UTC';

-- Task 14 canonical sales-document source body. It advances only the closed
-- sales_documents domain for projected values, currency, and child ordering.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.agent_read_domains'),
      ('function', 'private.agent_read_domain_uuid_from_text(text)'),
      ('function', 'private.advance_agent_read_domain_revisions(uuid[],text)'),
      ('table', 'public.estimates'),
      ('table', 'public.invoices'),
      ('table', 'public.line_items'),
      ('table', 'public.payment_milestones'),
      ('table', 'public.companies')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_sales_document_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'sales_documents'
  ) then
    raise exception 'agent_sales_document_domain_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Production already carries this client-facing schedule date. Keeping the
-- ledger replay-safe closes the historical schema gap on fresh databases.
alter table public.payment_milestones
  add column if not exists expected_date date;

create index if not exists idx_estimates_agent_sales_history_v1
  on public.estimates (
    company_id,
    pg_catalog.date_bin(
      interval '1 millisecond',
      updated_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) desc,
    id
  )
  where deleted_at is null;

create index if not exists idx_invoices_agent_sales_history_v1
  on public.invoices (
    company_id,
    pg_catalog.date_bin(
      interval '1 millisecond',
      updated_at,
      timestamptz '2000-01-01 00:00:00+00'
    ) desc,
    id
  )
  where deleted_at is null;

create index if not exists idx_line_items_agent_estimate_order_v1
  on public.line_items (estimate_id, sort_order, id)
  where estimate_id is not null;

create index if not exists idx_line_items_agent_invoice_order_v1
  on public.line_items (invoice_id, sort_order, id)
  where invoice_id is not null;

create index if not exists idx_payment_milestones_agent_estimate_order_v1
  on public.payment_milestones (estimate_id, sort_order, id);

create or replace function private.bump_agent_sales_document_source_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_relevant_fields text[];
  v_relevant_change boolean := true;
  v_company_ids uuid[] := array[]::uuid[];
  v_old_company_id uuid;
  v_new_company_id uuid;
  v_parent_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'companies',
       'estimates',
       'invoices',
       'line_items',
       'payment_milestones'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_sales_document_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
  end if;

  v_relevant_fields := case tg_table_name
    when 'companies' then array[
      'id', 'currency_code', 'deleted_at'
    ]
    when 'estimates' then array[
      'id', 'company_id', 'opportunity_id', 'project_id', 'project_ref',
      'client_id', 'client_ref', 'estimate_number', 'title',
      'client_message', 'terms', 'status', 'issue_date', 'expiration_date',
      'total', 'updated_at', 'deleted_at'
    ]
    when 'invoices' then array[
      'id', 'company_id', 'opportunity_id', 'project_id', 'project_ref',
      'client_id', 'client_ref', 'invoice_number', 'subject',
      'client_message', 'terms', 'footer', 'status', 'issue_date',
      'due_date', 'paid_at', 'total', 'amount_paid', 'balance_due',
      'updated_at', 'deleted_at'
    ]
    when 'line_items' then array[
      'id', 'company_id', 'estimate_id', 'invoice_id', 'name',
      'description', 'quantity', 'unit', 'unit_price', 'discount_percent',
      'line_total', 'is_taxable', 'is_optional', 'is_selected', 'sort_order'
    ]
    else array[
      'id', 'estimate_id', 'name', 'type', 'value', 'amount',
      'sort_order', 'invoice_id', 'paid_at', 'expected_date'
    ]
  end;

  if tg_op = 'UPDATE' then
    select coalesce(pg_catalog.bool_or(
             v_old_row -> field.value is distinct from
               v_new_row -> field.value
           ), false)
      into v_relevant_change
    from pg_catalog.unnest(v_relevant_fields) field(value);
  end if;

  if not v_relevant_change then
    return null;
  end if;

  if tg_table_name = 'companies' then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'id'
    );
    v_company_ids := array[v_old_company_id, v_new_company_id];
  elsif tg_table_name in ('estimates', 'invoices', 'line_items') then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'company_id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'company_id'
    );
    v_company_ids := array[v_old_company_id, v_new_company_id];

    if tg_table_name = 'line_items' then
      for v_parent_company_id in
        select distinct parent_company_id
        from (
          select estimate.company_id as parent_company_id
          from public.estimates estimate
          where estimate.id in (
            private.agent_read_domain_uuid_from_text(
              v_old_row ->> 'estimate_id'
            ),
            private.agent_read_domain_uuid_from_text(
              v_new_row ->> 'estimate_id'
            )
          )
          union all
          select invoice.company_id
          from public.invoices invoice
          where invoice.id in (
            private.agent_read_domain_uuid_from_text(
              v_old_row ->> 'invoice_id'
            ),
            private.agent_read_domain_uuid_from_text(
              v_new_row ->> 'invoice_id'
            )
          )
        ) parent
        where parent.parent_company_id is not null
      loop
        v_company_ids := pg_catalog.array_append(
          v_company_ids,
          v_parent_company_id
        );
      end loop;
    end if;
  else
    for v_parent_company_id in
      select distinct estimate.company_id
      from public.estimates estimate
      where estimate.id in (
        private.agent_read_domain_uuid_from_text(
          v_old_row ->> 'estimate_id'
        ),
        private.agent_read_domain_uuid_from_text(
          v_new_row ->> 'estimate_id'
        )
      )
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids,
        v_parent_company_id
      );
    end loop;
  end if;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'sales_documents'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_sales_document_source_revision()
  from public, anon, authenticated, service_role;

alter function private.bump_agent_sales_document_source_revision()
  owner to current_user;

do $canonical_acl$
declare
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_sales_document_source_revision()'
  )::oid;
  select function_row.proowner
    into v_function_owner
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_function_oid;

  for v_acl in
    select distinct acl.grantee,
           case when acl.grantee = 0 then 'public'
             else role_row.rolname end as role_name
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    left join pg_catalog.pg_roles role_row on role_row.oid = acl.grantee
    where function_row.oid = v_function_oid
      and acl.grantee <> v_function_owner
  loop
    if v_acl.role_name is null then
      raise exception 'agent_sales_document_source_acl_role_missing'
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_sales_document_source_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name)
      end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists estimates_bump_agent_sales_document_revision
  on public.estimates;
create trigger estimates_bump_agent_sales_document_revision
after insert or update or delete on public.estimates
for each row execute function
  private.bump_agent_sales_document_source_revision();

drop trigger if exists invoices_bump_agent_sales_document_revision
  on public.invoices;
create trigger invoices_bump_agent_sales_document_revision
after insert or update or delete on public.invoices
for each row execute function
  private.bump_agent_sales_document_source_revision();

drop trigger if exists line_items_bump_agent_sales_document_revision
  on public.line_items;
create trigger line_items_bump_agent_sales_document_revision
after insert or update or delete on public.line_items
for each row execute function
  private.bump_agent_sales_document_source_revision();

drop trigger if exists payment_milestones_bump_agent_sales_document_revision
  on public.payment_milestones;
create trigger payment_milestones_bump_agent_sales_document_revision
after insert or update or delete on public.payment_milestones
for each row execute function
  private.bump_agent_sales_document_source_revision();

drop trigger if exists companies_bump_agent_sales_document_revision
  on public.companies;
create trigger companies_bump_agent_sales_document_revision
after insert or update or delete on public.companies
for each row execute function
  private.bump_agent_sales_document_source_revision();

do $postflight$
declare
  v_name text;
  v_trigger record;
begin
  if pg_catalog.to_regprocedure(
    'private.bump_agent_sales_document_source_revision()'
  ) is null then
    raise exception 'agent_sales_document_source_function_missing'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) acl
    where function_row.oid = pg_catalog.to_regprocedure(
      'private.bump_agent_sales_document_source_revision()'
    )::oid
      and acl.grantee <> function_row.proowner
  ) then
    raise exception 'agent_sales_document_source_acl_invalid'
      using errcode = '55000';
  end if;

  foreach v_name in array array[
    'idx_estimates_agent_sales_history_v1',
    'idx_invoices_agent_sales_history_v1',
    'idx_line_items_agent_estimate_order_v1',
    'idx_line_items_agent_invoice_order_v1',
    'idx_payment_milestones_agent_estimate_order_v1'
  ]::text[]
  loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception 'agent_sales_document_index_missing: %', v_name
        using errcode = '55000';
    end if;
  end loop;

  foreach v_name in array array[
    'estimates_bump_agent_sales_document_revision',
    'invoices_bump_agent_sales_document_revision',
    'line_items_bump_agent_sales_document_revision',
    'payment_milestones_bump_agent_sales_document_revision',
    'companies_bump_agent_sales_document_revision'
  ]::text[]
  loop
    select trigger_row.tgenabled,
           trigger_row.tgisinternal,
           procedure.proname,
           pg_catalog.encode(trigger_row.tgargs, 'hex') as trigger_args
      into v_trigger
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc procedure
      on procedure.oid = trigger_row.tgfoid
    where trigger_row.tgname = v_name;

    if not found
       or v_trigger.tgenabled is distinct from 'O'
       or v_trigger.tgisinternal
       or v_trigger.proname is distinct from
            'bump_agent_sales_document_source_revision'
       or v_trigger.trigger_args is distinct from '' then
      raise exception 'agent_sales_document_trigger_invalid: %', v_name
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
