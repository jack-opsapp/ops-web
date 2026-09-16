-- Catalogue detail recipes gain an exposure-selected shape. Shape v1 keeps the
-- byte-identical projection every pin through '2026-09-10.mcp-exposure.v23'
-- already reads; shape v2 adds the family reference, variant selector, authored
-- quantity, scaling option and the referenced products' own options so a recipe
-- line can be audited without SQL access (ops-mcp-gaps #27).
--
-- The migration also teaches every place that accepts V23 to accept
-- '2026-09-15.mcp-exposure.v24' beside it. V24 carries the whole V23 tool set,
-- including prepare_customer_update, so token resolution, customer-update
-- authority, the prepare rate limiter and the prepare wrapper must all name it.
-- No client, grant, token, consent row, effect-policy seal or business row is
-- created or changed here.
--
-- Base: private.agent_p2_catalog_detail_v1 as left by
-- 20260830180000_agent_catalog_empty_supplier_costs.sql
-- (prosrc md5 bb36d87af76f5e759a58a3bf7183c42e, 28366 bytes,
--  sha256 8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
declare
  v_expected_owner oid := (
    select role.oid from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_signature constant text :=
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)';
  v_wrapper constant text :=
    'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)';
  v_base_md5 constant text := 'bb36d87af76f5e759a58a3bf7183c42e';
  v_base_sha256 constant text :=
    '8cd62292b72bb7dab9baa3b4db1eac406127c85ee8e7e0d694ef834589d6019d';
  v_source_md5 text;
  v_source_sha256 text;
  v_missing text[];
begin
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'agent_catalog_recipe_read_prerequisite_missing: digest'
      using errcode = '55000';
  end if;
  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('function', v_signature),
      ('function', v_wrapper),
      ('function', 'private.agent_p2_catalog_float8_milliunits_v1(double precision)'),
      ('function', 'private.agent_p2_optional_canonical_text(text,integer,integer,boolean)'),
      ('function', 'public.resolve_mcp_oauth_access_token_as_system(text,text)'),
      ('function', 'private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)'),
      ('function', 'public.consume_agent_customer_update_prepare_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)'),
      ('function', 'public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamp with time zone)'),
      ('table', 'public.product_options'),
      ('table', 'public.product_option_values'),
      ('table', 'public.product_materials'),
      ('table', 'private.agent_catalog_trial_bindings'),
      ('table', 'private.agent_site_visit_trial_bindings'),
      ('table', 'private.mcp_oauth_canary_bindings')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_catalog_recipe_read_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;

  -- Replace exactly the definition this migration was written against.
  select pg_catalog.md5(procedure.prosrc),
         pg_catalog.encode(
           extensions.digest(
             pg_catalog.convert_to(procedure.prosrc, 'UTF8'), 'sha256'
           ),
           'hex'
         )
    into strict v_source_md5, v_source_sha256
  from pg_catalog.pg_proc procedure
  where procedure.oid = pg_catalog.to_regprocedure(v_signature)::oid;
  if v_source_md5 is distinct from v_base_md5
     or v_source_sha256 is distinct from v_base_sha256 then
    raise exception 'agent_catalog_recipe_read_source_drift: % %',
      v_source_md5, v_source_sha256 using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_language language on language.oid = procedure.prolang
    where procedure.oid = pg_catalog.to_regprocedure(v_signature)::oid
      and namespace.nspname = 'private'
      and language.lanname = 'plpgsql'
      and procedure.proowner = v_expected_owner
      and not procedure.prosecdef
      and procedure.provolatile = 's'
      and not procedure.proisstrict
      and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'agent_catalog_recipe_read_security_identity_drift'
      using errcode = '55000';
  end if;

  -- Both live effect seals hash every mcp_oauth function definition. Never
  -- stale a running trial by rewriting token resolution underneath it.
  lock table private.agent_catalog_trial_bindings,
             private.agent_site_visit_trial_bindings,
             private.mcp_oauth_canary_bindings in share mode;
  if exists (
       select 1 from private.agent_catalog_trial_bindings
       where disabled_at is null and expires_at > clock_timestamp()
     )
     or exists (
       select 1 from private.agent_site_visit_trial_bindings
       where disabled_at is null and expires_at > clock_timestamp()
     )
     or exists (
       select 1 from private.mcp_oauth_canary_bindings
       where disabled_at is null and expires_at > clock_timestamp()
     ) then
    raise exception
      'agent_catalog_recipe_read_active_trial_requires_separate_rollout'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Both readers gain arguments, so the pre-shape overloads are removed rather
-- than left resolvable by name.
drop function private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer);
drop function public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer);

