-- Recipe engine: a scaled recipe line never falls back to the line quantity.
--
-- A product_materials row with scaled_by_option_id is counted per option unit
-- (end posts per "Left ends", sleeves per "45° corners"). Until now, when the
-- line's configured_options carried no number for that option, the resolver
-- silently used quantity_per_unit x line quantity: a 20 ft railing with no end
-- count booked 20 end posts. Now the scaled value is read as a jsonb number or
-- a numeric string (legacy writers); anything else books 0 and raises warning
-- `scaled_option_value_missing` on the run and on that material's demand row.
-- The demand row is still emitted so the warning names a concrete material.
--
-- Only the scaled block and its three working variables change. The body is
-- otherwise byte-exact with production (definition md5 checked below). No
-- grants, owners, rows, triggers or activation state change.
begin;
set local lock_timeout = '5s';

do $preflight$
declare
  v_oid oid := to_regprocedure('private.resolve_estimate_material_demand_plan(uuid,uuid)');
  v_md5 text;
begin
  if current_user <> 'postgres' then
    raise exception 'recipe_scaled_option_missing_owner_required' using errcode = '55000';
  end if;
  if v_oid is null then
    raise exception 'recipe_scaled_option_missing_source_drift: resolver missing' using errcode = '55000';
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_md5
    from pg_proc p
   where p.oid = v_oid
     and pg_get_userbyid(p.proowner) = 'postgres';
  -- 9cfa431e… is the production body captured 2026-09-15; 70bc716b… is this
  -- migration's body, so a replay is a no-op rather than a failure.
  if v_md5 is distinct from '9cfa431e79c4df4e7aeed00d3c9ccd87'
     and v_md5 is distinct from '70bc716bd98576551498fe40f91c9c94' then
    raise exception 'recipe_scaled_option_missing_source_drift: %', coalesce(v_md5, 'owner')
      using errcode = '55000';
  end if;
end;
$preflight$;

