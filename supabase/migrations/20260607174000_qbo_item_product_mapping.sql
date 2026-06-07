begin;

-- ============================================================================
-- QuickBooks ItemRef to OPS product mapping
--
-- QBO-first companies will continue creating estimates in QuickBooks during
-- adoption. QBO sales lines carry ItemRef.value, so OPS needs a durable mapping
-- from that QBO Item ID to an OPS product before accepted estimates become
-- projects/tasks. This migration preserves ItemRef identity in staging, stores
-- the mapping, and upgrades the locked replacement RPC so mapped lines carry
-- product/task/unit metadata into public.line_items.
-- ============================================================================

alter table public.qbo_import_runs
  add column if not exists connection_id uuid references public.accounting_connections(id) on delete set null;

alter table public.qbo_staging_line_items
  add column if not exists qb_item_id text,
  add column if not exists qb_item_name text;

create table if not exists public.qbo_item_product_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid references public.accounting_connections(id) on delete cascade,
  qb_item_id text not null,
  qb_item_name text,
  qb_item_type text,
  product_id uuid not null references public.products(id) on delete restrict,
  match_source text not null default 'manual'
    check (match_source in ('manual', 'imported', 'name_suggested', 'system')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists qbo_item_product_mappings_active_key
  on public.qbo_item_product_mappings (
    company_id,
    coalesce(connection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    qb_item_id
  )
  where deleted_at is null;

create index if not exists idx_qbo_item_product_mappings_company_connection
  on public.qbo_item_product_mappings (company_id, connection_id)
  where deleted_at is null;

create index if not exists idx_qbo_item_product_mappings_product
  on public.qbo_item_product_mappings (product_id)
  where deleted_at is null;

alter table public.qbo_item_product_mappings enable row level security;
revoke all on table public.qbo_item_product_mappings from anon, authenticated;
grant select on table public.qbo_item_product_mappings to authenticated;
grant all on table public.qbo_item_product_mappings to service_role;

drop policy if exists "read company qbo_item_product_mappings with accounting view"
  on public.qbo_item_product_mappings;
create policy "read company qbo_item_product_mappings with accounting view"
on public.qbo_item_product_mappings for select
using (
  company_id = (select private.get_user_company_id())
  and public.has_permission((select private.get_current_user_id()), 'accounting.view', 'all')
);

create or replace function public.replace_qbo_line_items_locked(
  p_company_id uuid,
  p_invoice_id uuid default null,
  p_estimate_id uuid default null,
  p_lines jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_parent_type text;
  v_parent_id uuid;
begin
  if p_company_id is null then
    raise exception 'replace_qbo_line_items_locked: company_id is required';
  end if;

  if (p_invoice_id is null and p_estimate_id is null)
     or (p_invoice_id is not null and p_estimate_id is not null) then
    raise exception 'replace_qbo_line_items_locked: exactly one parent is required';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'replace_qbo_line_items_locked: p_lines must be a json array';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as line(product_id uuid)
    where line.product_id is not null
      and not exists (
        select 1
        from public.products p
        where p.id = line.product_id
          and p.company_id = p_company_id
          and p.deleted_at is null
      )
  ) then
    raise exception 'replace_qbo_line_items_locked: mapped product is not active for company';
  end if;

  if p_invoice_id is not null then
    v_parent_type := 'invoice';
    v_parent_id := p_invoice_id;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(':', 'qbo-line-items', p_company_id::text, v_parent_type, v_parent_id::text),
        0
      )
    );

    perform 1
    from public.invoices
    where company_id = p_company_id
      and id = p_invoice_id
    for update;

    if not found then
      raise exception 'replace_qbo_line_items_locked: invoice parent not found';
    end if;

    delete from public.line_items
    where company_id = p_company_id
      and invoice_id = p_invoice_id;
  else
    v_parent_type := 'estimate';
    v_parent_id := p_estimate_id;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(':', 'qbo-line-items', p_company_id::text, v_parent_type, v_parent_id::text),
        0
      )
    );

    perform 1
    from public.estimates
    where company_id = p_company_id
      and id = p_estimate_id
    for update;

    if not found then
      raise exception 'replace_qbo_line_items_locked: estimate parent not found';
    end if;

    delete from public.line_items
    where company_id = p_company_id
      and estimate_id = p_estimate_id;
  end if;

  insert into public.line_items (
    company_id,
    estimate_id,
    invoice_id,
    product_id,
    task_type_ref,
    task_type_id,
    name,
    description,
    quantity,
    unit,
    unit_id,
    unit_price,
    is_taxable,
    sort_order,
    type,
    configured_options,
    resolved_unit_price,
    resolved_options_label
  )
  select
    p_company_id,
    case when v_parent_type = 'estimate' then v_parent_id else null end,
    case when v_parent_type = 'invoice' then v_parent_id else null end,
    line.product_id,
    line.task_type_ref,
    nullif(line.task_type_id, ''),
    coalesce(nullif(line.name, ''), 'Line item'),
    nullif(line.description, ''),
    coalesce(line.quantity, 1),
    nullif(line.unit, ''),
    line.unit_id,
    coalesce(line.unit_price, 0),
    coalesce(line.is_taxable, false),
    coalesce(line.sort_order, 0),
    coalesce(nullif(line.type, ''), 'OTHER'),
    line.configured_options,
    line.resolved_unit_price,
    nullif(line.resolved_options_label, '')
  from jsonb_to_recordset(p_lines) as line(
    name text,
    description text,
    quantity numeric,
    unit_price numeric,
    is_taxable boolean,
    sort_order integer,
    type text,
    product_id uuid,
    task_type_ref uuid,
    task_type_id text,
    unit text,
    unit_id uuid,
    configured_options jsonb,
    resolved_unit_price numeric,
    resolved_options_label text
  );
end;
$$;

revoke all on function public.replace_qbo_line_items_locked(
  uuid,
  uuid,
  uuid,
  jsonb
) from public, anon, authenticated;

grant execute on function public.replace_qbo_line_items_locked(
  uuid,
  uuid,
  uuid,
  jsonb
) to service_role;

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.replace_qbo_line_items_locked(uuid, uuid, uuid, jsonb)'::regprocedure
  )
  into v_def;

  if v_def is null
     or position('pg_advisory_xact_lock' in v_def) = 0
     or position('hashtextextended' in v_def) = 0
     or position('for update' in lower(v_def)) = 0
     or position('line_total' in v_def) > 0
     or position('product_id uuid' in v_def) = 0
     or position('task_type_ref uuid' in v_def) = 0
     or position('unit_id uuid' in v_def) = 0 then
    raise exception 'qbo_item_product_mapping_sentinel: function body is unsafe';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qbo_staging_line_items'
      and column_name = 'qb_item_id'
  ) then
    raise exception 'qbo_item_product_mapping_sentinel: staged line ItemRef identity missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'qbo_item_product_mappings'
  ) then
    raise exception 'qbo_item_product_mapping_sentinel: mapping table missing';
  end if;
end $$;

commit;