-- Recipe shape v2 reports a line's authored quantity at four decimal places
-- beside the three-decimal milliunit integer, which silently drops anything
-- finer than a thousandth. Four decimals covers every authored quantity in
-- production today; a finer value still returns null and fails the source
-- check rather than being rounded into a wrong number.
create or replace function private.agent_p2_catalog_float8_decimal4_v1(
  p_value double precision
) returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
set extra_float_digits = 3
as $function$
declare
  v_numeric numeric;
begin
  if p_value in (
    'NaN'::double precision,
    'Infinity'::double precision,
    '-Infinity'::double precision
  ) then
    return null;
  end if;
  v_numeric := p_value::text::numeric;
  if v_numeric < 0
     or v_numeric > 9007199254740.991
     or pg_catalog.round(v_numeric, 4) <> v_numeric then
    return null;
  end if;
  return pg_catalog.to_char(
    pg_catalog.round(v_numeric, 4), 'FM9999999999990.0000'
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
  p_supplier_cost_fetch_limit integer,
  p_recipe_shape text,
  p_recipe_selector_key_limit integer,
  p_recipe_product_limit integer,
  p_recipe_product_fetch_limit integer,
  p_recipe_option_limit integer,
  p_recipe_option_fetch_limit integer,
  p_recipe_option_value_limit integer,
  p_recipe_option_value_fetch_limit integer
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
  v_recipe_selector_key_max integer;
  v_recipe_product_count integer := 0;
  v_recipe_option_count integer := 0;
  v_recipe_option_value_count integer := 0;
  v_recipe_products jsonb := '[]'::jsonb;
  v_recipe_products_invalid boolean := false;
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
     or p_supplier_cost_fetch_limit is distinct from 65
     or p_recipe_shape is null
     or p_recipe_shape not in ('v1', 'v2')
     or p_recipe_selector_key_limit is distinct from 32
     or p_recipe_product_limit is distinct from 64
     or p_recipe_product_fetch_limit is distinct from 65
     or p_recipe_option_limit is distinct from 128
     or p_recipe_option_fetch_limit is distinct from 129
     or p_recipe_option_value_limit is distinct from 512
     or p_recipe_option_value_fetch_limit is distinct from 513 then
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
           null::uuid as unit_id,
           null::uuid as material_id,
           null::uuid as material_family_id,
           null::jsonb as raw_variant_selector,
           null::uuid as scaled_by_option_id
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
           material.unit_id,
           material.id,
           material.catalog_item_id,
           material.variant_selector,
           material.scaled_by_option_id
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
    -- The material id only breaks ties the pre-existing key leaves open. A
    -- truncated fetch always raises the bound below, so the retained set — and
    -- therefore every shape v1 byte — is unchanged.
    order by relationship, product_id, variant_id nulls first,
             material_id nulls first
    limit p_recipe_fetch_limit
  ), recipe_projection as materialized (
    select recipe.*,
           private.agent_p2_optional_canonical_text(
             recipe.product_name, 256, 1024, true
           ) as safe_product_name,
           private.agent_p2_catalog_float8_milliunits_v1(
             recipe.quantity_value
           )
             as quantity_milliunits,
           private.agent_p2_catalog_float8_decimal4_v1(
             recipe.quantity_value
           )
             as quantity_per_unit,
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
           scaled_option.id as scaled_option_id,
           private.agent_p2_optional_canonical_text(
             scaled_option.name, 160, 640, true
           ) as scaled_option_name,
           selector_state.entries as selector_entries,
           coalesce(selector_state.entry_count, 0) as selector_entry_count,
           coalesce(selector_state.source_invalid, false)
             as selector_invalid
    from raw_recipes recipe
    left join public.catalog_units unit_row
      on unit_row.id = recipe.unit_id
     and unit_row.company_id = p_company_id
     and unit_row.deleted_at is null
    -- A scaling option must still belong to the same live product. A dangling
    -- reference leaves the name null and fails the source check below.
    left join public.product_options scaled_option
      on scaled_option.id = recipe.scaled_by_option_id
     and scaled_option.product_id = recipe.product_id
     and scaled_option.deleted_at is null
    left join lateral (
      select pg_catalog.count(*)::integer as entry_count,
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'catalog_option_label', entry.safe_key,
                 'value_expression', entry.safe_value
               ) order by entry.raw_key collate "C"
             ) as entries,
             coalesce(
               pg_catalog.bool_or(
                 entry.safe_key is null or entry.safe_value is null
               ),
               false
             ) as source_invalid
      from (
        select selector.key as raw_key,
               private.agent_p2_optional_canonical_text(
                 selector.key, 160, 640, true
               ) as safe_key,
               private.agent_p2_optional_canonical_text(
                 selector.value, 160, 640, true
               ) as safe_value
        from pg_catalog.jsonb_each_text(
          case when p_recipe_shape = 'v2'
                and recipe.raw_variant_selector is not null
                and pg_catalog.jsonb_typeof(recipe.raw_variant_selector)
                      = 'object'
               then recipe.raw_variant_selector
               else '{}'::jsonb
          end
        ) selector
      ) entry
    ) selector_state on true
  )
  select pg_catalog.count(*)::integer,
         coalesce(
           pg_catalog.jsonb_agg(
             case when p_recipe_shape = 'v2' then
               pg_catalog.jsonb_build_object(
                 'product_ref', pg_catalog.jsonb_build_object(
                   'kind', 'product', 'id', recipe.product_id
                 ),
                 'product_label', recipe.safe_product_name,
                 'relationship', recipe.relationship,
                 'material_ref', case when recipe.material_id is null
                   then null
                   else pg_catalog.jsonb_build_object(
                     'kind', 'product_material', 'id', recipe.material_id
                   )
                 end,
                 'family_ref', case when recipe.material_family_id is null
                   then null
                   else pg_catalog.jsonb_build_object(
                     'kind', 'catalog_family', 'id', recipe.material_family_id
                   )
                 end,
                 'variant_ref', case when recipe.variant_id is null then null
                   else pg_catalog.jsonb_build_object(
                     'kind', 'catalog_variant', 'id', recipe.variant_id
                   )
                 end,
                 'variant_selector', case
                   when recipe.selector_entry_count = 0 then null
                   else recipe.selector_entries
                 end,
                 'quantity_milliunits', recipe.quantity_milliunits,
                 'quantity_per_unit', recipe.quantity_per_unit,
                 'quantity_basis', case
                   when recipe.relationship = 'stock_link' then null
                   when recipe.scaled_by_option_id is null
                     then 'per_product_unit'
                   else 'per_option_count'
                 end,
                 'scaled_by', case
                   when recipe.scaled_by_option_id is null then null
                   else pg_catalog.jsonb_build_object(
                     'option_ref', pg_catalog.jsonb_build_object(
                       'kind', 'product_option',
                       'id', recipe.scaled_by_option_id
                     ),
                     'option_name', recipe.scaled_option_name
                   )
                 end,
                 'unit', case when recipe.raw_unit_label is null then null
                   else pg_catalog.jsonb_build_object(
                     'label', recipe.unit_label,
                     'abbreviation', recipe.unit_abbreviation
                   )
                 end,
                 'content_kind', 'untrusted_business_data'
               )
             else
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
               )
             end order by recipe.relationship, recipe.product_id,
                        recipe.variant_id nulls first,
                        case when p_recipe_shape = 'v2'
                          then recipe.material_id
                        end nulls first
           ),
           '[]'::jsonb
         ),
         coalesce(
           pg_catalog.bool_or(
             recipe.safe_product_name is null
             or p_recipe_shape = 'v1'
                and recipe.relationship = 'recipe'
                and recipe.quantity_milliunits is null
             or recipe.raw_unit_label is not null
                and recipe.unit_label is null
             or recipe.raw_unit_abbreviation is not null
                and recipe.unit_abbreviation is null
             -- Shape v2 states the authored quantity at four decimals, so a
             -- line the three-decimal milliunit integer cannot carry is
             -- readable with quantity_milliunits null rather than refused.
             or p_recipe_shape = 'v2' and (
                  recipe.relationship = 'recipe'
                    and (
                      recipe.material_id is null
                      or recipe.quantity_per_unit is null
                    )
                  or recipe.relationship = 'stock_link'
                     and (
                       recipe.material_id is not null
                       or recipe.raw_variant_selector is not null
                       or recipe.scaled_by_option_id is not null
                     )
                  or recipe.material_family_id is not null
                     and recipe.material_family_id is distinct from v_family_id
                  or recipe.raw_variant_selector is not null
                     and pg_catalog.jsonb_typeof(recipe.raw_variant_selector)
                           is distinct from 'object'
                  or recipe.selector_invalid
                  or recipe.scaled_by_option_id is not null
                     and recipe.scaled_option_name is null
                )
           ),
           false
         ),
         coalesce(pg_catalog.max(recipe.selector_entry_count), 0)
    into v_recipe_count, v_recipes, v_recipe_invalid,
         v_recipe_selector_key_max
  from recipe_projection recipe;
  if v_recipe_count >= p_recipe_fetch_limit
     or v_recipe_selector_key_max > p_recipe_selector_key_limit then
    raise exception 'agent_catalog_result_bound'
      using errcode = '54000';
  end if;
  if v_recipe_invalid then
    raise exception 'agent_catalog_source_data_invalid'
      using errcode = '22023';
  end if;

  if p_recipe_shape = 'v2' then
    with recipe_product_source as materialized (
      select distinct on ((recipe.value #>> '{product_ref,id}')::uuid)
             (recipe.value #>> '{product_ref,id}')::uuid as product_id,
             recipe.value -> 'product_label' as product_label
      from pg_catalog.jsonb_array_elements(v_recipes) recipe(value)
      order by (recipe.value #>> '{product_ref,id}')::uuid
      limit p_recipe_product_fetch_limit
    ), recipe_option_source as materialized (
      select option_row.id,
             option_row.product_id,
             option_row.sort_order,
             option_row.kind,
             option_row.required,
             option_row.affects_recipe,
             private.agent_p2_optional_canonical_text(
               option_row.name, 160, 640, true
             ) as safe_name,
             option_row.default_value as raw_default_value,
             private.agent_p2_optional_canonical_text(
               option_row.default_value, 160, 640, true
             ) as safe_default_value
      from public.product_options option_row
      join recipe_product_source source
        on source.product_id = option_row.product_id
      where option_row.deleted_at is null
      order by option_row.product_id, option_row.sort_order, option_row.id
      limit p_recipe_option_fetch_limit
    ), recipe_option_value_source as materialized (
      select value_row.id,
             value_row.option_id,
             value_row.sort_order,
             private.agent_p2_optional_canonical_text(
               value_row.value, 160, 640, true
             ) as safe_value
      from public.product_option_values value_row
      join recipe_option_source option_row
        on option_row.id = value_row.option_id
      where value_row.deleted_at is null
      order by value_row.option_id, value_row.sort_order, value_row.id
      limit p_recipe_option_value_fetch_limit
    ), recipe_option_projection as materialized (
      select option_row.product_id,
             option_row.id,
             option_row.sort_order,
             option_row.safe_name is null
               or option_row.kind not in ('boolean', 'integer', 'select')
               or option_row.required is null
               or option_row.affects_recipe is null
               or option_row.sort_order < 0
               or option_row.sort_order > 9007199254740991
               or option_row.raw_default_value is not null
                  and option_row.safe_default_value is null
               or coalesce(value_state.source_invalid, false)
                 as source_invalid,
             pg_catalog.jsonb_build_object(
               'option_ref', pg_catalog.jsonb_build_object(
                 'kind', 'product_option', 'id', option_row.id
               ),
               'name', option_row.safe_name,
               'kind', option_row.kind,
               'required', option_row.required,
               'affects_recipe', option_row.affects_recipe,
               'default_value', option_row.safe_default_value,
               'values', coalesce(value_state.values, '[]'::jsonb),
               'content_kind', 'untrusted_business_data'
             ) as option_item
      from recipe_option_source option_row
      left join lateral (
        select pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'value_ref', pg_catalog.jsonb_build_object(
                     'kind', 'product_option_value', 'id', value_row.id
                   ),
                   'value', value_row.safe_value,
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
        from recipe_option_value_source value_row
        where value_row.option_id = option_row.id
      ) value_state on true
    ), recipe_product_projection as materialized (
      select source.product_id,
             pg_catalog.jsonb_build_object(
               'product_ref', pg_catalog.jsonb_build_object(
                 'kind', 'product', 'id', source.product_id
               ),
               'product_label', source.product_label,
               'options', coalesce(option_state.options, '[]'::jsonb),
               'content_kind', 'untrusted_business_data'
             ) as product_item,
             coalesce(option_state.source_invalid, false) as source_invalid
      from recipe_product_source source
      left join lateral (
        select pg_catalog.jsonb_agg(
                 projection.option_item
                 order by projection.sort_order, projection.id
               ) as options,
               coalesce(
                 pg_catalog.bool_or(projection.source_invalid), false
               ) as source_invalid
        from recipe_option_projection projection
        where projection.product_id = source.product_id
      ) option_state on true
    ), recipe_product_states as materialized (
      select (select pg_catalog.count(*)::integer from recipe_product_source)
               as product_count,
             (select pg_catalog.count(*)::integer from recipe_option_source)
               as option_count,
             (select pg_catalog.count(*)::integer
                from recipe_option_value_source) as option_value_count
    )
    select states.product_count,
           states.option_count,
           states.option_value_count,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.product_item order by projection.product_id
             ) filter (where projection.product_id is not null),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           )
      into v_recipe_product_count, v_recipe_option_count,
           v_recipe_option_value_count, v_recipe_products,
           v_recipe_products_invalid
    from recipe_product_states states
    left join recipe_product_projection projection on true
    group by states.product_count, states.option_count,
             states.option_value_count;
    if v_recipe_product_count >= p_recipe_product_fetch_limit
       or v_recipe_option_count >= p_recipe_option_fetch_limit
       or v_recipe_option_value_count >= p_recipe_option_value_fetch_limit then
      raise exception 'agent_catalog_result_bound'
        using errcode = '54000';
    end if;
    if v_recipe_products_invalid then
      raise exception 'agent_catalog_source_data_invalid'
        using errcode = '22023';
    end if;
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
    select pg_catalog.count(projection.id)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ) filter (where projection.id is not null),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from duplicate_state duplicate
    left join cost_projection projection on true
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
  ) || case when p_recipe_shape = 'v2'
    then pg_catalog.jsonb_build_object('recipe_products', v_recipe_products)
    else '{}'::jsonb
  end || case when p_include_supplier_costs
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
  ) || case when p_recipe_shape = 'v2'
    then pg_catalog.jsonb_build_object(
      'recipe_products', v_recipe_product_count,
      'recipe_product_options', v_recipe_option_count,
      'recipe_product_option_values', v_recipe_option_value_count
    )
    else '{}'::jsonb
  end;
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
  p_supplier_cost_fetch_limit integer,
  -- Shape is server-selected from the caller's MCP exposure revision, never
  -- from tool arguments. V23 and every earlier pin keep 'v1'.
  p_recipe_shape text default 'v1',
  p_recipe_selector_key_limit integer default 32,
  p_recipe_product_limit integer default 64,
  p_recipe_product_fetch_limit integer default 65,
  p_recipe_option_limit integer default 128,
  p_recipe_option_fetch_limit integer default 129,
  p_recipe_option_value_limit integer default 512,
  p_recipe_option_value_fetch_limit integer default 513
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
    p_supplier_cost_fetch_limit,
    p_recipe_shape,
    p_recipe_selector_key_limit,
    p_recipe_product_limit,
    p_recipe_product_fetch_limit,
    p_recipe_option_limit,
    p_recipe_option_fetch_limit,
    p_recipe_option_value_limit,
    p_recipe_option_value_fetch_limit
  );
  if v_result is null then
    raise exception 'agent_catalog_item_not_found_or_not_visible'
      using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

