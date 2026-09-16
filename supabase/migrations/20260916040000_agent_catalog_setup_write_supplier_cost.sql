-- Catalogue setup writes, kind 4 of 5: `set_supplier_cost`. Extends the spine
-- installed by 20260916010000, generalised by 20260916020000 and given a
-- per-kind writer dispatcher by 20260916030000. Nothing activates on merge
-- (plan decision W10): the effect seal stays unseeded, and installing this kind
-- deliberately CHANGES the effect revision — the spine's seal function already
-- NAMES private.catalog_supplier_cost_profile_save, so creating it here moves
-- the hash on purpose.
--
-- WHAT THIS KIND WRITES, AND WHY catalog_setup_save CANNOT.
-- `public.catalog_setup_save` has no supplier-cost section at all — the string
-- `catalog_supplier_cost_profiles` does not occur in it — and no other Postgres
-- function writes that table. So this kind, like the family half of
-- `set_pricing`, gets a narrow sealed writer:
--
--   private.catalog_supplier_cost_profile_save(company, actor, variant,
--                                              profile, idempotency_key)
--
-- private, security definer, search_path='', revoked from every app role
-- including service_role, reachable only from the commit through
-- private.agent_catalog_setup_write_apply, idempotent on (company, writer, key)
-- through the private ledger, returning the variant's exact stored rows so the
-- read-back compares exactly.
--
-- ONE DEFAULT PER VARIANT. `catalog_supplier_cost_profiles` carries a partial
-- unique index `(company_id, catalog_variant_id) where is_default and
-- deleted_at is null`, so at most one default is a database fact. That exactly
-- one is an OPS rule, and this writer keeps it: promoting demotes the current
-- default IN THE SAME STATEMENT SEQUENCE, old row first so the partial index
-- never trips, and a write that would leave a variant carrying profiles with no
-- default at all is refused with CATALOG_SETUP_DEFAULT_REQUIRED. Every one of
-- Canpro's 137 live profiles already satisfies that rule.
--
-- THE MIRROR (gap #17). OPS carries two cost models: the simple
-- `catalog_variants.unit_cost_override` / `catalog_items.default_unit_cost`
-- fields, and this richer profile table — and `get_catalog_item` reads only the
-- profiles. They drift the moment one is written without the other. Whenever
-- the profile that ends up as a variant's DEFAULT changes, or that default's
-- cost changes, this writer sets `unit_cost_override` to the same number in the
-- same transaction and the proposal reports it on both sides. It fixes the drift
-- for everything MCP writes; the historical rows are a separate migration.
--
-- SERVER PROVENANCE. `source` is the caller's own object, stored verbatim, and
-- OPS stamps its own block under the reserved top-level key `ops`
-- ({recorded_by, action_id, change_set_id, recorded_at}).
-- private.agent_catalog_setup_bounded_object refuses a caller key named `ops`,
-- so the caller can neither forge nor overwrite it, and the projection strips
-- `ops` before it reaches a preview — which is also what lets the read-back
-- compare the approved `after` for equality despite carrying a commit-time
-- timestamp on the row.
--
-- TEXT OPS WILL NOT RENDER. 107 of Canpro's 137 live profiles carry a
-- double-encoded em dash in `source` and 59 carry one in `label` — the bytes
-- `\u00e2\u0080\u0094`, written by the direct-SQL workaround this vertical
-- replaces. `\u0080` is a C1 control character and
-- private.agent_prompt_text_is_safe refuses it, so the prepare's whole-proposal
-- safety gate would refuse EVERY cost change on those variants — the tool would
-- be unusable on the exact catalogue it was built for. Rendering the bytes
-- anyway is not an option either. So the projection withholds a row's own text
-- instead: an unreadable row keeps its key, its cost and its default flag, and
-- its label comes back null with its rule and source emptied. The preview and
-- the read-back run the same projection, so they still compare for equality,
-- and writing such a row through this tool replaces the unreadable text with
-- readable text. The caller's own label, rule and source are refused outright if
-- they carry control characters, so this tool can only ever reduce the problem.
--
-- ADDING THE LAST KIND (create_option): the six steps in 20260916030000's
-- header, unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $prerequisites$
declare
  v_missing text[];
begin
  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('function', 'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'),
      ('function', 'public.has_permission(uuid,text,text)'),
      ('function', 'private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)'),
      ('function', 'private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_bounded_object(jsonb,integer)'),
      ('function', 'private.agent_catalog_setup_value_labels(uuid,uuid,uuid)'),
      ('function', 'private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)'),
      ('function', 'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'),
      ('function', 'private.agent_catalog_setup_write_payload(jsonb)'),
      ('function', 'private.agent_catalog_setup_write_hash(jsonb)'),
      ('function', 'private.agent_catalog_setup_money(numeric)'),
      ('function', 'private.agent_catalog_setup_exact(numeric)'),
      ('function', 'private.agent_catalog_setup_write_kind_notice(text)'),
      ('function', 'private.agent_catalog_setup_write_reauthorize(private.agent_catalog_setup_writes)'),
      ('function', 'private.agent_rfc3339_utc(timestamp with time zone)'),
      ('function', 'private.agent_prompt_text_is_safe(text,boolean)'),
      ('table', 'private.agent_catalog_setup_writes'),
      ('table', 'private.agent_catalog_setup_writer_requests'),
      ('table', 'public.catalog_supplier_cost_profiles'),
      ('table', 'public.catalog_variants')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_catalog_setup_supplier_cost_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)') is not null then
    raise exception 'agent_catalog_setup_supplier_cost_already_installed' using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'private'
      and table_row.relname = 'agent_catalog_setup_writes'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%''set_supplier_cost''%'
  ) then
    raise exception 'agent_catalog_setup_supplier_cost_kind_not_accepted' using errcode = '55000';
  end if;
  -- The spine reserved this kind's extra scope; assert it rather than widen it.
  if private.agent_catalog_setup_write_kind_scopes('prepare_set_supplier_cost')
       is distinct from array['ops.catalog_costs.read'] then
    raise exception 'agent_catalog_setup_supplier_cost_scope_not_reserved' using errcode = '55000';
  end if;
  -- The one-default-per-variant rule this writer keeps is backed by a partial
  -- unique index. Without it the demote-then-upsert ordering is decoration.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'catalog_supplier_cost_profiles_one_default'
  ) then
    raise exception 'agent_catalog_setup_supplier_cost_index_missing' using errcode = '55000';
  end if;
  -- Verified before relying on it: catalog_setup_save has no supplier-cost
  -- section, which is why this kind brings its own writer.
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'catalog_supplier_cost_profiles') > 0 then
    raise exception 'agent_catalog_setup_supplier_cost_save_shape_unknown' using errcode = '55000';
  end if;
