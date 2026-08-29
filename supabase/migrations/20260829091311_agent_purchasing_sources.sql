begin;

set local timezone = 'UTC';

-- Task 19 canonical purchase-order source body. The purchasing revision owns
-- order rows, line facts, and the safe catalogue labels projected on lines.
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
      ('table', 'public.catalog_orders'),
      ('table', 'public.catalog_order_items'),
      ('table', 'public.catalog_variants'),
      ('table', 'public.catalog_items'),
      ('table', 'public.catalog_units'),
      ('table', 'public.catalog_options'),
      ('table', 'public.catalog_option_values'),
      ('table', 'public.catalog_variant_option_values')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_purchasing_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
  if not exists (
    select 1 from private.agent_read_domains where domain = 'purchasing'
  ) then
    raise exception 'agent_purchasing_domain_missing' using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_catalog_orders_agent_delivery_v1
  on public.catalog_orders (
    company_id,
    (coalesce(expected_delivery_date, '9999-12-31'::date)),
    updated_at desc,
    id
  ) include (status, supplier_name)
  where deleted_at is null;

create index if not exists idx_catalog_order_items_agent_order_id_v1
  on public.catalog_order_items (order_id, id);

create or replace function private.bump_agent_purchasing_source_revision()
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
  v_company_id uuid;
begin
  if tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_nargs is distinct from 0
     or tg_table_schema is distinct from 'public'
     or tg_table_name not in (
       'catalog_orders',
       'catalog_order_items',
       'catalog_variants',
       'catalog_items',
       'catalog_units',
       'catalog_options',
       'catalog_option_values',
       'catalog_variant_option_values'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_purchasing_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := pg_catalog.to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := pg_catalog.to_jsonb(new);
  end if;

  v_relevant_fields := case tg_table_name
    when 'catalog_orders' then array[
      'id', 'company_id', 'status', 'title', 'supplier_name',
      'expected_delivery_date', 'created_at', 'updated_at', 'sent_at',
      'fulfilled_at', 'cancelled_at', 'deleted_at'
    ]
    when 'catalog_order_items' then array[
      'id', 'order_id', 'catalog_variant_id', 'quantity_requested',
      'cost_per_unit'
    ]
    when 'catalog_variants' then array[
      'id', 'company_id', 'catalog_item_id', 'sku', 'unit_id', 'deleted_at'
    ]
    when 'catalog_items' then array[
      'id', 'company_id', 'name', 'default_unit_id', 'deleted_at'
    ]
    when 'catalog_units' then array[
      'id', 'company_id', 'display', 'abbreviation', 'deleted_at'
    ]
    when 'catalog_options' then array[
      'id', 'catalog_item_id', 'sort_order', 'deleted_at'
    ]
    when 'catalog_option_values' then array[
      'id', 'option_id', 'value', 'sort_order', 'deleted_at'
    ]
    else array['id', 'variant_id', 'option_value_id', 'deleted_at']
  end;

  if tg_op = 'UPDATE' then
    select coalesce(
             pg_catalog.bool_or(
               v_old_row -> field.value is distinct from
                 v_new_row -> field.value
             ),
             false
           )
      into v_relevant_change
    from pg_catalog.unnest(v_relevant_fields) field(value);
  end if;
  if not v_relevant_change then
    return null;
  end if;

  if tg_table_name in (
    'catalog_orders', 'catalog_variants', 'catalog_items', 'catalog_units'
  ) then
    v_company_ids := array[
      private.agent_read_domain_uuid_from_text(v_old_row ->> 'company_id'),
      private.agent_read_domain_uuid_from_text(v_new_row ->> 'company_id')
    ];
  elsif tg_table_name = 'catalog_order_items' then
    for v_company_id in
      select distinct purchase_order.company_id
      from public.catalog_orders purchase_order
      where purchase_order.id in (
        private.agent_read_domain_uuid_from_text(v_old_row ->> 'order_id'),
        private.agent_read_domain_uuid_from_text(v_new_row ->> 'order_id')
      )
    loop
      v_company_ids := pg_catalog.array_append(v_company_ids, v_company_id);
    end loop;
  elsif tg_table_name = 'catalog_options' then
    for v_company_id in
      select distinct item.company_id
      from public.catalog_items item
      where item.id in (
        private.agent_read_domain_uuid_from_text(
          v_old_row ->> 'catalog_item_id'
        ),
        private.agent_read_domain_uuid_from_text(
          v_new_row ->> 'catalog_item_id'
        )
      )
    loop
      v_company_ids := pg_catalog.array_append(v_company_ids, v_company_id);
    end loop;
  elsif tg_table_name = 'catalog_option_values' then
    for v_company_id in
      select distinct item.company_id
      from public.catalog_options option_row
      join public.catalog_items item on item.id = option_row.catalog_item_id
      where option_row.id in (
        private.agent_read_domain_uuid_from_text(v_old_row ->> 'option_id'),
        private.agent_read_domain_uuid_from_text(v_new_row ->> 'option_id')
      )
    loop
      v_company_ids := pg_catalog.array_append(v_company_ids, v_company_id);
    end loop;
  else
    for v_company_id in
      select distinct parent.company_id
      from (
        select variant.company_id
        from public.catalog_variants variant
        where variant.id in (
          private.agent_read_domain_uuid_from_text(v_old_row ->> 'variant_id'),
          private.agent_read_domain_uuid_from_text(v_new_row ->> 'variant_id')
        )
        union all
        select item.company_id
        from public.catalog_option_values value_row
        join public.catalog_options option_row on option_row.id = value_row.option_id
        join public.catalog_items item on item.id = option_row.catalog_item_id
        where value_row.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'option_value_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'option_value_id'
          )
        )
      ) parent
    loop
      v_company_ids := pg_catalog.array_append(v_company_ids, v_company_id);
    end loop;
  end if;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'purchasing'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_purchasing_source_revision()
  from public, anon, authenticated, service_role;
