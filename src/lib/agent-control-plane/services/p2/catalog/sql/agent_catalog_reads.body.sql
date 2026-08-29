begin;

set local timezone = 'UTC';

-- Task 18 canonical catalogue read body. Public functions remain
-- service-role-only; private projections re-prove current grants, actor
-- permissions, the exact catalogue revision, physical bounds, and cost scope.
do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.object_name order by required.object_name)
    into v_missing
  from (
    values
      ('function', 'private.resolve_agent_actor_authority(uuid,uuid,text[])'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.canonical_agent_projection_json(jsonb)'),
      ('function', 'private.mcp_oauth_labels_for_scopes(text[],text)'),
      ('function', 'private.agent_currency_minor_exponent_or_null(text)'),
      ('function', 'private.agent_money_to_minor_units(numeric,text)'),
      ('table', 'private.agent_read_domain_revisions'),
      ('table', 'private.mcp_oauth_clients'),
      ('table', 'private.mcp_oauth_grants'),
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
    raise exception 'agent_catalog_reads_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;
end;
$prerequisites$;

create or replace function private.agent_p2_catalog_hash_ref(
  p_prefix text,
  p_material jsonb
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
begin
  if p_prefix not in ('ops_proof:v1:', 'ops_evidence:v1:') then
    raise exception 'invalid_agent_catalog_hash_prefix'
      using errcode = '22023';
  end if;
  return p_prefix || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        private.canonical_agent_projection_json(p_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
end;
$function$;

create or replace function private.agent_p2_catalog_detail_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_item_kind text,
  p_item_id uuid,
  p_include_supplier_costs boolean,
  p_source_limit integer,
  p_variant_limit integer,
  p_variant_fetch_limit integer,
  p_option_limit integer,
  p_option_fetch_limit integer,
  p_option_value_limit integer,
  p_option_value_fetch_limit integer,
  p_recipe_limit integer,
  p_recipe_fetch_limit integer,
  p_stock_group_limit integer,
  p_stock_group_fetch_limit integer,
  p_supplier_cost_limit integer,
  p_supplier_cost_fetch_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_currency_code text;
  v_family record;
  v_family_id uuid;
  v_requested_variant_id uuid;
  v_read_at timestamptz;
  v_variant_count integer;
  v_variants jsonb;
  v_variant_invalid boolean;
  v_first_search_item jsonb;
  v_option_count integer;
  v_option_value_count integer;
  v_options jsonb;
  v_option_invalid boolean;
  v_recipe_count integer;
  v_recipes jsonb;
  v_recipe_invalid boolean;
  v_stock_source_count integer;
  v_stock_group_count integer;
  v_physical_stock jsonb;
  v_stock_invalid boolean;
  v_supplier_cost_count integer := 0;
  v_supplier_costs jsonb := '[]'::jsonb;
  v_supplier_cost_invalid boolean := false;
  v_description text;
  v_family_source jsonb;
  v_result_source jsonb;
  v_source_inspected jsonb;
  v_query jsonb;
  v_proof_context jsonb;
  v_proof_ref text;
  v_evidence_ref text;
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'get_catalog_item'
     or p_capability_revision is distinct from
       'get_catalog_item:2026-08-22.v1'
     or p_item_kind not in ('catalog_family', 'catalog_variant')
     or p_item_id is null
     or p_include_supplier_costs is null
     or p_source_limit is distinct from 501
     or p_variant_limit is distinct from 50
     or p_variant_fetch_limit is distinct from 51
     or p_option_limit is distinct from 32
     or p_option_fetch_limit is distinct from 33
     or p_option_value_limit is distinct from 128
     or p_option_value_fetch_limit is distinct from 129
     or p_recipe_limit is distinct from 64
     or p_recipe_fetch_limit is distinct from 65
     or p_stock_group_limit is distinct from 100
     or p_stock_group_fetch_limit is distinct from 101
     or p_supplier_cost_limit is distinct from 64
     or p_supplier_cost_fetch_limit is distinct from 65 then
    raise exception 'invalid_agent_catalog_detail_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_catalog_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    p_include_supplier_costs
  );
  if v_context is null then
    raise exception 'agent_catalog_not_authorized'
      using errcode = '42501';
  end if;
  v_currency_code := v_context ->> 'currency_code';
  if v_currency_code is null
     or v_currency_code !~ '^[A-Z]{3}$'
     or v_context -> 'minor_exponent' = 'null'::jsonb then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  v_requested_variant_id := case when p_item_kind = 'catalog_variant'
    then p_item_id else null end;
  select family.*
    into v_family
  from public.catalog_items family
  where family.company_id = p_company_id
    and family.deleted_at is null
    and (
      p_item_kind = 'catalog_family' and family.id = p_item_id
      or p_item_kind = 'catalog_variant' and exists (
        select 1
        from public.catalog_variants requested_variant
        where requested_variant.id = p_item_id
          and requested_variant.company_id = p_company_id
          and requested_variant.catalog_item_id = family.id
          and requested_variant.deleted_at is null
      )
    );
  if not found then
    return null;
  end if;
  v_family_id := v_family.id;

  with variant_source as materialized (
    select source.*,
           variant.price_override,
           family.default_price,
           case when coalesce(variant.price_override, family.default_price)
                       is null then null
             else private.agent_money_to_minor_units(
               coalesce(variant.price_override, family.default_price),
               v_currency_code
             )
           end as sale_price_minor
    from private.agent_p2_catalog_variant_source_v1(
      p_company_id,
      null,
      null,
      v_family_id,
      v_requested_variant_id,
      p_variant_fetch_limit
    ) source
    join public.catalog_variants variant on variant.id = source.variant_id
    join public.catalog_items family on family.id = source.family_id
  ), variant_projection as materialized (
    select source.variant_id,
           source.item,
           source.source_invalid
             or coalesce(source.price_override, source.default_price) < 0
             or coalesce(source.price_override, source.default_price)
                  is not null and source.sale_price_minor is null
             as source_invalid,
           pg_catalog.jsonb_build_object(
             'variant_ref', source.item -> 'variant_ref',
             'label', source.item -> 'variant_label',
             'sku', source.item -> 'sku',
             'quantity_milliunits', source.item -> 'quantity_milliunits',
             'unit', source.item -> 'unit',
             'sale_price', case
               when coalesce(source.price_override, source.default_price)
                      is null then null
               else pg_catalog.jsonb_build_object(
                 'amount_minor', source.sale_price_minor,
                 'currency', v_currency_code
               )
             end,
             'thresholds', source.item -> 'thresholds',
             'stock_state', source.item -> 'stock_state',
             'active', source.item -> 'active',
             'updated_at', source.item -> 'updated_at',
             'content_kind', 'untrusted_business_data'
           ) as variant
    from variant_source source
  )
  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             projection.variant order by projection.variant_id
           ),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(projection.source_invalid), false
         ),
         (pg_catalog.jsonb_agg(
           projection.item order by projection.variant_id
         ) -> 0)
    into v_variant_count, v_variants, v_variant_invalid, v_first_search_item
  from variant_projection projection;
  if v_variant_count = 0 then
    return null;
  end if;
  if v_variant_count >= p_variant_fetch_limit then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_variant_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  with option_source as materialized (
    select option_row.id,
           option_row.name,
           option_row.sort_order,
           private.agent_p2_optional_canonical_text(
             option_row.name, 256, 1024, true
           ) as safe_name
    from public.catalog_options option_row
    where option_row.catalog_item_id = v_family_id
      and option_row.deleted_at is null
    order by option_row.sort_order, option_row.id
    limit p_option_fetch_limit
  ), value_source as materialized (
    select value_row.id,
           value_row.option_id,
           value_row.value,
           value_row.sort_order,
           private.agent_p2_optional_canonical_text(
             value_row.value, 256, 1024, true
           ) as safe_value
    from public.catalog_option_values value_row
    join option_source option_row on option_row.id = value_row.option_id
    where value_row.deleted_at is null
    order by option_row.sort_order, option_row.id,
             value_row.sort_order, value_row.id
    limit p_option_value_fetch_limit
  ), option_projection as materialized (
    select option_row.id,
           option_row.sort_order,
           option_row.safe_name is null
             or option_row.sort_order < 0
             or option_row.sort_order > 9007199254740991
             or coalesce(value_state.source_invalid, false)
               as source_invalid,
           pg_catalog.jsonb_build_object(
             'option_ref', pg_catalog.jsonb_build_object(
               'kind', 'catalog_option', 'id', option_row.id
             ),
             'label', option_row.safe_name,
             'sort_order', option_row.sort_order,
             'values', coalesce(value_state.values, '[]'::jsonb),
             'content_kind', 'untrusted_business_data'
           ) as option_item
    from option_source option_row
    left join lateral (
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'value_ref', pg_catalog.jsonb_build_object(
                   'kind', 'catalog_option_value', 'id', value_row.id
                 ),
                 'label', value_row.safe_value,
                 'sort_order', value_row.sort_order,
                 'content_kind', 'untrusted_business_data'
               ) order by value_row.sort_order, value_row.id
             ) as values,
             coalesce(
               pg_catalog.bool_or(
                 value_row.safe_value is null
                 or value_row.sort_order < 0
                 or value_row.sort_order > 9007199254740991
               ),
               false
             ) as source_invalid
      from value_source value_row
      where value_row.option_id = option_row.id
    ) value_state on true
  ), states as materialized (
    select (select pg_catalog.count(*)::integer from option_source)
             as option_count,
           (select pg_catalog.count(*)::integer from value_source)
             as value_count
  )
  select states.option_count,
         states.value_count,
         coalesce(
           pg_catalog.jsonb_agg(
             projection.option_item
             order by projection.sort_order, projection.id
           ) filter (where projection.id is not null),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(projection.source_invalid), false
         )
    into v_option_count, v_option_value_count, v_options, v_option_invalid
  from states
  left join option_projection projection on true
  group by states.option_count, states.value_count;
  if v_option_count >= p_option_fetch_limit
     or v_option_value_count >= p_option_value_fetch_limit then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_option_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  with selected_variants as materialized (
    select (variant.value #>> '{variant_ref,id}')::uuid as variant_id
    from pg_catalog.jsonb_array_elements(v_variants) variant(value)
  ), raw_recipes as materialized (
    select product.id as product_id,
           product.name as product_name,
           'stock_link'::text as relationship,
           null::uuid as variant_id,
             null::numeric as quantity_value,
           null::uuid as unit_id
    from public.products product
    where product.company_id = p_company_id
      and product.linked_catalog_item_id = v_family_id
      and product.deleted_at is null
      and coalesce(product.is_active, true)
    union all
    select product.id,
           product.name,
           'recipe',
           material.catalog_variant_id,
           material.quantity_per_unit,
           material.unit_id
    from public.product_materials material
    join public.products product
      on product.id = material.product_id
     and product.company_id = p_company_id
     and product.deleted_at is null
     and coalesce(product.is_active, true)
    where material.deleted_at is null
      and (
        material.catalog_item_id = v_family_id
        or material.catalog_variant_id in (
          select selected.variant_id from selected_variants selected
        )
      )
    order by relationship, product_id, variant_id nulls first
    limit p_recipe_fetch_limit
  ), recipe_projection as materialized (
    select recipe.*,
           private.agent_p2_optional_canonical_text(
             recipe.product_name, 256, 1024, true
           ) as safe_product_name,
           private.agent_p2_catalog_milliunits_v1(recipe.quantity_value)
             as quantity_milliunits,
           unit_row.display as raw_unit_label,
           case when unit_row.id is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.display, 160, 640, true
             )
           end as unit_label,
           unit_row.abbreviation as raw_unit_abbreviation,
           case when unit_row.abbreviation is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.abbreviation, 160, 640, true
             )
           end as unit_abbreviation
    from raw_recipes recipe
    left join public.catalog_units unit_row
      on unit_row.id = recipe.unit_id
     and unit_row.company_id = p_company_id
     and unit_row.deleted_at is null
  )
  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'product_ref', pg_catalog.jsonb_build_object(
                 'kind', 'product', 'id', recipe.product_id
               ),
               'product_label', recipe.safe_product_name,
               'relationship', recipe.relationship,
               'variant_ref', case when recipe.variant_id is null then null
                 else pg_catalog.jsonb_build_object(
                   'kind', 'catalog_variant', 'id', recipe.variant_id
                 )
               end,
               'quantity_milliunits', recipe.quantity_milliunits,
               'unit', case when recipe.raw_unit_label is null then null
                 else pg_catalog.jsonb_build_object(
                   'label', recipe.unit_label,
                   'abbreviation', recipe.unit_abbreviation
                 )
               end,
               'content_kind', 'untrusted_business_data'
             ) order by recipe.relationship, recipe.product_id,
                        recipe.variant_id nulls first
           ),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(
             recipe.safe_product_name is null
             or recipe.relationship = 'recipe'
                and recipe.quantity_milliunits is null
             or recipe.raw_unit_label is not null
                and recipe.unit_label is null
             or recipe.raw_unit_abbreviation is not null
                and recipe.unit_abbreviation is null
           ),
           false
         )
    into v_recipe_count, v_recipes, v_recipe_invalid
  from recipe_projection recipe;
  if v_recipe_count >= p_recipe_fetch_limit then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_recipe_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  with selected_variants as materialized (
    select (variant.value #>> '{variant_ref,id}')::uuid as variant_id
    from pg_catalog.jsonb_array_elements(v_variants) variant(value)
  ), raw_stock as materialized (
    select stock.*,
           private.agent_p2_catalog_milliunits_v1(stock.quantity_value)
             as quantity_milliunits,
           case when stock.location is null then null
             else private.agent_p2_optional_canonical_text(
               stock.location, 160, 640, true
             )
           end as safe_location,
           coalesce(stock.lot_code, stock.label) as raw_lot_label,
           case when coalesce(stock.lot_code, stock.label) is null then null
             else private.agent_p2_optional_canonical_text(
               coalesce(stock.lot_code, stock.label), 160, 640, true
             )
           end as safe_lot_label
    from public.catalog_stock_units stock
    where stock.company_id = p_company_id
      and stock.deleted_at is null
      and stock.catalog_variant_id in (
        select selected.variant_id from selected_variants selected
      )
    order by stock.id
    limit p_source_limit
  ), grouped_stock as materialized (
    select stock.catalog_variant_id,
           stock.status,
           stock.unit_kind,
           stock.safe_location,
           stock.safe_lot_label,
           pg_catalog.sum(stock.quantity_milliunits::numeric)
             as quantity_milliunits,
           pg_catalog.bool_or(
             stock.status not in (
               'consumed', 'full', 'partial', 'reserved', 'scrapped'
             )
             or stock.unit_kind not in (
               'box', 'each', 'length', 'lot', 'offcut', 'pallet', 'roll'
             )
             or stock.quantity_milliunits is null
             or stock.location is not null and stock.safe_location is null
             or stock.raw_lot_label is not null
                and stock.safe_lot_label is null
           ) as source_invalid
    from raw_stock stock
    group by stock.catalog_variant_id, stock.status, stock.unit_kind,
             stock.safe_location, stock.safe_lot_label
    order by stock.catalog_variant_id, stock.status, stock.unit_kind,
             stock.safe_location collate "C" nulls first,
             stock.safe_lot_label collate "C" nulls first
    limit p_stock_group_fetch_limit
  ), stock_states as materialized (
    select (select pg_catalog.count(*)::integer from raw_stock)
             as source_count,
           (select pg_catalog.count(*)::integer from grouped_stock)
             as group_count
  )
  select states.source_count,
         states.group_count,
         coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'variant_ref', pg_catalog.jsonb_build_object(
                 'kind', 'catalog_variant',
                 'id', stock.catalog_variant_id
               ),
               'status', stock.status,
               'unit_kind', stock.unit_kind,
               'location', stock.safe_location,
               'lot_label', stock.safe_lot_label,
               'quantity_milliunits', stock.quantity_milliunits,
               'content_kind', 'untrusted_business_data'
             ) order by stock.catalog_variant_id, stock.status,
                        stock.unit_kind,
                        stock.safe_location collate "C" nulls first,
                        stock.safe_lot_label collate "C" nulls first
           ) filter (where stock.catalog_variant_id is not null),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(
             stock.source_invalid
             or stock.quantity_milliunits < 0
             or stock.quantity_milliunits > 9007199254740991
           ),
           false
         )
    into v_stock_source_count, v_stock_group_count,
         v_physical_stock, v_stock_invalid
  from stock_states states
  left join grouped_stock stock on true
  group by states.source_count, states.group_count;
  if v_stock_source_count >= p_source_limit
     or v_stock_group_count >= p_stock_group_fetch_limit then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_stock_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  if p_include_supplier_costs then
    with selected_variants as materialized (
      select (variant.value #>> '{variant_ref,id}')::uuid as variant_id,
             variant.value -> 'label' as variant_label,
             variant.value -> 'unit' as unit_value
      from pg_catalog.jsonb_array_elements(v_variants) variant(value)
    ), raw_costs as materialized (
      select profile.id,
             profile.catalog_variant_id,
             selected.variant_label,
             selected.unit_value,
             profile.label,
             private.agent_p2_optional_canonical_text(
               profile.label, 256, 1024, true
             ) as safe_label,
             profile.unit_cost,
             pg_catalog.upper(profile.currency_code) as currency_code,
             private.agent_currency_minor_exponent_or_null(
               pg_catalog.upper(profile.currency_code)
             ) as minor_exponent,
             private.agent_money_to_minor_units(
               profile.unit_cost,
               pg_catalog.upper(profile.currency_code)
             ) as amount_minor,
             profile.is_default,
             pg_catalog.date_trunc('milliseconds', profile.updated_at)
               as effective_at
      from public.catalog_supplier_cost_profiles profile
      join selected_variants selected
        on selected.variant_id = profile.catalog_variant_id
      where profile.company_id = p_company_id
        and profile.deleted_at is null
      order by profile.catalog_variant_id,
               profile.is_default desc,
               profile.updated_at desc,
               profile.id
      limit p_supplier_cost_fetch_limit
    ), cost_projection as materialized (
      select cost.*,
             pg_catalog.jsonb_build_object(
               'variant_ref', pg_catalog.jsonb_build_object(
                 'kind', 'catalog_variant', 'id', cost.catalog_variant_id
               ),
               'variant_label', cost.variant_label,
               'supplier_label', cost.safe_label,
               'unit_cost', pg_catalog.jsonb_build_object(
                 'amount_minor', cost.amount_minor,
                 'currency', cost.currency_code
               ),
               'basis', pg_catalog.jsonb_build_object(
                 'kind', 'variant_unit', 'unit', cost.unit_value
               ),
               'effective_at',
                 private.agent_rfc3339_utc(cost.effective_at),
               'current', true,
               'default', cost.is_default,
               'source_freshness', pg_catalog.jsonb_build_object(
                 'observed_at',
                   private.agent_rfc3339_utc(cost.effective_at)
               ),
               'content_kind', 'untrusted_business_data'
             ) as cost_item,
             cost.safe_label is null
               or cost.unit_cost < 0
               or cost.currency_code !~ '^[A-Z]{3}$'
               or cost.minor_exponent is null
               or cost.amount_minor is null
               or not pg_catalog.isfinite(cost.effective_at)
                 as source_invalid
      from raw_costs cost
    ), duplicate_state as materialized (
      select exists (
        select 1
        from (
          select projection.cost_item,
                 pg_catalog.count(*)
          from cost_projection projection
          group by projection.cost_item
          having pg_catalog.count(*) > 1
        ) duplicate
      ) as has_duplicate
    )
    select pg_catalog.count(*)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from cost_projection projection
    cross join duplicate_state duplicate
    group by duplicate.has_duplicate;
    if v_supplier_cost_count >= p_supplier_cost_fetch_limit then
      raise exception 'agent_catalog_result_bound'
        using errcode = '54000';
    end if;
    if v_supplier_cost_invalid then
      raise exception 'agent_catalog_source_data_invalid'
        using errcode = '22023';
    end if;
  end if;

  v_description := case when v_family.description is null then null
    else private.agent_p2_optional_canonical_text(
      v_family.description, 4000, 16000, true
    )
  end;
  if v_first_search_item is null
     or v_family.description is not null and v_description is null
     or not pg_catalog.isfinite(v_family.updated_at) then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;
  v_family_source := pg_catalog.jsonb_build_object(
    'family_ref', v_first_search_item -> 'family_ref',
    'label', v_first_search_item -> 'family_label',
    'description', v_description,
    'image_state', case
      when v_family.image_url is null
        or pg_catalog.btrim(v_family.image_url) = '' then 'absent'
      else 'available'
    end,
    'category', v_first_search_item -> 'category',
    'tags', v_first_search_item -> 'tags',
    'active', v_family.is_active,
    'updated_at', private.agent_rfc3339_utc(
      pg_catalog.date_trunc('milliseconds', v_family.updated_at)
    ),
    'content_kind', 'untrusted_business_data'
  );
  v_result_source := pg_catalog.jsonb_build_object(
    'requested_ref', pg_catalog.jsonb_build_object(
      'kind', p_item_kind, 'id', p_item_id
    ),
    'family', v_family_source,
    'variants', v_variants,
    'options', v_options,
    'recipes', v_recipes,
    'physical_stock', v_physical_stock
  ) || case when p_include_supplier_costs
    then pg_catalog.jsonb_build_object('supplier_costs', v_supplier_costs)
    else '{}'::jsonb
  end;
  v_source_inspected := pg_catalog.jsonb_build_object(
    'families', 1,
    'variants', v_variant_count,
    'options', v_option_count,
    'option_values', v_option_value_count,
    'recipes', v_recipe_count,
    'stock_units', v_stock_source_count,
    'supplier_costs', v_supplier_cost_count
  );
  v_query := pg_catalog.jsonb_build_object(
    'item_ref', pg_catalog.jsonb_build_object(
      'kind', p_item_kind, 'id', p_item_id
    ),
    'sections', case when p_include_supplier_costs
      then pg_catalog.jsonb_build_array('supplier_costs')
      else '[]'::jsonb
    end
  );
  v_read_at := pg_catalog.date_trunc(
    'milliseconds', pg_catalog.statement_timestamp()
  );
  v_proof_context := pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'authorization_candidates',
      v_context -> 'proof_authorization_candidates',
    'query', v_query,
    'read_at', private.agent_rfc3339_utc(v_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'source_inspected', v_source_inspected
  );
  v_proof_ref := private.agent_p2_catalog_hash_ref(
    'ops_proof:v1:',
    v_proof_context || pg_catalog.jsonb_build_object(
      'proof_kind', 'catalog_detail_entity',
      'result', v_result_source
    )
  );
  v_evidence_ref := private.agent_p2_catalog_hash_ref(
    'ops_evidence:v1:',
    pg_catalog.jsonb_build_object(
      'evidence_kind', 'catalog_detail',
      'company_id', p_company_id,
      'requested_ref', v_query -> 'item_ref',
      'family_updated_at', v_family_source -> 'updated_at'
    )
  );

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'actor_user_id', p_actor_user_id,
    'oauth_grant_id', p_oauth_grant_id,
    'oauth_client_id', p_oauth_client_id,
    'grant_revision', p_grant_revision,
    'granted_scope_ceiling', pg_catalog.to_jsonb(p_granted_scope_ceiling),
    'permission_snapshot_revision', p_permission_snapshot_revision,
    'capability_manifest_revision', p_capability_manifest_revision,
    'capability_id', p_capability_id,
    'capability_revision', p_capability_revision,
    'authorization_candidates', p_authorization_candidates,
    'query', v_query,
    'read_at', private.agent_rfc3339_utc(v_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'selected_authorization_variants', case
      when p_include_supplier_costs then
        pg_catalog.jsonb_build_array('catalog', 'supplier_costs')
      else pg_catalog.jsonb_build_array('catalog')
    end,
    'source_inspected', v_source_inspected,
    'result', v_result_source,
    'proof_ref', v_proof_ref,
    'evidence_ref', v_evidence_ref
  );
end;
$function$;

create or replace function private.agent_p2_catalog_list_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_query_kind text,
  p_query_value text,
  p_active_state text,
  p_stock_states text[],
  p_low_stock_only boolean,
  p_category_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_updated_at timestamptz,
  p_after_variant_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_read_at timestamptz;
  v_result jsonb;
begin
  if p_capability_manifest_revision is distinct from
       '2026-08-22.capability-manifest.v8'
     or p_capability_id is distinct from 'search_catalog_items'
     or p_capability_revision is distinct from
       'search_catalog_items:2026-08-22.v1'
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501
     or (p_query_kind is null) is distinct from (p_query_value is null)
     or p_query_kind is not null and
          p_query_kind not in ('family', 'sku', 'category', 'tag')
     or p_query_value is not null and (
       private.agent_p2_optional_canonical_text(
         p_query_value, 160, 640, false
       ) is distinct from p_query_value
     )
     or p_active_state not in ('active', 'all', 'inactive')
     or p_stock_states is null
     or pg_catalog.cardinality(p_stock_states) not between 1 and 4
     or not p_stock_states <@
          array['critical', 'normal', 'untracked', 'warning']::text[]
     or p_stock_states is distinct from (
       select pg_catalog.array_agg(state.value order by state.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_stock_states) source(value)
       ) state
     )
     or p_low_stock_only is null
     or p_cursor_source_revisions is null
     or (p_cursor_read_at is null) is distinct from (
       p_after_updated_at is null
       and p_after_variant_id is null
       and p_cursor_source_revisions = '[]'::jsonb
     )
     or p_cursor_read_at is not null and (
       not pg_catalog.isfinite(p_cursor_read_at)
       or p_cursor_read_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_cursor_read_at
       )
       or extract(year from p_cursor_read_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_updated_at is null
       or not pg_catalog.isfinite(p_after_updated_at)
       or p_after_updated_at is distinct from pg_catalog.date_trunc(
         'milliseconds', p_after_updated_at
       )
       or extract(year from p_after_updated_at at time zone 'UTC')
            not between 1 and 9999
       or p_after_variant_id is null
       or pg_catalog.jsonb_typeof(p_cursor_source_revisions)
            is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_cursor_source_revisions) <> 1
       or p_cursor_source_revisions #>> '{0,domain}' <> 'catalog'
       or pg_catalog.jsonb_typeof(
            p_cursor_source_revisions #> '{0,source_revision}'
          ) is distinct from 'number'
       or (p_cursor_source_revisions #>> '{0,source_revision}')
            !~ '^(0|[1-9][0-9]{0,15})$'
       or (p_cursor_source_revisions -> 0) -
            array['domain', 'source_revision']::text[] <> '{}'::jsonb
     ) then
    raise exception 'invalid_agent_catalog_list_request'
      using errcode = '22023';
  end if;

  v_context := private.agent_p2_catalog_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    false
  );
  if v_context is null then
    raise exception 'agent_catalog_not_authorized'
      using errcode = '42501';
  end if;
  if p_cursor_read_at is not null
     and p_cursor_source_revisions is distinct from
       v_context -> 'source_revisions' then
    raise exception 'agent_catalog_read_stale'
      using errcode = '40001';
  end if;
  v_read_at := coalesce(
    p_cursor_read_at,
    pg_catalog.date_trunc('milliseconds', pg_catalog.statement_timestamp())
  );

  with raw_source as materialized (
    select source.*
    from private.agent_p2_catalog_variant_source_v1(
      p_company_id,
      p_query_kind,
      p_query_value,
      null,
      null,
      p_source_limit
    ) source
  ), raw_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(pg_catalog.bool_or(source.source_invalid), false)
             as source_invalid
    from raw_source source
  ), filtered_source as materialized (
    select source.*
    from raw_source source
    cross join raw_state state
    where state.source_count < p_source_limit
      and not state.source_invalid
      and (
        p_active_state = 'all'
        or p_active_state = 'active' and source.active
        or p_active_state = 'inactive' and not source.active
      )
      and source.stock_state = any(p_stock_states)
      and (
        not p_low_stock_only
        or source.stock_state in ('critical', 'warning')
      )
      and (p_category_id is null or source.category_id = p_category_id)
      and (
        p_after_updated_at is null
        or source.order_updated_at < p_after_updated_at
        or source.order_updated_at = p_after_updated_at
           and source.variant_id > p_after_variant_id
      )
  ), bounded_source as materialized (
    select source.*,
           pg_catalog.row_number() over (
             order by source.order_updated_at desc, source.variant_id
           ) as ordinality
    from filtered_source source
    order by source.order_updated_at desc, source.variant_id
    limit p_page_fetch_limit
  ), page_state as materialized (
    select pg_catalog.count(*)::integer as fetched_count,
           pg_catalog.count(*) > p_item_limit as source_has_more
    from bounded_source
  ), query_projection as materialized (
    select (
      case when p_query_kind is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object(
          'query', pg_catalog.jsonb_build_object(
            'kind', p_query_kind, 'value', p_query_value
          )
        )
      end
      || pg_catalog.jsonb_build_object(
        'active_state', p_active_state,
        'stock_states', pg_catalog.to_jsonb(p_stock_states),
        'low_stock_only', p_low_stock_only,
        'limit', p_item_limit
      )
      || case when p_category_id is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object(
          'category_ref', pg_catalog.jsonb_build_object(
            'kind', 'catalog_category', 'id', p_category_id
          )
        )
      end
    ) as query
  ), cursor_projection as materialized (
    select case when p_cursor_read_at is null then null::jsonb
      else pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_array(
          private.agent_rfc3339_utc(p_after_updated_at),
          p_after_variant_id
        ),
        'tie_breaker', p_after_variant_id
      )
    end as predecessor
  ), proof_context as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision', p_permission_snapshot_revision,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'capability_manifest_revision', p_capability_manifest_revision,
             'ranking_revision', 'catalog-ranking:2026-08-22.v1',
             'authorization_candidates',
               v_context -> 'proof_authorization_candidates',
             'query', query.query,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'read_at', private.agent_rfc3339_utc(v_read_at),
             'source_revisions', v_context -> 'source_revisions',
             'source_inspected', raw.source_count,
             'source_has_more', page.source_has_more
           ) as context
    from query_projection query
    cross join cursor_projection cursor
    cross join raw_state raw
    cross join page_state page
  ), row_material as materialized (
    select source.ordinality,
           source.variant_id,
           source.item,
           pg_catalog.jsonb_build_object(
             'order', pg_catalog.jsonb_build_array(
               private.agent_rfc3339_utc(source.order_updated_at),
               source.variant_id
             ),
             'tie_breaker', source.variant_id
           ) as predecessor,
           private.agent_p2_catalog_hash_ref(
             'ops_proof:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'proof_kind', 'catalog_search_entity',
               'selected_authorization',
                 v_context -> 'proof_authorization_candidates' -> 0,
               'item', source.item
             )
           ) as proof_ref,
           private.agent_p2_catalog_hash_ref(
             'ops_evidence:v1:',
             proof.context || pg_catalog.jsonb_build_object(
               'evidence_kind', 'catalog_search_item',
               'selected_authorization',
                 v_context -> 'proof_authorization_candidates' -> 0,
               'variant_ref', source.item -> 'variant_ref',
               'updated_at', source.item -> 'updated_at'
             )
           ) as evidence_ref
    from bounded_source source
    cross join proof_context proof
    where source.ordinality <= p_item_limit
  ), aggregate_rows as materialized (
    select coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'item', row.item,
                 'selected_authorization_variant', 'catalog',
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref,
                 'predecessor', row.predecessor
               ) order by row.ordinality
             ),
             '[]'::jsonb
           ) as rows,
           coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'variant_ref', row.item -> 'variant_ref',
                 'proof_ref', row.proof_ref,
                 'evidence_ref', row.evidence_ref
               ) order by row.ordinality
             ),
             '[]'::jsonb
           ) as children
    from row_material row
  ), final_projection as materialized (
    select pg_catalog.jsonb_build_object(
             'company_id', p_company_id,
             'actor_user_id', p_actor_user_id,
             'oauth_grant_id', p_oauth_grant_id,
             'oauth_client_id', p_oauth_client_id,
             'grant_revision', p_grant_revision,
             'granted_scope_ceiling',
               pg_catalog.to_jsonb(p_granted_scope_ceiling),
             'permission_snapshot_revision', p_permission_snapshot_revision,
             'capability_manifest_revision', p_capability_manifest_revision,
             'capability_id', p_capability_id,
             'capability_revision', p_capability_revision,
             'authorization_candidates', p_authorization_candidates,
             'query', query.query,
             'read_at', private.agent_rfc3339_utc(v_read_at),
             'source_revisions', v_context -> 'source_revisions',
             'ranking_revision', 'catalog-ranking:2026-08-22.v1',
             'item_limit', p_item_limit,
             'cursor_read_at', case when p_cursor_read_at is null then null
               else private.agent_rfc3339_utc(p_cursor_read_at)
             end,
             'cursor_source_revisions', p_cursor_source_revisions,
             'cursor_predecessor', cursor.predecessor,
             'source_inspected', raw.source_count,
             'source_has_more', page.source_has_more,
             'rows', aggregate.rows,
             'collection_proof_ref',
               private.agent_p2_catalog_hash_ref(
                 'ops_proof:v1:',
                 proof.context || pg_catalog.jsonb_build_object(
                   'proof_kind', 'catalog_search_collection',
                   'returned_count',
                     pg_catalog.jsonb_array_length(aggregate.rows),
                   'has_more', page.source_has_more,
                   'children', aggregate.children
                 )
               ),
             '_source_bound', raw.source_count >= p_source_limit,
             '_source_invalid', raw.source_invalid
           ) as projection
    from query_projection query
    cross join cursor_projection cursor
    cross join raw_state raw
    cross join page_state page
    cross join proof_context proof
    cross join aggregate_rows aggregate
  )
  select projection into v_result from final_projection;

  if (v_result ->> '_source_bound')::boolean then
    raise exception 'agent_catalog_source_bound'
      using errcode = '54000';
  end if;
  if (v_result ->> '_source_invalid')::boolean then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;
  return v_result - array['_source_bound', '_source_invalid'];