end;
$prerequisites$;

-- ── Family pre-image widened to what this kind can move ────────────────────
-- Identical to the thresholds migration's version apart from `supplier_costs`,
-- which now carries `activation_rule`, `source`, `deleted_at` and soft-deleted
-- rows. Without that, soft-deleting a profile between prepare and commit would
-- leave the pre-image hash unchanged and a preview that said `created` could
-- commit as `revived`. `price_override_exact` is carried exactly as before —
-- the thresholds postflight refuses to install without it and the byte-identity
-- of untouched siblings depends on it.
create or replace function private.agent_catalog_setup_family_state(
  p_company uuid, p_family uuid, p_lock boolean default true
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_family public.catalog_items%rowtype; v_state jsonb; v_currency text;
begin
  if p_lock then
    select * into v_family from public.catalog_items
    where id = p_family and company_id = p_company and deleted_at is null for update;
  else
    select * into v_family from public.catalog_items
    where id = p_family and company_id = p_company and deleted_at is null;
  end if;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  select nullif(pg_catalog.btrim(coalesce(company.currency_code, '')), '') into v_currency
  from public.companies company where company.id = p_company and company.deleted_at is null;
  if v_currency is null then
    raise exception 'CATALOG_SETUP_CURRENCY_UNAVAILABLE' using errcode = '55000';
  end if;

  v_state := jsonb_build_object(
    'currency_code', v_currency,
    'family', jsonb_build_object(
      'id', v_family.id,
      'name', v_family.name,
      'description', v_family.description,
      'notes', v_family.notes,
      'image_url', v_family.image_url,
      'category_id', v_family.category_id,
      'default_price', private.agent_catalog_setup_money(v_family.default_price),
      'default_unit_cost', private.agent_catalog_setup_money(v_family.default_unit_cost),
      'default_warning_threshold', private.agent_catalog_setup_exact(v_family.default_warning_threshold::numeric),
      'default_critical_threshold', private.agent_catalog_setup_exact(v_family.default_critical_threshold::numeric),
      'default_unit_id', v_family.default_unit_id,
      'is_active', v_family.is_active
    ),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', option_row.id,
        'name', option_row.name,
        'sort_order', option_row.sort_order,
        'values', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', value_row.id, 'value', value_row.value, 'sort_order', value_row.sort_order
          ) order by value_row.sort_order, value_row.value, value_row.id)
          from public.catalog_option_values value_row
          where value_row.option_id = option_row.id and value_row.deleted_at is null
        ), '[]'::jsonb)
      ) order by option_row.sort_order, option_row.name, option_row.id)
      from public.catalog_options option_row
      where option_row.catalog_item_id = p_family and option_row.deleted_at is null
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant_row.id,
        'sku', variant_row.sku,
        'quantity', private.agent_catalog_setup_exact(variant_row.quantity::numeric),
        'price_override', private.agent_catalog_setup_money(variant_row.price_override),
        -- The stored numeric text, digits and display scale exactly as they sit
        -- on disk. `price_override` above is the 4-decimal money projection the
        -- preview reads; this is what the payload re-sends, so a variant the
        -- operator did not change comes back byte-identical.
        'price_override_exact', variant_row.price_override::text,
        'unit_cost_override', private.agent_catalog_setup_money(variant_row.unit_cost_override),
        'warning_threshold', private.agent_catalog_setup_exact(variant_row.warning_threshold::numeric),
        'critical_threshold', private.agent_catalog_setup_exact(variant_row.critical_threshold::numeric),
        'unit_id', variant_row.unit_id,
        'is_active', variant_row.is_active,
        'option_value_ids', coalesce((
          select jsonb_agg(to_jsonb(junction.option_value_id::text) order by junction.option_value_id)
          from public.catalog_variant_option_values junction
          where junction.variant_id = variant_row.id and junction.deleted_at is null
        ), '[]'::jsonb)
      ) order by variant_row.id)
      from public.catalog_variants variant_row
      where variant_row.catalog_item_id = p_family
        and variant_row.company_id = p_company
        and variant_row.deleted_at is null
    ), '[]'::jsonb),
    'stock_units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', unit_row.id,
        'variant_id', unit_row.catalog_variant_id,
        'unit_kind', unit_row.unit_kind,
        'status', unit_row.status,
        'quantity_value', private.agent_catalog_setup_exact(unit_row.quantity_value),
        'remaining_length_value', private.agent_catalog_setup_exact(unit_row.remaining_length_value)
      ) order by unit_row.id)
      from public.catalog_stock_units unit_row
      join public.catalog_variants owner_variant
        on owner_variant.id = unit_row.catalog_variant_id
       and owner_variant.catalog_item_id = p_family
      where unit_row.company_id = p_company and unit_row.deleted_at is null
    ), '[]'::jsonb),
    'stock_events', coalesce((
      select jsonb_agg(summary order by summary->>'variant_id')
      from (
        select jsonb_build_object(
          'variant_id', event_row.catalog_variant_id,
          'events', count(*),
          'quantity_delta', private.agent_catalog_setup_exact(sum(coalesce(event_row.quantity_delta, 0)))
        ) summary
        from public.catalog_stock_unit_events event_row
        join public.catalog_variants owner_variant
          on owner_variant.id = event_row.catalog_variant_id
         and owner_variant.catalog_item_id = p_family
        where event_row.company_id = p_company
        group by event_row.catalog_variant_id
      ) grouped
    ), '[]'::jsonb),
    -- Soft-deleted profiles are IN the pre-image. A removed profile coming back
    -- is a different write from a new one, and the operator approved one of
    -- them by name.
    'supplier_costs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile_row.id,
        'variant_id', profile_row.catalog_variant_id,
        'profile_key', profile_row.profile_key,
        'label', profile_row.label,
        'unit_cost', private.agent_catalog_setup_money(profile_row.unit_cost),
        'currency_code', profile_row.currency_code,
        'is_default', profile_row.is_default,
        'activation_rule', profile_row.activation_rule,
        'source', profile_row.source,
        'deleted', profile_row.deleted_at is not null
      ) order by profile_row.id)
      from public.catalog_supplier_cost_profiles profile_row
      join public.catalog_variants owner_variant
        on owner_variant.id = profile_row.catalog_variant_id
       and owner_variant.catalog_item_id = p_family
      where profile_row.company_id = p_company
    ), '[]'::jsonb)
  );
  return v_state;
