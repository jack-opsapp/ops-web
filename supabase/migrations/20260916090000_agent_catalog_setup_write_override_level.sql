-- Catalogue setup writes mirror a value at the level the family already uses,
-- and never change that level as a side effect.
--
-- THE TWO-LEVEL FIELDS. Five catalogue fields resolve through a variant term
-- and a family term:
--
--   sale price          coalesce(variant.price_override,     family.default_price)
--   unit cost           coalesce(variant.unit_cost_override, family.default_unit_cost)
--   warning threshold   coalesce(variant.warning_threshold,  family.default_warning_threshold,  category.default_warning_threshold)
--   critical threshold  coalesce(variant.critical_threshold, family.default_critical_threshold, category.default_critical_threshold)
--   unit                coalesce(variant.unit_id,            family.default_unit_id)
--
-- A variant whose own term is NULL INHERITS: the next family edit reaches it.
-- A variant whose own term is set is PINNED: the next family edit does not.
-- Which of the two a variant is, is a decision a company made about how it
-- runs its catalogue (Corner Sleeve is priced and costed once, for the family;
-- Glass Panel is costed per variant). It is not a side effect of typing a
-- number.
--
-- WHAT WAS WRONG (audit, 2026-09-16). Four writers wrote the variant term
-- verbatim even when the value equalled what the variant already inherited:
--
--   * set_pricing, variant ref: price_override := the requested amount, on
--     purpose — its compile carried a comment defending "pinning a variant to
--     the price it already inherits". A variant set to its family's price
--     silently stopped following the family.
--   * set_thresholds: each supplied level became an override even when it
--     equalled the family or category level.
--   * create_variant: a supplied price or threshold equal to the inherited
--     value was written onto the new variant as an override.
--   * set_supplier_cost: private.catalog_supplier_cost_profile_save set
--     unit_cost_override := the default profile's cost whenever the default
--     moved, whatever catalog_items.default_unit_cost said — converting an
--     item-level-costed family to variant-level costing one write at a time.
--     Its compile predicted the same.
--
-- set_pricing with a family ref already wrote only the family default, but its
-- preview dropped every variant carrying an override of its own without a
-- word, so an operator could not see which variants the new default would not
-- reach.
--
-- THE RULE (decided with the product owner).
--   1. A family ref writes the family default only. It never creates variant
--      overrides, and the preview lists every override that will shadow the
--      new value. An override that will EQUAL the new value is flagged as
--      redundant — informational only, never cleared: clearing it would be a
--      level change nobody asked for.
--   2. A variant ref whose inherited value is NULL writes the variant term.
--   3. A variant ref whose inherited value is set writes the variant term only
--      when the new value DIFFERS from the inherited one. When it is equal, the
--      variant ends up inheriting: its term is NULL afterwards, which clears an
--      override that was set, and a request that changes nothing at all is
--      refused as CATALOG_SETUP_NO_CHANGE.
-- Equality is numeric, never textual (15 = 15.0000). Thresholds apply the rule
-- to each level independently. An explicit null in a request still clears the
-- variant term, exactly as before. The supplier-cost mirror applies rule 3
-- against catalog_items.default_unit_cost and never writes that column: a
-- per-variant tool does not get to decide a family-wide cost.
--
-- The rule lives in ONE function, private.agent_catalog_setup_override_for,
-- and every writer that mirrors a value calls it.
--
-- THE REAL GUARD. A rule applied in four compile functions is a rule four
-- future edits can forget. So public.commit_catalog_setup_write_as_actor now
-- snapshots every live variant of the family immediately before the approved
-- write, and after the write — before the read-back — refuses with
-- CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED (SQLSTATE 55000, the whole commit rolls
-- back) if any of the five variant terms CHANGED in this write, is non-NULL
-- afterwards, and equals the value the variant would inherit afterwards. A new
-- variant counts as changed from NULL. An override that was already redundant
-- and that this write did not touch is left alone: production carries 31
-- variants whose unit_id equals their family's default_unit_id, created outside
-- MCP, and a write elsewhere in those families must still commit. The guard
-- covers all five kinds, including whatever a later kind gets wrong.
--
-- catalog_setup_save IS NOT CHANGED. It writes price_override,
-- warning_threshold, critical_threshold and unit_id verbatim from the variant
-- document and never touches unit_cost_override, and
-- private.agent_catalog_setup_write_payload re-sends every sibling's STORED
-- values. Siblings therefore keep their level on every commit; the flaw was
-- confined to each writer's own target field, and that is what this fixes.
--
-- THE PREVIEW SHOWS THE LEVEL, NOT JUST THE NUMBER. Wherever a proposal shows
-- one of these fields, both sides carry the resolved value and its origin —
-- variant, family, category or none:
--   * create_variant: the new variant's sale price, unit cost and both levels
--     are {amount|value, origin}, resolved exactly as the family resolves them;
--   * set_supplier_cost: variant_unit_cost is {amount, origin};
--   * set_thresholds already carried {value, origin} and keeps its shape;
--   * set_pricing gains shadowing_variants.
-- Both proposal sides and the commit read-back still come from the same
-- projection functions, so the read-back still compares for equality; every
-- read-back branch in private.agent_catalog_setup_write_readback copies the
-- approved `after` generically, which is why that function is asserted
-- unchanged below rather than replaced.
--
-- THIS MOVES THE EFFECT SEAL, AND THE TOOLS FAIL CLOSED UNTIL IT IS REISSUED.
-- private.agent_catalog_setup_write_effect_revision() hashes every function
-- reachable from the prepare and the commit, and this file replaces nine of
-- them and adds three. The installed seal row
-- '2026-09-15.catalog-setup-write.v1' therefore stops matching the moment this
-- commits: every prepare answers CATALOG_SETUP_WRITE_ACTIVATION_REQUIRED and
-- every commit CATALOG_SETUP_WRITE_EFFECT_POLICY_CHANGED until an operator
-- reseals, after this migration AND the code that reads the new preview shape
-- are both live. The postflight proves the old seal no longer matches. This
-- migration does not write the seal table.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
declare
  v_missing text[];
  v_drifted text[];
begin
  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('function', 'public.catalog_setup_save(uuid,text,jsonb)'),
      ('function', 'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'),
      ('function', 'private.agent_catalog_setup_variant_projection(uuid,uuid,uuid)'),
      ('function', 'private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_pricing_projection(uuid,uuid,text,uuid,uuid[])'),
      ('function', 'private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_supplier_cost_projection(uuid,uuid,uuid)'),
      ('function', 'private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)'),
      ('function', 'private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)'),
      ('function', 'private.agent_catalog_setup_write_payload(jsonb)'),
      ('function', 'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'),
      ('function', 'private.agent_catalog_setup_threshold_level(numeric,numeric,numeric)'),
      ('function', 'private.agent_catalog_setup_threshold_projection(uuid,uuid,uuid)'),
      ('function', 'private.agent_catalog_setup_value_labels(uuid,uuid,uuid)'),
      ('function', 'private.agent_catalog_setup_money(numeric)'),
      ('function', 'private.agent_catalog_setup_exact(numeric)'),
      ('function', 'private.agent_catalog_setup_write_effect_revision()'),
      ('function', 'private.agent_catalog_setup_write_hash(jsonb)'),
      ('table', 'private.agent_catalog_effect_policy'),
      ('table', 'private.agent_catalog_setup_writes'),
      ('table', 'public.catalog_categories'),
      ('table', 'public.catalog_items'),
      ('table', 'public.catalog_variants'),
      ('table', 'public.catalog_supplier_cost_profiles')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_catalog_setup_override_level_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_override_for(numeric,numeric)') is not null
     or pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_amount_level(numeric,numeric)') is not null
     or pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_override_level_changes(uuid,uuid,public.catalog_variants[])') is not null then
    raise exception 'agent_catalog_setup_override_level_already_installed'
      using errcode = '55000';
  end if;

  -- Every body this file replaces must be the body production shipped
  -- (docs/artifacts/mcp-catalog-setup-writes/release-runbook.md, section 2),
  -- and every body it relies on without replacing must be too: the rule below
  -- is proved against those exact definitions, and a drifted one is a
  -- different vertical that must be re-read, not overwritten.
  select pg_catalog.array_agg(expected.signature order by expected.signature)
    into v_drifted
  from (
    values
      -- Replaced here.
      ('private.agent_catalog_setup_variant_projection(uuid,uuid,uuid)', '41e5b7f216fabf9947e12ab07b9f30be'),
      ('private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb)', '6cd327573d82f71b5aed5658c15e05e0'),
      ('private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)', '20a0c7e406051f638dd0ba27ca66a546'),
      ('private.agent_catalog_setup_pricing_projection(uuid,uuid,text,uuid,uuid[])', 'be04f362f89aef524f3b4ede3799826c'),
      ('private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)', 'd637920c83e3bf53d1a421e425ea5755'),
      ('private.agent_catalog_setup_supplier_cost_projection(uuid,uuid,uuid)', '9734dded044596743922079724600b69'),
      ('private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)', '055e527e7b0534c390c08158cd7d9b09'),
      ('private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)', 'adfdd78019b3f27f8b4601aa0d4102b2'),
      ('public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)', 'e515d98f1e3d761539e2f259f99a12b9'),
      -- Relied on, unchanged.
      ('public.catalog_setup_save(uuid,text,jsonb)', 'f5c4630d0282d999b5b691c22b63d84a'),
      ('private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)', 'ad8f149143d8a48b8d88253eb2dbb3e1'),
      ('private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)', 'f5fabc043b7f97e8dec7d614c03c2ac2'),
      ('private.agent_catalog_setup_write_payload(jsonb)', '80e79a55e0c77b0e095d1ec7fceb4f08'),
      ('private.agent_catalog_setup_family_state(uuid,uuid,boolean)', 'bb1586bd33ff5f60ca831b8c8b6f11d2'),
      ('private.agent_catalog_setup_threshold_level(numeric,numeric,numeric)', '78e299f25fa95bd6e7116e96d7ec515b'),
      ('private.agent_catalog_setup_threshold_projection(uuid,uuid,uuid)', '8590f95ca81b266f6e1dec4ecbfcd05f'),
      ('private.agent_catalog_setup_write_effect_revision()', 'a56dcc88d2f1a917d48833066bd6eb32')
  ) expected(signature, fingerprint)
  join pg_catalog.pg_proc proc on proc.oid = pg_catalog.to_regprocedure(expected.signature)
  where pg_catalog.md5(proc.prosrc) is distinct from expected.fingerprint;
  if v_drifted is not null then
    raise exception 'agent_catalog_setup_override_level_source_drift: %',
      pg_catalog.array_to_string(v_drifted, ',') using errcode = '55000';
  end if;

  -- Recorded so the postflight can prove the effect revision moved.
  perform pg_catalog.set_config('ops.catalog_setup_override_level_effect_before',
    private.agent_catalog_setup_write_effect_revision(), true);
end;
$prerequisites$;

-- ── The rule, as one function ──────────────────────────────────────────────
-- What to store in a variant's own term so that the variant resolves to
-- p_requested WITHOUT changing the level it resolves at. NULL — inherit — when
-- the requested value equals the inherited one; the requested value itself
-- otherwise, including when nothing is inherited. Numeric equality, so 15 and
-- 15.0000 are the same answer. A NULL request stays NULL: an explicit clear is
-- a clear, whatever is inherited.
create function private.agent_catalog_setup_override_for(
  p_requested numeric, p_inherited numeric
) returns numeric language sql immutable set search_path = '' as $$
  select case
    when p_requested is not null and p_inherited is not null
         and p_requested = p_inherited then null
    else p_requested end
$$;

-- ── A resolved amount and the level it comes from ──────────────────────────
-- The money counterpart of private.agent_catalog_setup_threshold_level. Shared
-- by the projections (live rows) and the compiles (the rows a write will
-- produce), so a preview and its read-back cannot disagree by construction.
-- Amounts are the four-decimal money text every other projection uses.
create function private.agent_catalog_setup_amount_level(
  p_variant numeric, p_family numeric
) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'amount', private.agent_catalog_setup_money(coalesce(p_variant, p_family)),
    'origin', case
      when p_variant is not null then 'variant'
      when p_family is not null then 'family'
      else 'none' end)
$$;

