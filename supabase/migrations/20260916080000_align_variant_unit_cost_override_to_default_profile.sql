-- Re-align the four `catalog_variants.unit_cost_override` values that the cost
-- rounding in 20260916060000 left disagreeing with their own default supplier
-- cost profile, and write the precedence rule down where the data lives.
--
-- THE RULE. OPS carries two cost models: the richer
-- `catalog_supplier_cost_profiles` (one default per variant, activation rules,
-- source provenance) and the flat catalogue pair
-- `catalog_variants.unit_cost_override` / `catalog_items.default_unit_cost`.
-- The default supplier profile is canonical. The catalogue mirror of it is
-- `coalesce(variant.unit_cost_override, item.default_unit_cost)` — the same
-- coalesce the sale price uses — and it must be written AT WHICHEVER LEVEL THE
-- FAMILY ALREADY USES. A family costed at item level keeps its variants'
-- override NULL on purpose: that is inheritance working, not drift, and writing
-- the profile cost down onto those variants would silently convert the family
-- to variant-level costing (a later family-level cost change would stop
-- reaching them). Today nothing in estimating or job costing reads either
-- field (verified 2026-09-16); the two readers that exist —
-- `private.agent_p2_catalog_detail_v1` and
-- `private.agent_p2_purchase_order_cost_witness_v1` — read the profile.
--
-- WHAT THIS TOUCHES. Only variants whose override IS SET and disagrees with
-- their default profile: on 2026-09-16 that is exactly the four Canpro Glass
-- Panel rows the rounding moved (4.1992, 4.2804, 9.2684, 9.7440 against the
-- rounded profile). Variants with a NULL override are left alone regardless of
-- what their profile says — for every one of them the family default already
-- equals the profile, and a guard below refuses to run if that ever stops
-- being true, because that would be a precedence question for a human.
--
-- AUDITABLE AND REVERSIBLE. Every changed row goes into the same ledger as the
-- afternoon's other repairs, `private.catalog_text_repairs_20260916`, as
-- table_name = 'catalog_variants', column_name = 'unit_cost_override', with the
-- exact stored text on both sides.
--
-- NOT AN EFFECT CHANGE. Data only; no function or trigger the catalogue write
-- seal hashes is touched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
begin
  if pg_catalog.to_regclass('private.catalog_text_repairs_20260916') is null
     or pg_catalog.to_regclass('public.catalog_supplier_cost_profiles') is null
     or pg_catalog.to_regclass('public.catalog_variants') is null then
    raise exception 'align_unit_cost_override_prerequisite_missing' using errcode = '55000';
  end if;
  if exists (select 1 from private.catalog_text_repairs_20260916
             where table_name = 'catalog_variants' and column_name = 'unit_cost_override') then
    raise exception 'align_unit_cost_override_already_applied' using errcode = '55000';
  end if;
  -- Item-level-costed variants must still agree with their profile through the
  -- family default. If one does not, that is not this file's call to make.
  if exists (
    select 1
    from public.catalog_variants v
    join public.catalog_items i on i.id = v.catalog_item_id
    join public.catalog_supplier_cost_profiles p
      on p.catalog_variant_id = v.id and p.is_default and p.deleted_at is null
    where v.deleted_at is null and v.unit_cost_override is null
      and i.default_unit_cost is distinct from p.unit_cost
  ) then
    raise exception 'align_unit_cost_override_precedence_conflict' using errcode = '55000';
  end if;
end;
$prerequisites$;

do $align$
declare v_changed integer;
begin
  with candidate as (
    select v.id, v.unit_cost_override as before_value, p.unit_cost as profile_cost
    from public.catalog_variants v
    join public.catalog_supplier_cost_profiles p
      on p.catalog_variant_id = v.id and p.company_id = v.company_id
     and p.is_default and p.deleted_at is null
    where v.deleted_at is null
      and v.unit_cost_override is not null
      and v.unit_cost_override is distinct from p.unit_cost
  ), updated as (
    update public.catalog_variants target
       set unit_cost_override = pg_catalog.trim_scale(candidate.profile_cost),
           updated_at = clock_timestamp()
      from candidate
     where target.id = candidate.id
    returning target.id, candidate.before_value, target.unit_cost_override as after_value
  )
  insert into private.catalog_text_repairs_20260916
    (table_name, column_name, row_id, before_value, after_value)
  select 'catalog_variants', 'unit_cost_override', updated.id,
         updated.before_value::text, updated.after_value::text
  from updated;
  get diagnostics v_changed = row_count;
  raise notice 'unit_cost_override re-aligned to the default supplier profile on % variant(s)', v_changed;
end;
$align$;

do $postflight$
declare v_remaining integer; v_nulls_touched integer;
begin
  -- No variant with a set override disagrees with its profile any more.
  select count(*) into v_remaining
  from public.catalog_variants v
  join public.catalog_supplier_cost_profiles p
    on p.catalog_variant_id = v.id and p.is_default and p.deleted_at is null
  where v.deleted_at is null and v.unit_cost_override is not null
    and v.unit_cost_override is distinct from p.unit_cost;
  if v_remaining <> 0 then
    raise exception 'align_unit_cost_override_incomplete: % row(s) still diverge', v_remaining
      using errcode = '55000';
  end if;
  -- No item-level-costed variant was converted: nothing in the ledger came from NULL.
  select count(*) into v_nulls_touched
  from private.catalog_text_repairs_20260916
  where table_name = 'catalog_variants' and column_name = 'unit_cost_override'
    and (before_value = 'null' or before_value = '');
  if v_nulls_touched <> 0 then
    raise exception 'align_unit_cost_override_touched_inherited_rows' using errcode = '55000';
  end if;
  if exists (select 1 from private.catalog_text_repairs_20260916
             where table_name = 'catalog_variants' and column_name = 'unit_cost_override'
               and before_value = after_value) then
    raise exception 'align_unit_cost_override_ledger_invalid' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