end;
$function$;

create or replace function private.agent_p2_catalog_milliunits_v1(
  p_value numeric
) returns bigint
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
declare
  v_numeric numeric;
  v_scaled numeric;
begin
  if p_value is null or p_value < 0 then
    return null;
  end if;
  v_numeric := p_value;
  v_scaled := v_numeric * 1000;
  if v_scaled <> pg_catalog.trunc(v_scaled)
     or v_scaled > 9007199254740991 then
    return null;
  end if;
  return v_scaled::bigint;
end;
$function$;

create or replace function private.agent_p2_catalog_normalized_text_v1(
  p_value text
) returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(p_value), '[[:space:]]+', ' ', 'g'
    )
  );
$function$;

create or replace function private.agent_p2_catalog_expected_candidate_v1(
  p_variant_key text,
  p_permissions jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_catalog_scope text;
  v_products_scope text;
  v_finances_scope text;
begin
  if p_variant_key not in ('catalog', 'supplier_costs')
     or p_permissions is null
     or pg_catalog.jsonb_typeof(p_permissions) is distinct from 'object' then
    return null;
  end if;
  v_catalog_scope := p_permissions ->> 'catalog.view';
  v_products_scope := p_permissions ->> 'catalog.products.view';
  v_finances_scope := p_permissions ->> 'finances.view';

  if p_variant_key = 'catalog' then
    if v_catalog_scope <> 'all' or v_products_scope <> 'all' then
      return null;
    end if;
    return pg_catalog.jsonb_build_object(
      'variant_key', 'catalog',
      'required_oauth_scopes',
        pg_catalog.jsonb_build_array('ops.catalog.read'),
      'resolved_permission_scopes', pg_catalog.jsonb_build_object(
        'catalog.products.view', 'all',
        'catalog.view', 'all'
      ),
      'satisfied_permission_group_indexes',
        pg_catalog.jsonb_build_array(0)
    );
  end if;

  if v_products_scope <> 'all' or v_finances_scope <> 'all' then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'variant_key', 'supplier_costs',
    'required_oauth_scopes',
      pg_catalog.jsonb_build_array('ops.catalog_costs.read'),
    'resolved_permission_scopes', pg_catalog.jsonb_build_object(
      'catalog.products.view', 'all',
      'finances.view', 'all'
    ),
    'satisfied_permission_group_indexes',
      pg_catalog.jsonb_build_array(0)
  );
