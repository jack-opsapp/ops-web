-- Catalogue money is written at the currency's own minor unit, and no finer.
--
-- WHAT IS WRONG. prepare_set_catalog_pricing and prepare_set_supplier_cost both
-- accept a decimal string of up to four fraction digits, because that is the
-- scale of the numeric(14,4) columns they write. The catalogue READ does not
-- accept that: private.agent_money_to_minor_units projects money in minor units
-- and raises agent_money_minor_units_not_exact on any stored number that is not
-- exact there. CAD and USD carry two decimals, so a cost of 16.925 CAD is a row
-- the write surface would accept and the read surface would then refuse -- and
-- refuse for the whole family, not just that row. That is not hypothetical:
-- four of Canpro's Glass Panel supplier cost profiles carry exactly that shape
-- and they take get_catalog_item down for the family they belong to
-- (docs/artifacts/mcp-catalog-setup-writes/text-repair-proof.md, sections 2
-- and 5).
--
-- WHAT THIS CHANGES. The two compile functions gain one check, placed with the
-- other input validation and raising CATALOG_SETUP_MONEY_PRECISION_INVALID
-- (SQLSTATE 22023) before any authority check, any lock and any read of the
-- family. The decision is delegated to the same exponent table the read uses,
-- private.agent_currency_minor_exponent_or_null, so the write and the read
-- cannot disagree about what a currency's minor unit is; a currency that table
-- does not name is refused rather than guessed at. Trailing zeros are not
-- precision -- 7.5000 is 7.50 and passes -- because the check is on the value's
-- exactness in minor units, which is the read's own test.
--
-- The contract layer carries the same bound in zod
-- (CatalogMinorUnitMoneySchema in
-- src/lib/agent-control-plane/contracts/catalog-setup-write.ts). This file is
-- the backstop for a client that bypasses it.
--
-- WHAT THIS DOES NOT CHANGE. Nothing about what OPS shows. Both projections and
-- both readbacks still render stored money as four-decimal text, exactly as
-- before, so the pre-image of a row written by hand at four decimals still
-- reads back truthfully. No column type, no stored row, no proposal, no grant,
-- no consent row and no exposure revision is touched here, and the price and
-- cost writers themselves are untouched.
--
-- THIS MOVES THE EFFECT SEAL, AND THAT IS INTENDED.
-- private.agent_catalog_setup_write_effect_revision() hashes pg_get_functiondef
-- of every function reachable from the catalogue write spine, and both compile
-- functions are reachable. Replacing them therefore changes the revision this
-- vertical's effect policy would be sealed against. Nothing is sealed yet - the
-- tools are dark until an operator installs a seal row (decision W10) - so this
-- moves a value nothing is currently compared against. Whoever installs the
-- seal must do it after this migration, not before.
--
-- The bodies below are the definitions from
-- 20260916030000_agent_catalog_setup_write_pricing.sql and
-- 20260916040000_agent_catalog_setup_write_supplier_cost.sql, byte for byte,
-- plus the one check and its declaration. Those files are left alone.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
declare v_missing text[];
begin
  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'),
      ('private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)'),
      -- The read's own exponent table. If this is missing the check cannot be
      -- the read's check, and a check that is merely similar is worse than none.
      ('private.agent_currency_minor_exponent_or_null(text)'),
      ('private.agent_money_to_minor_units(numeric,text)')
  ) required(name)
  where pg_catalog.to_regprocedure(required.name) is null;
  if v_missing is not null then
    raise exception 'agent_catalog_setup_money_precision_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  -- The exponent table must actually answer the way this migration assumes, or
  -- the guard it installs would refuse the currencies OPS bills in.
  if private.agent_currency_minor_exponent_or_null('CAD') is distinct from 2::smallint
     or private.agent_currency_minor_exponent_or_null('USD') is distinct from 2::smallint then
    raise exception 'agent_catalog_setup_money_precision_exponent_unexpected'
      using errcode = '55000';
  end if;
end;
$prerequisites$;