-- ── The post-condition ─────────────────────────────────────────────────────
-- Every variant term this write changed into a redundant override. p_before is
-- the family's live variants as they stood immediately before the write, typed
-- rows rather than text so a double precision threshold compares exactly. A
-- variant absent from p_before is new and counts as changed from NULL. The
-- inherited values are read AFTER the write, so a family default that moved in
-- the same write is the one compared against. Returns variant ids and field
-- names only: this is an error detail, and costs are not written into one.
create function private.agent_catalog_setup_override_level_changes(
  p_company uuid, p_family uuid, p_before public.catalog_variants[]
) returns jsonb language sql stable security definer set search_path = '' as $$
  with inherited as (
    select family.default_price,
           family.default_unit_cost,
           family.default_unit_id,
           coalesce(family.default_warning_threshold,
                    category.default_warning_threshold) as warning_threshold,
           coalesce(family.default_critical_threshold,
                    category.default_critical_threshold) as critical_threshold
    from public.catalog_items family
    left join public.catalog_categories category
      on category.id = family.category_id
     and category.company_id = p_company
     and category.deleted_at is null
    where family.id = p_family and family.company_id = p_company
  ), prior as (
    select snapshot.*
    from pg_catalog.unnest(coalesce(p_before, array[]::public.catalog_variants[])) snapshot
  ), live as (
    select variant_row.*
    from public.catalog_variants variant_row
    where variant_row.company_id = p_company
      and variant_row.catalog_item_id = p_family
      and variant_row.deleted_at is null
  ), offenders as (
    select live.id, 'price_override'::text as field
    from live cross join inherited left join prior on prior.id = live.id
    where live.price_override is distinct from prior.price_override
      and live.price_override is not null
      and live.price_override = inherited.default_price
    union all
    select live.id, 'unit_cost_override'
    from live cross join inherited left join prior on prior.id = live.id
    where live.unit_cost_override is distinct from prior.unit_cost_override
      and live.unit_cost_override is not null
      and live.unit_cost_override = inherited.default_unit_cost
    union all
    select live.id, 'warning_threshold'
    from live cross join inherited left join prior on prior.id = live.id
    where live.warning_threshold is distinct from prior.warning_threshold
      and live.warning_threshold is not null
      and live.warning_threshold = inherited.warning_threshold
    union all
    select live.id, 'critical_threshold'
    from live cross join inherited left join prior on prior.id = live.id
    where live.critical_threshold is distinct from prior.critical_threshold
      and live.critical_threshold is not null
      and live.critical_threshold = inherited.critical_threshold
    union all
    select live.id, 'unit_id'
    from live cross join inherited left join prior on prior.id = live.id
    where live.unit_id is distinct from prior.unit_id
      and live.unit_id is not null
      and live.unit_id = inherited.default_unit_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('variant_id', offenders.id, 'field', offenders.field)
                    order by offenders.id, offenders.field), '[]'::jsonb)
  from offenders
$$;