end;
$function$;

create or replace function private.agent_p2_catalog_proof_candidates_v1(
  p_authorization_candidates jsonb,
  p_permissions jsonb
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variantKey', candidate.value ->> 'variant_key',
        'requiredOAuthScopes', candidate.value -> 'required_oauth_scopes',
        'resolvedPermissionScopes',
          candidate.value -> 'resolved_permission_scopes',
        'satisfiedPermissionGroupIndexes',
          candidate.value -> 'satisfied_permission_group_indexes',
        'catalogViewScope',
          candidate.value -> 'resolved_permission_scopes' ->> 'catalog.view',
        'catalogProductsViewScope',
          candidate.value -> 'resolved_permission_scopes' ->>
            'catalog.products.view',
        'financesViewScope',
          candidate.value -> 'resolved_permission_scopes' ->> 'finances.view'
      ) order by candidate.ordinality
    ),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(p_authorization_candidates)
    with ordinality candidate(value, ordinality)
  where candidate.value is not distinct from
    private.agent_p2_catalog_expected_candidate_v1(
      candidate.value ->> 'variant_key',
      p_permissions
    );
$function$;

create or replace function private.agent_p2_catalog_read_context_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_include_supplier_costs boolean
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_permissions jsonb;
  v_snapshot_revision text;
  v_expected_count integer;
  v_result jsonb;