end $$;

-- ── Supplier cost projection ───────────────────────────────────────────────
-- Every live profile on one variant, plus the variant's own cost field. Both
-- sides of the preview and the commit's read-back come from this one function.
--
-- Canonical order is `is_default desc, profile_key`, deliberately NOT the read's
-- `updated_at desc`: a timestamp cannot be predicted at prepare time, and the
-- read-back compares the approved `after` for equality. The default first is
-- also what an operator wants to read first.
--
-- `source` is returned WITHOUT the server's reserved `ops` block. That block is
-- provenance, not the caller's data, and it carries a commit-time timestamp.
create function private.agent_catalog_setup_supplier_cost_projection(
  p_company uuid, p_family uuid, p_variant uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_variant public.catalog_variants%rowtype; v_currency text; v_profiles jsonb;
begin
  select * into v_variant from public.catalog_variants
  where id = p_variant and company_id = p_company
    and catalog_item_id = p_family and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_VARIANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select nullif(pg_catalog.btrim(coalesce(company.currency_code, '')), '') into v_currency
  from public.companies company where company.id = p_company and company.deleted_at is null;
  if v_currency is null then
    raise exception 'CATALOG_SETUP_CURRENCY_UNAVAILABLE' using errcode = '55000';
  end if;

  -- A row whose own stored text OPS will not render keeps its key, its cost and
  -- its default flag, and gives up its label, rule and source together. See this
  -- migration's header: refusing the whole sheet instead would make the tool
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
    'variant_unit_cost', private.agent_catalog_setup_money(v_variant.unit_cost_override));
