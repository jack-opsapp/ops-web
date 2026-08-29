begin;

set local timezone = 'UTC';

-- Task 18 canonical catalogue source body. It advances only the closed
-- catalogue domain for values that can change an approved public projection.
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
      ('table', 'public.companies'),
      ('table', 'public.catalog_categories'),
      ('table', 'public.catalog_items'),
      ('table', 'public.catalog_variants'),
      ('table', 'public.catalog_options'),
      ('table', 'public.catalog_option_values'),
      ('table', 'public.catalog_variant_option_values'),
      ('table', 'public.catalog_tags'),
      ('table', 'public.catalog_item_tags'),
      ('table', 'public.catalog_units'),
      ('table', 'public.catalog_stock_units'),
      ('table', 'public.catalog_supplier_cost_profiles'),
      ('table', 'public.products'),
      ('table', 'public.product_materials')
  ) required(object_kind, object_name)
  where case required.object_kind
    when 'function' then pg_catalog.to_regprocedure(required.object_name) is null
    else pg_catalog.to_regclass(required.object_name) is null
  end;

  if v_missing is not null then
    raise exception 'agent_catalog_sources_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = 'catalog'
  ) then
    raise exception 'agent_catalog_domain_missing'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create index if not exists idx_catalog_items_agent_normalized_name_v1
  on public.catalog_items (
    company_id,
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(name), '[[:space:]]+', ' ', 'g'
      )
    ),
    id
  )
  where deleted_at is null;

create index if not exists idx_catalog_tags_agent_normalized_name_v1
  on public.catalog_tags (
    company_id,
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(name), '[[:space:]]+', ' ', 'g'
      )
    ),
    id
  )
  where deleted_at is null;

create index if not exists idx_catalog_supplier_cost_profiles_agent_current_v1
  on public.catalog_supplier_cost_profiles (
    company_id,
    catalog_variant_id,
    is_default desc,
    updated_at desc,
    id
  )
  where deleted_at is null;