revoke all on function private.agent_p2_catalog_float8_decimal4_v1(
  double precision
) from public, anon, authenticated, service_role;
revoke all on function private.agent_p2_catalog_detail_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,integer,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;
revoke all on function public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,integer,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,integer,integer,integer,integer,integer,integer,integer
) to service_role;

-- Exposure V24 acceptance. Every V23 branch keeps its exact shape; V24 is only
-- added beside it, so existing V14 and V23 pins stay valid and immutable.
do $exposure$
declare
  item record;
  definition text;
  anchor_count integer;
begin
  for item in select * from (values
  ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
   $old$'2026-08-29.mcp-exposure.v2', '2026-09-04.mcp-exposure.v14', '2026-09-10.mcp-exposure.v23') then$old$,
   $new$'2026-08-29.mcp-exposure.v2', '2026-09-04.mcp-exposure.v14', '2026-09-10.mcp-exposure.v23', '2026-09-15.mcp-exposure.v24') then$new$),
  ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
   $old$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision='2026-09-08.mcp-exposure.v19'$old$,
   $new$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')
            and grant_record.exposure_revision='2026-09-08.mcp-exposure.v19'$new$),
  ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
   $old$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision='2026-09-07.mcp-exposure.v17'$old$,
   $new$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')
            and grant_record.exposure_revision='2026-09-07.mcp-exposure.v17'$new$),
  ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
   $old$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
            and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')$old$,
   $new$        or (p_active_exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')
            and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')$new$),
  ('public.resolve_mcp_oauth_access_token_as_system(text,text)',
   $old$        or (p_active_exposure_revision='2026-09-10.mcp-exposure.v23'
            and grant_record.exposure_revision='2026-09-10.mcp-exposure.v22'$old$,
   $new$        or (p_active_exposure_revision in ('2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')
            and grant_record.exposure_revision='2026-09-10.mcp-exposure.v22'$new$),
  ('private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)',
   $old$     or p_exposure_revision is null or p_exposure_revision not in
       ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')$old$,
   $new$     or p_exposure_revision is null or p_exposure_revision not in
       ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')$new$),
  ('public.consume_agent_customer_update_prepare_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)',
   $old$    and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23')
    and 'ops.customers.prepare'=any(grant_record.scopes);$old$,
   $new$    and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24')
    and 'ops.customers.prepare'=any(grant_record.scopes);$new$),
  ('public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamp with time zone)',
   $old$   and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23');$old$,
   $new$   and grant_record.exposure_revision in ('2026-09-04.mcp-exposure.v14','2026-09-10.mcp-exposure.v23','2026-09-15.mcp-exposure.v24');$new$)
  ) patch(signature, anchor, replacement) loop
    definition := pg_catalog.pg_get_functiondef(item.signature::regprocedure);
    anchor_count := (
      pg_catalog.length(definition) - pg_catalog.length(
        pg_catalog.replace(definition, item.anchor, '')
      )
    ) / pg_catalog.length(item.anchor);
    if anchor_count = 0
       and pg_catalog.strpos(definition, item.replacement) > 0 then
      continue;
    end if;
    if anchor_count <> 1 then
      raise exception 'agent_catalog_recipe_read_anchor_drift: % %',
        item.signature, anchor_count using errcode = '55000';
    end if;
    execute pg_catalog.replace(definition, item.anchor, item.replacement);
  end loop;
end;
$exposure$;

do $postflight$
declare
  v_expected_owner oid := (
    select role.oid from pg_catalog.pg_roles role
    where role.rolname = current_user
  );
  v_signature constant text :=
    'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,integer,integer,integer,integer,integer,integer,integer)';
  v_wrapper constant text :=
    'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,text,integer,integer,integer,integer,integer,integer,integer)';
  v_stale text[];
  item record;
begin
  if pg_catalog.to_regprocedure(
       'private.agent_p2_catalog_detail_v1(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'public.read_agent_catalog_item_as_system(text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer,integer)'
     ) is not null then
    raise exception 'agent_catalog_recipe_read_stale_overload'
      using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(v_signature) is null
     or pg_catalog.to_regprocedure(v_wrapper) is null
     or pg_catalog.to_regprocedure(
       'private.agent_p2_catalog_float8_decimal4_v1(double precision)'
     ) is null then
    raise exception 'agent_catalog_recipe_read_postflight_missing'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where procedure.oid = pg_catalog.to_regprocedure(v_signature)::oid
      and namespace.nspname = 'private'
      and procedure.proowner = v_expected_owner
      and not procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) or not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'private.agent_p2_catalog_float8_decimal4_v1(double precision)'
    )::oid
      and procedure.provolatile = 'i'
      and procedure.proisstrict
      and procedure.proparallel = 's'
      and not procedure.prosecdef
      and procedure.proconfig @> array[
        'search_path=""', 'extra_float_digits=3'
      ]::text[]
      and pg_catalog.cardinality(procedure.proconfig) = 2
      and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
  ) or not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where procedure.oid = pg_catalog.to_regprocedure(v_wrapper)::oid
      and namespace.nspname = 'public'
      and procedure.proowner = v_expected_owner
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig is not distinct from
            array['search_path=""']::text[]
      and pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('public', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ) then
    raise exception 'agent_catalog_recipe_read_postflight_invalid'
      using errcode = '55000';
  end if;

  -- Every V23 acceptance point now also names V24, and still names V23.
  for item in select * from (values
    ('public.resolve_mcp_oauth_access_token_as_system(text,text)'),
    ('private.assert_agent_customer_update_authority(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text)'),
    ('public.consume_agent_customer_update_prepare_rate_limit_as_system(text,uuid,uuid,uuid,text,text,integer,text)'),
    ('public.prepare_agent_customer_update_for_grant_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,jsonb,timestamp with time zone)')
  ) expected(signature) loop
    if pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(item.signature::regprocedure),
         '2026-09-15.mcp-exposure.v24'
       ) = 0
       or pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(item.signature::regprocedure),
         '2026-09-10.mcp-exposure.v23'
       ) = 0 then
      raise exception 'agent_catalog_recipe_read_exposure_postflight: %',
        item.signature using errcode = '55000';
    end if;
  end loop;
  v_stale := null;
  if v_stale is not null then
    raise exception 'agent_catalog_recipe_read_postflight_invalid'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