alter function private.bump_agent_purchasing_source_revision()
  owner to current_user;

do $canonical_acl$
declare
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_purchasing_source_revision()'
  )::oid;
  select function_row.proowner into v_function_owner
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
      raise exception 'agent_purchasing_source_acl_role_missing'
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_purchasing_source_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name) end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists catalog_orders_bump_agent_purchasing_revision
  on public.catalog_orders;
create trigger catalog_orders_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_orders
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_order_items_bump_agent_purchasing_revision
  on public.catalog_order_items;
create trigger catalog_order_items_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_order_items
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_variants_bump_agent_purchasing_revision
  on public.catalog_variants;
create trigger catalog_variants_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_variants
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_items_bump_agent_purchasing_revision
  on public.catalog_items;
create trigger catalog_items_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_items
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_units_bump_agent_purchasing_revision
  on public.catalog_units;
create trigger catalog_units_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_units
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_options_bump_agent_purchasing_revision
  on public.catalog_options;
create trigger catalog_options_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_options
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_option_values_bump_agent_purchasing_revision
  on public.catalog_option_values;
create trigger catalog_option_values_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_option_values
for each row execute function private.bump_agent_purchasing_source_revision();

drop trigger if exists catalog_variant_option_values_bump_agent_purchasing_revision
  on public.catalog_variant_option_values;
create trigger catalog_variant_option_values_bump_agent_purchasing_revision
after insert or update or delete on public.catalog_variant_option_values
for each row execute function private.bump_agent_purchasing_source_revision();

do $postflight$
declare
  v_table text;
begin
  foreach v_table in array array[
    'catalog_orders', 'catalog_order_items', 'catalog_variants',
    'catalog_items', 'catalog_units', 'catalog_options',
    'catalog_option_values', 'catalog_variant_option_values'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace schema_row on schema_row.oid = table_row.relnamespace
      where schema_row.nspname = 'public'
        and table_row.relname = v_table
        and trigger_row.tgname =
          v_table || '_bump_agent_purchasing_revision'
        and not trigger_row.tgisinternal
    ) then
      raise exception 'agent_purchasing_source_trigger_missing: %', v_table
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