create or replace function private.bump_agent_catalog_source_revision()
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
       'catalog_categories',
       'catalog_items',
       'catalog_variants',
       'catalog_options',
       'catalog_option_values',
       'catalog_variant_option_values',
       'catalog_tags',
       'catalog_item_tags',
       'catalog_units',
       'catalog_stock_units',
       'catalog_supplier_cost_profiles',
       'products',
       'product_materials'
     )
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_catalog_revision_trigger_misconfigured'
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
    when 'catalog_categories' then array[
      'id', 'company_id', 'name', 'default_critical_threshold',
      'default_warning_threshold', 'deleted_at'
    ]
    when 'catalog_items' then array[
      'id', 'company_id', 'category_id', 'name', 'description',
      'default_price', 'default_critical_threshold',
      'default_warning_threshold', 'default_unit_id', 'image_url',
      'is_active', 'updated_at', 'deleted_at'
    ]
    when 'catalog_variants' then array[
      'id', 'company_id', 'catalog_item_id', 'price_override', 'quantity',
      'sku', 'unit_id', 'warning_threshold', 'critical_threshold',
      'is_active', 'updated_at', 'deleted_at'
    ]
    when 'catalog_options' then array[
      'id', 'catalog_item_id', 'name', 'sort_order', 'deleted_at'
    ]
    when 'catalog_option_values' then array[
      'id', 'option_id', 'value', 'sort_order', 'deleted_at'
    ]
    when 'catalog_variant_option_values' then array[
      'id', 'variant_id', 'option_value_id', 'deleted_at'
    ]
    when 'catalog_tags' then array[
      'id', 'company_id', 'name', 'warning_threshold',
      'critical_threshold', 'deleted_at'
    ]
    when 'catalog_item_tags' then array[
      'id', 'catalog_item_id', 'tag_id'
    ]
    when 'catalog_units' then array[
      'id', 'company_id', 'display', 'abbreviation', 'deleted_at'
    ]
    when 'catalog_stock_units' then array[
      'id', 'company_id', 'catalog_variant_id', 'label', 'location',
      'lot_code', 'quantity_value', 'status', 'unit_kind', 'updated_at',
      'deleted_at'
    ]
    when 'catalog_supplier_cost_profiles' then array[
      'id', 'company_id', 'catalog_variant_id', 'currency_code',
      'is_default', 'label', 'unit_cost', 'updated_at', 'deleted_at'
    ]
    when 'products' then array[
      'id', 'company_id', 'name', 'linked_catalog_item_id', 'is_active',
      'updated_at', 'deleted_at'
    ]
    else array[
      'id', 'product_id', 'catalog_item_id', 'catalog_variant_id',
      'quantity_per_unit', 'unit_id', 'updated_at', 'deleted_at'
    ]
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

  if tg_table_name = 'companies' then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'id'
    );
  elsif tg_table_name in (
    'catalog_categories',
    'catalog_items',
    'catalog_variants',
    'catalog_tags',
    'catalog_units',
    'catalog_stock_units',
    'catalog_supplier_cost_profiles',
    'products'
  ) then
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> 'company_id'
    );
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> 'company_id'
    );
  end if;
  v_company_ids := array[v_old_company_id, v_new_company_id];

  if tg_table_name = 'catalog_options' then
    for v_parent_company_id in
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
      v_company_ids := pg_catalog.array_append(
        v_company_ids, v_parent_company_id
      );
    end loop;
  elsif tg_table_name = 'catalog_option_values' then
    for v_parent_company_id in
      select distinct item.company_id
      from public.catalog_options option_row
      join public.catalog_items item on item.id = option_row.catalog_item_id
      where option_row.id in (
        private.agent_read_domain_uuid_from_text(v_old_row ->> 'option_id'),
        private.agent_read_domain_uuid_from_text(v_new_row ->> 'option_id')
      )
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids, v_parent_company_id
      );
    end loop;
  elsif tg_table_name = 'catalog_variant_option_values' then
    for v_parent_company_id in
      select distinct parent.company_id
      from (
        select variant.company_id
        from public.catalog_variants variant
        where variant.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'variant_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'variant_id'
          )
        )
        union all
        select item.company_id
        from public.catalog_option_values value_row
        join public.catalog_options option_row
          on option_row.id = value_row.option_id
        join public.catalog_items item
          on item.id = option_row.catalog_item_id
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
      v_company_ids := pg_catalog.array_append(
        v_company_ids, v_parent_company_id
      );
    end loop;
  elsif tg_table_name = 'catalog_item_tags' then
    for v_parent_company_id in
      select distinct parent.company_id
      from (
        select item.company_id
        from public.catalog_items item
        where item.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'catalog_item_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'catalog_item_id'
          )
        )
        union all
        select tag.company_id
        from public.catalog_tags tag
        where tag.id in (
          private.agent_read_domain_uuid_from_text(v_old_row ->> 'tag_id'),
          private.agent_read_domain_uuid_from_text(v_new_row ->> 'tag_id')
        )
      ) parent
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids, v_parent_company_id
      );
    end loop;
  elsif tg_table_name = 'product_materials' then
    for v_parent_company_id in
      select distinct parent.company_id
      from (
        select product.company_id
        from public.products product
        where product.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'product_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'product_id'
          )
        )
        union all
        select item.company_id
        from public.catalog_items item
        where item.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'catalog_item_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'catalog_item_id'
          )
        )
        union all
        select variant.company_id
        from public.catalog_variants variant
        where variant.id in (
          private.agent_read_domain_uuid_from_text(
            v_old_row ->> 'catalog_variant_id'
          ),
          private.agent_read_domain_uuid_from_text(
            v_new_row ->> 'catalog_variant_id'
          )
        )
      ) parent
    loop
      v_company_ids := pg_catalog.array_append(
        v_company_ids, v_parent_company_id
      );
    end loop;
  end if;

  perform private.advance_agent_read_domain_revisions(
    v_company_ids,
    'catalog'
  );
  return null;
end;
$function$;

revoke all on function private.bump_agent_catalog_source_revision()
  from public, anon, authenticated, service_role;

alter function private.bump_agent_catalog_source_revision()
  owner to current_user;

do $canonical_acl$
declare
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  v_function_oid := pg_catalog.to_regprocedure(
    'private.bump_agent_catalog_source_revision()'
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
      raise exception 'agent_catalog_source_acl_role_missing'
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'revoke all privileges on function %s from %s',
      'private.bump_agent_catalog_source_revision()',
      case when v_acl.grantee = 0 then 'public'
        else pg_catalog.quote_ident(v_acl.role_name)
      end
    );
  end loop;
end;
$canonical_acl$;

drop trigger if exists companies_bump_agent_catalog_revision
  on public.companies;
create trigger companies_bump_agent_catalog_revision
after insert or update or delete on public.companies
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_categories_bump_agent_catalog_revision
  on public.catalog_categories;