-- ── create_variant ─────────────────────────────────────────────────────────
-- The new variant as it will resolve, read the way the family resolves it. The
-- shipped projection reported the variant's OWN thresholds and a bare unit
-- cost, so a variant that inherited a level read as "not tracked" and a cost
-- carried no level at all. Every field an operator can be surprised by now
-- names its value AND the level that supplies it, through the same two level
-- functions the compile uses to predict it.
create or replace function private.agent_catalog_setup_variant_projection(p_company uuid, p_family uuid, p_variant uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_variant public.catalog_variants%rowtype;
  v_family public.catalog_items%rowtype;
  v_category_warning double precision;
  v_category_critical double precision;
begin
  select * into v_family from public.catalog_items
  where id = p_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_variant from public.catalog_variants
  where id = p_variant and company_id = p_company and catalog_item_id = p_family and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select category.default_warning_threshold, category.default_critical_threshold
    into v_category_warning, v_category_critical
  from public.catalog_categories category
  where category.id = v_family.category_id
    and category.company_id = p_company
    and category.deleted_at is null;
  return jsonb_build_object(
    'option_values', coalesce((
      select jsonb_agg(jsonb_build_object(
        'option_ref', jsonb_build_object('kind', 'catalog_option', 'id', option_row.id),
        'option_name', option_row.name,
        'value_ref', jsonb_build_object('kind', 'catalog_option_value', 'id', value_row.id),
        'value', value_row.value
      ) order by option_row.sort_order, option_row.name, option_row.id)
      from public.catalog_variant_option_values junction
      join public.catalog_option_values value_row on value_row.id = junction.option_value_id
      join public.catalog_options option_row on option_row.id = value_row.option_id
      where junction.variant_id = p_variant and junction.deleted_at is null
        and value_row.deleted_at is null and option_row.deleted_at is null
        and option_row.catalog_item_id = p_family
    ), '[]'::jsonb),
    'sku', v_variant.sku,
    'sale_price', private.agent_catalog_setup_amount_level(
      v_variant.price_override, v_family.default_price),
    'unit_cost', private.agent_catalog_setup_amount_level(
      v_variant.unit_cost_override, v_family.default_unit_cost),
    'warning_threshold', private.agent_catalog_setup_threshold_level(
      v_variant.warning_threshold::numeric,
      v_family.default_warning_threshold::numeric,
      v_category_warning::numeric),
    'critical_threshold', private.agent_catalog_setup_threshold_level(
      v_variant.critical_threshold::numeric,
      v_family.default_critical_threshold::numeric,
      v_category_critical::numeric),
    'quantity', private.agent_catalog_setup_exact(v_variant.quantity::numeric),
    'is_active', v_variant.is_active,
    'stock_units', (
      select count(*) from public.catalog_stock_units unit_row
      where unit_row.catalog_variant_id = p_variant and unit_row.company_id = p_company
        and unit_row.deleted_at is null
    ),
    'stock_events', (
      select count(*) from public.catalog_stock_unit_events event_row
      where event_row.catalog_variant_id = p_variant and event_row.company_id = p_company
    )
  );
end $$;

-- The 20260916070000 body with the new variant's price and levels written at
-- the level the family already answers, and its preview read through the
-- projection above.
create or replace function private.agent_catalog_setup_compile_create_variant(
  p_company uuid, p_actor uuid, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_state jsonb;
  v_family uuid;
  v_entry jsonb;
  v_value jsonb;
  v_text text;
  v_money_pattern constant text := '^(0|[1-9][0-9]{0,11})([.][0-9]{1,4})?$';
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_option_ids uuid[];
  v_value_ids uuid[];
  v_live_option_ids uuid[];
  v_evidence jsonb := '[]'::jsonb;
  v_price text;
  v_minor smallint;
  v_quantity text;
  v_note text;
  v_sku text;
  v_warning text;
  v_critical text;
  v_family_row public.catalog_items%rowtype;
  v_category_warning double precision;
  v_category_critical double precision;
  v_price_override numeric;
  v_warning_override numeric;
  v_critical_override numeric;
  v_payload jsonb;
  v_variant_doc jsonb;
  v_before jsonb;
  v_after jsonb;
  v_effects jsonb;
  v_existing_sets jsonb;
  v_set_total integer;
  v_option_values jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or octet_length(p_request::text) > 32768
     or exists (
       select 1 from jsonb_object_keys(p_request) key
       where key not in ('family_ref','option_values','sku','price_override',
                         'warning_threshold','critical_threshold','opening_quantity',
                         'evidence','idempotency_key')
     )
     or not p_request ?& array['family_ref','option_values','evidence','idempotency_key']
     or jsonb_typeof(p_request->'option_values') is distinct from 'array'
     or jsonb_typeof(p_request->'evidence') is distinct from 'array'
     or (p_request->>'idempotency_key') is null
     or (p_request->>'idempotency_key') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or jsonb_typeof(p_request->'family_ref') is distinct from 'object'
     or (p_request#>>'{family_ref,kind}') is distinct from 'catalog_family'
     or exists (select 1 from jsonb_object_keys(p_request->'family_ref') key where key not in ('kind','id'))
     or (p_request#>>'{family_ref,id}') !~ v_uuid_pattern then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_family := (p_request#>>'{family_ref,id}')::uuid;

  if jsonb_array_length(p_request->'option_values') not between 1 and 32 then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_option_ids := array[]::uuid[];
  v_value_ids := array[]::uuid[];
  for v_entry in select value from jsonb_array_elements(p_request->'option_values') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('option_ref','value_ref'))
       or (v_entry#>>'{option_ref,kind}') is distinct from 'catalog_option'
       or (v_entry#>>'{value_ref,kind}') is distinct from 'catalog_option_value'
       or (v_entry#>>'{option_ref,id}') !~ v_uuid_pattern
       or (v_entry#>>'{value_ref,id}') !~ v_uuid_pattern then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_option_ids := v_option_ids || (v_entry#>>'{option_ref,id}')::uuid;
    v_value_ids := v_value_ids || (v_entry#>>'{value_ref,id}')::uuid;
  end loop;

  v_sku := nullif(pg_catalog.btrim(coalesce(p_request->>'sku', '')), '');
  if p_request ? 'sku' and (
       jsonb_typeof(p_request->'sku') is distinct from 'string'
       or v_sku is distinct from (p_request->>'sku')
       or length(v_sku) > 80
       or not private.agent_prompt_text_is_safe(v_sku, true)) then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_request ? 'price_override' then
    if jsonb_typeof(p_request->'price_override') is distinct from 'object'
       or not (p_request->'price_override') ?& array['amount','currency']
       or exists (select 1 from jsonb_object_keys(p_request->'price_override') key where key not in ('amount','currency'))
       or (p_request#>>'{price_override,amount}') !~ v_money_pattern
       or (p_request#>>'{price_override,currency}') !~ '^[A-Z]{3}$' then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_price := private.agent_catalog_setup_money((p_request#>>'{price_override,amount}')::numeric);

    -- Money at the currency's own minor unit, and no finer. The catalogue read
    -- projects money through private.agent_money_to_minor_units, which raises
    -- agent_money_minor_units_not_exact on a stored number that is not exact
    -- there, so a row written finer than its currency is a row the read then
    -- refuses to show -- which is exactly how four Glass Panel cost profiles
    -- broke get_catalog_item for a whole family. The same exponent table the
    -- read uses decides it here, so the two cannot disagree, and a currency that
    -- table does not name is refused rather than guessed at.
    v_minor := private.agent_currency_minor_exponent_or_null(p_request#>>'{price_override,currency}');
    if v_minor is null
       or pg_catalog.trunc(v_price::numeric * pg_catalog.power(10::numeric, v_minor))
          is distinct from v_price::numeric * pg_catalog.power(10::numeric, v_minor) then
      raise exception 'CATALOG_SETUP_MONEY_PRECISION_INVALID' using errcode = '22023';
    end if;
  end if;

  foreach v_text in array array['warning_threshold','critical_threshold'] loop
    if p_request ? v_text then
      if jsonb_typeof(p_request->v_text) is distinct from 'number'
         or (p_request->>v_text) !~ '^(0|[1-9][0-9]{0,8})$' then
        raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
      end if;
    end if;
  end loop;
  v_warning := p_request->>'warning_threshold';
  v_critical := p_request->>'critical_threshold';
  if v_warning is not null and v_critical is not null
     and v_critical::numeric > v_warning::numeric then
    raise exception 'CATALOG_SETUP_THRESHOLDS_INVALID' using errcode = '22023';
  end if;

  if p_request ? 'opening_quantity' then
    if jsonb_typeof(p_request->'opening_quantity') is distinct from 'object'
       or not (p_request->'opening_quantity') ? 'quantity'
       or exists (select 1 from jsonb_object_keys(p_request->'opening_quantity') key where key not in ('quantity','note'))
       or (p_request#>>'{opening_quantity,quantity}') !~ v_money_pattern then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_quantity := (p_request#>>'{opening_quantity,quantity}');
    if (p_request->'opening_quantity') ? 'note' then
      v_note := nullif(pg_catalog.btrim(coalesce(p_request#>>'{opening_quantity,note}', '')), '');
      if v_note is null or length(v_note) > 500 or not private.agent_prompt_text_is_safe(v_note, true) then
        raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
      end if;
    end if;
    if not public.has_permission(p_actor, 'catalog.stock.adjust', 'all') then
      raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
    end if;
  end if;

  if jsonb_array_length(p_request->'evidence') not between 1 and 3 then
    raise exception 'CATALOG_SETUP_EVIDENCE_MISSING' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_request->'evidence') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (v_entry->>'kind') is distinct from 'operator_statement'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('kind','text')) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_text := v_entry->>'text';
    if v_text is null or v_text is distinct from pg_catalog.btrim(v_text)
       or length(v_text) not between 1 and 2000
       or not private.agent_prompt_text_is_safe(v_text, true) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'kind', 'operator_statement',
      'text', v_text,
      'source_sha256', private.agent_catalog_setup_write_hash(
        jsonb_build_object('actor', p_actor, 'statement', v_text)),
      'content_kind', 'untrusted_business_data'
    ));
  end loop;

  v_state := private.agent_catalog_setup_family_state(p_company, v_family);
  if p_request ? 'price_override'
     and (p_request#>>'{price_override,currency}') is distinct from (v_state->>'currency_code') then
    raise exception 'CATALOG_SETUP_CURRENCY_MISMATCH' using errcode = '22023';
  end if;

  -- Every non-deleted option of the family must be named exactly once, and each
  -- chosen value must belong to the option that names it (design note 3: a
  -- variant without a value for a live axis makes the whole grid ambiguous).
  select coalesce(array_agg(option_row.id order by option_row.id), array[]::uuid[])
    into v_live_option_ids
  from public.catalog_options option_row
  where option_row.catalog_item_id = v_family and option_row.deleted_at is null;
  if cardinality(v_live_option_ids) = 0 then
    raise exception 'CATALOG_SETUP_FAMILY_HAS_NO_OPTIONS' using errcode = '22023';
  end if;
  if (select array_agg(distinct id order by id) from unnest(v_option_ids) id) is distinct from v_live_option_ids
     or cardinality(v_option_ids) <> cardinality(v_live_option_ids) then
    raise exception 'CATALOG_SETUP_OPTION_COVERAGE_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_request->'option_values') entry(value)
    where not exists (
      select 1 from public.catalog_option_values value_row
      join public.catalog_options option_row on option_row.id = value_row.option_id
      where value_row.id = (entry.value#>>'{value_ref,id}')::uuid
        and value_row.deleted_at is null
        and option_row.id = (entry.value#>>'{option_ref,id}')::uuid
        and option_row.deleted_at is null
        and option_row.catalog_item_id = v_family
    )
  ) then
    raise exception 'CATALOG_SETUP_OPTION_VALUE_INVALID' using errcode = '22023';
  end if;

  -- Application-layer uniqueness. The database accepts two identical value sets
  -- on one family (design note 1); this write surface refuses to create one.
  if exists (
    select 1 from public.catalog_variants variant_row
    where variant_row.catalog_item_id = v_family
      and variant_row.company_id = p_company
      and variant_row.deleted_at is null
      and (
        select coalesce(array_agg(distinct value_row.id order by value_row.id), array[]::uuid[])
        from public.catalog_variant_option_values junction
        join public.catalog_option_values value_row on value_row.id = junction.option_value_id
        join public.catalog_options option_row on option_row.id = value_row.option_id
        where junction.variant_id = variant_row.id and junction.deleted_at is null
          and value_row.deleted_at is null and option_row.deleted_at is null
          and option_row.catalog_item_id = v_family
      ) = (select array_agg(distinct id order by id) from unnest(v_value_ids) id)
  ) then
    raise exception 'CATALOG_SETUP_VARIANT_EXISTS' using errcode = '23505';
  end if;

  -- Design note 8 / decision W5. A family whose price varies by option has no
  -- default_price, so a variant created without an override reads as no price.
  if v_price is null and (v_state#>>'{family,default_price}') is null then
    raise exception 'CATALOG_SETUP_PRICE_REQUIRED' using errcode = '22023';
  end if;

  -- The level each supplied value lands at. A new variant is born inheriting
  -- whatever the family already answers: a price, warning level or critical
  -- level equal to the value it would inherit is not written onto it, so the
  -- next family edit reaches it like every other variant that inherits. Only a
  -- value that differs becomes the variant's own. The family row was locked by
  -- the pre-image read above.
  select * into v_family_row from public.catalog_items
  where id = v_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select category.default_warning_threshold, category.default_critical_threshold
    into v_category_warning, v_category_critical
  from public.catalog_categories category
  where category.id = v_family_row.category_id
    and category.company_id = p_company
    and category.deleted_at is null;
  v_price_override := private.agent_catalog_setup_override_for(
    v_price::numeric, v_family_row.default_price);
  v_warning_override := private.agent_catalog_setup_override_for(
    v_warning::numeric,
    coalesce(v_family_row.default_warning_threshold::numeric, v_category_warning::numeric));
  v_critical_override := private.agent_catalog_setup_override_for(
    v_critical::numeric,
    coalesce(v_family_row.default_critical_threshold::numeric, v_category_critical::numeric));

  select jsonb_agg(jsonb_build_object(
           'option_ref', jsonb_build_object('kind', 'catalog_option', 'id', option_row.id),
           'option_name', option_row.name,
           'value_ref', jsonb_build_object('kind', 'catalog_option_value', 'id', value_row.id),
           'value', value_row.value
         ) order by option_row.sort_order, option_row.name, option_row.id)
    into v_option_values
  from unnest(v_value_ids) chosen(id)
  join public.catalog_option_values value_row on value_row.id = chosen.id
  join public.catalog_options option_row on option_row.id = value_row.option_id;

  -- The one new variant, appended to the family's complete current document.
  --
  -- `quantity` mirrors the opening quantity deliberately. Nothing in the
  -- database projects catalog_stock_unit_events onto catalog_variants.quantity
  -- (verified: no trigger on either table does), and catalog_setup_save replaces
  -- quantity with 0 when a variant doc omits it. Recording the receipt event
  -- without the mirror would ship a variant that OPS shows as zero on hand while
  -- a stock unit of twelve exists. The audit trail is the event; the scalar is
  -- the projection the rest of OPS reads.
  v_variant_doc := jsonb_build_object(
    'client_id', 'agent_new_variant',
    'sku', v_sku,
    'quantity', coalesce(v_quantity, '0'),
    -- The variant's own terms, never the requested values verbatim: a value
    -- equal to what it inherits is sent as null. The price keeps the
    -- four-decimal text the shipped writer sent when it is the variant's own.
    'price_override', private.agent_catalog_setup_money(v_price_override),
    'warning_threshold', private.agent_catalog_setup_exact(v_warning_override),
    'critical_threshold', private.agent_catalog_setup_exact(v_critical_override),
    'unit_id', null,
    'excluded', false,
    'option_value_ids', (select jsonb_agg(to_jsonb(id::text) order by id) from unnest(v_value_ids) id)
  );
  v_payload := private.agent_catalog_setup_write_payload(v_state);
  v_payload := jsonb_set(v_payload, '{variants}', (v_payload->'variants') || jsonb_build_array(v_variant_doc));
  if v_quantity is not null then
    v_payload := jsonb_set(v_payload, '{stock_units}', jsonb_build_array(jsonb_build_object(
      'client_id', 'agent_new_stock_unit',
      'variant_client_id', 'agent_new_variant',
      'unit_kind', 'each',
      'status', 'full',
      'quantity_value', v_quantity,
      'notes', v_note
    )));
    -- Design note 4 / decision W4: opening stock is an event, never a silent set.
    v_payload := jsonb_set(v_payload, '{stock_unit_events}', jsonb_build_array(jsonb_build_object(
      'stock_unit_client_id', 'agent_new_stock_unit',
      'variant_client_id', 'agent_new_variant',
      'event_type', 'receive',
      'to_status', 'full',
      'quantity_delta', v_quantity,
      'notes', v_note,
      'payload', jsonb_build_object('source', 'agent_catalog_setup_write', 'kind', 'create_variant')
    )));
  end if;

  select count(*), coalesce(jsonb_agg(numbered.label order by numbered.label)
           filter (where numbered.position <= 50), '[]'::jsonb)
    into v_set_total, v_existing_sets
  from (
    select labelled.label,
           row_number() over (order by labelled.label) position
    from (
      select (
        select string_agg(value_row.value, ' / ' order by option_row.sort_order, option_row.name, option_row.id)
        from public.catalog_variant_option_values junction
        join public.catalog_option_values value_row on value_row.id = junction.option_value_id
        join public.catalog_options option_row on option_row.id = value_row.option_id
        where junction.variant_id = variant_row.id and junction.deleted_at is null
          and value_row.deleted_at is null and option_row.deleted_at is null
          and option_row.catalog_item_id = v_family
      ) label
      from public.catalog_variants variant_row
      where variant_row.catalog_item_id = v_family and variant_row.company_id = p_company
        and variant_row.deleted_at is null
    ) labelled
  ) numbered;

  v_before := jsonb_build_object(
    'variant_count', v_set_total,
    'default_price', v_state#>'{family,default_price}',
    'default_unit_cost', v_state#>'{family,default_unit_cost}',
    'existing_value_sets', v_existing_sets,
    'existing_value_sets_truncated', v_set_total > 50
  );
  v_after := jsonb_build_object(
    'variant', jsonb_build_object(
      'option_values', coalesce(v_option_values, '[]'::jsonb),
      'sku', v_sku,
      -- Exactly what private.agent_catalog_setup_variant_projection will read
      -- back from the row this document produces: the same level functions,
      -- fed the variant's own terms and the family's.
      'sale_price', private.agent_catalog_setup_amount_level(
        v_price_override, v_family_row.default_price),
      'unit_cost', private.agent_catalog_setup_amount_level(
        null, v_family_row.default_unit_cost),
      'warning_threshold', private.agent_catalog_setup_threshold_level(
        v_warning_override,
        v_family_row.default_warning_threshold::numeric,
        v_category_warning::numeric),
      'critical_threshold', private.agent_catalog_setup_threshold_level(
        v_critical_override,
        v_family_row.default_critical_threshold::numeric,
        v_category_critical::numeric),
      'quantity', private.agent_catalog_setup_exact(coalesce(v_quantity, '0')::numeric),
      'is_active', true,
      'stock_units', case when v_quantity is null then 0 else 1 end,
      'stock_events', case when v_quantity is null then 0 else 1 end
    ),
    'opening_quantity', case when v_quantity is null then null
      else jsonb_build_object('quantity', v_quantity, 'note', v_note, 'recorded_as', 'stock_receive_event') end,
    'currency', v_state->>'currency_code'
  );
  v_effects := jsonb_build_object(
    'variants_created', 1,
    'stock_units_created', case when v_quantity is null then 0 else 1 end,
    'stock_events_recorded', case when v_quantity is null then 0 else 1 end,
    'prices_changed', 0,
    'options_created', 0,
    'variants_backfilled', 0,
    'supplier_cost_profiles_written', 0,
    'messages_sent', 0,
    'accounting_sync_enqueued', 0
  );

  return jsonb_build_object(
    'family_id', v_family,
    'family_name', v_state#>>'{family,name}',
    'pre_image_hash', private.agent_catalog_setup_write_hash(v_state),
    'payload', v_payload,
    'evidence', v_evidence,
    'proposal_before', v_before,
    'proposal_after', v_after,
    'effects', v_effects,
    'blockers', '[]'::jsonb
  );
end $$;

-- ── set_thresholds ─────────────────────────────────────────────────────────
-- The preview shape is unchanged: both sides were already {value, origin} per
-- level. What changes is which value lands in the variant's own column.
create or replace function private.agent_catalog_setup_compile_set_thresholds(
  p_company uuid, p_actor uuid, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_variant uuid;
  v_family uuid;
  v_row public.catalog_variants%rowtype;
  v_family_row public.catalog_items%rowtype;
  v_category_warning double precision;
  v_category_critical double precision;
  v_state jsonb;
  v_entry jsonb;
  v_text text;
  v_field text;
  v_evidence jsonb := '[]'::jsonb;
  v_inherited_warning numeric;
  v_inherited_critical numeric;
  v_new_warning numeric;
  v_new_critical numeric;
  v_before jsonb;
  v_after jsonb;
  v_changed integer := 0;
  v_payload jsonb;
  v_variants jsonb;
  v_matches integer;
  v_effects jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or octet_length(p_request::text) > 32768
     or exists (
       select 1 from jsonb_object_keys(p_request) key
       where key not in ('variant_ref','warning_threshold','critical_threshold',
                         'evidence','idempotency_key')
     )
     or not p_request ?& array['variant_ref','evidence','idempotency_key']
     or not (p_request ? 'warning_threshold' or p_request ? 'critical_threshold')
     or jsonb_typeof(p_request->'evidence') is distinct from 'array'
     or (p_request->>'idempotency_key') is null
     or (p_request->>'idempotency_key') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or jsonb_typeof(p_request->'variant_ref') is distinct from 'object'
     or (p_request#>>'{variant_ref,kind}') is distinct from 'catalog_variant'
     or exists (select 1 from jsonb_object_keys(p_request->'variant_ref') key where key not in ('kind','id'))
     or (p_request#>>'{variant_ref,id}') !~ v_uuid_pattern then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_variant := (p_request#>>'{variant_ref,id}')::uuid;

  -- Whole units in, whole units out. An explicit null is the clear.
  foreach v_field in array array['warning_threshold','critical_threshold'] loop
    if p_request ? v_field
       and jsonb_typeof(p_request->v_field) not in ('null','number') then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    if p_request ? v_field and jsonb_typeof(p_request->v_field) = 'number'
       and (p_request->>v_field) !~ '^(0|[1-9][0-9]{0,8})$' then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
  end loop;

  if jsonb_array_length(p_request->'evidence') not between 1 and 3 then
    raise exception 'CATALOG_SETUP_EVIDENCE_MISSING' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_request->'evidence') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (v_entry->>'kind') is distinct from 'operator_statement'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('kind','text')) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_text := v_entry->>'text';
    if v_text is null or v_text is distinct from pg_catalog.btrim(v_text)
       or length(v_text) not between 1 and 2000
       or not private.agent_prompt_text_is_safe(v_text, true) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'kind', 'operator_statement',
      'text', v_text,
      'source_sha256', private.agent_catalog_setup_write_hash(
        jsonb_build_object('actor', p_actor, 'statement', v_text)),
      'content_kind', 'untrusted_business_data'
    ));
  end loop;

  -- The variant names its own family; the caller never supplies one, so a
  -- variant from another company or another family cannot be aimed at a family
  -- the caller does hold.
  select * into v_row from public.catalog_variants
  where id = v_variant and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_family := v_row.catalog_item_id;

  -- Locks the family and pins the pre-image the commit will be checked against.
  v_state := private.agent_catalog_setup_family_state(p_company, v_family);
  select * into v_family_row from public.catalog_items
  where id = v_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select category.default_warning_threshold, category.default_critical_threshold
    into v_category_warning, v_category_critical
  from public.catalog_categories category
  where category.id = v_family_row.category_id
    and category.company_id = p_company
    and category.deleted_at is null;

  v_before := private.agent_catalog_setup_threshold_projection(p_company, v_family, v_variant);

  -- Absent key: leave that level exactly as it is. Null: clear the variant's
  -- own level. Number: the level resolves to that number — as the variant's own
  -- when it differs from what the variant would inherit (family default, else
  -- category default), and by inheriting when it is equal. Each level on its
  -- own: a warning level can end up inheriting while the critical level beside
  -- it stays the variant's own.
  v_inherited_warning := coalesce(
    v_family_row.default_warning_threshold::numeric, v_category_warning::numeric);
  v_inherited_critical := coalesce(
    v_family_row.default_critical_threshold::numeric, v_category_critical::numeric);
  v_new_warning := case
    when not p_request ? 'warning_threshold' then v_row.warning_threshold::numeric
    when jsonb_typeof(p_request->'warning_threshold') = 'null' then null
    else private.agent_catalog_setup_override_for(
      (p_request->>'warning_threshold')::numeric, v_inherited_warning) end;
  v_new_critical := case
    when not p_request ? 'critical_threshold' then v_row.critical_threshold::numeric
    when jsonb_typeof(p_request->'critical_threshold') = 'null' then null
    else private.agent_catalog_setup_override_for(
      (p_request->>'critical_threshold')::numeric, v_inherited_critical) end;

  v_after := jsonb_build_object(
    'variant', v_before->'variant',
    'warning', private.agent_catalog_setup_threshold_level(
      v_new_warning, v_family_row.default_warning_threshold::numeric, v_category_warning::numeric),
    'critical', private.agent_catalog_setup_threshold_level(
      v_new_critical, v_family_row.default_critical_threshold::numeric, v_category_critical::numeric));

  -- The guard is on the levels that end up in force, not only on the two
  -- arguments: clearing a warning can leave a family default below a critical
  -- the caller just set, and OPS would alarm critical before it ever warned.
  if (v_after#>>'{warning,value}') is not null
     and (v_after#>>'{critical,value}') is not null
     and (v_after#>>'{critical,value}')::numeric > (v_after#>>'{warning,value}')::numeric then
    raise exception 'CATALOG_SETUP_THRESHOLDS_INVALID' using errcode = '22023';
  end if;

  if (v_after->'warning') is distinct from (v_before->'warning') then
    v_changed := v_changed + 1;
  end if;
  if (v_after->'critical') is distinct from (v_before->'critical') then
    v_changed := v_changed + 1;
  end if;
  if v_changed = 0 then
    raise exception 'CATALOG_SETUP_NO_CHANGE' using errcode = '22023';
  end if;

  -- The family's complete current document with only this variant's two
  -- threshold fields changed. Everything else is re-sent byte for byte because
  -- catalog_setup_save replaces a variant row from its document.
  v_payload := private.agent_catalog_setup_write_payload(v_state);
  select jsonb_agg(
           case when variant_doc.value->>'id' = v_variant::text
             then variant_doc.value
                  || jsonb_build_object(
                       'warning_threshold',
                       case when v_new_warning is null then 'null'::jsonb
                            else to_jsonb(private.agent_catalog_setup_exact(v_new_warning)) end,
                       'critical_threshold',
                       case when v_new_critical is null then 'null'::jsonb
                            else to_jsonb(private.agent_catalog_setup_exact(v_new_critical)) end)
             else variant_doc.value end
           order by variant_doc.ordinality),
         count(*) filter (where variant_doc.value->>'id' = v_variant::text)
    into v_variants, v_matches
  from jsonb_array_elements(v_payload->'variants') with ordinality variant_doc(value, ordinality);
  if v_matches is distinct from 1 then
    raise exception 'CATALOG_SETUP_SOURCE_STALE' using errcode = '55000';
  end if;
  v_payload := jsonb_set(v_payload, '{variants}', v_variants);

  v_effects := jsonb_build_object(
    'variants_created', 0,
    'stock_units_created', 0,
    'stock_events_recorded', 0,
    'prices_changed', 0,
    'options_created', 0,
    'variants_backfilled', 0,
    'supplier_cost_profiles_written', 0,
    'messages_sent', 0,
    'accounting_sync_enqueued', 0,
    'variants_updated', 1,
    'thresholds_changed', v_changed
  );

  return jsonb_build_object(
    'family_id', v_family,
    'family_name', v_state#>>'{family,name}',
    'pre_image_hash', private.agent_catalog_setup_write_hash(v_state),
    'payload', v_payload,
    'evidence', v_evidence,
    'proposal_before', v_before,
    'proposal_after', v_after,
    'effects', v_effects,
    'blockers', '[]'::jsonb
  );
end $$;

-- ── set_pricing ────────────────────────────────────────────────────────────
-- The shipped projection plus `shadowing_variants`: for a family target, every
-- active variant carrying a price of its own, which the family default does
-- not reach. The shipped preview left them out without a word, so an operator
-- moving a family price could not see which variants would keep their old one.
-- Each names its own price and whether that price EQUALS the family default
-- this projection reads — `redundant`, an override that changes nothing today
-- but will stop the variant following the next family edit. The flag is
-- information for the operator; nothing here or in the write clears it.
--
-- It is derived from live rows on both sides and in the read-back, and that is
-- sound: a family-target write changes catalog_items.default_price and no
-- variant row (the post-condition in the commit enforces the "no variant row"
-- half), and the family pre-image hash refuses a commit if any variant moved
-- between prepare and commit. So the set is identical on every read; only
-- `redundant` follows the default. A variant target carries an empty list.
create or replace function private.agent_catalog_setup_pricing_projection(
  p_company uuid, p_family uuid, p_item_kind text, p_item uuid, p_variants uuid[]
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_family public.catalog_items%rowtype;
  v_variant public.catalog_variants%rowtype;
  v_currency text;
  v_price numeric;
  v_origin text;
  v_labels jsonb;
begin
  if p_item_kind not in ('catalog_family', 'catalog_variant') then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  select * into v_family from public.catalog_items
  where id = p_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select nullif(pg_catalog.btrim(coalesce(company.currency_code, '')), '') into v_currency
  from public.companies company
  where company.id = p_company and company.deleted_at is null;
  if v_currency is null then
    raise exception 'CATALOG_SETUP_CURRENCY_UNAVAILABLE' using errcode = '55000';
  end if;

  if p_item_kind = 'catalog_variant' then
    select * into v_variant from public.catalog_variants
    where id = p_item and company_id = p_company
      and catalog_item_id = p_family and deleted_at is null;
    if not found then
      raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_price := coalesce(v_variant.price_override, v_family.default_price);
    v_origin := case
      when v_variant.price_override is not null then 'variant'
      when v_family.default_price is not null then 'family'
      else 'none' end;
    v_labels := private.agent_catalog_setup_value_labels(p_company, p_family, p_item);
  else
    v_price := v_family.default_price;
    v_origin := case when v_family.default_price is not null then 'family' else 'none' end;
    v_labels := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'target', jsonb_build_object(
      'item_ref', jsonb_build_object('kind', p_item_kind, 'id', p_item),
      'name', v_family.name,
      'value_labels', v_labels),
    'price', jsonb_build_object(
      'amount', private.agent_catalog_setup_money(v_price),
      'currency', v_currency,
      'origin', v_origin),
    'affected_variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', variant_row.id),
        'value_labels', private.agent_catalog_setup_value_labels(p_company, p_family, variant_row.id),
        'sale_price', private.agent_catalog_setup_money(
          coalesce(variant_row.price_override, v_family.default_price)),
        'sale_price_origin', case
          when variant_row.price_override is not null then 'variant'
          when v_family.default_price is not null then 'family'
          else 'none' end
      ) order by variant_row.id)
      from public.catalog_variants variant_row
      where variant_row.company_id = p_company
        and variant_row.catalog_item_id = p_family
        and variant_row.deleted_at is null
        and variant_row.id = any(p_variants)
    ), '[]'::jsonb),
    'shadowing_variants', case when p_item_kind = 'catalog_family' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', variant_row.id),
        'value_labels', private.agent_catalog_setup_value_labels(p_company, p_family, variant_row.id),
        'price_override', private.agent_catalog_setup_money(variant_row.price_override),
        'redundant', coalesce(variant_row.price_override = v_family.default_price, false)
      ) order by variant_row.id)
      from public.catalog_variants variant_row
      where variant_row.company_id = p_company
        and variant_row.catalog_item_id = p_family
        and variant_row.deleted_at is null
        and variant_row.is_active
        and variant_row.price_override is not null
    ), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- The 20260916070000 body with a variant price written at the level the family
-- already answers, the shadowing list on the preview, and the comment that
-- defended pinning a variant to its inherited price removed along with the
-- behaviour.
create or replace function private.agent_catalog_setup_compile_set_pricing(
  p_company uuid, p_actor uuid, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_item_kind text;
  v_item uuid;
  v_family uuid;
  v_family_row public.catalog_items%rowtype;
  v_variant_row public.catalog_variants%rowtype;
  v_state jsonb;
  v_entry jsonb;
  v_text text;
  v_evidence jsonb := '[]'::jsonb;
  v_currency text;
  v_new_price numeric;
  v_override numeric;
  v_minor smallint;
  v_affected uuid[];
  v_shadowing integer := 0;
  v_before jsonb;
  v_after jsonb;
  v_moved integer;
  v_payload jsonb;
  v_variants jsonb;
  v_matches integer;
  v_effects jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or octet_length(p_request::text) > 32768
     or exists (
       select 1 from jsonb_object_keys(p_request) key
       where key not in ('item_ref','sale_price','evidence','idempotency_key')
     )
     or not p_request ?& array['item_ref','sale_price','evidence','idempotency_key']
     or jsonb_typeof(p_request->'evidence') is distinct from 'array'
     or (p_request->>'idempotency_key') is null
     or (p_request->>'idempotency_key') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or jsonb_typeof(p_request->'item_ref') is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_request->'item_ref') key where key not in ('kind','id'))
     or (p_request#>>'{item_ref,kind}') not in ('catalog_family','catalog_variant')
     or (p_request#>>'{item_ref,id}') !~ v_uuid_pattern then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_item_kind := p_request#>>'{item_ref,kind}';
  v_item := (p_request#>>'{item_ref,id}')::uuid;

  -- An explicit null clears the price at the level the ref names. Anything else
  -- is money, and money is a decimal string of at most four fraction digits —
  -- never a JSON number, which cannot represent 16.9250 and would lose a cent
  -- in a round trip.
  if jsonb_typeof(p_request->'sale_price') not in ('null','object') then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_request->'sale_price') = 'object' then
    if exists (select 1 from jsonb_object_keys(p_request->'sale_price') key
               where key not in ('amount','currency'))
       or not (p_request->'sale_price') ?& array['amount','currency']
       or jsonb_typeof(p_request#>'{sale_price,amount}') is distinct from 'string'
       or jsonb_typeof(p_request#>'{sale_price,currency}') is distinct from 'string'
       or (p_request#>>'{sale_price,amount}') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$'
       or (p_request#>>'{sale_price,currency}') !~ '^[A-Z]{3}$' then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_new_price := (p_request#>>'{sale_price,amount}')::numeric;

    -- Money at the currency's own minor unit, and no finer. The catalogue read
    -- projects money through private.agent_money_to_minor_units, which raises
    -- agent_money_minor_units_not_exact on a stored number that is not exact
    -- there, so a row written finer than its currency is a row the read then
    -- refuses to show -- which is exactly how four Glass Panel cost profiles
    -- broke get_catalog_item for a whole family. The same exponent table the
    -- read uses decides it here, so the two cannot disagree, and a currency that
    -- table does not name is refused rather than guessed at.
    v_minor := private.agent_currency_minor_exponent_or_null(p_request#>>'{sale_price,currency}');
    if v_minor is null
       or pg_catalog.trunc(v_new_price * pg_catalog.power(10::numeric, v_minor))
          is distinct from v_new_price * pg_catalog.power(10::numeric, v_minor) then
      raise exception 'CATALOG_SETUP_MONEY_PRECISION_INVALID' using errcode = '22023';
    end if;
  end if;

  -- Setup authority. See this migration's header: the field this kind writes is
  -- written nowhere else in OPS but the wizard, which is gated on this key.
  if not public.has_permission(p_actor, 'catalog.run_setup', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;

  if jsonb_array_length(p_request->'evidence') not between 1 and 3 then
    raise exception 'CATALOG_SETUP_EVIDENCE_MISSING' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_request->'evidence') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (v_entry->>'kind') is distinct from 'operator_statement'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('kind','text')) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_text := v_entry->>'text';
    if v_text is null or v_text is distinct from pg_catalog.btrim(v_text)
       or pg_catalog.length(v_text) not between 1 and 2000
       or not private.agent_prompt_text_is_safe(v_text, true) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'kind', 'operator_statement',
      'text', v_text,
      'source_sha256', private.agent_catalog_setup_write_hash(
        jsonb_build_object('actor', p_actor, 'statement', v_text)),
      'content_kind', 'untrusted_business_data'));
  end loop;

  -- A variant names its own family; the caller never supplies one, so a variant
  -- from another company cannot be aimed at a family the caller does hold.
  if v_item_kind = 'catalog_variant' then
    select * into v_variant_row from public.catalog_variants
    where id = v_item and company_id = p_company and deleted_at is null;
    if not found then
      raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_family := v_variant_row.catalog_item_id;
  else
    v_family := v_item;
  end if;

  -- Locks the family and pins the pre-image the commit will be checked against.
  v_state := private.agent_catalog_setup_family_state(p_company, v_family);
  select * into v_family_row from public.catalog_items
  where id = v_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_currency := v_state->>'currency_code';
  if v_new_price is not null
     and (p_request#>>'{sale_price,currency}') is distinct from v_currency then
    raise exception 'CATALOG_SETUP_CURRENCY_INVALID' using errcode = '22023';
  end if;

  -- The level the price lands at. A family ref writes the family default and
  -- nothing else. A variant ref writes the variant's own price only when it
  -- differs from the family default the variant would otherwise inherit; a
  -- price EQUAL to that default leaves the variant inheriting, which clears an
  -- override it carried. An explicit null still clears the variant's own price.
  -- No change is then measured on the field that would be written, so a variant
  -- already inheriting the requested price is refused rather than staged.
  if v_item_kind = 'catalog_family' then
    if pg_catalog.trim_scale(v_new_price) is not distinct from
       pg_catalog.trim_scale(v_family_row.default_price) then
      raise exception 'CATALOG_SETUP_NO_CHANGE' using errcode = '22023';
    end if;
    -- Every active variant carrying no override of its own: those are the rows
    -- whose resolved sale price this write reaches.
    select pg_catalog.array_agg(variant_row.id order by variant_row.id) into v_affected
    from public.catalog_variants variant_row
    where variant_row.company_id = p_company
      and variant_row.catalog_item_id = v_family
      and variant_row.deleted_at is null
      and variant_row.is_active
      and variant_row.price_override is null;
    -- And every active variant carrying one: the rows the new default does not
    -- reach, listed in the preview as shadowing it.
    select pg_catalog.count(*) into v_shadowing
    from public.catalog_variants variant_row
    where variant_row.company_id = p_company
      and variant_row.catalog_item_id = v_family
      and variant_row.deleted_at is null
      and variant_row.is_active
      and variant_row.price_override is not null;
  else
    v_override := private.agent_catalog_setup_override_for(
      v_new_price, v_family_row.default_price);
    if v_override is not distinct from v_variant_row.price_override then
      raise exception 'CATALOG_SETUP_NO_CHANGE' using errcode = '22023';
    end if;
    v_affected := array[v_item];
  end if;
  v_affected := coalesce(v_affected, array[]::uuid[]);
  -- Bounded, never truncated. A shortened list of prices is a preview nobody can
  -- approve honestly, so a family this wide is refused rather than summarised.
  if pg_catalog.cardinality(v_affected) > 128 or v_shadowing > 128 then
    raise exception 'CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY' using errcode = '54000';
  end if;

  v_before := private.agent_catalog_setup_pricing_projection(
    p_company, v_family, v_item_kind, v_item, v_affected);

  -- The after side is the same projection with the one field moved. It is built
  -- here rather than read back from a speculative write, and the commit proves
  -- it by reading the same function again once the write has landed.
  v_after := jsonb_build_object(
    'target', v_before->'target',
    'price', case
      when v_item_kind = 'catalog_variant' then
        jsonb_build_object(
          'amount', private.agent_catalog_setup_money(
            coalesce(v_override, v_family_row.default_price)),
          'currency', v_currency,
          'origin', case
            when v_override is not null then 'variant'
            when v_family_row.default_price is not null then 'family'
            else 'none' end)
      else
        jsonb_build_object(
          'amount', private.agent_catalog_setup_money(v_new_price),
          'currency', v_currency,
          'origin', case when v_new_price is not null then 'family' else 'none' end)
      end,
    'affected_variants', coalesce((
      select jsonb_agg(
        case
          when v_item_kind = 'catalog_variant' then
            row_doc.value
              || jsonb_build_object(
                   'sale_price', private.agent_catalog_setup_money(
                     coalesce(v_override, v_family_row.default_price)),
                   'sale_price_origin', case
                     when v_override is not null then 'variant'
                     when v_family_row.default_price is not null then 'family'
                     else 'none' end)
          else
            row_doc.value
              || jsonb_build_object(
                   'sale_price', private.agent_catalog_setup_money(v_new_price),
                   'sale_price_origin', case
                     when v_new_price is not null then 'family' else 'none' end)
        end order by row_doc.ordinality)
      from jsonb_array_elements(v_before->'affected_variants') with ordinality row_doc(value, ordinality)
    ), '[]'::jsonb),
    -- The same variants on both sides: a family write moves no variant row.
    -- Only `redundant` follows the default, compared against the stored price
    -- exactly as the projection compares it, not against its rounded text.
    'shadowing_variants', coalesce((
      select jsonb_agg(
        row_doc.value
          || jsonb_build_object('redundant', coalesce((
               select variant_row.price_override = v_new_price
               from public.catalog_variants variant_row
               where variant_row.id = (row_doc.value#>>'{variant_ref,id}')::uuid
                 and variant_row.company_id = p_company), false))
        order by row_doc.ordinality)
      from jsonb_array_elements(v_before->'shadowing_variants') with ordinality row_doc(value, ordinality)
    ), '[]'::jsonb));

  -- A variant target must also show its own price on the after side, which the
  -- clause above does; a family target never touches a variant that carries an
  -- override, which the affected set above already excludes.
  select pg_catalog.count(*) into v_moved
  from jsonb_array_elements(v_before->'affected_variants') with ordinality past(value, ordinality)
  join jsonb_array_elements(v_after->'affected_variants') with ordinality next_row(value, ordinality)
    on next_row.ordinality = past.ordinality
  where (past.value->'sale_price') is distinct from (next_row.value->'sale_price');

  if v_item_kind = 'catalog_family' then
    -- The family's price is not in catalog_setup_save's family section, so the
    -- payload is the narrow writer's argument document and nothing else. No
    -- variant row is sent, and therefore no variant row can move.
    v_payload := jsonb_build_object(
      'writer', 'catalog_family_default_price_save',
      'family_id', v_family,
      'default_price', private.agent_catalog_setup_exact(v_new_price));
  else
    -- A variant's override IS in catalog_setup_save's variant section, so this
    -- goes through the wizard's own path with the family's complete current
    -- document and one field moved — to the level-preserving value, never the
    -- requested one verbatim. Every sibling is re-sent byte for byte.
    v_payload := private.agent_catalog_setup_write_payload(v_state);
    select jsonb_agg(
             case when variant_doc.value->>'id' = v_item::text
               then variant_doc.value
                    || jsonb_build_object('price_override',
                         case when v_override is null then 'null'::jsonb
                              else to_jsonb(private.agent_catalog_setup_exact(v_override)) end)
               else variant_doc.value end
             order by variant_doc.ordinality),
           pg_catalog.count(*) filter (where variant_doc.value->>'id' = v_item::text)
      into v_variants, v_matches
    from jsonb_array_elements(v_payload->'variants') with ordinality variant_doc(value, ordinality);
    if v_matches is distinct from 1 then
      raise exception 'CATALOG_SETUP_SOURCE_STALE' using errcode = '55000';
    end if;
    v_payload := jsonb_set(v_payload, '{variants}', v_variants);
  end if;

  v_effects := jsonb_build_object(
    'variants_created', 0,
    'stock_units_created', 0,
    'stock_events_recorded', 0,
    'options_created', 0,
    'variants_backfilled', 0,
    'supplier_cost_profiles_written', 0,
    'messages_sent', 0,
    'accounting_sync_enqueued', 0,
    'families_updated', case when v_item_kind = 'catalog_family' then 1 else 0 end,
    'variants_updated', case when v_item_kind = 'catalog_family' then 0 else 1 end,
    'prices_changed', v_moved);

  return jsonb_build_object(
    'family_id', v_family,
    'family_name', v_state#>>'{family,name}',
    'pre_image_hash', private.agent_catalog_setup_write_hash(v_state),
    'payload', v_payload,
    'evidence', v_evidence,
    'proposal_before', v_before,
    'proposal_after', v_after,
    'effects', v_effects,
    'blockers', '[]'::jsonb);
end $$;

-- ── set_supplier_cost ──────────────────────────────────────────────────────
-- The shipped projection, with `variant_unit_cost` read the way the catalogue
-- resolves it: {amount, origin} over unit_cost_override and the family's
-- default_unit_cost. The shipped bare number showed NULL for every variant of
-- an item-level-costed family, which read as "no cost" when the family answers
-- one, and could not show the difference between a cost this variant carries
-- and a cost it inherits.
create or replace function private.agent_catalog_setup_supplier_cost_projection(
  p_company uuid, p_family uuid, p_variant uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_variant public.catalog_variants%rowtype; v_currency text; v_profiles jsonb;
        v_family_cost numeric;
begin
  select * into v_variant from public.catalog_variants
  where id = p_variant and company_id = p_company
    and catalog_item_id = p_family and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select family.default_unit_cost into v_family_cost
  from public.catalog_items family
  where family.id = p_family and family.company_id = p_company and family.deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select nullif(pg_catalog.btrim(coalesce(company.currency_code, '')), '') into v_currency
  from public.companies company where company.id = p_company and company.deleted_at is null;
  if v_currency is null then
    raise exception 'CATALOG_SETUP_CURRENCY_UNAVAILABLE' using errcode = '55000';
  end if;

  -- A row whose own stored text OPS will not render keeps its key, its cost and
  -- its default flag, and gives up its label, rule and source together. See
  -- 20260916040000's header: refusing the whole sheet instead would make the tool
  -- unusable on the catalogue it was built for, and rendering the bytes anyway
  -- would put control characters in front of an operator.
  select coalesce(jsonb_agg(
           case when private.agent_prompt_text_is_safe(profile_row.label, true)
                 and private.agent_prompt_text_is_safe(profile_row.activation_rule::text, true)
                 and private.agent_prompt_text_is_safe((profile_row.source - 'ops')::text, true)
             then jsonb_build_object(
               'profile_key', profile_row.profile_key,
               'label', profile_row.label,
               'unit_cost', private.agent_catalog_setup_money(profile_row.unit_cost),
               'currency', pg_catalog.upper(profile_row.currency_code),
               'is_default', profile_row.is_default,
               'activation_rule', profile_row.activation_rule,
               'source', profile_row.source - 'ops',
               'content_kind', 'untrusted_business_data')
             else jsonb_build_object(
               'profile_key', profile_row.profile_key,
               'label', null,
               'unit_cost', private.agent_catalog_setup_money(profile_row.unit_cost),
               'currency', pg_catalog.upper(profile_row.currency_code),
               'is_default', profile_row.is_default,
               'activation_rule', '{}'::jsonb,
               'source', '{}'::jsonb,
               'content_kind', 'untrusted_business_data')
           end order by profile_row.is_default desc, profile_row.profile_key collate "C"), '[]'::jsonb)
    into v_profiles
  from public.catalog_supplier_cost_profiles profile_row
  where profile_row.company_id = p_company
    and profile_row.catalog_variant_id = p_variant
    and profile_row.deleted_at is null;

  return jsonb_build_object(
    'variant', jsonb_build_object(
      'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', p_variant),
      'value_labels', private.agent_catalog_setup_value_labels(p_company, p_family, p_variant),
      'sku', nullif(pg_catalog.btrim(coalesce(v_variant.sku, '')), '')),
    'profiles', v_profiles,
    'variant_unit_cost', private.agent_catalog_setup_amount_level(
      v_variant.unit_cost_override, v_family_cost));
end $$;

-- The shipped writer, with its mirror aimed at the level the family already
-- uses. See the header: the shipped mirror wrote the default profile's cost
-- into unit_cost_override whenever the default moved, which converted an
-- item-level-costed family to variant-level costing one variant at a time.
create or replace function private.catalog_supplier_cost_profile_save(
  p_company_id uuid, p_actor_user_id uuid, p_variant_id uuid,
  p_profile jsonb, p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_request_hash text;
  v_existing private.agent_catalog_setup_writer_requests%rowtype;
  v_variant public.catalog_variants%rowtype;
  v_currency text;
  v_key text;
  v_label text;
  v_cost numeric;
  v_is_default boolean;
  v_activation jsonb;
  v_source jsonb;
  v_target public.catalog_supplier_cost_profiles%rowtype;
  v_current_default public.catalog_supplier_cost_profiles%rowtype;
  v_demoted integer := 0;
  v_rows integer;
  v_default_cost numeric;
  v_family_cost numeric;
  v_mirror boolean := false;
  v_result jsonb;
begin
  if p_company_id is null or p_actor_user_id is null or p_variant_id is null
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or p_profile is null or jsonb_typeof(p_profile) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_profile) key
                where key not in ('profile_key','label','unit_cost','currency_code',
                                  'is_default','activation_rule','source'))
     or not p_profile ?& array['profile_key','label','unit_cost','currency_code',
                               'is_default','activation_rule','source'] then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_key := p_profile->>'profile_key';
  v_label := pg_catalog.btrim(coalesce(p_profile->>'label', ''));
  v_is_default := (p_profile->>'is_default')::boolean;
  v_activation := p_profile->'activation_rule';
  v_source := p_profile->'source';
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9-]{0,79}$'
     or pg_catalog.length(v_label) not between 1 and 160
     or (p_profile->>'unit_cost') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$'
     or (p_profile->>'currency_code') !~ '^[A-Z]{3}$'
     or v_is_default is null
     or jsonb_typeof(v_activation) <> 'object'
     or jsonb_typeof(v_source) <> 'object'
     or not private.agent_catalog_setup_bounded_object(v_activation)
     or not private.agent_catalog_setup_bounded_object(v_source - 'ops')
     or not private.agent_prompt_text_is_safe(v_label, true)
     or not private.agent_prompt_text_is_safe(v_activation::text, true)
     or not private.agent_prompt_text_is_safe((v_source - 'ops')::text, true) then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  -- The server's provenance block must be present and must be the server's.
  -- Nothing reaching this function may carry a caller-authored `ops` key: the
  -- caller-facing bounded-object check refuses one, and this re-asserts it.
  if jsonb_typeof(v_source->'ops') is distinct from 'object'
     or (v_source#>>'{ops,recorded_by}') is distinct from 'mcp'
     or not (v_source->'ops') ?& array['recorded_by','action_id','change_set_id','recorded_at'] then
    raise exception 'CATALOG_SETUP_PROFILE_PROVENANCE_MISSING' using errcode = '22023';
  end if;
  v_cost := (p_profile->>'unit_cost')::numeric;

  -- Defence in depth. The commit re-authorized the grant, the permissions and
  -- the family before it got here; cost is separately authorised data, so the
  -- writer refuses on its own account as well.
  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id and company.deleted_at is null
    where actor.id = p_actor_user_id and actor.company_id = p_company_id
      and actor.is_active and actor.deleted_at is null
  )
     or not public.has_permission(p_actor_user_id, 'catalog.manage', 'all')
     or not public.has_permission(p_actor_user_id, 'catalog.run_setup', 'all')
     or not public.has_permission(p_actor_user_id, 'finances.view', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;

  v_request_hash := private.agent_catalog_setup_write_hash(jsonb_build_object(
    'writer', 'catalog_supplier_cost_profile_save',
    'company', p_company_id, 'actor', p_actor_user_id, 'variant', p_variant_id,
    'profile', p_profile - 'source' || jsonb_build_object('source', v_source - 'ops')));

  select * into v_existing from private.agent_catalog_setup_writer_requests
  where company_id = p_company_id and writer = 'catalog_supplier_cost_profile_save'
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception 'CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  select * into v_variant from public.catalog_variants
  where id = p_variant_id and company_id = p_company_id and deleted_at is null
  for update;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select nullif(pg_catalog.btrim(coalesce(company.currency_code, '')), '') into v_currency
  from public.companies company where company.id = p_company_id and company.deleted_at is null;
  if v_currency is null or (p_profile->>'currency_code') is distinct from v_currency then
    raise exception 'CATALOG_SETUP_CURRENCY_INVALID' using errcode = '22023';
  end if;

  select * into v_target from public.catalog_supplier_cost_profiles
  where company_id = p_company_id and catalog_variant_id = p_variant_id
    and profile_key = v_key
  for update;
  select * into v_current_default from public.catalog_supplier_cost_profiles
  where company_id = p_company_id and catalog_variant_id = p_variant_id
    and is_default and deleted_at is null
  for update;

  -- A variant carrying profiles carries exactly one default. Refusing here is
  -- the only answer that does not guess: silently promoting would decide a cost
  -- question on the operator's behalf.
  if not v_is_default
     and not (v_current_default.id is not null
              and v_current_default.id is distinct from v_target.id) then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
  end if;

  -- Demote FIRST, then write the target: the partial unique index is enforced
  -- per statement, so the other order would trip it.
  if v_is_default and v_current_default.id is not null
     and v_current_default.id is distinct from v_target.id then
    update public.catalog_supplier_cost_profiles
       set is_default = false
     where id = v_current_default.id;
    get diagnostics v_rows = row_count;
    if v_rows is distinct from 1 then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
    v_demoted := 1;
  end if;

  if v_target.id is null then
    insert into public.catalog_supplier_cost_profiles(
      company_id, catalog_variant_id, profile_key, label, unit_cost,
      currency_code, is_default, activation_rule, source)
    values (
      p_company_id, p_variant_id, v_key, v_label, pg_catalog.round(v_cost, 4),
      v_currency, v_is_default, v_activation, v_source);
  else
    -- Revived rather than re-inserted: (company, variant, profile_key) is
    -- unique WITHOUT a deleted_at predicate, so a soft-deleted row would make
    -- an insert violate the constraint rather than replace the row.
    update public.catalog_supplier_cost_profiles
       set label = v_label,
           unit_cost = pg_catalog.round(v_cost, 4),
           currency_code = v_currency,
           is_default = v_is_default,
           activation_rule = v_activation,
           source = v_source,
           deleted_at = null
     where id = v_target.id;
    get diagnostics v_rows = row_count;
    if v_rows is distinct from 1 then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
  end if;

  -- The mirror (gap #17). The default that ends up in force decides the
  -- variant's catalogue cost, so the two models cannot drift for this row — AT
  -- THE LEVEL THE FAMILY ALREADY USES. The catalogue cost resolves as
  -- coalesce(unit_cost_override, catalog_items.default_unit_cost):
  --   * a family whose default_unit_cost is NULL, or differs from the new
  --     default cost, gets the cost on the variant's own term;
  --   * a family whose default_unit_cost EQUALS it leaves the variant
  --     inheriting — its own term is NULL afterwards, cleared if it was set.
  -- The family column is read and never written: one variant's supplier cost
  -- does not get to move the cost of every other variant in the family.
  select profile_row.unit_cost into v_default_cost
  from public.catalog_supplier_cost_profiles profile_row
  where profile_row.company_id = p_company_id
    and profile_row.catalog_variant_id = p_variant_id
    and profile_row.is_default and profile_row.deleted_at is null;
  if v_default_cost is null then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
  end if;
  select family.default_unit_cost into v_family_cost
  from public.catalog_items family
  where family.id = v_variant.catalog_item_id and family.company_id = p_company_id
    and family.deleted_at is null
  for share;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_current_default.id is null
     or v_current_default.profile_key is distinct from (
          select inner_row.profile_key from public.catalog_supplier_cost_profiles inner_row
          where inner_row.company_id = p_company_id
            and inner_row.catalog_variant_id = p_variant_id
            and inner_row.is_default and inner_row.deleted_at is null)
     or v_current_default.unit_cost is distinct from v_default_cost then
    -- trim_scale for the same reason the family price writer trims: the column
    -- is an unconstrained numeric and keeps whatever scale it is written with,
    -- and 18.25 beside 16.92 is what every hand-written row in this catalogue
    -- already looks like.
    update public.catalog_variants
       set unit_cost_override = private.agent_catalog_setup_override_for(
             pg_catalog.trim_scale(v_default_cost), v_family_cost),
           updated_at = clock_timestamp()
     where id = p_variant_id and company_id = p_company_id and deleted_at is null;
    get diagnostics v_rows = row_count;
    if v_rows is distinct from 1 then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
    v_mirror := true;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'blockers', '[]'::jsonb,
    'writer', 'catalog_supplier_cost_profile_save',
    'variant_id', p_variant_id,
    'profile_key', v_key,
    'profiles_demoted', v_demoted,
    'variant_unit_cost_mirrored', v_mirror,
    'projection', private.agent_catalog_setup_supplier_cost_projection(
      p_company_id, v_variant.catalog_item_id, p_variant_id),
    'replayed', false);
  insert into private.agent_catalog_setup_writer_requests(
    company_id, actor_user_id, writer, idempotency_key, request_hash, source, response)
  values (
    p_company_id, p_actor_user_id, 'catalog_supplier_cost_profile_save',
    p_idempotency_key, v_request_hash, v_source->'ops', v_result);
  return v_result;
end $$;

-- The 20260916070000 body with the mirror prediction aimed at the family's level
-- (see the writer above) and `variant_unit_cost` as {amount, origin}.
create or replace function private.agent_catalog_setup_compile_set_supplier_cost(
  p_company uuid, p_actor uuid, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_variant uuid;
  v_family uuid;
  v_variant_row public.catalog_variants%rowtype;
  v_state jsonb;
  v_entry jsonb;
  v_text text;
  v_evidence jsonb := '[]'::jsonb;
  v_currency text;
  v_key text;
  v_label text;
  v_cost numeric;
  v_minor smallint;
  v_is_default boolean;
  v_activation jsonb;
  v_source jsonb;
  v_target public.catalog_supplier_cost_profiles%rowtype;
  v_current_default public.catalog_supplier_cost_profiles%rowtype;
  v_before jsonb;
  v_after_profiles jsonb;
  v_after jsonb;
  v_target_state text;
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_new_default_key text;
  v_new_default_cost numeric;
  v_mirror boolean;
  v_family_cost numeric;
  v_after_cost numeric;
  v_effects jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or octet_length(p_request::text) > 32768
     or exists (
       select 1 from jsonb_object_keys(p_request) key
       where key not in ('variant_ref','profile_key','label','unit_cost','is_default',
                         'activation_rule','source','evidence','idempotency_key')
     )
     or not p_request ?& array['variant_ref','profile_key','label','unit_cost',
                               'evidence','idempotency_key']
     or jsonb_typeof(p_request->'evidence') is distinct from 'array'
     or (p_request->>'idempotency_key') is null
     or (p_request->>'idempotency_key') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or jsonb_typeof(p_request->'variant_ref') is distinct from 'object'
     or (p_request#>>'{variant_ref,kind}') is distinct from 'catalog_variant'
     or exists (select 1 from jsonb_object_keys(p_request->'variant_ref') key where key not in ('kind','id'))
     or (p_request#>>'{variant_ref,id}') !~ v_uuid_pattern then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_variant := (p_request#>>'{variant_ref,id}')::uuid;
  v_key := p_request->>'profile_key';
  v_label := pg_catalog.btrim(coalesce(p_request->>'label', ''));
  v_is_default := coalesce((p_request->>'is_default')::boolean, false);
  v_activation := coalesce(p_request->'activation_rule', '{}'::jsonb);
  v_source := coalesce(p_request->'source', '{}'::jsonb);
  if jsonb_typeof(p_request->'profile_key') is distinct from 'string'
     or v_key !~ '^[a-z0-9][a-z0-9-]{0,79}$'
     or jsonb_typeof(p_request->'label') is distinct from 'string'
     or pg_catalog.length(v_label) not between 1 and 160
     or (p_request ? 'is_default' and jsonb_typeof(p_request->'is_default') <> 'boolean')
     or jsonb_typeof(p_request->'unit_cost') is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_request->'unit_cost') key
                where key not in ('amount','currency'))
     or not (p_request->'unit_cost') ?& array['amount','currency']
     or jsonb_typeof(p_request#>'{unit_cost,amount}') is distinct from 'string'
     or (p_request#>>'{unit_cost,amount}') !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$'
     or (p_request#>>'{unit_cost,currency}') !~ '^[A-Z]{3}$'
     or not private.agent_catalog_setup_bounded_object(v_activation)
     or not private.agent_catalog_setup_bounded_object(v_source)
     -- The caller's own text goes straight onto an operator's screen and then
     -- into the row. Control characters are refused on the way in, which is
     -- also what stops this tool adding to the unreadable rows it can already
     -- see.
     or not private.agent_prompt_text_is_safe(v_label, true)
     or not private.agent_prompt_text_is_safe(v_activation::text, true)
     or not private.agent_prompt_text_is_safe(v_source::text, true) then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  v_cost := pg_catalog.round((p_request#>>'{unit_cost,amount}')::numeric, 4);

  -- Money at the currency's own minor unit, and no finer. The catalogue read
  -- projects money through private.agent_money_to_minor_units, which raises
  -- agent_money_minor_units_not_exact on a stored number that is not exact
  -- there, so a row written finer than its currency is a row the read then
  -- refuses to show -- which is exactly how four Glass Panel cost profiles
  -- broke get_catalog_item for a whole family. The same exponent table the
  -- read uses decides it here, so the two cannot disagree, and a currency that
  -- table does not name is refused rather than guessed at.
  v_minor := private.agent_currency_minor_exponent_or_null(p_request#>>'{unit_cost,currency}');
  if v_minor is null
     or pg_catalog.trunc(v_cost * pg_catalog.power(10::numeric, v_minor))
        is distinct from v_cost * pg_catalog.power(10::numeric, v_minor) then
    raise exception 'CATALOG_SETUP_MONEY_PRECISION_INVALID' using errcode = '22023';
  end if;

  -- Cost is separately authorised data, and the field this writes is guarded by
  -- the setup permission. Both are checked here so a prepare refuses up front.
  if not public.has_permission(p_actor, 'finances.view', 'all')
     or not public.has_permission(p_actor, 'catalog.run_setup', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;

  if jsonb_array_length(p_request->'evidence') not between 1 and 3 then
    raise exception 'CATALOG_SETUP_EVIDENCE_MISSING' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_request->'evidence') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (v_entry->>'kind') is distinct from 'operator_statement'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('kind','text')) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_text := v_entry->>'text';
    if v_text is null or v_text is distinct from pg_catalog.btrim(v_text)
       or pg_catalog.length(v_text) not between 1 and 2000
       or not private.agent_prompt_text_is_safe(v_text, true) then
      raise exception 'CATALOG_SETUP_EVIDENCE_INVALID' using errcode = '22023';
    end if;
    v_evidence := v_evidence || jsonb_build_array(jsonb_build_object(
      'kind', 'operator_statement',
      'text', v_text,
      'source_sha256', private.agent_catalog_setup_write_hash(
        jsonb_build_object('actor', p_actor, 'statement', v_text)),
      'content_kind', 'untrusted_business_data'));
  end loop;

  select * into v_variant_row from public.catalog_variants
  where id = v_variant and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_family := v_variant_row.catalog_item_id;

  -- Locks the family and pins the pre-image the commit will be checked against.
  v_state := private.agent_catalog_setup_family_state(p_company, v_family);
  v_currency := v_state->>'currency_code';
  if (p_request#>>'{unit_cost,currency}') is distinct from v_currency then
    raise exception 'CATALOG_SETUP_CURRENCY_INVALID' using errcode = '22023';
  end if;

  select * into v_target from public.catalog_supplier_cost_profiles
  where company_id = p_company and catalog_variant_id = v_variant and profile_key = v_key;
  select * into v_current_default from public.catalog_supplier_cost_profiles
  where company_id = p_company and catalog_variant_id = v_variant
    and is_default and deleted_at is null;

  if not v_is_default
     and not (v_current_default.id is not null
              and v_current_default.id is distinct from v_target.id) then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
  end if;

  v_before := private.agent_catalog_setup_supplier_cost_projection(p_company, v_family, v_variant);

  -- What this approval does to the row it names.
  v_target_state := case
    when v_target.id is null then 'created'
    when v_target.deleted_at is not null then 'revived'
    when not v_target.is_default and v_is_default then 'promoted'
    when v_target.label is distinct from v_label
      or v_target.unit_cost is distinct from v_cost
      or pg_catalog.upper(v_target.currency_code) is distinct from v_currency
      or v_target.is_default is distinct from v_is_default
      or v_target.activation_rule is distinct from v_activation
      or (v_target.source - 'ops') is distinct from v_source then 'updated'
    else 'unchanged' end;
  if v_target_state = 'unchanged' then
    raise exception 'CATALOG_SETUP_NO_CHANGE' using errcode = '22023';
  end if;
  if v_is_default and not (v_target.id is not null
                           and v_target.deleted_at is null
                           and v_target.is_default) then
    v_promoted := 1;
  end if;
  if v_is_default and v_current_default.id is not null
     and v_current_default.id is distinct from v_target.id then
    v_demoted := 1;
  end if;

  -- The cost sheet as it will read: every live profile, the named one moved,
  -- the outgoing default demoted, and everything else exactly as it stands.
  select coalesce(jsonb_agg(entry order by entry->>'is_default' desc, entry->>'profile_key' collate "C"), '[]'::jsonb)
    into v_after_profiles
  from (
    select case
             when row_doc.value->>'profile_key' = v_key then
               jsonb_build_object(
                 'profile_key', v_key, 'label', v_label,
                 'unit_cost', private.agent_catalog_setup_money(v_cost),
                 'currency', v_currency, 'is_default', v_is_default,
                 'activation_rule', v_activation, 'source', v_source,
                 'content_kind', 'untrusted_business_data',
                 'state', v_target_state)
             when v_demoted = 1 and coalesce((row_doc.value->>'is_default')::boolean, false) then
               row_doc.value || jsonb_build_object('is_default', false, 'state', 'demoted')
             else row_doc.value || jsonb_build_object('state', 'unchanged')
           end as entry
    from jsonb_array_elements(v_before->'profiles') row_doc(value)
    union all
    select jsonb_build_object(
             'profile_key', v_key, 'label', v_label,
             'unit_cost', private.agent_catalog_setup_money(v_cost),
             'currency', v_currency, 'is_default', v_is_default,
             'activation_rule', v_activation, 'source', v_source,
             'content_kind', 'untrusted_business_data',
             'state', v_target_state)
    where v_target_state in ('created', 'revived')
  ) rows;
  if jsonb_array_length(v_after_profiles) > 32 then
    raise exception 'CATALOG_SETUP_PROFILES_TOO_MANY' using errcode = '54000';
  end if;

  -- The mirror, predicted exactly as the writer performs it: when the default
  -- moves, the variant's own cost term becomes the new default cost unless the
  -- family's default_unit_cost already equals it, in which case the variant
  -- inherits. Both sides then name the resolved cost and the level it is at.
  select row_doc.value->>'profile_key',
         (row_doc.value->>'unit_cost')::numeric
    into v_new_default_key, v_new_default_cost
  from jsonb_array_elements(v_after_profiles) row_doc(value)
  where coalesce((row_doc.value->>'is_default')::boolean, false);
  if v_new_default_key is null then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
  end if;
  select family.default_unit_cost into v_family_cost
  from public.catalog_items family
  where family.id = v_family and family.company_id = p_company and family.deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_mirror := v_current_default.id is null
    or v_current_default.profile_key is distinct from v_new_default_key
    or v_current_default.unit_cost is distinct from v_new_default_cost;
  v_after_cost := case
    when v_mirror then private.agent_catalog_setup_override_for(v_new_default_cost, v_family_cost)
    else v_variant_row.unit_cost_override end;

  v_after := jsonb_build_object(
    'variant', v_before->'variant',
    'profiles', v_after_profiles,
    'variant_unit_cost', private.agent_catalog_setup_amount_level(v_after_cost, v_family_cost));

  v_effects := jsonb_build_object(
    'variants_created', 0,
    'stock_units_created', 0,
    'stock_events_recorded', 0,
    'prices_changed', 0,
    'options_created', 0,
    'variants_backfilled', 0,
    'messages_sent', 0,
    'accounting_sync_enqueued', 0,
    'supplier_cost_profiles_written', 1 + v_demoted,
    'profiles_created', case when v_target_state = 'created' then 1 else 0 end,
    'profiles_revived', case when v_target_state = 'revived' then 1 else 0 end,
    'profiles_updated', case when v_target_state in ('updated', 'promoted') then 1 else 0 end,
    'profiles_demoted', v_demoted,
    'profiles_promoted', v_promoted,
    'variant_unit_cost_mirrored', v_mirror);

  return jsonb_build_object(
    'family_id', v_family,
    'family_name', v_state#>>'{family,name}',
    'pre_image_hash', private.agent_catalog_setup_write_hash(v_state),
    'payload', jsonb_build_object(
      'writer', 'catalog_supplier_cost_profile_save',
      'variant_id', v_variant,
      'profile', jsonb_build_object(
        'profile_key', v_key,
        'label', v_label,
        'unit_cost', private.agent_catalog_setup_money(v_cost),
        'currency_code', v_currency,
        'is_default', v_is_default,
        'activation_rule', v_activation,
        'source', v_source)),
    'evidence', v_evidence,
    'proposal_before', v_before,
    'proposal_after', v_after,
    'effects', v_effects,
    'blockers', '[]'::jsonb);
end $$;

-- ── Commit: the post-condition ─────────────────────────────────────────────
-- The 20260916030000 commit with one guard added around the write. Every kind's
-- compile now aims each value at the level the family already uses; this is
-- what makes that a property of the commit rather than a promise four compile
-- functions keep. It runs after the write and before the read-back, so a write
-- that changed a level is refused as exactly that, and the transaction — the
-- write, the ledger rows, the receipt — rolls back with it.
create or replace function public.commit_catalog_setup_write_as_actor(
  p_actor_user_id uuid, p_company_id uuid, p_action_id uuid, p_change_set_id uuid,
  p_preview_sha256 text, p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_write private.agent_catalog_setup_writes%rowtype;
  v_action public.agent_actions%rowtype;
  v_state jsonb;
  v_levels_before public.catalog_variants[];
  v_level_changes jsonb;
  v_save jsonb;
  v_projection jsonb;
  v_readback jsonb;
  v_result jsonb;
  v_sub text;
  v_claims_before text;
  v_claim_role_before text;
  v_claim_sub_before text;
  v_confirmation uuid := extensions.gen_random_uuid();
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'access_denied' using errcode = '42501';
  end if;
  if p_actor_user_id is null or p_company_id is null or p_action_id is null
     or p_change_set_id is null or p_preview_sha256 is null
     or p_preview_sha256 !~ '^sha256:[0-9a-f]{64}$'
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception 'CATALOG_SETUP_WRITE_CONFIRMATION_INVALID' using errcode = '22023';
  end if;
  perform private.lock_lead_assignment_company(p_company_id);
  select * into v_write from private.agent_catalog_setup_writes
  where id = p_change_set_id and action_id = p_action_id
    and company_id = p_company_id and actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'CATALOG_SETUP_WRITE_RECORD_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Authorization always precedes replay, including stale permission snapshots.
  perform private.agent_catalog_setup_write_reauthorize(v_write);
  if v_write.preview_hash is distinct from p_preview_sha256 then
    raise exception 'CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
  end if;
  if v_write.committed_at is not null then
    if v_write.commit_key is distinct from p_idempotency_key then
      raise exception 'CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_write.receipt || jsonb_build_object('replayed', true);
  end if;
  select * into v_action from public.agent_actions
  where id = p_action_id and company_id = p_company_id and user_id = p_actor_user_id
    and action_type = 'approve_catalog_setup_write'
  for update;
  if not found or v_action.status <> 'pending' or v_action.expires_at <= clock_timestamp()
     or v_write.expires_at <= clock_timestamp() or v_write.rejected_at is not null
     or v_action.action_data->>'preview_sha256' is distinct from p_preview_sha256
     or v_action.action_data->'proposal' is distinct from v_write.proposal
     or v_write.policy_revision <> '2026-09-15.catalog-setup-write.v1' then
    raise exception 'CATALOG_SETUP_WRITE_CONFIRMATION_STALE' using errcode = '55000';
  end if;

  -- The effects this seal was reviewed against must still be the installed ones.
  perform private.agent_catalog_setup_write_assert_seal(true);
  if private.agent_catalog_setup_write_effect_revision() is distinct from v_write.effect_sha256 then
    raise exception 'CATALOG_SETUP_WRITE_EFFECT_POLICY_CHANGED' using errcode = '55000';
  end if;

  -- The approved document was derived from an exact family pre-image. If the
  -- family moved underneath the approval, the document would overwrite the move.
  v_state := private.agent_catalog_setup_family_state(p_company_id, v_write.family_id);
  if private.agent_catalog_setup_write_hash(v_state) is distinct from v_write.pre_image_hash then
    raise exception 'CATALOG_SETUP_SOURCE_STALE' using errcode = '55000';
  end if;

  select coalesce(nullif(pg_catalog.btrim(actor.auth_id), ''),
                  nullif(pg_catalog.btrim(actor.firebase_uid), ''))
    into v_sub
  from public.users actor
  where actor.id = p_actor_user_id and actor.company_id = p_company_id
    and actor.is_active and actor.deleted_at is null;
  if v_sub is null then
    raise exception 'CATALOG_SETUP_OPERATOR_IDENTITY_UNAVAILABLE' using errcode = '42501';
  end if;
  v_claims_before := coalesce(current_setting('request.jwt.claims', true), '');
  v_claim_role_before := coalesce(current_setting('request.jwt.claim.role', true), '');
  v_claim_sub_before := coalesce(current_setting('request.jwt.claim.sub', true), '');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_sub, true);
  if private.get_current_user_id() is distinct from p_actor_user_id
     or private.get_user_company_id() is distinct from p_company_id then
    perform set_config('request.jwt.claims', v_claims_before, true);
    perform set_config('request.jwt.claim.role', v_claim_role_before, true);
    perform set_config('request.jwt.claim.sub', v_claim_sub_before, true);
    raise exception 'CATALOG_SETUP_OPERATOR_IDENTITY_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Every live variant of the family, as typed rows, immediately before the
  -- write, and after the pre-image check above proved they are the rows the
  -- operator approved against. A writer outside this vertical that changed a
  -- variant in the instant between this read and the guard could only make the
  -- guard refuse; it cannot hide a change this write made.
  select coalesce(pg_catalog.array_agg(variant_row order by variant_row.id),
                  array[]::public.catalog_variants[])
    into v_levels_before
  from public.catalog_variants variant_row
  where variant_row.company_id = p_company_id
    and variant_row.catalog_item_id = v_write.family_id
    and variant_row.deleted_at is null;
  v_save := private.agent_catalog_setup_write_apply(v_write);
  perform set_config('request.jwt.claims', v_claims_before, true);
  perform set_config('request.jwt.claim.role', v_claim_role_before, true);
  perform set_config('request.jwt.claim.sub', v_claim_sub_before, true);

  if v_save is null or jsonb_typeof(v_save) is distinct from 'object'
     or coalesce((v_save->>'ok')::boolean, false) is distinct from true
     or jsonb_array_length(coalesce(v_save->'blockers', '[]'::jsonb)) > 0 then
    raise exception 'CATALOG_SETUP_SAVE_BLOCKED' using errcode = '55000',
      detail = coalesce(v_save->>'blockers', '[]');
  end if;

  -- A write never changes the level a value resolves at as a side effect. Any
  -- variant price, cost, threshold or unit this write changed — a new variant
  -- counts as changed from nothing — that now sits on the variant while equal
  -- to what the variant would inherit is a level change nobody approved:
  -- refuse, and the whole write rolls back. Overrides that were already
  -- redundant and that this write left alone do not trip it.
  v_level_changes := private.agent_catalog_setup_override_level_changes(
    p_company_id, v_write.family_id, v_levels_before);
  if jsonb_array_length(v_level_changes) > 0 then
    raise exception 'CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED' using errcode = '55000',
      detail = v_level_changes::text;
  end if;

  -- Independent read through the same projection the preview predicted.
  v_projection := private.agent_catalog_setup_write_readback(v_write, v_save);
  v_readback := v_projection->'readback';

  v_now := clock_timestamp();
  v_result := jsonb_build_object(
    'ok', true,
    'effect', 'catalog_setup_write_saved_inside_ops',
    'kind', v_write.kind,
    'action_id', p_action_id,
    'change_set_id', p_change_set_id,
    'run_id', v_write.run_id,
    'confirmation_receipt_id', v_confirmation,
    'preview_sha256', p_preview_sha256,
    'readback_sha256', private.agent_catalog_setup_write_hash(v_readback),
    'readback', v_readback,
    'effects', v_write.proposal->'effects',
    'committed_at', v_now,
    'replayed', false) || (v_projection - 'readback');
  v_result := v_result || jsonb_build_object(
    'receipt_sha256', private.agent_catalog_setup_write_hash(v_result));
  update private.agent_catalog_setup_writes
     set committed_at = v_now, confirmation_id = v_confirmation,
         commit_key = p_idempotency_key, receipt = v_result
   where id = v_write.id;
  update public.agent_actions
     set status = 'executed', reviewed_by = p_actor_user_id, reviewed_at = v_now,
         executed_at = v_now, execution_result = v_result, error = null
   where id = p_action_id and status = 'pending';
  if not found then
    raise exception 'CATALOG_SETUP_WRITE_ACTION_CONFLICT' using errcode = '40001';
  end if;
  update public.notifications set is_read = true, persistent = false
   where company_id = p_company_id::text and user_id = p_actor_user_id::text
     and dedupe_key = 'catalog-setup-write:' || p_action_id::text;
  return v_result;
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps a function's privileges and CREATE grants EXECUTE to
-- PUBLIC, so both kinds of definition are restated: no app role executes any
-- private function here, service_role included, and the commit stays callable
-- by service_role alone.
do $acl$
declare f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in (
            'agent_catalog_setup_override_for',
            'agent_catalog_setup_amount_level',
            'agent_catalog_setup_override_level_changes',
            'agent_catalog_setup_variant_projection',
            'agent_catalog_setup_compile_create_variant',
            'agent_catalog_setup_compile_set_thresholds',
            'agent_catalog_setup_pricing_projection',
            'agent_catalog_setup_compile_set_pricing',
            'agent_catalog_setup_supplier_cost_projection',
            'catalog_supplier_cost_profile_save',
            'agent_catalog_setup_compile_set_supplier_cost'))
       or (n.nspname = 'public' and p.proname = 'commit_catalog_setup_write_as_actor')
  loop
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',
      f.nspname, f.proname, f.args);
    if f.nspname = 'public' then
      execute format('grant execute on function %I.%I(%s) to service_role',
        f.nspname, f.proname, f.args);
    end if;
  end loop;
end $acl$;

do $postflight$
declare
  f record;
  v_role text;
  v_seen integer := 0;
  v_effect_before text;
  v_effect_after text;
  v_commit text;
  v_pricing text;
begin
  -- Every definition landed with the posture the vertical ships with, and no
  -- app role can reach a private one.
  for f in
    select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig, p.provolatile
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in (
            'agent_catalog_setup_override_for',
            'agent_catalog_setup_amount_level',
            'agent_catalog_setup_override_level_changes',
            'agent_catalog_setup_variant_projection',
            'agent_catalog_setup_compile_create_variant',
            'agent_catalog_setup_compile_set_thresholds',
            'agent_catalog_setup_pricing_projection',
            'agent_catalog_setup_compile_set_pricing',
            'agent_catalog_setup_supplier_cost_projection',
            'catalog_supplier_cost_profile_save',
            'agent_catalog_setup_compile_set_supplier_cost'))
       or (n.nspname = 'public' and p.proname = 'commit_catalog_setup_write_as_actor')
  loop
    v_seen := v_seen + 1;
    if f.proconfig is null or not ('search_path=""' = any(f.proconfig))
       or (f.proname not in ('agent_catalog_setup_override_for',
                             'agent_catalog_setup_amount_level')
           and not f.prosecdef) then
      raise exception 'agent_catalog_setup_override_level_posture_lost: %', f.proname
        using errcode = '55000';
    end if;
    foreach v_role in array array['public','anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(v_role, f.oid, 'execute')
         and not (f.nspname = 'public' and v_role = 'service_role') then
        raise exception 'agent_catalog_setup_override_level_executable: % by %',
          f.proname, v_role using errcode = '42501';
      end if;
    end loop;
    if f.nspname = 'public'
       and not pg_catalog.has_function_privilege('service_role', f.oid, 'execute') then
      raise exception 'agent_catalog_setup_override_level_commit_unreachable'
        using errcode = '42501';
    end if;
  end loop;
  if v_seen <> 12 then
    raise exception 'agent_catalog_setup_override_level_incomplete: % of 12', v_seen
      using errcode = '55000';
  end if;
  -- The writers this vertical already had stay unreachable too.
  foreach v_role in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(v_role,
         'private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)'::regprocedure,
         'execute') then
      raise exception 'agent_catalog_setup_override_level_executable: catalog_family_default_price_save by %',
        v_role using errcode = '42501';
    end if;
  end loop;

  -- The rule, answered the way the header states it.
  if private.agent_catalog_setup_override_for(15, 15.0000) is not null
     or private.agent_catalog_setup_override_for(18, 15) is distinct from 18::numeric
     or private.agent_catalog_setup_override_for(15, null) is distinct from 15::numeric
     or private.agent_catalog_setup_override_for(null, 15) is not null
     or private.agent_catalog_setup_amount_level(null, 15)
          is distinct from '{"amount": "15.0000", "origin": "family"}'::jsonb
     or private.agent_catalog_setup_amount_level(18, 15)
          is distinct from '{"amount": "18.0000", "origin": "variant"}'::jsonb
     or private.agent_catalog_setup_amount_level(null, null)
          is distinct from '{"amount": null, "origin": "none"}'::jsonb then
    raise exception 'agent_catalog_setup_override_level_rule_wrong' using errcode = '55000';
  end if;

  -- Every writer that mirrors a value goes through the rule, and the commit
  -- carries the guard.
  for f in
    select * from (values
      ('private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb)'),
      ('private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)'),
      ('private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'),
      ('private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)'),
      ('private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)')
    ) writer(signature)
  loop
    if pg_catalog.strpos(pg_catalog.pg_get_functiondef(f.signature::regprocedure),
         'private.agent_catalog_setup_override_for(') = 0 then
      raise exception 'agent_catalog_setup_override_level_rule_bypassed: %', f.signature
        using errcode = '55000';
    end if;
  end loop;
  v_commit := pg_catalog.pg_get_functiondef(
    'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'::regprocedure);
  if pg_catalog.strpos(v_commit, 'CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED') = 0
     or pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_override_level_changes(') = 0
     or pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_write_apply(') = 0
     or pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_override_level_changes(')
          < pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_write_apply(')
     or pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_write_readback(')
          < pg_catalog.strpos(v_commit, 'private.agent_catalog_setup_override_level_changes(') then
    raise exception 'agent_catalog_setup_override_level_guard_missing' using errcode = '55000';
  end if;
  -- The behaviour that was defended in a comment is gone, and so is the comment.
  v_pricing := pg_catalog.pg_get_functiondef(
    'private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'::regprocedure);
  if pg_catalog.strpos(v_pricing, 'pinning a variant to the price it already') > 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
          'private.agent_catalog_setup_pricing_projection(uuid,uuid,text,uuid,uuid[])'::regprocedure),
          'shadowing_variants') = 0 then
    raise exception 'agent_catalog_setup_override_level_pricing_incomplete' using errcode = '55000';
  end if;
  -- The writer never moves the family cost.
  if pg_catalog.pg_get_functiondef(
       'private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)'::regprocedure)
       ~* 'update\s+public\.catalog_items' then
    raise exception 'agent_catalog_setup_override_level_family_cost_written' using errcode = '55000';
  end if;

  -- THE SEAL. The effect revision moved, and the reviewed seal no longer
  -- matches it: every prepare and every commit fails closed until an operator
  -- reseals against the definitions this file installed. This file writes no
  -- seal row.
  v_effect_before := nullif(pg_catalog.current_setting(
    'ops.catalog_setup_override_level_effect_before', true), '');
  v_effect_after := private.agent_catalog_setup_write_effect_revision();
  if v_effect_before is null or v_effect_after is not distinct from v_effect_before then
    raise exception 'agent_catalog_setup_override_level_effect_unmoved' using errcode = '55000';
  end if;
  if exists (
    select 1 from private.agent_catalog_effect_policy
    where revision = '2026-09-15.catalog-setup-write.v1'
      and effect_sha256 = v_effect_after
  ) then
    raise exception 'agent_catalog_setup_override_level_seal_still_matches' using errcode = '55000';
  end if;
  raise notice 'catalogue override level: rule installed, commit guard installed, effect seal moved (reseal required)';
end;
$postflight$;

commit;