CREATE OR REPLACE FUNCTION private.resolve_estimate_material_demand_plan(p_estimate_id uuid, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare
  v_actor_user_id uuid;
  v_actor_company_id uuid;
  v_estimate_company_id uuid;
  v_estimate_status text;
  v_estimate_project_ref uuid;
  v_estimate_project_id_text text;
  v_project_id uuid;
  v_inventory_mode text := 'off';
  v_demands jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_missing_mappings jsonb := '[]'::jsonb;
  v_overruns jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_line record;
  v_material record;
  v_recipe_count integer;
  v_resolution jsonb;
  v_available jsonb;
  v_catalog_variant_id uuid;
  v_required_quantity numeric;
  v_available_quantity numeric;
  v_projected_overrun_quantity numeric;
  v_demand_key text;
  v_material_warning_payload jsonb;
  v_schema_ready boolean := true;
  v_scaled_raw jsonb;
  v_scaled_value numeric;
  v_scaled_warning jsonb;
begin
  if p_estimate_id is null then
    raise exception 'estimate_id_required' using errcode = '22023';
  end if;

  v_actor_user_id := private.get_current_user_id();
  v_actor_company_id := private.get_user_company_id();

  if v_actor_user_id is null or v_actor_company_id is null then
    raise exception 'actor_company_not_found' using errcode = '42501';
  end if;

  select estimate_row.company_id,
         estimate_row.status,
         estimate_row.project_ref,
         estimate_row.project_id
    into v_estimate_company_id,
         v_estimate_status,
         v_estimate_project_ref,
         v_estimate_project_id_text
    from public.estimates estimate_row
   where estimate_row.id = p_estimate_id
     and estimate_row.deleted_at is null;

  if v_estimate_company_id is null then
    raise exception 'estimate_not_found' using errcode = 'P0002';
  end if;

  if v_estimate_company_id is distinct from v_actor_company_id then
    raise exception 'estimate_company_scope_mismatch' using errcode = '42501';
  end if;

  v_project_id := coalesce(
    p_project_id,
    v_estimate_project_ref,
    case
      when v_estimate_project_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then v_estimate_project_id_text::uuid
      else null
    end
  );

  if v_project_id is not null
     and not exists (
       select 1
         from public.projects project_row
        where project_row.id = v_project_id
          and project_row.company_id = v_estimate_company_id
          and project_row.deleted_at is null
     ) then
    raise exception 'project_company_scope_mismatch' using errcode = '42501';
  end if;

  if to_regclass('public.company_inventory_settings') is null then
    v_schema_ready := false;
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'p6_2_inventory_settings_not_installed',
      'detail', 'company_inventory_settings is required before tracked material demand can run'
    ));
    return jsonb_build_object(
      'ok', false,
      'schema_ready', v_schema_ready,
      'estimate_id', p_estimate_id,
      'project_id', v_project_id,
      'company_id', v_estimate_company_id,
      'inventory_mode', 'schema_pending',
      'material_demand_performed', false,
      'demands', v_demands,
      'warnings', v_warnings,
      'missing_mappings', v_missing_mappings,
      'overruns', v_overruns,
      'blockers', v_blockers
    );
  end if;

  execute
    'select coalesce(settings.inventory_mode, ''off'')
       from public.company_inventory_settings settings
      where settings.company_id = $1'
    into v_inventory_mode
    using v_estimate_company_id;

  v_inventory_mode := coalesce(v_inventory_mode, 'off');

  if v_inventory_mode = 'off' then
    return jsonb_build_object(
      'ok', true,
      'schema_ready', v_schema_ready,
      'estimate_id', p_estimate_id,
      'project_id', v_project_id,
      'company_id', v_estimate_company_id,
      'inventory_mode', v_inventory_mode,
      'material_demand_performed', false,
      'demands', v_demands,
      'warnings', v_warnings,
      'missing_mappings', v_missing_mappings,
      'overruns', v_overruns,
      'blockers', v_blockers
    );
  end if;

  if v_inventory_mode <> 'tracked' then
    raise exception 'invalid_inventory_mode' using errcode = '22023';
  end if;

  if v_estimate_status not in ('approved', 'converted') then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'estimate_not_accepted_for_material_demand',
      'estimate_status', v_estimate_status
    ));

    return jsonb_build_object(
      'ok', true,
      'schema_ready', v_schema_ready,
      'estimate_id', p_estimate_id,
      'project_id', v_project_id,
      'company_id', v_estimate_company_id,
      'inventory_mode', v_inventory_mode,
      'material_demand_performed', false,
      'demands', v_demands,
      'warnings', v_warnings,
      'missing_mappings', v_missing_mappings,
      'overruns', v_overruns,
      'blockers', v_blockers
    );
  end if;

  if v_project_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'project_id_required_for_material_demand',
      'estimate_id', p_estimate_id
    ));

    return jsonb_build_object(
      'ok', false,
      'schema_ready', v_schema_ready,
      'estimate_id', p_estimate_id,
      'project_id', v_project_id,
      'company_id', v_estimate_company_id,
      'inventory_mode', v_inventory_mode,
      'material_demand_performed', false,
      'demands', v_demands,
      'warnings', v_warnings,
      'missing_mappings', v_missing_mappings,
      'overruns', v_overruns,
      'blockers', v_blockers
    );
  end if;

  for v_line in
    select
      line_item.id as line_item_id,
      line_item.product_id,
      line_item.name as line_name,
      line_item.description as line_description,
      line_item.quantity::numeric as line_quantity,
      line_item.unit_id,
      line_item.unit,
      line_item.type as line_type,
      line_item.is_optional,
      line_item.is_selected,
      line_item.parent_line_item_id,
      coalesce(line_item.configured_options, '{}'::jsonb) as configured_options,
      product_row.name as product_name,
      product_row.kind as product_kind,
      product_row.type as product_type,
      product_row.linked_catalog_item_id,
      coalesce(task_for_line.id, scope_task_for_line.task_id, task_for_parent.id, scope_task_for_parent.task_id) as task_id
    from public.line_items line_item
    join public.products product_row
      on product_row.id = line_item.product_id
     and product_row.company_id = line_item.company_id
     and product_row.deleted_at is null
    left join public.project_tasks task_for_line
      on task_for_line.company_id = line_item.company_id
     and task_for_line.project_id = v_project_id
     and task_for_line.source_estimate_id = p_estimate_id::text
     and task_for_line.source_line_item_id = line_item.id::text
     and task_for_line.deleted_at is null
    left join public.project_tasks task_for_parent
      on task_for_parent.company_id = line_item.company_id
     and task_for_parent.project_id = v_project_id
     and task_for_parent.source_estimate_id = p_estimate_id::text
     and task_for_parent.source_line_item_id = line_item.parent_line_item_id::text
     and task_for_parent.deleted_at is null
    -- Task groups: a line carried as a scope of a grouped task maps to that task.
    left join lateral (
      select scope_row.task_id
        from public.task_scopes scope_row
        join public.project_tasks scope_task on scope_task.id = scope_row.task_id
       where scope_row.company_id = line_item.company_id
         and scope_row.deleted_at is null
         and scope_row.source_line_item_id = line_item.id::text
         and scope_task.project_id = v_project_id
         and scope_task.source_estimate_id = p_estimate_id::text
         and scope_task.deleted_at is null
       order by scope_row.created_at, scope_row.id
       limit 1
    ) scope_task_for_line on true
    left join lateral (
      select scope_row.task_id
        from public.task_scopes scope_row
        join public.project_tasks scope_task on scope_task.id = scope_row.task_id
       where scope_row.company_id = line_item.company_id
         and scope_row.deleted_at is null
         and scope_row.source_line_item_id = line_item.parent_line_item_id::text
         and scope_task.project_id = v_project_id
         and scope_task.source_estimate_id = p_estimate_id::text
         and scope_task.deleted_at is null
       order by scope_row.created_at, scope_row.id
       limit 1
    ) scope_task_for_parent on true
    where line_item.company_id = v_estimate_company_id
      and line_item.estimate_id = p_estimate_id
      and line_item.product_id is not null
      and coalesce(line_item.is_selected, true) = true
      and (
        coalesce(line_item.is_optional, false) = false
        or line_item.is_selected = true
      )
    order by coalesce(line_item.sort_order, 0), line_item.id
  loop
    select count(*)::integer
      into v_recipe_count
      from public.product_materials material_row
     where material_row.product_id = v_line.product_id
       and material_row.deleted_at is null;

    for v_material in
      select
        material_row.id as product_material_id,
        material_row.catalog_variant_id,
        material_row.catalog_item_id,
        material_row.variant_selector,
        material_row.quantity_per_unit::numeric as quantity_per_unit,
        material_row.scaled_by_option_id,
        material_row.unit_id,
        material_row.notes
      from public.product_materials material_row
      where material_row.product_id = v_line.product_id
        and material_row.deleted_at is null
      order by material_row.id
    loop
      v_catalog_variant_id := v_material.catalog_variant_id;
      v_material_warning_payload := '[]'::jsonb;

      if v_catalog_variant_id is null and v_material.catalog_item_id is not null then
        v_resolution := private.resolve_catalog_variant_for_material_demand(
          v_estimate_company_id,
          v_line.product_id,
          v_material.catalog_item_id,
          v_line.configured_options,
          coalesce(v_material.variant_selector, '{}'::jsonb)
        );

        v_catalog_variant_id := private.try_parse_uuid(v_resolution ->> 'catalog_variant_id');
        v_material_warning_payload := coalesce(v_resolution -> 'warnings', '[]'::jsonb);
        v_warnings := v_warnings || v_material_warning_payload;
        v_missing_mappings := v_missing_mappings || coalesce(v_resolution -> 'missing_mappings', '[]'::jsonb);
      end if;

      if v_catalog_variant_id is null then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'recipe_material_variant_unresolved',
          'estimate_id', p_estimate_id,
          'line_item_id', v_line.line_item_id,
          'product_id', v_line.product_id,
          'product_material_id', v_material.product_material_id
        ));
        continue;
      end if;

      if v_material.scaled_by_option_id is not null then
        v_scaled_raw := v_line.configured_options -> v_material.scaled_by_option_id::text;
        v_scaled_value := case
          when v_scaled_raw is null then null
          when jsonb_typeof(v_scaled_raw) = 'number' then (v_scaled_raw #>> '{}')::numeric
          when jsonb_typeof(v_scaled_raw) = 'string'
               and (v_scaled_raw #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$'
            then btrim(v_scaled_raw #>> '{}')::numeric
          else null
        end;
        if v_scaled_value is null then
          v_required_quantity := 0;
          v_scaled_warning := jsonb_build_object(
            'code', 'scaled_option_value_missing',
            'estimate_id', p_estimate_id,
            'line_item_id', v_line.line_item_id,
            'product_id', v_line.product_id,
            'product_material_id', v_material.product_material_id,
            'product_option_id', v_material.scaled_by_option_id,
            'configured_value', v_scaled_raw
          );
          v_warnings := v_warnings || jsonb_build_array(v_scaled_warning);
          v_material_warning_payload := v_material_warning_payload || jsonb_build_array(v_scaled_warning);
        else
          v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
            * greatest(v_scaled_value, 0);
        end if;
      else
        v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
          * greatest(coalesce(v_line.line_quantity, 0), 0);
      end if;

      v_available := private.catalog_variant_available_stock_summary(
        v_estimate_company_id,
        v_catalog_variant_id
      );
      v_available_quantity := coalesce((v_available ->> 'effective_available_quantity')::numeric, 0);
      v_projected_overrun_quantity := greatest(v_required_quantity - v_available_quantity, 0);
      v_demand_key := 'estimate:' || p_estimate_id::text
        || ':line:' || v_line.line_item_id::text
        || ':product_material:' || v_material.product_material_id::text
        || ':variant:' || v_catalog_variant_id::text;

      v_demands := v_demands || jsonb_build_array(jsonb_build_object(
        'demand_key', v_demand_key,
        'source', 'estimate_acceptance',
        'status', case when v_projected_overrun_quantity > 0 then 'warning' else 'projected' end,
        'company_id', v_estimate_company_id,
        'project_id', v_project_id,
        'task_id', v_line.task_id,
        'estimate_id', p_estimate_id,
        'line_item_id', v_line.line_item_id,
        'product_id', v_line.product_id,
        'product_material_id', v_material.product_material_id,
        'catalog_variant_id', v_catalog_variant_id,
        'unit_id', coalesce(v_material.unit_id, v_line.unit_id),
        'required_quantity', v_required_quantity,
        'available_quantity_at_booking', v_available_quantity,
        'projected_overrun_quantity', v_projected_overrun_quantity,
        'resolver_payload', jsonb_build_object(
          'line_name', coalesce(v_line.line_name, v_line.line_description, v_line.product_name),
          'product_name', v_line.product_name,
          'line_quantity', v_line.line_quantity,
          'line_type', v_line.line_type,
          'line_is_optional', v_line.is_optional,
          'line_is_selected', v_line.is_selected,
          'configured_options', v_line.configured_options,
          'availability', v_available
        ),
        'warning_payload', jsonb_build_object(
          'warnings', v_material_warning_payload,
          'available_quantity_at_booking', v_available_quantity,
          'projected_overrun_quantity', v_projected_overrun_quantity
        )
      ));

      if v_projected_overrun_quantity > 0 then
        v_overruns := v_overruns || jsonb_build_array(jsonb_build_object(
          'demand_key', v_demand_key,
          'line_item_id', v_line.line_item_id,
          'product_id', v_line.product_id,
          'catalog_variant_id', v_catalog_variant_id,
          'required_quantity', v_required_quantity,
          'available_quantity_at_booking', v_available_quantity,
          'projected_overrun_quantity', v_projected_overrun_quantity,
          'availability_basis', v_available ->> 'availability_basis'
        ));
      end if;
    end loop;

    if v_recipe_count = 0
       and v_line.linked_catalog_item_id is not null
       and (v_line.product_kind = 'material' or v_line.product_type = 'MATERIAL') then
      v_resolution := private.resolve_catalog_variant_for_material_demand(
        v_estimate_company_id,
        v_line.product_id,
        v_line.linked_catalog_item_id,
        v_line.configured_options,
        '{}'::jsonb
      );

      v_catalog_variant_id := private.try_parse_uuid(v_resolution ->> 'catalog_variant_id');
      v_material_warning_payload := coalesce(v_resolution -> 'warnings', '[]'::jsonb);
      v_warnings := v_warnings || v_material_warning_payload;
      v_missing_mappings := v_missing_mappings || coalesce(v_resolution -> 'missing_mappings', '[]'::jsonb);

      if v_catalog_variant_id is null then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
          'code', 'linked_product_variant_unresolved',
          'estimate_id', p_estimate_id,
          'line_item_id', v_line.line_item_id,
          'product_id', v_line.product_id,
          'catalog_item_id', v_line.linked_catalog_item_id
        ));
        continue;
      end if;

      v_required_quantity := greatest(coalesce(v_line.line_quantity, 0), 0);
      v_available := private.catalog_variant_available_stock_summary(
        v_estimate_company_id,
        v_catalog_variant_id
      );
      v_available_quantity := coalesce((v_available ->> 'effective_available_quantity')::numeric, 0);
      v_projected_overrun_quantity := greatest(v_required_quantity - v_available_quantity, 0);
      v_demand_key := 'estimate:' || p_estimate_id::text
        || ':line:' || v_line.line_item_id::text
        || ':product:' || v_line.product_id::text
        || ':variant:' || v_catalog_variant_id::text;

      v_demands := v_demands || jsonb_build_array(jsonb_build_object(
        'demand_key', v_demand_key,
        'source', 'estimate_acceptance',
        'status', case when v_projected_overrun_quantity > 0 then 'warning' else 'projected' end,
        'company_id', v_estimate_company_id,
        'project_id', v_project_id,
        'task_id', v_line.task_id,
        'estimate_id', p_estimate_id,
        'line_item_id', v_line.line_item_id,
        'product_id', v_line.product_id,
        'product_material_id', null,
        'catalog_variant_id', v_catalog_variant_id,
        'unit_id', v_line.unit_id,
        'required_quantity', v_required_quantity,
        'available_quantity_at_booking', v_available_quantity,
        'projected_overrun_quantity', v_projected_overrun_quantity,
        'resolver_payload', jsonb_build_object(
          'line_name', coalesce(v_line.line_name, v_line.line_description, v_line.product_name),
          'product_name', v_line.product_name,
          'line_quantity', v_line.line_quantity,
          'line_type', v_line.line_type,
          'line_is_optional', v_line.is_optional,
          'line_is_selected', v_line.is_selected,
          'configured_options', v_line.configured_options,
          'linked_catalog_item_id', v_line.linked_catalog_item_id,
          'availability', v_available
        ),
        'warning_payload', jsonb_build_object(
          'warnings', v_material_warning_payload,
          'available_quantity_at_booking', v_available_quantity,
          'projected_overrun_quantity', v_projected_overrun_quantity
        )
      ));

      if v_projected_overrun_quantity > 0 then
        v_overruns := v_overruns || jsonb_build_array(jsonb_build_object(
          'demand_key', v_demand_key,
          'line_item_id', v_line.line_item_id,
          'product_id', v_line.product_id,
          'catalog_variant_id', v_catalog_variant_id,
          'required_quantity', v_required_quantity,
          'available_quantity_at_booking', v_available_quantity,
          'projected_overrun_quantity', v_projected_overrun_quantity,
          'availability_basis', v_available ->> 'availability_basis'
        ));
      end if;
    elsif v_recipe_count = 0
       and v_line.linked_catalog_item_id is null
       and (v_line.product_kind = 'material' or v_line.product_type = 'MATERIAL') then
      v_missing_mappings := v_missing_mappings || jsonb_build_array(jsonb_build_object(
        'code', 'material_product_catalog_link_missing',
        'dedupe_key', 'catalog_mapping_needed:product:' || v_line.product_id::text || ':linked_catalog_item',
        'estimate_id', p_estimate_id,
        'line_item_id', v_line.line_item_id,
        'product_id', v_line.product_id
      ));
    end if;
  end loop;

  v_warnings := v_warnings || v_missing_mappings;

  return jsonb_build_object(
    'ok', true,
    'schema_ready', v_schema_ready,
    'estimate_id', p_estimate_id,
    'project_id', v_project_id,
    'company_id', v_estimate_company_id,
    'inventory_mode', v_inventory_mode,
    'material_demand_performed', true,
    'selection_rule', jsonb_build_object(
      'estimate_statuses', jsonb_build_array('approved', 'converted'),
      'line_filter', 'selected_non_optional_or_explicitly_selected_optional'
    ),
    'demand_count', jsonb_array_length(v_demands),
    'warning_count', jsonb_array_length(v_warnings),
    'missing_mapping_count', jsonb_array_length(v_missing_mappings),
    'overrun_count', jsonb_array_length(v_overruns),
    'demands', v_demands,
    'warnings', v_warnings,
    'missing_mappings', v_missing_mappings,
    'overruns', v_overruns,
    'blockers', v_blockers
  );
end;
$function$
;

do $postflight$
begin
  if not exists (
    select 1
      from pg_proc p
     where p.oid = to_regprocedure('private.resolve_estimate_material_demand_plan(uuid,uuid)')
       and pg_get_userbyid(p.proowner) = 'postgres'
       and md5(pg_get_functiondef(p.oid)) = '70bc716bd98576551498fe40f91c9c94'
  ) then
    raise exception 'recipe_scaled_option_missing_install_drift' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