create trigger catalog_categories_bump_agent_catalog_revision
after insert or update or delete on public.catalog_categories
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_items_bump_agent_catalog_revision
  on public.catalog_items;
create trigger catalog_items_bump_agent_catalog_revision
after insert or update or delete on public.catalog_items
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_variants_bump_agent_catalog_revision
  on public.catalog_variants;
create trigger catalog_variants_bump_agent_catalog_revision
after insert or update or delete on public.catalog_variants
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_options_bump_agent_catalog_revision
  on public.catalog_options;
create trigger catalog_options_bump_agent_catalog_revision
after insert or update or delete on public.catalog_options
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_option_values_bump_agent_catalog_revision
  on public.catalog_option_values;
create trigger catalog_option_values_bump_agent_catalog_revision
after insert or update or delete on public.catalog_option_values
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_variant_option_values_bump_agent_catalog_revision
  on public.catalog_variant_option_values;
create trigger catalog_variant_option_values_bump_agent_catalog_revision
after insert or update or delete on public.catalog_variant_option_values
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_tags_bump_agent_catalog_revision
  on public.catalog_tags;
create trigger catalog_tags_bump_agent_catalog_revision
after insert or update or delete on public.catalog_tags
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_item_tags_bump_agent_catalog_revision
  on public.catalog_item_tags;
create trigger catalog_item_tags_bump_agent_catalog_revision
after insert or update or delete on public.catalog_item_tags
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_units_bump_agent_catalog_revision
  on public.catalog_units;
create trigger catalog_units_bump_agent_catalog_revision
after insert or update or delete on public.catalog_units
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_stock_units_bump_agent_catalog_revision
  on public.catalog_stock_units;
create trigger catalog_stock_units_bump_agent_catalog_revision
after insert or update or delete on public.catalog_stock_units
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists catalog_supplier_cost_profiles_bump_agent_catalog_revision
  on public.catalog_supplier_cost_profiles;
create trigger catalog_supplier_cost_profiles_bump_agent_catalog_revision
after insert or update or delete on public.catalog_supplier_cost_profiles
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists products_bump_agent_catalog_revision
  on public.products;
create trigger products_bump_agent_catalog_revision
after insert or update or delete on public.products
for each row execute function private.bump_agent_catalog_source_revision();

drop trigger if exists product_materials_bump_agent_catalog_revision
  on public.product_materials;
create trigger product_materials_bump_agent_catalog_revision
after insert or update or delete on public.product_materials
for each row execute function private.bump_agent_catalog_source_revision();

do $postflight$
declare
  v_name text;
  v_trigger record;
begin
  if pg_catalog.to_regprocedure(
    'private.bump_agent_catalog_source_revision()'
  ) is null then
    raise exception 'agent_catalog_source_function_missing'
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
      'private.bump_agent_catalog_source_revision()'
    )::oid
      and acl.grantee <> function_row.proowner
  ) then
    raise exception 'agent_catalog_source_acl_invalid'
      using errcode = '55000';
  end if;

  foreach v_name in array array[
    'idx_catalog_items_agent_normalized_name_v1',
    'idx_catalog_tags_agent_normalized_name_v1',
    'idx_catalog_supplier_cost_profiles_agent_current_v1'
  ]::text[]
  loop
    if pg_catalog.to_regclass('public.' || v_name) is null then
      raise exception 'agent_catalog_index_missing: %', v_name
        using errcode = '55000';
    end if;
  end loop;

  foreach v_name in array array[
    'companies_bump_agent_catalog_revision',
    'catalog_categories_bump_agent_catalog_revision',
    'catalog_items_bump_agent_catalog_revision',
    'catalog_variants_bump_agent_catalog_revision',
    'catalog_options_bump_agent_catalog_revision',
    'catalog_option_values_bump_agent_catalog_revision',
    'catalog_variant_option_values_bump_agent_catalog_revision',
    'catalog_tags_bump_agent_catalog_revision',
    'catalog_item_tags_bump_agent_catalog_revision',
    'catalog_units_bump_agent_catalog_revision',
    'catalog_stock_units_bump_agent_catalog_revision',
    'catalog_supplier_cost_profiles_bump_agent_catalog_revision',
    'products_bump_agent_catalog_revision',
    'product_materials_bump_agent_catalog_revision'
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
            'bump_agent_catalog_source_revision'
       or v_trigger.trigger_args is distinct from '' then
      raise exception 'agent_catalog_trigger_invalid: %', v_name
        using errcode = '55000';
    end if;
  end loop;
end;
$postflight$;

commit;
