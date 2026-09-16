-- Catalogue setup writes, the last of the five kinds: `create_option`. Extends
-- the spine installed by 20260916010000, generalised by 20260916020000, given a
-- per-kind writer dispatcher by 20260916030000 and a second narrow writer by
-- 20260916040000. Nothing activates on merge (plan decision W10): the effect
-- seal stays unseeded, and installing this kind deliberately CHANGES the effect
-- revision, because the compile and projection this file adds are reachable
-- from the functions the seal hashes.
--
-- WHAT THIS KIND WRITES, AND WHY IT BRINGS NO WRITER OF ITS OWN.
-- `public.catalog_setup_save` has a `catalog_options` section that upserts
-- options and their values, and a `variants[].option_value_client_ids` section
-- that writes the joins. Every table this kind touches — catalog_options,
-- catalog_option_values, catalog_variant_option_values — is therefore already
-- reachable through the wizard's own save path, so this kind goes through it
-- exactly as create_variant and set_thresholds do. No third narrow writer.
--
-- THE AUTHORITY IS THE SPINE'S, NOT THE MONEY KINDS'. set_pricing and
-- set_supplier_cost ask for `catalog.run_setup` because the fields they write —
-- catalog_items.default_price and the supplier cost profile table — are reached
-- by a SECURITY DEFINER writer that would otherwise step past the row policy
-- guarding them, and the supplier-cost policy names that key itself. The three
-- tables this kind writes carry `company_isolation` policies and nothing more,
-- and the write runs as the approving operator through a SECURITY INVOKER save,
-- so those policies apply unchanged. Asking for setup authority here would be
-- asking for a key that guards nothing this write touches. A postflight refuses
-- to install if that reasoning is ever quietly widened.
--
-- THE BACKFILL, AND WHY IT SENDS EVERY VARIANT'S WHOLE VALUE SET.
-- Adding a dimension to a family with variants leaves every one of them without
-- a value for it, and the recipe resolver treats an axis a variant does not
-- answer as unfiltered — so the grid resolves ambiguously for the rest of its
-- life (design note 3, gap #3). This kind therefore requires
-- `value_for_existing_variants` whenever the family has any variant and gives
-- every one of them that value in the same write.
--
-- The obvious payload — leave each variant's existing `option_value_ids` alone
-- and add the one new value under `option_value_client_ids` — is refused by
-- catalog_setup_save. It dedupes the draft's variant matrix on
-- `option_value_client_ids` alone, so every backfilled variant would carry the
-- identical one-element signature and the save returns
-- `matrix_signature_conflict`. Proven on a local copy of production against
-- Canpro's Vinyl family: fifteen variants, fifteen conflict blockers. So the
-- payload sends each variant's COMPLETE value set under
-- `option_value_client_ids` — its existing value ids plus the new value's
-- client id — and declares a client id for every existing option value so the
-- save recognises the ids it is handed. Those signatures are distinct because
-- the variants were distinct, which is also why a family carrying two active
-- variants with identical value sets is refused up front rather than staged
-- into a blocked commit.
--
-- WHY A CREATED ROW CARRIES NO ID IN THE PROPOSAL. In edit mode
-- catalog_setup_save refuses an option or value `id` that does not already
-- belong to the family, so a new option must be sent by `client_id` and the
-- save assigns its uuid. A preview that named an id would be inventing one. The
-- created rows therefore carry a null ref, exactly as create_variant's new
-- variant carries none, and the commit resolves them from the save's id map:
-- the read-back compares the live grid against the approved one with those ids
-- substituted in, so the option that landed is proved to be the option that was
-- approved rather than assumed to be.
--
-- ADDING A LATER KIND: the six steps in 20260916030000's header, unchanged.
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
      ('function', 'public.catalog_setup_save(uuid,text,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)'),
      ('function', 'private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_value_labels(uuid,uuid,uuid)'),
      ('function', 'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'),
      ('function', 'private.agent_catalog_setup_write_payload(jsonb)'),
      ('function', 'private.agent_catalog_setup_write_hash(jsonb)'),
      ('function', 'private.agent_catalog_setup_write_kind_notice(text)'),
      ('function', 'private.agent_catalog_setup_write_kind_operation(text)'),
      ('function', 'private.agent_catalog_setup_write_kind_scopes(text)'),
      ('function', 'private.agent_prompt_text_is_safe(text,boolean)'),
      ('table', 'private.agent_catalog_setup_writes'),
      ('table', 'public.catalog_options'),
      ('table', 'public.catalog_option_values'),
      ('table', 'public.catalog_variant_option_values'),
      ('table', 'public.catalog_variants')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_catalog_setup_option_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)') is not null then
    raise exception 'agent_catalog_setup_option_already_installed' using errcode = '55000';
  end if;
  if not exists (
    select 1 from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'private'
      and table_row.relname = 'agent_catalog_setup_writes'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%''create_option''%'
  ) then
    raise exception 'agent_catalog_setup_option_kind_not_accepted' using errcode = '55000';
  end if;
  -- The spine reserved this kind with no extra scope. Assert that rather than
  -- widen it: a grant that never named a scope must not start requiring one.
  if private.agent_catalog_setup_write_kind_scopes('prepare_create_catalog_option')
       is distinct from array[]::text[] then
    raise exception 'agent_catalog_setup_option_scope_not_reserved' using errcode = '55000';
  end if;
  -- Verified before relying on it: the wizard's save path writes all three of
  -- this kind's tables, which is why it needs no writer of its own.
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'insert into public.catalog_options') = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'insert into public.catalog_option_values') = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'insert into public.catalog_variant_option_values') = 0
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'matrix_signature_conflict') = 0 then
    raise exception 'agent_catalog_setup_option_save_shape_unknown' using errcode = '55000';
  end if;
