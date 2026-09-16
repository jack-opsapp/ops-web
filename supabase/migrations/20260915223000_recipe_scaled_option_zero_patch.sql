-- Recipe engine: apply the scaled-line fix to production's own function bytes.
--
-- Same end state as 20260915220000_recipe_scaled_option_missing_zero.sql (that
-- file carries the full CREATE OR REPLACE and is what was proved locally). This
-- one patches the live definition in place instead of restating 500 lines, so
-- production's body cannot drift from what was verified: it reads
-- pg_get_functiondef, swaps exactly two blocks, and refuses unless the result
-- hashes to the definition the local proof produced.
--
-- Replay-safe: an already-patched function returns early, and any other body
-- aborts the transaction. Behaviour change is documented on the source file.
begin;
set local lock_timeout = '5s';

do $patch$
declare
  v_oid oid := to_regprocedure('private.resolve_estimate_material_demand_plan(uuid,uuid)');
  v_src text;
  v_new text;
  v_md5 text;
begin
  if current_user <> 'postgres' then
    raise exception 'recipe_scaled_option_missing_owner_required' using errcode = '55000';
  end if;
  if v_oid is null then
    raise exception 'recipe_scaled_option_missing_source_drift: resolver missing' using errcode = '55000';
  end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
   where p.oid = v_oid
     and pg_get_userbyid(p.proowner) = 'postgres';

  if md5(v_src) = '70bc716bd98576551498fe40f91c9c94' then
    return; -- already applied
  end if;
  if md5(v_src) is distinct from '9cfa431e79c4df4e7aeed00d3c9ccd87' then
    raise exception 'recipe_scaled_option_missing_source_drift: %', coalesce(md5(v_src), 'owner')
      using errcode = '55000';
  end if;

  v_new := replace(v_src, $old_declare$  v_material_warning_payload jsonb;
  v_schema_ready boolean := true;$old_declare$, $new_declare$  v_material_warning_payload jsonb;
  v_schema_ready boolean := true;
  v_scaled_raw jsonb;
  v_scaled_value numeric;
  v_scaled_warning jsonb;$new_declare$);
  v_new := replace(v_new, $old_scaled$
      v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
        * greatest(coalesce(v_line.line_quantity, 0), 0);

      if v_material.scaled_by_option_id is not null
         and v_line.configured_options ? v_material.scaled_by_option_id::text
         and jsonb_typeof(v_line.configured_options -> v_material.scaled_by_option_id::text) = 'number' then
        v_required_quantity := greatest(coalesce(v_material.quantity_per_unit, 0), 0)
          * greatest(((v_line.configured_options ->> v_material.scaled_by_option_id::text)::numeric), 0);$old_scaled$, $new_scaled$
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
          * greatest(coalesce(v_line.line_quantity, 0), 0);$new_scaled$);

  if v_new = v_src then
    raise exception 'recipe_scaled_option_missing_patch_no_match' using errcode = '55000';
  end if;

  execute v_new;

  select md5(pg_get_functiondef(p.oid)) into v_md5
    from pg_proc p where p.oid = v_oid;
  if v_md5 is distinct from '70bc716bd98576551498fe40f91c9c94' then
    raise exception 'recipe_scaled_option_missing_install_drift: %', coalesce(v_md5, 'missing')
      using errcode = '55000';
  end if;
end;
$patch$;

commit;
