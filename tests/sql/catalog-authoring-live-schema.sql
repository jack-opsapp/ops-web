-- Catalog schema/types and reachable trigger functions read from production metadata 2026-09-08. No customer rows.
create table private.agent_read_domain_revisions (
company_id uuid not null,
domain text not null,
source_revision bigint default 0 not null,
updated_at timestamp with time zone default statement_timestamp() not null
);
create table private.agent_read_domains (
domain text not null
);
create table public.catalog_categories (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
name text not null,
parent_id uuid,
sort_order integer default 0 not null,
color_hex text,
default_warning_threshold double precision,
default_critical_threshold double precision,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_items (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
category_id uuid,
name text not null,
description text,
default_price numeric,
default_unit_cost numeric,
default_warning_threshold double precision,
default_critical_threshold double precision,
default_unit_id uuid,
image_url text,
notes text,
is_active boolean default true not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone,
external_source text,
external_id text
);
create table public.catalog_option_values (
id uuid default gen_random_uuid() not null,
option_id uuid not null,
value text not null,
sort_order integer default 0 not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_options (
id uuid default gen_random_uuid() not null,
catalog_item_id uuid not null,
name text not null,
sort_order integer default 0 not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_stock_units (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
catalog_variant_id uuid not null,
unit_kind text default 'each'::text not null,
label text,
lot_code text,
width_value numeric,
width_unit text,
original_length_value numeric,
remaining_length_value numeric,
length_unit text,
quantity_value numeric default 1 not null,
location text,
status text default 'full'::text not null,
source_order_item_id uuid,
notes text,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_units (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
display text not null,
abbreviation text,
dimension text default 'count'::text not null,
is_default boolean default false not null,
sort_order integer default 0 not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_variant_option_values (
variant_id uuid not null,
option_value_id uuid not null,
id uuid default gen_random_uuid() not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.catalog_variants (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
catalog_item_id uuid not null,
sku text,
quantity double precision default 0 not null,
price_override numeric,
unit_cost_override numeric,
warning_threshold double precision,
critical_threshold double precision,
unit_id uuid,
is_active boolean default true not null,
created_at timestamp with time zone default now() not null,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone,
external_source text,
external_id text
);
create table public.inventory_deductions (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
inventory_item_id uuid,
project_id uuid,
task_id uuid,
line_item_id uuid,
quantity_deducted double precision not null,
previous_quantity double precision not null,
new_quantity double precision not null,
reason text default 'task_completion'::text not null,
deducted_by uuid,
deducted_at timestamp with time zone default now() not null,
notes text,
catalog_variant_id uuid
);
create table public.product_materials (
product_id uuid not null,
inventory_item_id uuid,
quantity_per_unit double precision not null,
notes text,
id uuid default gen_random_uuid() not null,
catalog_variant_id uuid,
catalog_item_id uuid,
variant_selector jsonb,
scaled_by_option_id uuid,
unit_id uuid,
updated_at timestamp with time zone default now() not null,
deleted_at timestamp with time zone
);
create table public.products (
id uuid default gen_random_uuid() not null,
company_id uuid not null,
name text not null,
description text,
default_price numeric(12,2) default 0 not null,
unit_cost numeric(12,2),
unit text default 'each'::text,
category text,
is_taxable boolean default true,
is_active boolean default true,
created_at timestamp with time zone default now(),
updated_at timestamp with time zone default now(),
deleted_at timestamp with time zone,
type text default 'LABOR'::text not null,
task_type_id text,
task_type_ref uuid,
unit_id uuid,
kind text default 'service'::text not null,
sku text,
is_favorite boolean default false not null,
minimum_charge numeric,
minimum_quantity numeric,
show_bom_on_estimate boolean default false not null,
show_in_storefront boolean default false not null,
tiered_pricing jsonb default '{}'::jsonb not null,
base_price numeric default 0 not null,
pricing_unit text default 'each'::text not null,
category_id uuid,
thumbnail_url text,
linked_catalog_item_id uuid,
bundle_pricing_mode text,
external_source text,
external_id text
);
alter table public.catalog_categories add constraint catalog_categories_pkey PRIMARY KEY (id);
alter table public.catalog_items add constraint catalog_items_pkey PRIMARY KEY (id);
alter table public.catalog_option_values add constraint catalog_option_values_pkey PRIMARY KEY (id);
alter table public.catalog_options add constraint catalog_options_pkey PRIMARY KEY (id);
alter table public.catalog_units add constraint catalog_units_pkey PRIMARY KEY (id);
alter table public.catalog_variant_option_values add constraint catalog_variant_option_values_pkey PRIMARY KEY (id);
alter table public.catalog_variants add constraint catalog_variants_pkey PRIMARY KEY (id);
alter table public.inventory_deductions add constraint inventory_deductions_pkey PRIMARY KEY (id);
alter table public.product_materials add constraint product_materials_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (id);
alter table public.catalog_categories add constraint catalog_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.catalog_categories add constraint catalog_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES catalog_categories(id) ON DELETE SET NULL;
alter table public.catalog_items add constraint catalog_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE SET NULL;
alter table public.catalog_items add constraint catalog_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.catalog_items add constraint catalog_items_default_unit_id_fkey FOREIGN KEY (default_unit_id) REFERENCES catalog_units(id) ON DELETE SET NULL;
alter table public.catalog_option_values add constraint catalog_option_values_option_id_fkey FOREIGN KEY (option_id) REFERENCES catalog_options(id) ON DELETE CASCADE;
alter table public.catalog_options add constraint catalog_options_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE;
alter table public.catalog_units add constraint catalog_units_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.catalog_variant_option_values add constraint catalog_variant_option_values_option_value_id_fkey FOREIGN KEY (option_value_id) REFERENCES catalog_option_values(id) ON DELETE CASCADE;
alter table public.catalog_variant_option_values add constraint catalog_variant_option_values_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES catalog_variants(id) ON DELETE CASCADE;
alter table public.catalog_variants add constraint catalog_variants_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE CASCADE;
alter table public.catalog_variants add constraint catalog_variants_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.catalog_variants add constraint catalog_variants_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES catalog_units(id) ON DELETE SET NULL;
alter table public.inventory_deductions add constraint inventory_deductions_catalog_variant_id_fkey FOREIGN KEY (catalog_variant_id) REFERENCES catalog_variants(id) ON DELETE RESTRICT;
alter table public.inventory_deductions add constraint inventory_deductions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
alter table public.inventory_deductions add constraint inventory_deductions_reason_check CHECK ((reason = ANY (ARRAY['task_completion'::text, 'task_reopened'::text, 'manual_adjustment'::text, 'skipped_archived'::text])));
alter table public.product_materials add constraint chk_product_materials_pin_xor_family CHECK ((((catalog_variant_id IS NOT NULL) AND (catalog_item_id IS NULL)) OR ((catalog_variant_id IS NULL) AND (catalog_item_id IS NOT NULL)) OR ((catalog_variant_id IS NULL) AND (catalog_item_id IS NULL) AND (inventory_item_id IS NOT NULL))));
alter table public.product_materials add constraint product_materials_catalog_item_id_fkey FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT;
alter table public.product_materials add constraint product_materials_catalog_variant_id_fkey FOREIGN KEY (catalog_variant_id) REFERENCES catalog_variants(id) ON DELETE RESTRICT;
alter table public.product_materials add constraint product_materials_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public.product_materials add constraint product_materials_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES catalog_units(id) ON DELETE SET NULL;
alter table public.products add constraint products_bundle_pricing_mode_check CHECK (((bundle_pricing_mode IS NULL) OR (bundle_pricing_mode = ANY (ARRAY['auto'::text, 'override'::text]))));
alter table public.products add constraint products_category_id_fkey FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE SET NULL;
alter table public.products add constraint products_kind_check CHECK ((kind = ANY (ARRAY['service'::text, 'material'::text, 'package'::text])));
alter table public.products add constraint products_linked_catalog_item_id_fkey FOREIGN KEY (linked_catalog_item_id) REFERENCES catalog_items(id) ON DELETE SET NULL;
alter table public.products add constraint products_pricing_unit_check CHECK ((pricing_unit = ANY (ARRAY['each'::text, 'flat_rate'::text, 'linear_foot'::text, 'sqft'::text, 'hour'::text, 'day'::text])));
alter table public.products add constraint products_type_check CHECK ((type = ANY (ARRAY['LABOR'::text, 'MATERIAL'::text, 'OTHER'::text])));
alter table private.agent_read_domains add primary key(domain);
alter table private.agent_read_domain_revisions add primary key(company_id,domain);
CREATE OR REPLACE FUNCTION private.advance_agent_read_domain_revisions(p_company_ids uuid[], p_domain text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  v_expected_count integer;
  v_advanced_count integer;
begin
  if p_domain is null or not exists (
    select 1
    from private.agent_read_domains domain
    where domain.domain = p_domain
  ) then
    raise exception 'agent_read_domain_revision_invalid_domain'
      using errcode = '22023';
  end if;

  select count(*)::integer
    into v_expected_count
  from (
    select distinct company_id
    from unnest(coalesce(p_company_ids, array[]::uuid[])) company_id
    where company_id is not null
  ) distinct_companies;

  if v_expected_count = 0 then
    return;
  end if;

  -- One ordered statement gives cross-tenant moves a consistent lock order.
  insert into private.agent_read_domain_revisions as revision (
    company_id,
    domain,
    source_revision,
    updated_at
  )
  select
    distinct_companies.company_id,
    p_domain,
    1,
    statement_timestamp()
  from (
    select distinct company_id
    from unnest(p_company_ids) company_id
    where company_id is not null
    order by company_id
  ) distinct_companies
  on conflict (company_id, domain) do update
  set source_revision = revision.source_revision + 1,
      updated_at = excluded.updated_at
  where revision.source_revision < 9007199254740991;

  get diagnostics v_advanced_count = row_count;
  if v_advanced_count is distinct from v_expected_count then
    raise exception 'agent_read_domain_revision_exhausted'
      using errcode = '22003';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.agent_read_domain_uuid_from_text(p_value text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then lower(p_value)::uuid
  end;
$function$
;
CREATE OR REPLACE FUNCTION private.bump_agent_catalog_source_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE TRIGGER catalog_categories_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_categories FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE OR REPLACE FUNCTION private.catalog_categories_no_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    cur_id uuid := NEW.parent_id;
    depth integer := 0;
BEGIN
    WHILE cur_id IS NOT NULL LOOP
        IF cur_id = NEW.id THEN
            RAISE EXCEPTION 'catalog_categories cycle detected via parent_id';
        END IF;
        SELECT parent_id INTO cur_id FROM public.catalog_categories WHERE id = cur_id;
        depth := depth + 1;
        IF depth > 50 THEN
            RAISE EXCEPTION 'catalog_categories parent chain exceeds 50 levels';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_catalog_categories_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON public.catalog_categories FOR EACH ROW EXECUTE FUNCTION private.catalog_categories_no_cycle();
CREATE TRIGGER catalog_items_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE OR REPLACE FUNCTION private.bump_agent_purchasing_source_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE TRIGGER catalog_items_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_items FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE TRIGGER catalog_option_values_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_option_values FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER catalog_option_values_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_option_values FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;
CREATE TRIGGER trg_catalog_option_values_updated_at BEFORE UPDATE ON public.catalog_option_values FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER catalog_options_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_options FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER catalog_options_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_options FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE TRIGGER trg_catalog_options_updated_at BEFORE UPDATE ON public.catalog_options FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER catalog_units_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_units FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER catalog_units_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_units FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE TRIGGER catalog_variant_option_values_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_variant_option_values FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER catalog_variant_option_values_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_variant_option_values FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE TRIGGER trg_catalog_variant_option_values_updated_at BEFORE UPDATE ON public.catalog_variant_option_values FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER catalog_variants_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_variants FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER catalog_variants_bump_agent_purchasing_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_variants FOR EACH ROW EXECUTE FUNCTION private.bump_agent_purchasing_source_revision();
CREATE OR REPLACE FUNCTION private.bump_agent_read_domain_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_company_id uuid;
  v_new_company_id uuid;
begin
  if tg_nargs is distinct from 2
     or nullif(tg_argv[0], '') is null
     or nullif(tg_argv[1], '') is null
     or tg_when is distinct from 'AFTER'
     or tg_level is distinct from 'ROW'
     or tg_op not in ('INSERT', 'UPDATE', 'DELETE') then
    raise exception 'agent_read_domain_revision_trigger_misconfigured'
      using errcode = '55000';
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old_row := to_jsonb(old);
    if not (v_old_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_old_company_id := private.agent_read_domain_uuid_from_text(
      v_old_row ->> tg_argv[1]
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_row := to_jsonb(new);
    if not (v_new_row ? tg_argv[1]) then
      raise exception 'agent_read_domain_revision_trigger_misconfigured'
        using errcode = '55000';
    end if;
    v_new_company_id := private.agent_read_domain_uuid_from_text(
      v_new_row ->> tg_argv[1]
    );
  end if;

  perform private.advance_agent_read_domain_revisions(
    array[v_old_company_id, v_new_company_id],
    tg_argv[0]
  );

  -- AFTER row-trigger return values are ignored. NULL avoids polymorphic
  -- record coercion and makes that behavior explicit.
  return null;
end;
$function$
;
CREATE TRIGGER catalog_variants_bump_agent_task_revision AFTER INSERT OR DELETE OR UPDATE ON public.catalog_variants FOR EACH ROW EXECUTE FUNCTION private.bump_agent_read_domain_revision('tasks', 'company_id');
CREATE TRIGGER product_materials_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.product_materials FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE TRIGGER trg_product_materials_updated_at BEFORE UPDATE ON public.product_materials FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER products_bump_agent_catalog_revision AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.bump_agent_catalog_source_revision();
CREATE OR REPLACE FUNCTION public.update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $function$
;
CREATE TRIGGER trg_product_timestamp BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE OR REPLACE FUNCTION private.products_mirror_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.base_price IS NULL OR NEW.base_price = 0 THEN
            NEW.base_price := COALESCE(NEW.default_price, 0);
        ELSIF NEW.default_price IS NULL OR NEW.default_price = 0 THEN
            NEW.default_price := NEW.base_price;
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.base_price IS DISTINCT FROM OLD.base_price AND NEW.default_price IS NOT DISTINCT FROM OLD.default_price THEN
            NEW.default_price := NEW.base_price;
        ELSIF NEW.default_price IS DISTINCT FROM OLD.default_price AND NEW.base_price IS NOT DISTINCT FROM OLD.base_price THEN
            NEW.base_price := NEW.default_price;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_products_mirror_price BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.products_mirror_price();
CREATE OR REPLACE FUNCTION private.resolve_catalog_mapping_needed_notifications_for_product_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_company_id uuid := new.company_id;
  v_dedupe_key text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.deleted_at is not null
     or new.linked_catalog_item_id is null then
    return new;
  end if;

  if v_company_id is null
     or v_company_id is distinct from private.get_user_company_id() then
    return new;
  end if;

  if not exists (
    select 1
      from public.catalog_items ci
     where ci.id = new.linked_catalog_item_id
       and ci.company_id = v_company_id
       and ci.deleted_at is null
  ) then
    return new;
  end if;

  v_dedupe_key :=
    'catalog_mapping_needed:product:' || new.id::text ||
    ':linked_catalog_item';

  update public.notifications
     set is_read = true,
         resolved_at = now(),
         resolved_by = private.get_current_user_id(),
         resolution_reason = 'catalog_product_linked'
   where company_id = v_company_id::text
     and type = 'catalog_mapping_needed'
     and dedupe_key = v_dedupe_key
     and resolved_at is null;

  return new;
end;
$function$
;
CREATE TRIGGER trg_products_resolve_catalog_mapping_notifications AFTER INSERT OR UPDATE OF linked_catalog_item_id, deleted_at ON public.products FOR EACH ROW EXECUTE FUNCTION private.resolve_catalog_mapping_needed_notifications_for_product_link();