end;
$prerequisites$;

-- ── Option grid projection ─────────────────────────────────────────────────
-- The family read as a grid: every live dimension with its values, and every
-- live variant with the values that name it. Both the preview's `before` side
-- and the commit's read-back are this one function, so they cannot disagree.
--
-- It carries no timestamps and no per-row state. A state is a prediction about
-- a write and this is a read; the compile adds the states to build the `after`
-- side and the commit strips them again before comparing.
--
-- `backfill` is the write's own statement about itself, so the option name and
-- value are arguments. `variant_count` is not: it is counted from the live
-- rows, which is zero before the write and every backfilled variant after it.
create function private.agent_catalog_setup_option_projection(
  p_company uuid, p_family uuid, p_backfill_option text, p_backfill_value text
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_family public.catalog_items%rowtype;
begin
  select * into v_family from public.catalog_items
  where id = p_family and company_id = p_company and deleted_at is null;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'family', jsonb_build_object(
      'family_ref', jsonb_build_object('kind', 'catalog_family', 'id', p_family),
      'name', v_family.name),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'option_ref', jsonb_build_object('kind', 'catalog_option', 'id', option_row.id),
        'name', option_row.name,
        'sort_order', option_row.sort_order,
        'values', coalesce((
          select jsonb_agg(jsonb_build_object(
            'value_ref', jsonb_build_object('kind', 'catalog_option_value', 'id', value_row.id),
            'value', value_row.value,
            'sort_order', value_row.sort_order)
            order by value_row.sort_order, value_row.value, value_row.id)
          from public.catalog_option_values value_row
          where value_row.option_id = option_row.id and value_row.deleted_at is null
        ), '[]'::jsonb))
        order by option_row.sort_order, option_row.name, option_row.id)
      from public.catalog_options option_row
      where option_row.catalog_item_id = p_family and option_row.deleted_at is null
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', variant_row.id),
        'value_labels', private.agent_catalog_setup_value_labels(p_company, p_family, variant_row.id))
        order by variant_row.id)
      from public.catalog_variants variant_row
      where variant_row.company_id = p_company
        and variant_row.catalog_item_id = p_family
        and variant_row.deleted_at is null
    ), '[]'::jsonb),
    'backfill', jsonb_build_object(
      'option_name', p_backfill_option,
      'value', p_backfill_value,
      'variant_count', (
        select count(*)
        from public.catalog_variants variant_row
        where variant_row.company_id = p_company
          and variant_row.catalog_item_id = p_family
          and variant_row.deleted_at is null
          and p_backfill_value is not null
          and exists (
            select 1
            from public.catalog_variant_option_values junction
            join public.catalog_option_values value_row on value_row.id = junction.option_value_id
            join public.catalog_options option_row on option_row.id = value_row.option_id
            where junction.variant_id = variant_row.id and junction.deleted_at is null
              and value_row.deleted_at is null and option_row.deleted_at is null
              and option_row.catalog_item_id = p_family
              and option_row.name = p_backfill_option
              and value_row.value = p_backfill_value))));