begin
  v_expected_count := case when p_include_supplier_costs then 2 else 1 end;
  if p_actor_user_id is null
     or p_company_id is null
     or p_oauth_grant_id is null
     or p_oauth_client_id is null
     or p_grant_revision is null
     or p_grant_revision !~ '^[0-9a-f]{32}$'
     or p_permission_snapshot_revision is null
     or p_permission_snapshot_revision !~ '^sha256:[0-9a-f]{64}$'
     or p_granted_scope_ceiling is null
     or p_registered_permission_keys is null
     or p_authorization_candidates is null
     or pg_catalog.jsonb_typeof(p_authorization_candidates)
          is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_authorization_candidates)
          <> v_expected_count
     or p_authorization_candidates #>> '{0,variant_key}' <> 'catalog'
     or p_include_supplier_costs and
          p_authorization_candidates #>> '{1,variant_key}' <>
            'supplier_costs'
     or not ('ops.catalog.read' = any(p_granted_scope_ceiling))
     or p_include_supplier_costs and
          not ('ops.catalog_costs.read' = any(p_granted_scope_ceiling))
     or p_granted_scope_ceiling is distinct from (
       select pg_catalog.array_agg(scope.value order by scope.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_granted_scope_ceiling) source(value)
       ) scope
     )
     or p_registered_permission_keys is distinct from (
       select pg_catalog.array_agg(key.value order by key.value)
       from (
         select distinct source.value
         from pg_catalog.unnest(p_registered_permission_keys) source(value)
       ) key
     ) then
    return null;
  end if;

  select authority.permission_snapshot_revision,
         coalesce(
           pg_catalog.jsonb_object_agg(
             permission.value ->> 'permission',
             permission.value ->> 'scope'
             order by permission.value ->> 'permission'
           ) filter (
             where permission.value ->> 'permission' is not null
               and permission.value ->> 'scope' is not null
           ),
           '{}'::jsonb
         )
    into v_snapshot_revision, v_permissions
  from private.resolve_agent_actor_authority(
    p_actor_user_id,
    p_company_id,
    p_registered_permission_keys
  ) authority
  left join lateral pg_catalog.jsonb_array_elements(
    authority.effective_permissions
  ) permission(value) on true
  group by authority.permission_snapshot_revision;

  if v_snapshot_revision is distinct from p_permission_snapshot_revision
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(p_authorization_candidates)
         with ordinality candidate(value, ordinality)
       where candidate.value is distinct from
         private.agent_p2_catalog_expected_candidate_v1(
           case candidate.ordinality
             when 1 then 'catalog'
             else 'supplier_costs'
           end,
           v_permissions
         )
     ) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'permissions', v_permissions,
           'currency_code', pg_catalog.upper(company.currency_code),
           'minor_exponent',
             private.agent_currency_minor_exponent_or_null(
               pg_catalog.upper(company.currency_code)
             ),
           'source_revisions', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'domain', 'catalog',
               'source_revision', catalog_revision.source_revision
             )
           ),
           'proof_authorization_candidates',
             private.agent_p2_catalog_proof_candidates_v1(
               p_authorization_candidates,
               v_permissions
             )
         )
    into v_result
  from private.mcp_oauth_grants grant_row
  join private.mcp_oauth_clients oauth_client
    on oauth_client.client_id = grant_row.client_id
   and oauth_client.disabled_at is null
   and grant_row.scopes <@ oauth_client.scope_ceiling
   and grant_row.consent_catalog_revision =
         oauth_client.consent_catalog_revision
   and grant_row.exposure_revision = oauth_client.exposure_revision
  join public.companies company
    on company.id = p_company_id
   and company.deleted_at is null
  join private.agent_read_domain_revisions catalog_revision
    on catalog_revision.company_id = p_company_id
   and catalog_revision.domain = 'catalog'
   and catalog_revision.source_revision between 0 and 9007199254740991
  where grant_row.id = p_oauth_grant_id
    and grant_row.user_id = p_actor_user_id
    and grant_row.company_id = p_company_id
    and grant_row.client_id = p_oauth_client_id
    and grant_row.revision = p_grant_revision
    and grant_row.revoked_at is null
    and grant_row.scopes = p_granted_scope_ceiling
    and array['ops.catalog.read']::text[] <@ grant_row.scopes
    and (
      not p_include_supplier_costs
      or array['ops.catalog_costs.read']::text[] <@ grant_row.scopes
    )
    and grant_row.accepted_labels =
      private.mcp_oauth_labels_for_scopes(
        grant_row.scopes,
        grant_row.consent_catalog_revision
      );

  if v_result is null
     or pg_catalog.jsonb_array_length(
          v_result -> 'proof_authorization_candidates'
        ) <> v_expected_count then
    return null;
  end if;
  return v_result;