end $$;

-- ── The narrow writer for supplier cost profiles ───────────────────────────
create function private.catalog_supplier_cost_profile_save(
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
  -- variant's own cost field, so the two models cannot drift for this row.
  select profile_row.unit_cost into v_default_cost
  from public.catalog_supplier_cost_profiles profile_row
  where profile_row.company_id = p_company_id
    and profile_row.catalog_variant_id = p_variant_id
    and profile_row.is_default and profile_row.deleted_at is null;
  if v_default_cost is null then
    raise exception 'CATALOG_SETUP_DEFAULT_REQUIRED' using errcode = '22023';
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
       set unit_cost_override = pg_catalog.trim_scale(v_default_cost),
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

-- ── Kind 4: set_supplier_cost ──────────────────────────────────────────────
create function private.agent_catalog_setup_compile_set_supplier_cost(
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

-- ── Dispatch ───────────────────────────────────────────────────────────────
create or replace function private.agent_catalog_setup_write_compile(
  p_company uuid, p_actor uuid, p_kind text, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_kind = 'create_variant' then
    return private.agent_catalog_setup_compile_create_variant(p_company, p_actor, p_request);
  end if;
  if p_kind = 'set_thresholds' then
    return private.agent_catalog_setup_compile_set_thresholds(p_company, p_actor, p_request);
  end if;
  if p_kind = 'set_pricing' then
    return private.agent_catalog_setup_compile_set_pricing(p_company, p_actor, p_request);
  end if;
  if p_kind = 'set_supplier_cost' then
    return private.agent_catalog_setup_compile_set_supplier_cost(p_company, p_actor, p_request);
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

create or replace function private.agent_catalog_setup_write_readback(
  p_write private.agent_catalog_setup_writes, p_save jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_variant uuid; v_item uuid; v_kind text; v_variants uuid[];
        v_readback jsonb; v_expected jsonb;
begin
  if p_write.kind = 'create_variant' then
    v_variant := nullif(p_save#>>'{id_map,agent_new_variant}', '')::uuid;
    if v_variant is null then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    v_readback := private.agent_catalog_setup_variant_projection(
      p_write.company_id, p_write.family_id, v_variant);
    v_expected := p_write.proposal#>'{after,variant}';
    if v_readback is distinct from v_expected then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'readback', v_readback,
      'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', v_variant));
  elsif p_write.kind = 'set_thresholds' then
    v_variant := (p_write.request#>>'{variant_ref,id}')::uuid;
    v_readback := private.agent_catalog_setup_threshold_projection(
      p_write.company_id, p_write.family_id, v_variant);
    v_expected := p_write.proposal->'after';
    if v_readback is distinct from v_expected then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'readback', v_readback,
      'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', v_variant));
  elsif p_write.kind = 'set_pricing' then
    -- WHICH variants the change reaches is decided at prepare time and approved
    -- with the preview; what each of them now sells for is read live. Deriving
    -- the set again after the write would ask a different question, because the
    -- write itself changes who carries an override.
    v_kind := p_write.request#>>'{item_ref,kind}';
    v_item := (p_write.request#>>'{item_ref,id}')::uuid;
    select coalesce(pg_catalog.array_agg((row_doc.value#>>'{variant_ref,id}')::uuid
             order by row_doc.ordinality), array[]::uuid[])
      into v_variants
    from jsonb_array_elements(p_write.proposal#>'{after,affected_variants}')
      with ordinality row_doc(value, ordinality);
    v_readback := private.agent_catalog_setup_pricing_projection(
      p_write.company_id, p_write.family_id, v_kind, v_item, v_variants);
    v_expected := p_write.proposal->'after';
    if v_readback is distinct from v_expected then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'readback', v_readback,
      'item_ref', jsonb_build_object('kind', v_kind, 'id', v_item));
  elsif p_write.kind = 'set_supplier_cost' then
    -- The approved `after` carries a per-row `state`: what this approval does
    -- to each row. A read of live rows cannot carry that, so it is stripped
    -- from the expectation rather than invented in the read-back.
    v_variant := (p_write.request#>>'{variant_ref,id}')::uuid;
    v_readback := private.agent_catalog_setup_supplier_cost_projection(
      p_write.company_id, p_write.family_id, v_variant);
    select jsonb_build_object(
             'variant', p_write.proposal#>'{after,variant}',
             'profiles', coalesce(jsonb_agg(row_doc.value - 'state' order by row_doc.ordinality), '[]'::jsonb),
             'variant_unit_cost', p_write.proposal#>'{after,variant_unit_cost}')
      into v_expected
    from jsonb_array_elements(p_write.proposal#>'{after,profiles}')
      with ordinality row_doc(value, ordinality);
    if v_readback is distinct from v_expected then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'readback', v_readback,
      'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', v_variant));
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

create or replace function private.agent_catalog_setup_write_kind_notice(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'create_variant' then 'Review the new variant, its price and its opening stock.'
    when 'set_thresholds' then 'Review the stock levels this variant will warn at.'
    when 'set_pricing' then 'Review a price change on this catalog item.'
    -- No figure here on purpose: cost is separately authorised data and a
    -- notification body is not gated on the permission that shows it.
    when 'set_supplier_cost' then 'Review a supplier cost change on this catalog item.'
    else 'Review the catalog change before it is saved.'
  end
$$;

create or replace function private.agent_catalog_setup_write_apply(
  p_write private.agent_catalog_setup_writes
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_key constant text := 'agent-catalog-setup-write:' || p_write.id::text;
        v_provenance jsonb;
begin
  if p_write.kind in ('create_variant', 'set_thresholds')
     or (p_write.kind = 'set_pricing'
         and (p_write.request#>>'{item_ref,kind}') = 'catalog_variant') then
    return public.catalog_setup_save(p_write.company_id, v_key, p_write.payload);
  end if;
  -- Server-stamped provenance. Nothing in this block comes from the caller, and
  -- the reserved `ops` key is refused on the way in so it cannot be forged.
  v_provenance := jsonb_build_object(
    'recorded_by', 'mcp',
    'action_id', p_write.action_id,
    'change_set_id', p_write.id,
    'recorded_at', private.agent_rfc3339_utc(clock_timestamp()));
  if p_write.kind = 'set_pricing' then
    if (p_write.payload->>'writer') is distinct from 'catalog_family_default_price_save'
       or (p_write.payload->>'family_id')::uuid is distinct from p_write.family_id then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
    return private.catalog_family_default_price_save(
      p_write.company_id, p_write.actor_user_id, p_write.family_id,
      (p_write.payload->>'default_price')::numeric, v_key, v_provenance);
  end if;
  if p_write.kind = 'set_supplier_cost' then
    if (p_write.payload->>'writer') is distinct from 'catalog_supplier_cost_profile_save'
       or (p_write.payload->>'variant_id')::uuid
            is distinct from (p_write.request#>>'{variant_ref,id}')::uuid then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
    return private.catalog_supplier_cost_profile_save(
      p_write.company_id, p_write.actor_user_id,
      (p_write.payload->>'variant_id')::uuid,
      jsonb_set(p_write.payload->'profile', '{source}',
        (p_write.payload#>'{profile,source}') || jsonb_build_object('ops', v_provenance)),
      v_key);
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

-- ── Grants ─────────────────────────────────────────────────────────────────
do $acl$
declare f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in (
      'catalog_supplier_cost_profile_save',
      'agent_catalog_setup_supplier_cost_projection',
      'agent_catalog_setup_compile_set_supplier_cost',
      'agent_catalog_setup_family_state',
      'agent_catalog_setup_write_compile',
      'agent_catalog_setup_write_readback',
      'agent_catalog_setup_write_apply',
      'agent_catalog_setup_write_kind_notice')
  loop
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',
      f.nspname, f.proname, f.args);
  end loop;
end $acl$;

do $postflight$
declare v_role text; v_writer constant text :=
  'private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)';
begin
  if pg_catalog.to_regprocedure('private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure(v_writer) is null
     or pg_catalog.to_regprocedure('private.agent_catalog_setup_supplier_cost_projection(uuid,uuid,uuid)') is null then
    raise exception 'agent_catalog_setup_supplier_cost_postflight_missing' using errcode = '55000';
  end if;

  -- The narrow writer is reachable from the commit and from nowhere else.
  foreach v_role in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(v_role, v_writer::regprocedure, 'execute') then
      raise exception 'agent_catalog_setup_supplier_cost_writer_reachable: %', v_role
        using errcode = '42501';
    end if;
  end loop;

  -- The seal already named this writer before it existed; creating it must have
  -- put a real definition into the hash.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_write_effect_revision()'::regprocedure),
       'catalog_supplier_cost_profile_save') = 0 then
    raise exception 'agent_catalog_setup_supplier_cost_seal_incomplete' using errcode = '55000';
  end if;
  -- The pre-image must cover what this kind can move, soft-deleted rows
  -- included, or a preview that says `created` could commit as `revived`.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'::regprocedure),
       'activation_rule') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'::regprocedure),
       'price_override_exact') = 0 then
    raise exception 'agent_catalog_setup_supplier_cost_pre_image_incomplete' using errcode = '55000';
  end if;
  -- A row OPS cannot render must lose its text, not the whole preview.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_supplier_cost_projection(uuid,uuid,uuid)'::regprocedure),
       'agent_prompt_text_is_safe') = 0 then
    raise exception 'agent_catalog_setup_supplier_cost_unreadable_text_unhandled'
      using errcode = '55000';
  end if;
  -- The operator notice for this kind must not carry a cost figure.
  if private.agent_catalog_setup_write_kind_notice('set_supplier_cost') !~ '^[^0-9]*$' then
    raise exception 'agent_catalog_setup_supplier_cost_notice_leaks_cost' using errcode = '55000';
  end if;
  if private.agent_catalog_setup_write_kind_operation('set_supplier_cost')
       is distinct from 'set_supplier_cost' then
    raise exception 'agent_catalog_setup_supplier_cost_operation_missing' using errcode = '55000';
  end if;

  -- W10: this migration seeds no seal either.
  if exists (select 1 from private.agent_catalog_effect_policy
             where revision = '2026-09-15.catalog-setup-write.v1') then
    raise exception 'agent_catalog_setup_supplier_cost_must_not_activate' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