end $$;

-- ── Kind 5: create_option ──────────────────────────────────────────────────
-- Returns the shared compile envelope:
--   {family_id, family_name, pre_image_hash, payload, evidence,
--    proposal_before, proposal_after, effects, blockers}
create function private.agent_catalog_setup_compile_create_option(
  p_company uuid, p_actor uuid, p_request jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_family uuid;
  v_state jsonb;
  v_entry jsonb;
  v_text text;
  v_evidence jsonb := '[]'::jsonb;
  v_name text;
  v_sort_order integer;
  v_backfill text;
  v_values jsonb := '[]'::jsonb;
  v_value_count integer;
  v_variant_count integer;
  v_payload jsonb;
  v_options jsonb;
  v_variants jsonb;
  v_before jsonb;
  v_after jsonb;
  v_after_options jsonb;
  v_after_variants jsonb;
  v_effects jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or octet_length(p_request::text) > 32768
     or exists (
       select 1 from jsonb_object_keys(p_request) key
       where key not in ('family_ref','name','values','sort_order',
                         'value_for_existing_variants','evidence','idempotency_key')
     )
     or not p_request ?& array['family_ref','name','values','evidence','idempotency_key']
     or jsonb_typeof(p_request->'values') is distinct from 'array'
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

  v_name := nullif(pg_catalog.btrim(coalesce(p_request->>'name', '')), '');
  if jsonb_typeof(p_request->'name') is distinct from 'string'
     or v_name is null or pg_catalog.length(v_name) > 80
     or v_name is distinct from (p_request->>'name')
     or not private.agent_prompt_text_is_safe(v_name, true) then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_request ? 'sort_order' then
    if jsonb_typeof(p_request->'sort_order') is distinct from 'number'
       or (p_request->>'sort_order') !~ '^(0|[1-9][0-9]{0,3})$' then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_sort_order := (p_request->>'sort_order')::integer;
  end if;

  if jsonb_array_length(p_request->'values') not between 1 and 32 then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_request->'values') loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_entry) key where key not in ('value','sort_order'))
       or not v_entry ? 'value'
       or jsonb_typeof(v_entry->'value') is distinct from 'string' then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    v_text := nullif(pg_catalog.btrim(coalesce(v_entry->>'value', '')), '');
    if v_text is null or pg_catalog.length(v_text) > 80
       or v_text is distinct from (v_entry->>'value')
       or not private.agent_prompt_text_is_safe(v_text, true) then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    if v_entry ? 'sort_order' then
      if jsonb_typeof(v_entry->'sort_order') is distinct from 'number'
         or (v_entry->>'sort_order') !~ '^(0|[1-9][0-9]{0,3})$' then
        raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
      end if;
    end if;
    v_values := v_values || jsonb_build_array(jsonb_build_object(
      'value', v_text,
      'sort_order', coalesce((v_entry->>'sort_order')::integer,
                             (jsonb_array_length(v_values) + 1) * 10)));
  end loop;
  v_value_count := jsonb_array_length(v_values);
  -- Canonical order once, here: the payload's client ids are numbered by
  -- position in this list and the proposal lists the created values in the same
  -- order, so the commit can map `agent_new_option_value_3` to the third value
  -- the operator approved. Sorting later, or in one place only, would silently
  -- pair a value with another value's id.
  select jsonb_agg(entry.value
           order by (entry.value->>'sort_order')::integer, entry.value->>'value')
    into v_values
  from jsonb_array_elements(v_values) entry(value);
  -- The values name distinct things, however they are cased: a family carrying
  -- 42" twice cannot be resolved by a selector that compares lower and trimmed.
  if (select count(distinct lower(entry.value->>'value')) from jsonb_array_elements(v_values) entry(value))
       is distinct from v_value_count then
    raise exception 'CATALOG_SETUP_OPTION_VALUES_DUPLICATE' using errcode = '22023';
  end if;

  if p_request ? 'value_for_existing_variants' then
    v_backfill := nullif(pg_catalog.btrim(coalesce(p_request->>'value_for_existing_variants', '')), '');
    if jsonb_typeof(p_request->'value_for_existing_variants') is distinct from 'string'
       or v_backfill is null or pg_catalog.length(v_backfill) > 80
       or v_backfill is distinct from (p_request->>'value_for_existing_variants') then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
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

  -- Locks the family and pins the pre-image the commit will be checked against.
  v_state := private.agent_catalog_setup_family_state(p_company, v_family);

  -- One dimension of a given name per family. catalog_setup_save blocks a draft
  -- that names two, but an operator asked to approve a second Height should
  -- never see the preview at all.
  if exists (
    select 1 from public.catalog_options option_row
    where option_row.catalog_item_id = v_family
      and option_row.deleted_at is null
      and lower(pg_catalog.btrim(option_row.name)) = lower(v_name)
  ) then
    raise exception 'CATALOG_SETUP_OPTION_EXISTS' using errcode = '23505';
  end if;

  select count(*) into v_variant_count
  from public.catalog_variants variant_row
  where variant_row.company_id = p_company
    and variant_row.catalog_item_id = v_family
    and variant_row.deleted_at is null;

  -- Bounded, never truncated. Adding a dimension rewrites every variant's
  -- identity, and a shortened list is a preview nobody can approve honestly.
  if v_variant_count > 128 then
    raise exception 'CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY' using errcode = '54000';
  end if;

  -- Design note 3. A variant left without a value for a live axis is not
  -- filtered on by the recipe resolver, so the grid resolves ambiguously.
  if v_variant_count > 0 then
    if v_backfill is null then
      raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_values) entry(value)
      where entry.value->>'value' = v_backfill
    ) then
      raise exception 'CATALOG_SETUP_BACKFILL_VALUE_INVALID' using errcode = '22023';
    end if;
  elsif v_backfill is not null then
    -- Nothing to backfill, so naming a value for it is a request OPS cannot
    -- honour rather than a no-op it should quietly accept.
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;

  -- The payload sends every active variant's whole value set, and
  -- catalog_setup_save refuses a draft in which two of them are identical
  -- (matrix_signature_conflict). Families carrying such a pair exist — this
  -- refuses one up front rather than staging a preview that cannot commit.
  if exists (
    select 1
    from public.catalog_variants variant_row
    where variant_row.company_id = p_company
      and variant_row.catalog_item_id = v_family
      and variant_row.deleted_at is null
      and variant_row.is_active
    group by (
      select coalesce(pg_catalog.array_agg(distinct junction.option_value_id
               order by junction.option_value_id), array[]::uuid[])
      from public.catalog_variant_option_values junction
      where junction.variant_id = variant_row.id and junction.deleted_at is null)
    having count(*) > 1
  ) then
    raise exception 'CATALOG_SETUP_VARIANT_SET_AMBIGUOUS' using errcode = '22023';
  end if;

  -- The catalogue's own convention is 10 / 20 / 30, so a new axis takes the
  -- next step rather than 0 — landing first would reorder every label OPS shows.
  if v_sort_order is null then
    select coalesce(max(option_row.sort_order) + 10, 10) into v_sort_order
    from public.catalog_options option_row
    where option_row.catalog_item_id = v_family and option_row.deleted_at is null;
  end if;

  -- ── Payload ──────────────────────────────────────────────────────────────
  -- The family's complete current document with the new option appended, every
  -- existing option value given a client id equal to its own row id, and every
  -- variant's whole value set re-sent under option_value_client_ids. See this
  -- migration's header for why the whole set and not just the new value.
  v_payload := private.agent_catalog_setup_write_payload(v_state);
  select jsonb_agg(
           (option_doc.value - 'values')
           || jsonb_build_object('values', coalesce((
                select jsonb_agg(
                  value_doc.value
                  || jsonb_build_object('client_id', value_doc.value->>'id')
                  order by value_doc.ordinality)
                from jsonb_array_elements(option_doc.value->'values')
                  with ordinality value_doc(value, ordinality)), '[]'::jsonb))
           order by option_doc.ordinality)
    into v_options
  from jsonb_array_elements(v_payload->'catalog_options') with ordinality option_doc(value, ordinality);
  v_options := coalesce(v_options, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'client_id', 'agent_new_option',
    'name', v_name,
    'sort_order', v_sort_order,
    'values', (
      select jsonb_agg(jsonb_build_object(
        'client_id', 'agent_new_option_value_' || entry.ordinality::text,
        'value', entry.value->>'value',
        'sort_order', entry.value->'sort_order')
        order by entry.ordinality)
      from jsonb_array_elements(v_values) with ordinality entry(value, ordinality))));
  v_payload := jsonb_set(v_payload, '{catalog_options}', v_options);

  select jsonb_agg(
           (variant_doc.value - 'option_value_ids')
           || jsonb_build_object('option_value_client_ids',
                coalesce(variant_doc.value->'option_value_ids', '[]'::jsonb)
                || case when v_backfill is null then '[]'::jsonb
                        else jsonb_build_array(
                          'agent_new_option_value_' || (
                            select entry.ordinality::text
                            from jsonb_array_elements(v_values) with ordinality entry(value, ordinality)
                            where entry.value->>'value' = v_backfill)) end)
           order by variant_doc.ordinality)
    into v_variants
  from jsonb_array_elements(v_payload->'variants') with ordinality variant_doc(value, ordinality);
  v_payload := jsonb_set(v_payload, '{variants}', coalesce(v_variants, '[]'::jsonb));

  -- ── Proposal ─────────────────────────────────────────────────────────────
  v_before := private.agent_catalog_setup_option_projection(
    p_company, v_family, v_name, v_backfill);

  -- The after side is the same grid with one column arriving. It is built here
  -- rather than read from a speculative write, and the commit proves it by
  -- running the projection again once the write has landed.
  select jsonb_agg(entry.doc order by entry.sort_order, entry.name)
    into v_after_options
  from (
    select option_doc.value->>'name' as name,
           (option_doc.value->>'sort_order')::integer as sort_order,
           option_doc.value || jsonb_build_object('state', 'unchanged') as doc
    from jsonb_array_elements(v_before->'options') option_doc(value)
    union all
    select v_name, v_sort_order,
           jsonb_build_object(
             'option_ref', null,
             'name', v_name,
             'sort_order', v_sort_order,
             'values', (
               select jsonb_agg(jsonb_build_object(
                 'value_ref', null,
                 'value', entry.value->>'value',
                 'sort_order', entry.value->'sort_order')
                 order by entry.ordinality)
               from jsonb_array_elements(v_values) with ordinality entry(value, ordinality)),
             'state', 'created')
  ) entry;

  select jsonb_agg(jsonb_build_object(
           'variant_ref', jsonb_build_object('kind', 'catalog_variant', 'id', variant_row.id),
           'value_labels', coalesce(labelled.labels, '[]'::jsonb),
           'state', case when v_backfill is null then 'unchanged' else 'backfilled' end)
           order by variant_row.id)
    into v_after_variants
  from public.catalog_variants variant_row
  left join lateral (
    select jsonb_agg(axis.label order by axis.option_sort, axis.option_name, axis.option_id nulls last) labels
    from (
      select option_row.sort_order option_sort, option_row.name option_name,
             option_row.id option_id, value_row.value label
      from public.catalog_variant_option_values junction
      join public.catalog_option_values value_row on value_row.id = junction.option_value_id
      join public.catalog_options option_row on option_row.id = value_row.option_id
      where junction.variant_id = variant_row.id and junction.deleted_at is null
        and value_row.deleted_at is null and option_row.deleted_at is null
        and option_row.catalog_item_id = v_family
      union all
      select v_sort_order, v_name, null::uuid, v_backfill
      where v_backfill is not null
    ) axis
  ) labelled on true
  where variant_row.company_id = p_company
    and variant_row.catalog_item_id = v_family
    and variant_row.deleted_at is null;

  v_after := jsonb_build_object(
    'family', v_before->'family',
    'options', coalesce(v_after_options, '[]'::jsonb),
    'variants', coalesce(v_after_variants, '[]'::jsonb),
    'backfill', jsonb_build_object(
      'option_name', v_name,
      'value', v_backfill,
      'variant_count', case when v_backfill is null then 0 else v_variant_count end));
  v_before := jsonb_set(v_before, '{options}', coalesce((
    select jsonb_agg(option_doc.value || jsonb_build_object('state', 'unchanged')
             order by option_doc.ordinality)
    from jsonb_array_elements(v_before->'options') with ordinality option_doc(value, ordinality)
  ), '[]'::jsonb));
  v_before := jsonb_set(v_before, '{variants}', coalesce((
    select jsonb_agg(variant_doc.value || jsonb_build_object('state', 'unchanged')
             order by variant_doc.ordinality)
    from jsonb_array_elements(v_before->'variants') with ordinality variant_doc(value, ordinality)
  ), '[]'::jsonb));

  v_effects := jsonb_build_object(
    'variants_created', 0,
    'stock_units_created', 0,
    'stock_events_recorded', 0,
    'prices_changed', 0,
    'supplier_cost_profiles_written', 0,
    'messages_sent', 0,
    'accounting_sync_enqueued', 0,
    'options_created', 1,
    'option_values_created', v_value_count,
    'variants_backfilled', case when v_backfill is null then 0 else v_variant_count end,
    'variants_updated', case when v_backfill is null then 0 else v_variant_count end);

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
  if p_kind = 'create_option' then
    return private.agent_catalog_setup_compile_create_option(p_company, p_actor, p_request);
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