end;
$function$;

create or replace function private.agent_p2_catalog_variant_source_v1(
  p_company_id uuid,
  p_query_kind text,
  p_query_value text,
  p_family_id uuid,
  p_variant_id uuid,
  p_source_limit integer
) returns table (
  variant_id uuid,
  family_id uuid,
  category_id uuid,
  order_updated_at timestamptz,
  active boolean,
  stock_state text,
  item jsonb,
  source_invalid boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with raw_ids as materialized (
    select variant.id
    from public.catalog_variants variant
    join public.catalog_items family
      on family.id = variant.catalog_item_id
     and family.company_id = p_company_id
     and family.deleted_at is null
    left join public.catalog_categories category
      on category.id = family.category_id
     and category.company_id = p_company_id
     and category.deleted_at is null
    where variant.company_id = p_company_id
      and variant.deleted_at is null
      and (p_family_id is null or family.id = p_family_id)
      and (p_variant_id is null or variant.id = p_variant_id)
      and (
        p_query_kind is null
        or p_query_kind = 'family' and
          pg_catalog.lower(
            pg_catalog.regexp_replace(
              pg_catalog.btrim(family.name), '[[:space:]]+', ' ', 'g'
            )
          ) = private.agent_p2_catalog_normalized_text_v1(p_query_value)
        or p_query_kind = 'sku' and
          private.agent_p2_catalog_normalized_text_v1(variant.sku) =
            private.agent_p2_catalog_normalized_text_v1(p_query_value)
        or p_query_kind = 'category' and
          private.agent_p2_catalog_normalized_text_v1(category.name) =
            private.agent_p2_catalog_normalized_text_v1(p_query_value)
        or p_query_kind = 'tag' and exists (
          select 1
          from public.catalog_item_tags item_tag
          join public.catalog_tags tag
            on tag.id = item_tag.tag_id
           and tag.company_id = p_company_id
           and tag.deleted_at is null
          where item_tag.catalog_item_id = family.id
            and pg_catalog.lower(
              pg_catalog.regexp_replace(
                pg_catalog.btrim(tag.name), '[[:space:]]+', ' ', 'g'
              )
            ) = private.agent_p2_catalog_normalized_text_v1(p_query_value)
        )
      )
    order by greatest(family.updated_at, variant.updated_at) desc,
             variant.id
    limit p_source_limit
  ), source as materialized (
    select variant.id as variant_id,
           family.id as family_id,
           category.id as category_id,
           pg_catalog.date_trunc(
             'milliseconds',
             greatest(family.updated_at, variant.updated_at)
           ) as order_updated_at,
           family.is_active and variant.is_active as active,
           family.name as raw_family_label,
           private.agent_p2_optional_canonical_text(
             family.name, 256, 1024, true
           ) as family_label,
           variant.sku as raw_sku,
           case when variant.sku is null then null
             else private.agent_p2_optional_canonical_text(
               variant.sku, 160, 640, true
             )
           end as safe_sku,
           category.name as raw_category_label,
           case when category.id is null then null
             else private.agent_p2_optional_canonical_text(
               category.name, 256, 1024, true
             )
           end as category_label,
           unit_row.display as raw_unit_label,
           case when unit_row.id is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.display, 160, 640, true
             )
           end as unit_label,
           unit_row.abbreviation as raw_unit_abbreviation,
           case when unit_row.abbreviation is null then null
             else private.agent_p2_optional_canonical_text(
               unit_row.abbreviation, 160, 640, true
             )
           end as unit_abbreviation,
           private.agent_p2_catalog_milliunits_v1(variant.quantity) as quantity_milliunits,
           private.agent_p2_catalog_milliunits_v1(
             coalesce(
               variant.warning_threshold,
               family.default_warning_threshold,
               category.default_warning_threshold
             )
           ) as warning_milliunits,
           case
             when variant.warning_threshold is not null then 'variant'
             when family.default_warning_threshold is not null then 'family'
             when category.default_warning_threshold is not null then 'category'
             else 'none'
           end as warning_origin,
           private.agent_p2_catalog_milliunits_v1(
             coalesce(
               variant.critical_threshold,
               family.default_critical_threshold,
               category.default_critical_threshold
             )
           ) as critical_milliunits,
           case
             when variant.critical_threshold is not null then 'variant'
             when family.default_critical_threshold is not null then 'family'
             when category.default_critical_threshold is not null then 'category'
             else 'none'
           end as critical_origin,
           tag_state.tags,
           tag_state.tag_count,
           tag_state.tag_invalid,
           label_state.raw_variant_label,
           label_state.label_invalid,
           label_state.variant_label
    from raw_ids raw
    join public.catalog_variants variant on variant.id = raw.id
    join public.catalog_items family on family.id = variant.catalog_item_id
    left join public.catalog_categories category
      on category.id = family.category_id
     and category.company_id = p_company_id
     and category.deleted_at is null
    left join public.catalog_units unit_row
      on unit_row.id = coalesce(variant.unit_id, family.default_unit_id)
     and unit_row.company_id = p_company_id
     and unit_row.deleted_at is null
    left join lateral (
      with raw_tags as materialized (
        select private.agent_p2_optional_canonical_text(
                 tag.name, 160, 640, true
               ) as value
        from public.catalog_item_tags item_tag
        join public.catalog_tags tag
          on tag.id = item_tag.tag_id
         and tag.company_id = p_company_id
         and tag.deleted_at is null
        where item_tag.catalog_item_id = family.id
        order by item_tag.id
        limit 65
      ), tag_summary as materialized (
        select pg_catalog.count(*)::integer as tag_count,
               coalesce(
                 pg_catalog.bool_or(raw_tag.value is null), false
               ) as tag_invalid
        from raw_tags raw_tag
      ), distinct_tags as materialized (
        select distinct raw_tag.value
        from raw_tags raw_tag
        where raw_tag.value is not null
      )
      select summary.tag_count,
             coalesce(
               (
                 select pg_catalog.jsonb_agg(
                          distinct_tag.value
                          order by distinct_tag.value collate "C"
                        )
                 from distinct_tags distinct_tag
               ),
               '[]'::jsonb
             ) as tags,
             summary.tag_invalid
      from tag_summary summary
    ) tag_state on true
    left join lateral (
      with raw_label_values as materialized (
        select safe_value.value,
               option_row.sort_order as option_sort_order,
               option_row.id as option_id,
               value_row.sort_order as value_sort_order,
               value_row.id as value_id,
               assignment.id as assignment_id
        from public.catalog_variant_option_values assignment
        join public.catalog_option_values value_row
          on value_row.id = assignment.option_value_id
         and value_row.deleted_at is null
        join public.catalog_options option_row
          on option_row.id = value_row.option_id
         and option_row.catalog_item_id = family.id
         and option_row.deleted_at is null
        cross join lateral (
          select private.agent_p2_optional_canonical_text(
            value_row.value, 256, 1024, true
          ) as value
        ) safe_value
        where assignment.variant_id = variant.id
          and assignment.deleted_at is null
        order by option_row.sort_order, option_row.id,
                 value_row.sort_order, value_row.id, assignment.id
        limit 129
      ), labels as materialized (
        select pg_catalog.string_agg(
                 raw_value.value,
                 ' / '
                 order by raw_value.option_sort_order, raw_value.option_id,
                          raw_value.value_sort_order, raw_value.value_id,
                          raw_value.assignment_id
               ) as raw_variant_label,
               pg_catalog.count(*)::integer as label_count,
               coalesce(
                 pg_catalog.bool_or(raw_value.value is null), false
               ) as label_invalid
        from raw_label_values raw_value
      )
      select labels.raw_variant_label,
             labels.label_count >= 129 or labels.label_invalid as label_invalid,
             case when labels.raw_variant_label is null then null
               else private.agent_p2_optional_canonical_text(
                 labels.raw_variant_label, 256, 1024, true
               )
             end as variant_label
      from labels
    ) label_state on true
  ), calculated as materialized (
    select source.*,
           case
             when source.warning_origin = 'none'
              and source.critical_origin = 'none' then 'untracked'
             when source.critical_milliunits is not null
              and source.quantity_milliunits <= source.critical_milliunits
               then 'critical'
             when source.warning_milliunits is not null
              and source.quantity_milliunits <= source.warning_milliunits
               then 'warning'
             else 'normal'
           end as calculated_stock_state,
           source.family_label is null
             or source.raw_sku is not null and source.safe_sku is null
             or source.raw_category_label is not null
                and source.category_label is null
             or source.raw_unit_label is not null and source.unit_label is null
             or source.raw_unit_abbreviation is not null
                and source.unit_abbreviation is null
             or source.quantity_milliunits is null
             or source.warning_origin <> 'none'
                and source.warning_milliunits is null
             or source.critical_origin <> 'none'
                and source.critical_milliunits is null
             or source.tag_count >= 65
             or source.tag_invalid
             or source.label_invalid
             or coalesce(
               not pg_catalog.isfinite(source.order_updated_at), true
             )
             or source.raw_variant_label is not null
                and source.variant_label is null as calculated_invalid
    from source
  )
  select calculated.variant_id,
         calculated.family_id,
         calculated.category_id,
         calculated.order_updated_at,
         calculated.active,
         calculated.calculated_stock_state,
         pg_catalog.jsonb_build_object(
           'family_ref', pg_catalog.jsonb_build_object(
             'kind', 'catalog_family', 'id', calculated.family_id
           ),
           'family_label', calculated.family_label,
           'variant_ref', pg_catalog.jsonb_build_object(
             'kind', 'catalog_variant', 'id', calculated.variant_id
           ),
           'variant_label', calculated.variant_label,
           'category', case when calculated.category_id is null then null
             else pg_catalog.jsonb_build_object(
               'category_ref', pg_catalog.jsonb_build_object(
                 'kind', 'catalog_category', 'id', calculated.category_id
               ),
               'label', calculated.category_label
             )
           end,
           'sku', calculated.safe_sku,
           'quantity_milliunits', calculated.quantity_milliunits,
           'unit', case when calculated.raw_unit_label is null then null
             else pg_catalog.jsonb_build_object(
               'label', calculated.unit_label,
               'abbreviation', calculated.unit_abbreviation
             )
           end,
           'thresholds', pg_catalog.jsonb_build_object(
             'warning_milliunits', calculated.warning_milliunits,
             'critical_milliunits', calculated.critical_milliunits,
             'warning_origin', calculated.warning_origin,
             'critical_origin', calculated.critical_origin
           ),
           'stock_state', calculated.calculated_stock_state,
           'tags', calculated.tags,
           'active', calculated.active,
           'updated_at',
             private.agent_rfc3339_utc(calculated.order_updated_at),
           'content_kind', 'untrusted_business_data'
         ),
         calculated.calculated_invalid
  from calculated;