-- Selling price --------------------------------------------------
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
  v_minor smallint;
  v_affected uuid[];
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

  -- No change is measured on the field that would be written, not on the number
  -- an operator happens to see: pinning a variant to the price it already
  -- inherits writes a real row and stops a later family edit from moving it.
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
  else
    if pg_catalog.trim_scale(v_new_price) is not distinct from
       pg_catalog.trim_scale(v_variant_row.price_override) then
      raise exception 'CATALOG_SETUP_NO_CHANGE' using errcode = '22023';
    end if;
    v_affected := array[v_item];
  end if;
  v_affected := coalesce(v_affected, array[]::uuid[]);
  -- Bounded, never truncated. A shortened list of prices is a preview nobody can
  -- approve honestly, so a family this wide is refused rather than summarised.
  if pg_catalog.cardinality(v_affected) > 128 then
    raise exception 'CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY' using errcode = '54000';
  end if;

  v_before := private.agent_catalog_setup_pricing_projection(
    p_company, v_family, v_item_kind, v_item, v_affected);

  -- The after side is the same projection with the one field moved. It is built
  -- here rather than read back from a speculative write, and the commit proves
  -- it by reading the same function again once the write has landed.
  v_after := jsonb_build_object(
    'target', v_before->'target',
    'price', jsonb_build_object(
      'amount', private.agent_catalog_setup_money(v_new_price),
      'currency', v_currency,
      'origin', case
        when v_new_price is not null and v_item_kind = 'catalog_variant' then 'variant'
        when v_new_price is not null then 'family'
        when v_item_kind = 'catalog_variant' and v_family_row.default_price is not null then 'family'
        else 'none' end),
    'affected_variants', coalesce((
      select jsonb_agg(
        case
          when v_item_kind = 'catalog_variant' then
            row_doc.value
              || jsonb_build_object(
                   'sale_price', private.agent_catalog_setup_money(
                     coalesce(v_new_price, v_family_row.default_price)),
                   'sale_price_origin', case
                     when v_new_price is not null then 'variant'
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
    -- document and one field moved. Every sibling is re-sent byte for byte.
    v_payload := private.agent_catalog_setup_write_payload(v_state);
    select jsonb_agg(
             case when variant_doc.value->>'id' = v_item::text
               then variant_doc.value
                    || jsonb_build_object('price_override',
                         case when v_new_price is null then 'null'::jsonb
                              else to_jsonb(private.agent_catalog_setup_exact(v_new_price)) end)
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

-- Supplier cost --------------------------------------------------
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

  -- The mirror, predicted exactly as the writer performs it.
  select row_doc.value->>'profile_key',
         (row_doc.value->>'unit_cost')::numeric
    into v_new_default_key, v_new_default_cost
  from jsonb_array_elements(v_after_profiles) row_doc(value)
  where coalesce((row_doc.value->>'is_default')::boolean, false);
  if v_new_default_key is null then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
  end if;
  v_mirror := v_current_default.id is null
    or v_current_default.profile_key is distinct from v_new_default_key
    or v_current_default.unit_cost is distinct from v_new_default_cost;
  v_after_cost := case when v_mirror then v_new_default_cost
                       else v_variant_row.unit_cost_override end;

  v_after := jsonb_build_object(
    'variant', v_before->'variant',
    'profiles', v_after_profiles,
    'variant_unit_cost', private.agent_catalog_setup_money(v_after_cost));

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

-- ACLs, restated. CREATE OR REPLACE keeps the privileges a function already
-- has, so this is an assertion of the state the two migrations above
-- established rather than a change: no app role executes a compile function.
do $acl$
declare f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('agent_catalog_setup_compile_set_pricing',
                        'agent_catalog_setup_compile_set_supplier_cost')
  loop
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',
      f.nspname, f.proname, f.args);
  end loop;
end $acl$;

do $postflight$
declare
  f record;
  v_role text;
  v_seen integer := 0;
begin
  for f in
    select p.oid, p.proname, p.prosecdef, p.proconfig,
           pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('agent_catalog_setup_compile_set_pricing',
                        'agent_catalog_setup_compile_set_supplier_cost')
  loop
    v_seen := v_seen + 1;
    -- The security posture the originals shipped with, unchanged.
    if not f.prosecdef
       or f.proconfig is null
       or not ('search_path=""' = any(f.proconfig)) then
      raise exception 'agent_catalog_setup_money_precision_posture_lost: %', f.proname
        using errcode = '55000';
    end if;
    -- The check is in the body that landed, not merely in this file.
    if pg_get_functiondef(f.oid) not like '%CATALOG_SETUP_MONEY_PRECISION_INVALID%'
       or pg_get_functiondef(f.oid) not like '%agent_currency_minor_exponent_or_null%' then
      raise exception 'agent_catalog_setup_money_precision_guard_missing: %', f.proname
        using errcode = '55000';
    end if;
    foreach v_role in array array['public','anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(v_role, f.oid, 'execute') then
        raise exception 'agent_catalog_setup_money_precision_executable: % by %',
          f.proname, v_role using errcode = '42501';
      end if;
    end loop;
  end loop;
  if v_seen <> 2 then
    raise exception 'agent_catalog_setup_money_precision_incomplete: % of 2', v_seen
      using errcode = '55000';
  end if;
  raise notice 'catalogue money precision: both compile functions refuse amounts finer than the currency';
end;
$postflight$;

commit;