create or replace function private.agent_catalog_setup_write_readback(
  p_write private.agent_catalog_setup_writes, p_save jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_variant uuid; v_item uuid; v_kind text; v_variants uuid[];
        v_option uuid; v_created jsonb; v_missing integer;
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
  elsif p_write.kind = 'create_option' then
    -- The approved `after` predicts a row that did not exist yet, so it carries
    -- a null ref and a per-row state. The expectation puts the ids the save
    -- actually assigned into those nulls and drops the states: the grid that
    -- landed is compared against the grid that was approved, with the created
    -- option proved to be the one the save reported rather than assumed.
    v_option := nullif(p_save#>>'{id_map,agent_new_option}', '')::uuid;
    if v_option is null then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    select option_doc.value into v_created
    from jsonb_array_elements(p_write.proposal#>'{after,options}') option_doc(value)
    where option_doc.value->>'state' = 'created';
    if v_created is null then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    select count(*) into v_missing
    from jsonb_array_elements(v_created->'values') with ordinality value_doc(value, ordinality)
    where nullif(p_save#>>array['id_map', 'agent_new_option_value_' || value_doc.ordinality::text], '') is null;
    if v_missing > 0 then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    v_readback := private.agent_catalog_setup_option_projection(
      p_write.company_id, p_write.family_id,
      p_write.proposal#>>'{after,backfill,option_name}',
      p_write.proposal#>>'{after,backfill,value}');
    v_expected := jsonb_build_object(
      'family', p_write.proposal#>'{after,family}',
      'options', coalesce((
        select jsonb_agg(
          case when option_doc.value->>'state' = 'created' then
            (option_doc.value - 'state')
            || jsonb_build_object(
                 'option_ref', jsonb_build_object('kind', 'catalog_option', 'id', v_option),
                 'values', coalesce((
                   select jsonb_agg(
                     value_doc.value
                     || jsonb_build_object('value_ref', jsonb_build_object(
                          'kind', 'catalog_option_value',
                          'id', (p_save#>>array['id_map', 'agent_new_option_value_' || value_doc.ordinality::text])::uuid))
                     order by value_doc.ordinality)
                   from jsonb_array_elements(option_doc.value->'values')
                     with ordinality value_doc(value, ordinality)), '[]'::jsonb))
          else option_doc.value - 'state' end
          order by option_doc.ordinality)
        from jsonb_array_elements(p_write.proposal#>'{after,options}')
          with ordinality option_doc(value, ordinality)), '[]'::jsonb),
      'variants', coalesce((
        select jsonb_agg(variant_doc.value - 'state' order by variant_doc.ordinality)
        from jsonb_array_elements(p_write.proposal#>'{after,variants}')
          with ordinality variant_doc(value, ordinality)), '[]'::jsonb),
      'backfill', p_write.proposal#>'{after,backfill}');
    if v_readback is distinct from v_expected then
      raise exception 'CATALOG_SETUP_READBACK_MISMATCH' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'readback', v_readback,
      'option_ref', jsonb_build_object('kind', 'catalog_option', 'id', v_option));
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

-- ── Operator notice ────────────────────────────────────────────────────────
create or replace function private.agent_catalog_setup_write_kind_notice(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'create_variant' then 'Review the new variant, its price and its opening stock.'
    when 'set_thresholds' then 'Review the stock levels this variant will warn at.'
    when 'set_pricing' then 'Review a price change on this catalog item.'
    -- No figure here on purpose: cost is separately authorised data and a
    -- notification body is not gated on the permission that shows it.
    when 'set_supplier_cost' then 'Review a supplier cost change on this catalog item.'
    when 'create_option' then 'Review the new option and the value every variant on file gets.'
    else 'Review the catalog change before it is saved.'
  end
$$;

-- ── Writer dispatch ────────────────────────────────────────────────────────
-- This kind writes options, their values and the variant joins, all of which
-- catalog_setup_save already carries — so it joins the first two kinds on the
-- wizard's own path rather than bringing a third narrow writer.
create or replace function private.agent_catalog_setup_write_apply(
  p_write private.agent_catalog_setup_writes
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_key constant text := 'agent-catalog-setup-write:' || p_write.id::text;
        v_provenance jsonb;
begin
  if p_write.kind in ('create_variant', 'set_thresholds', 'create_option')
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
      'agent_catalog_setup_option_projection',
      'agent_catalog_setup_compile_create_option',
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
declare v_role text;
begin
  if pg_catalog.to_regprocedure('private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('private.agent_catalog_setup_option_projection(uuid,uuid,text,text)') is null then
    raise exception 'agent_catalog_setup_option_postflight_missing' using errcode = '55000';
  end if;

  foreach v_role in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(v_role,
         'private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)'::regprocedure, 'execute') then
      raise exception 'agent_catalog_setup_option_compile_reachable: %', v_role using errcode = '42501';
    end if;
  end loop;

  -- This kind adds no sealed writer: everything it touches goes through the
  -- wizard's save path. A third writer appearing here would be a design change
  -- and must not arrive unannounced.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)'::regprocedure),
       'create_option') = 0
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private'
           and p.proname in ('catalog_family_default_price_save',
                             'catalog_supplier_cost_profile_save')) <> 2
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'private' and p.proname like 'catalog\_%\_save') <> 2 then
    raise exception 'agent_catalog_setup_option_writer_added' using errcode = '55000';
  end if;

  -- The authority this kind asks for is the spine's. The two money kinds name
  -- catalog.run_setup in the reauthorization; this one must not join them, and
  -- its compile must not ask for it either.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_write_reauthorize(private.agent_catalog_setup_writes)'::regprocedure),
       'in (''set_pricing'', ''set_supplier_cost'')') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_compile_create_option(uuid,uuid,jsonb)'::regprocedure),
       'run_setup') > 0 then
    raise exception 'agent_catalog_setup_option_authority_widened' using errcode = '55000';
  end if;

  if private.agent_catalog_setup_write_kind_operation('create_option')
       is distinct from 'create_catalog_option' then
    raise exception 'agent_catalog_setup_option_operation_missing' using errcode = '55000';
  end if;
  -- The notice names the dimension, never a value: a value is business text and
  -- a notification body is not a preview.
  if private.agent_catalog_setup_write_kind_notice('create_option')
       is distinct from 'Review the new option and the value every variant on file gets.' then
    raise exception 'agent_catalog_setup_option_notice_missing' using errcode = '55000';
  end if;

  -- The pre-image must still cover what the earlier kinds depend on.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'::regprocedure),
       'price_override_exact') = 0 then
    raise exception 'agent_catalog_setup_option_pre_image_incomplete' using errcode = '55000';
  end if;

  -- W10: this migration seeds no seal either, and installing a kind changes the
  -- effect revision on purpose.
  if exists (select 1 from private.agent_catalog_effect_policy
             where revision = '2026-09-15.catalog-setup-write.v1') then
    raise exception 'agent_catalog_setup_option_must_not_activate' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