$function$;

create or replace function private.agent_p2_catalog_attention_v1(
  p_actor_user_id uuid,
  p_company_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_authorization_candidates jsonb,
  p_include_supplier_costs boolean,
  p_read_at timestamptz,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_currency_code text;
  v_source_count integer;
  v_source_invalid boolean;
  v_cost_source_count integer := 0;
  v_cost_invalid boolean := false;
  v_items jsonb;
begin
  if p_include_supplier_costs is null
     or p_read_at is null
     or not pg_catalog.isfinite(p_read_at)
     or p_read_at is distinct from pg_catalog.date_trunc(
       'milliseconds', p_read_at
     )
     or extract(year from p_read_at at time zone 'UTC') not between 1 and 9999
     or p_item_limit not between 1 and 25
     or p_page_fetch_limit is distinct from p_item_limit + 1
     or p_page_fetch_limit not between 2 and 26
     or p_source_limit is distinct from 501 then
    raise exception 'invalid_agent_catalog_attention_request'
      using errcode = '22023';
  end if;
  v_context := private.agent_p2_catalog_read_context_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_authorization_candidates,
    p_include_supplier_costs
  );
  if v_context is null then
    raise exception 'agent_catalog_not_authorized'
      using errcode = '42501';
  end if;
  v_currency_code := v_context ->> 'currency_code';
  if p_include_supplier_costs and (
    v_currency_code is null
    or v_currency_code !~ '^[A-Z]{3}$'
    or v_context -> 'minor_exponent' = 'null'::jsonb
  ) then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  with raw_source as materialized (
    select source.*
    from private.agent_p2_catalog_variant_source_v1(
      p_company_id, null, null, null, null, p_source_limit
    ) source
  ), raw_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(pg_catalog.bool_or(source.source_invalid), false)
             as source_invalid
    from raw_source source
  ), bounded_source as materialized (
    select source.*
    from raw_source source
    cross join raw_state state
    where state.source_count < p_source_limit
      and not state.source_invalid
      and source.stock_state in ('critical', 'warning', 'untracked')
    order by case source.stock_state
               when 'critical' then 0
               when 'warning' then 1
               else 2
             end,
             source.order_updated_at desc,
             source.variant_id
    limit p_page_fetch_limit
  ), returned_source as materialized (
    select source.*
    from bounded_source source
    order by case source.stock_state
               when 'critical' then 0
               when 'warning' then 1
               else 2
             end,
             source.order_updated_at desc,
             source.variant_id
  ), cost_source as materialized (
    select profile.catalog_variant_id,
           profile.id,
           private.agent_p2_optional_canonical_text(
             profile.label, 256, 1024, true
           ) as supplier_label,
           profile.unit_cost,
           pg_catalog.upper(profile.currency_code) as currency_code,
           private.agent_currency_minor_exponent_or_null(
             pg_catalog.upper(profile.currency_code)
           ) as minor_exponent,
           private.agent_money_to_minor_units(
             profile.unit_cost,
             pg_catalog.upper(profile.currency_code)
           ) as amount_minor,
           profile.is_default,
           pg_catalog.date_trunc('milliseconds', profile.updated_at)
             as effective_at
    from public.catalog_supplier_cost_profiles profile
    join returned_source source
      on source.variant_id = profile.catalog_variant_id
    where p_include_supplier_costs
      and profile.company_id = p_company_id
      and profile.deleted_at is null
    order by profile.catalog_variant_id,
             profile.is_default desc,
             profile.updated_at desc,
             profile.id
    limit 65
  ), cost_state as materialized (
    select pg_catalog.count(*)::integer as source_count,
           coalesce(
             pg_catalog.bool_or(
               cost.supplier_label is null
               or cost.unit_cost < 0
               or cost.currency_code !~ '^[A-Z]{3}$'
               or cost.minor_exponent is null
               or cost.amount_minor is null
               or not pg_catalog.isfinite(cost.effective_at)
             ),
             false
           ) as source_invalid
    from cost_source cost
  ), item_projection as materialized (
    select source.variant_id,
           case source.stock_state
             when 'critical' then 0
             when 'warning' then 1
             else 2
           end as priority,
           source.order_updated_at,
           pg_catalog.jsonb_build_object(
             'family_ref', source.item -> 'family_ref',
             'family_label', source.item -> 'family_label',
             'variant_ref', source.item -> 'variant_ref',
             'variant_label', source.item -> 'variant_label',
             'sku', source.item -> 'sku',
             'quantity_milliunits', source.item -> 'quantity_milliunits',
             'unit', source.item -> 'unit',
             'thresholds', source.item -> 'thresholds',
             'stock_state', source.item -> 'stock_state',
             'updated_at', source.item -> 'updated_at',
             'content_kind', 'untrusted_business_data'
           ) || case when p_include_supplier_costs then
             pg_catalog.jsonb_build_object(
               'supplier_costs', coalesce(cost.costs, '[]'::jsonb)
             )
           else '{}'::jsonb end as item
    from returned_source source
    left join lateral (
      select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'supplier_label', cost.supplier_label,
                 'unit_cost', pg_catalog.jsonb_build_object(
                   'amount_minor', cost.amount_minor,
                   'currency', cost.currency_code
                 ),
                 'effective_at',
                   private.agent_rfc3339_utc(cost.effective_at),
                 'current', true,
                 'default', cost.is_default,
                 'source_freshness', pg_catalog.jsonb_build_object(
                   'observed_at',
                     private.agent_rfc3339_utc(cost.effective_at)
                 )
               ) order by cost.is_default desc, cost.effective_at desc,
                          cost.supplier_label collate "C", cost.id
             ) as costs
      from cost_source cost
      where cost.catalog_variant_id = source.variant_id
    ) cost on true
  )
  select raw.source_count,
         raw.source_invalid,
         costs.source_count,
         costs.source_invalid,
         coalesce(
           pg_catalog.jsonb_agg(
             item.item order by item.priority, item.order_updated_at desc,
                                item.variant_id
           ),
           '[]'::jsonb
         )
    into v_source_count, v_source_invalid,
         v_cost_source_count, v_cost_invalid, v_items
  from raw_state raw
  cross join cost_state costs
  left join item_projection item on true
  group by raw.source_count, raw.source_invalid,
           costs.source_count, costs.source_invalid;

  if v_source_count >= p_source_limit then
    raise exception 'agent_catalog_source_bound'
      using errcode = '54000';
  end if;
  if v_cost_source_count >= 65 then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_source_invalid or v_cost_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'read_at', private.agent_rfc3339_utc(p_read_at),
    'source_revisions', v_context -> 'source_revisions',
    'selected_authorization_variants', case
      when p_include_supplier_costs then
        pg_catalog.jsonb_build_array('catalog', 'supplier_costs')
      else pg_catalog.jsonb_build_array('catalog')
    end,
    'source_inspected', v_source_count,
    'has_more', pg_catalog.jsonb_array_length(v_items) > p_item_limit,
    'items', case when pg_catalog.jsonb_array_length(v_items) <= p_item_limit
      then v_items
      else (
        select coalesce(
          pg_catalog.jsonb_agg(value.value order by value.ordinality),
          '[]'::jsonb
        )
        from pg_catalog.jsonb_array_elements(v_items)
          with ordinality value(value, ordinality)
        where value.ordinality <= p_item_limit
      )
    end
  );
end;
$function$;

create or replace function public.read_agent_catalog_items_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_query_kind text,
  p_query_value text,
  p_active_state text,
  p_stock_states text[],
  p_low_stock_only boolean,
  p_category_id uuid,
  p_item_limit integer,
  p_page_fetch_limit integer,
  p_source_limit integer,
  p_cursor_read_at timestamptz,
  p_cursor_source_revisions jsonb,
  p_after_updated_at timestamptz,
  p_after_variant_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_catalog_list_request'
      using errcode = '22023';
  end if;
  return private.agent_p2_catalog_list_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidates,
    p_query_kind,
    p_query_value,
    p_active_state,
    p_stock_states,
    p_low_stock_only,
    p_category_id,
    p_item_limit,
    p_page_fetch_limit,
    p_source_limit,
    p_cursor_read_at,
    p_cursor_source_revisions,
    p_after_updated_at,
    p_after_variant_id
  );
end;
$function$;

create or replace function public.read_agent_catalog_item_as_system(
  p_request_id text,
  p_company_id uuid,
  p_actor_user_id uuid,
  p_oauth_grant_id uuid,
  p_oauth_client_id uuid,
  p_grant_revision text,
  p_granted_scope_ceiling text[],
  p_permission_snapshot_revision text,
  p_registered_permission_keys text[],
  p_capability_manifest_revision text,
  p_capability_id text,
  p_capability_revision text,
  p_authorization_candidates jsonb,
  p_item_kind text,
  p_item_id uuid,
  p_include_supplier_costs boolean,
  p_source_limit integer,
  p_variant_limit integer,
  p_variant_fetch_limit integer,
  p_option_limit integer,
  p_option_fetch_limit integer,
  p_option_value_limit integer,
  p_option_value_fetch_limit integer,
  p_recipe_limit integer,
  p_recipe_fetch_limit integer,
  p_stock_group_limit integer,
  p_stock_group_fetch_limit integer,
  p_supplier_cost_limit integer,
  p_supplier_cost_fetch_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role'
     or p_request_id is null
     or p_request_id is distinct from pg_catalog.btrim(p_request_id)
     or pg_catalog.octet_length(p_request_id) not between 1 and 256 then
    raise exception 'invalid_agent_catalog_detail_request'
      using errcode = '22023';
  end if;
  v_result := private.agent_p2_catalog_detail_v1(
    p_actor_user_id,
    p_company_id,
    p_oauth_grant_id,
    p_oauth_client_id,
    p_grant_revision,
    p_granted_scope_ceiling,
    p_permission_snapshot_revision,
    p_registered_permission_keys,
    p_capability_manifest_revision,
    p_capability_id,
    p_capability_revision,
    p_authorization_candidates,
    p_item_kind,
    p_item_id,
    p_include_supplier_costs,
    p_source_limit,
    p_variant_limit,
    p_variant_fetch_limit,
    p_option_limit,
    p_option_fetch_limit,
    p_option_value_limit,
    p_option_value_fetch_limit,
    p_recipe_limit,
    p_recipe_fetch_limit,
    p_stock_group_limit,
    p_stock_group_fetch_limit,
    p_supplier_cost_limit,
    p_supplier_cost_fetch_limit
  );
  if v_result is null then
    raise exception 'agent_catalog_item_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.read_agent_catalog_items_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,text,text,text[],boolean,uuid,integer,integer,integer,
  timestamp with time zone,jsonb,timestamp with time zone,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;

do $canonical_acl$
declare
  v_signature text;
  v_function_oid oid;
  v_function_owner oid;
  v_acl record;
begin
  foreach v_signature in array array[
    'private.agent_p2_catalog_hash_ref(text,jsonb)',
    'private.agent_p2_catalog_milliunits_v1(numeric)',
    'private.agent_p2_catalog_normalized_text_v1(text)',
    'private.agent_p2_catalog_expected_candidate_v1(text,jsonb)',
    'private.agent_p2_catalog_proof_candidates_v1(jsonb,jsonb)',
    'private.agent_p2_catalog_read_context_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean)',
    'private.agent_p2_catalog_variant_source_v1(uuid,text,text,uuid,uuid,integer)',
    'private.agent_p2_catalog_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)',
    'private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)',
    'public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)',
    'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
  ]::text[] loop
    v_function_oid := pg_catalog.to_regprocedure(v_signature)::oid;
    if v_function_oid is null then
      raise exception 'agent_catalog_acl_function_missing: %', v_signature
        using errcode = '55000';
    end if;
    execute pg_catalog.format(
      'alter function %s owner to current_user', v_signature
    );
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
        raise exception 'agent_catalog_acl_role_missing'
          using errcode = '55000';
      end if;
      execute pg_catalog.format(
        'revoke all privileges on function %s from %s',
        v_signature,
        case when v_acl.grantee = 0 then 'public'
          else pg_catalog.quote_ident(v_acl.role_name)
        end
      );
    end loop;
  end loop;
end;
$canonical_acl$;

grant execute on function public.read_agent_catalog_items_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,text,text,text[],boolean,uuid,integer,integer,integer,
  timestamp with time zone,jsonb,timestamp with time zone,uuid
) to service_role;
grant execute on function public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer
) to service_role;

do $postflight$
declare
  v_missing text[];
  v_invalid text[];
begin
  select pg_catalog.array_agg(required.signature order by required.signature)
    into v_missing
  from (
    values
      ('private.agent_p2_catalog_list_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)'),
      ('private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'),
      ('private.agent_p2_catalog_attention_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],jsonb,boolean,timestamp with time zone,integer,integer,integer)'),
      ('public.read_agent_catalog_items_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,text,text,text[],boolean,uuid,integer,integer,integer,timestamp with time zone,jsonb,timestamp with time zone,uuid)'),
      ('public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)')
  ) required(signature)
  where pg_catalog.to_regprocedure(required.signature) is null;

  if v_missing is not null then
    raise exception 'agent_catalog_reads_postflight_missing: %',
      pg_catalog.array_to_string(v_missing, ',')
      using errcode = '55000';
  end if;

  select pg_catalog.array_agg(
           namespace.nspname || '.' || procedure.proname
           order by namespace.nspname, procedure.proname
         )
    into v_invalid
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where (
      namespace.nspname = 'private'
      and procedure.proname in (
        'agent_p2_catalog_list_v1',
        'agent_p2_catalog_detail_v1',
        'agent_p2_catalog_attention_v1'
      )
      and (
        procedure.provolatile <> 's'
        or procedure.prosecdef
        or pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
      )
    ) or (
      namespace.nspname = 'public'
      and procedure.proname in (
        'read_agent_catalog_items_as_system',
        'read_agent_catalog_item_as_system'
      )
      and (
        procedure.provolatile <> 's'
        or not procedure.prosecdef
        or not pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        )
        or pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
      )
    );

  if v_invalid is not null then
    raise exception 'agent_catalog_reads_postflight_invalid: %',
      pg_catalog.array_to_string(v_invalid, ',')
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
