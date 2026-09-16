-- Catalogue setup writes, kind 3 of 5: `set_pricing`. Extends the spine
-- installed by 20260916010000_agent_catalog_setup_write_variant.sql and
-- generalised by 20260916020000_agent_catalog_setup_write_thresholds.sql.
-- Nothing activates on merge (plan decision W10): the effect seal stays
-- unseeded, and installing this kind deliberately CHANGES the effect revision.
--
-- WHY THIS KIND NEEDS A WRITER OF ITS OWN. `public.catalog_setup_save` writes a
-- variant's `price_override` and it does NOT write a family's `default_price`:
-- its family section touches category_id, name, description, image_url, the two
-- default thresholds, default_unit_id and notes, and nothing else. No other
-- Postgres function updates an existing family's `default_price` either. So a
-- family-level price is the first catalogue write in this vertical that the
-- wizard's save path cannot carry, and it gets a narrow sealed writer beside it:
--
--   private.catalog_family_default_price_save(company, actor, family, price,
--                                             idempotency_key, source)
--
-- It is `private`, `security definer`, `search_path = ''`, revoked from every
-- app role including service_role, reachable only from the commit, idempotent on
-- (company, writer, key) through a private ledger, and it returns the row's
-- exact stored text so the read-back compares exactly rather than numerically.
-- A variant-level price still goes through `catalog_setup_save` with the family's
-- complete document, exactly as the first two kinds do.
--
-- ONE MORE PERMISSION THAN THE SPINE ASKS FOR. `catalog_items.default_price` is
-- written nowhere in OPS except the catalogue setup wizard, whose route is gated
-- on `catalog.run_setup`. A SECURITY DEFINER writer reached through MCP must not
-- become a way around the authority that guards the field it writes, so this
-- kind requires `catalog.run_setup` on top of the spine's four keys — at compile
-- time so a prepare refuses up front, at reauthorization so a commit re-checks,
-- and inside the writer itself. The first two kinds go through
-- `catalog_setup_save` against tables whose policies ask for no such key, which
-- is why the spine did not need this and this kind does.
--
-- THE COMMIT IS NOW KIND-AGNOSTIC ABOUT ITS WRITER TOO. The thresholds migration
-- made the proposal operation, the operator notice and the read-back per-kind
-- lookups; the commit still named `public.catalog_setup_save` directly. It now
-- goes through private.agent_catalog_setup_write_apply, one branch per kind, so
-- the remaining kinds can bring their own writer without touching the commit.
--
-- ADDING A LATER KIND (set_supplier_cost, create_option):
--   1. add private.agent_catalog_setup_compile_<kind>(uuid,uuid,jsonb),
--   2. add one branch to private.agent_catalog_setup_write_compile,
--   3. add one branch to private.agent_catalog_setup_write_readback,
--   4. add one branch to private.agent_catalog_setup_write_apply if the kind
--      does not write through public.catalog_setup_save,
--   5. add the kind to private.agent_catalog_setup_write_kind_operation and
--      private.agent_catalog_setup_write_kind_notice,
--   6. add its extra scopes to private.agent_catalog_setup_write_kind_scopes,
--   7. name any new sealed writer in
--      private.agent_catalog_setup_write_effect_revision().
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
      ('function', 'public.prepare_catalog_setup_write_as_system(uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,text,text,text,jsonb,timestamp with time zone)'),
      ('function', 'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'),
      ('function', 'public.catalog_setup_save(uuid,text,jsonb)'),
      ('function', 'public.has_permission(uuid,text,text)'),
      ('function', 'private.agent_catalog_setup_write_compile(uuid,uuid,text,jsonb)'),
      ('function', 'private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)'),
      ('function', 'private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)'),
      ('function', 'private.agent_catalog_setup_family_state(uuid,uuid,boolean)'),
      ('function', 'private.agent_catalog_setup_write_payload(jsonb)'),
      ('function', 'private.agent_catalog_setup_write_hash(jsonb)'),
      ('function', 'private.agent_catalog_setup_money(numeric)'),
      ('function', 'private.agent_catalog_setup_exact(numeric)'),
      ('function', 'private.agent_catalog_setup_write_effect_revision()'),
      ('function', 'private.agent_catalog_setup_write_assert_seal(boolean)'),
      ('function', 'private.agent_catalog_setup_write_kind_capability(text)'),
      ('function', 'private.agent_catalog_setup_write_kind_notice(text)'),
      ('function', 'private.agent_catalog_setup_write_kind_operation(text)'),
      ('function', 'private.agent_catalog_setup_write_reauthorize(private.agent_catalog_setup_writes)'),
      ('function', 'private.agent_prompt_text_is_safe(text,boolean)'),
      ('table', 'private.agent_catalog_setup_writes'),
      ('table', 'public.catalog_items'),
      ('table', 'public.catalog_variants')
  ) required(kind, name)
  where case required.kind
    when 'function' then pg_catalog.to_regprocedure(required.name) is null
    else pg_catalog.to_regclass(required.name) is null
  end;
  if v_missing is not null then
    raise exception 'agent_catalog_setup_pricing_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  if pg_catalog.to_regprocedure(
       'private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)') is not null then
    raise exception 'agent_catalog_setup_pricing_already_installed' using errcode = '55000';
  end if;
  -- The spine's proposal table already accepts this kind.
  if not exists (
    select 1 from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'private'
      and table_row.relname = 'agent_catalog_setup_writes'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) like '%''set_pricing''%'
  ) then
    raise exception 'agent_catalog_setup_pricing_kind_not_accepted' using errcode = '55000';
  end if;
  -- Verified before relying on it: catalog_setup_save does not write a family's
  -- default price, which is the whole reason the narrow writer below exists. If
  -- that ever changes, this vertical must be rewritten, not silently doubled up.
  if pg_catalog.strpos(
       pg_catalog.pg_get_functiondef('public.catalog_setup_save(uuid,text,jsonb)'::regprocedure),
       'public.catalog_items') = 0 then
    raise exception 'agent_catalog_setup_pricing_save_shape_unknown' using errcode = '55000';
  end if;
end;
$prerequisites$;

-- ── A ledger for the narrow writers ────────────────────────────────────────
-- `public.catalog_setup_save` keeps its own request ledger, guarded by a trigger
-- that refuses any write not made by that one function. The narrow writers get
-- their own rather than widening that guard's meaning: one row per
-- (company, writer, key), holding the request hash so a replayed key carrying
-- different arguments is a conflict and not a silent no-op, and the server
-- provenance for a field whose table has nowhere to keep it.
create table private.agent_catalog_setup_writer_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_user_id uuid not null references public.users(id),
  writer text not null check (writer in (
    'catalog_family_default_price_save', 'catalog_supplier_cost_profile_save'
  )),
  idempotency_key text not null,
  request_hash text not null,
  source jsonb not null default '{}'::jsonb,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, writer, idempotency_key),
  check (jsonb_typeof(source) = 'object' and jsonb_typeof(response) = 'object'),
  check (octet_length(response::text) <= 262144)
);
alter table private.agent_catalog_setup_writer_requests enable row level security;
alter table private.agent_catalog_setup_writer_requests force row level security;
revoke all on private.agent_catalog_setup_writer_requests
  from public, anon, authenticated, service_role;
create index agent_catalog_setup_writer_requests_company
  on private.agent_catalog_setup_writer_requests(company_id, writer);

-- ── Bounded jsonb ──────────────────────────────────────────────────────────
-- Objects a caller hands in and OPS stores verbatim: object depth at most 3, at
-- most 32 keys per object and 32 elements per array, strings at most 512
-- characters, arrays of scalars only, no key beginning with `$`, and no key
-- named `ops` — that one is reserved for the server's own provenance block so
-- the caller can never forge or overwrite it.
create function private.agent_catalog_setup_bounded_object(
  p_value jsonb, p_depth integer default 1
) returns boolean language plpgsql immutable set search_path = '' as $$
declare v_key text; v_child jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    return false;
  end if;
  if p_depth > 3 then return false; end if;
  if (select pg_catalog.count(*) from jsonb_object_keys(p_value)) > 32 then
    return false;
  end if;
  for v_key in select key from jsonb_object_keys(p_value) key loop
    if pg_catalog.left(v_key, 1) = '$' or pg_catalog.length(v_key) not between 1 and 512
       or (p_depth = 1 and v_key = 'ops') then
      return false;
    end if;
    v_child := p_value -> v_key;
    if jsonb_typeof(v_child) = 'object' then
      if not private.agent_catalog_setup_bounded_object(v_child, p_depth + 1) then
        return false;
      end if;
    elsif jsonb_typeof(v_child) = 'array' then
      if jsonb_array_length(v_child) > 32 then return false; end if;
      if exists (
        select 1 from jsonb_array_elements(v_child) element
        where jsonb_typeof(element.value) in ('object', 'array')
           or (jsonb_typeof(element.value) = 'string'
               and pg_catalog.length(element.value #>> '{}') > 512)
      ) then
        return false;
      end if;
    elsif jsonb_typeof(v_child) = 'string' then
      if pg_catalog.length(v_child #>> '{}') > 512 then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- ── Variant value labels ───────────────────────────────────────────────────
-- The option values that name one variant, in the family's own option order.
-- The thresholds projection inlines this same query; it is left exactly as it
-- is and the new projections call this instead, so installing a kind cannot
-- change what an already-installed kind reads back.
create function private.agent_catalog_setup_value_labels(
  p_company uuid, p_family uuid, p_variant uuid
) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_agg(value_row.value
      order by option_row.sort_order, option_row.name, option_row.id)
    from public.catalog_variant_option_values junction
    join public.catalog_option_values value_row on value_row.id = junction.option_value_id
    join public.catalog_options option_row on option_row.id = value_row.option_id
    where junction.variant_id = p_variant and junction.deleted_at is null
      and value_row.deleted_at is null and option_row.deleted_at is null
      and option_row.catalog_item_id = p_family
      and exists (
        select 1 from public.catalog_variants owner_variant
        where owner_variant.id = p_variant and owner_variant.company_id = p_company
      )
  ), '[]'::jsonb)
$$;

-- ── The narrow writer for a family's default price ─────────────────────────
create function private.catalog_family_default_price_save(
  p_company_id uuid, p_actor_user_id uuid, p_family_id uuid,
  p_default_price numeric, p_idempotency_key text, p_source jsonb
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_request_hash text;
  v_existing private.agent_catalog_setup_writer_requests%rowtype;
  v_before numeric;
  v_after text;
  v_rows integer;
  v_result jsonb;
begin
  if p_company_id is null or p_actor_user_id is null or p_family_id is null
     or p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
     or p_source is null
     or not private.agent_catalog_setup_bounded_object(p_source)
     or (p_default_price is not null
         and (p_default_price < 0
              or p_default_price > 99999999999
              or pg_catalog.round(p_default_price, 4) is distinct from p_default_price)) then
    raise exception 'CATALOG_SETUP_WRITE_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Defence in depth. The commit re-authorized the grant, the permissions and
  -- the family before it got here; this is the writer refusing on its own
  -- account, so it cannot be turned into a privilege-escalation path by any
  -- later caller that forgets.
  if not exists (
    select 1
    from public.users actor
    join public.companies company
      on company.id = actor.company_id and company.deleted_at is null
    where actor.id = p_actor_user_id and actor.company_id = p_company_id
      and actor.is_active and actor.deleted_at is null
  )
     or not public.has_permission(p_actor_user_id, 'catalog.manage', 'all')
     or not public.has_permission(p_actor_user_id, 'catalog.run_setup', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;

  v_request_hash := private.agent_catalog_setup_write_hash(jsonb_build_object(
    'writer', 'catalog_family_default_price_save',
    'company', p_company_id, 'actor', p_actor_user_id, 'family', p_family_id,
    'default_price', private.agent_catalog_setup_exact(p_default_price)));

  select * into v_existing from private.agent_catalog_setup_writer_requests
  where company_id = p_company_id and writer = 'catalog_family_default_price_save'
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception 'CATALOG_SETUP_WRITE_IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  select default_price into v_before from public.catalog_items
  where id = p_family_id and company_id = p_company_id and deleted_at is null
  for update;
  if not found then
    raise exception 'CATALOG_SETUP_FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Exactly one row, exactly two columns. `updated_at` is set here because
  -- public.catalog_items carries no trigger that would set it.
  update public.catalog_items
     set default_price = pg_catalog.trim_scale(p_default_price),
         updated_at = clock_timestamp()
   where id = p_family_id and company_id = p_company_id and deleted_at is null
  returning default_price::text into v_after;
  get diagnostics v_rows = row_count;
  if v_rows is distinct from 1 then
    raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'blockers', '[]'::jsonb,
    'writer', 'catalog_family_default_price_save',
    'family_id', p_family_id,
    'default_price_before', v_before::text,
    'default_price', v_after,
    'replayed', false);
  insert into private.agent_catalog_setup_writer_requests(
    company_id, actor_user_id, writer, idempotency_key, request_hash, source, response)
  values (
    p_company_id, p_actor_user_id, 'catalog_family_default_price_save',
    p_idempotency_key, v_request_hash, p_source, v_result);
  return v_result;
end $$;

-- ── Pricing projection ─────────────────────────────────────────────────────
-- What one family or one variant sells for, where that answer comes from, and
-- every variant the change reaches. Both sides of the preview and the commit's
-- read-back are this one function, so the preview and the receipt cannot
-- disagree by construction.
--
-- It deliberately carries no timestamp. A projection that named `updated_at`
-- could never be predicted at prepare time, and the read-back compares the
-- approved `after` for equality.
create function private.agent_catalog_setup_pricing_projection(
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
    ), '[]'::jsonb));
end $$;

-- ── Kind 3: set_pricing ────────────────────────────────────────────────────
-- Returns the shared compile envelope:
--   {family_id, family_name, pre_image_hash, payload, evidence,
--    proposal_before, proposal_after, effects, blockers}
create function private.agent_catalog_setup_compile_set_pricing(
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
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

create or replace function private.agent_catalog_setup_write_kind_notice(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'create_variant' then 'Review the new variant, its price and its opening stock.'
    when 'set_thresholds' then 'Review the stock levels this variant will warn at.'
    when 'set_pricing' then 'Review a price change on this catalog item.'
    else 'Review the catalog change before it is saved.'
  end
$$;

-- ── The writer dispatcher ──────────────────────────────────────────────────
-- Which function actually performs the approved write. Everything else about
-- the commit — authority, seal, pre-image, read-back, receipt — is the same for
-- every kind; this is the one place a kind gets to bring its own writer.
create function private.agent_catalog_setup_write_apply(
  p_write private.agent_catalog_setup_writes
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_key constant text := 'agent-catalog-setup-write:' || p_write.id::text;
begin
  if p_write.kind in ('create_variant', 'set_thresholds')
     or (p_write.kind = 'set_pricing'
         and (p_write.request#>>'{item_ref,kind}') = 'catalog_variant') then
    return public.catalog_setup_save(p_write.company_id, v_key, p_write.payload);
  end if;
  if p_write.kind = 'set_pricing' then
    if (p_write.payload->>'writer') is distinct from 'catalog_family_default_price_save'
       or (p_write.payload->>'family_id')::uuid is distinct from p_write.family_id then
      raise exception 'CATALOG_SETUP_WRITE_APPLY_FAILED' using errcode = '55000';
    end if;
    return private.catalog_family_default_price_save(
      p_write.company_id, p_write.actor_user_id, p_write.family_id,
      (p_write.payload->>'default_price')::numeric, v_key,
      -- Server-stamped provenance. Nothing here comes from the caller.
      jsonb_build_object(
        'recorded_by', 'mcp',
        'action_id', p_write.action_id,
        'change_set_id', p_write.id,
        'recorded_at', private.agent_rfc3339_utc(clock_timestamp())));
  end if;
  raise exception 'CATALOG_SETUP_WRITE_KIND_UNAVAILABLE' using errcode = '22023';
end $$;

-- ── Commit: kind-agnostic writer ───────────────────────────────────────────
-- Identical to the thresholds commit apart from the one line that performs the
-- write, which now goes through private.agent_catalog_setup_write_apply. The
-- operator's own JWT claims are still installed around it, because the
-- catalog_setup_save path is SECURITY INVOKER and guards on them.
create or replace function public.commit_catalog_setup_write_as_actor(
  p_actor_user_id uuid, p_company_id uuid, p_action_id uuid, p_change_set_id uuid,
  p_preview_sha256 text, p_idempotency_key text
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_write private.agent_catalog_setup_writes%rowtype;
  v_action public.agent_actions%rowtype;
  v_state jsonb;
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

-- ── Reauthorization: the money kinds carry setup authority ─────────────────
create or replace function private.agent_catalog_setup_write_reauthorize(
  p_write private.agent_catalog_setup_writes
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_capability text;
begin
  v_capability := private.agent_catalog_setup_write_kind_capability(p_write.kind);
  perform private.assert_agent_catalog_setup_write_authority(
    p_write.actor_user_id, p_write.company_id, p_write.oauth_grant_id, p_write.oauth_client_id,
    p_write.authority->>'grant_revision',
    array(select jsonb_array_elements_text(p_write.authority->'scopes')),
    p_write.authority->>'permission_revision',
    array(select jsonb_array_elements_text(p_write.authority->'permission_keys')),
    '2026-09-15.capability-manifest.v28', '2026-09-15.mcp-exposure.v24',
    v_capability, v_capability || ':2026-09-15.v1');
  if p_write.request ? 'opening_quantity'
     and not public.has_permission(p_write.actor_user_id, 'catalog.stock.adjust', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;
  if p_write.kind = 'set_supplier_cost'
     and not public.has_permission(p_write.actor_user_id, 'finances.view', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;
  -- The two kinds whose fields are written nowhere in OPS but the setup wizard.
  if p_write.kind in ('set_pricing', 'set_supplier_cost')
     and not public.has_permission(p_write.actor_user_id, 'catalog.run_setup', 'all') then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.catalog_items family
    where family.id = p_write.family_id and family.company_id = p_write.company_id
      and family.deleted_at is null
  ) then
    raise exception 'CATALOG_SETUP_WRITE_AUTHORITY_DENIED' using errcode = '42501';
  end if;
end $$;

-- ── Effect seal (W10) ──────────────────────────────────────────────────────
-- The second narrow writer is named here explicitly, beside the one the spine
-- already reserved. Both would be reached transitively through the commit, but
-- a sealed writer should be named by the seal and not found by accident.
create or replace function private.agent_catalog_setup_write_effect_revision() returns text
language sql stable security definer set search_path = '' as $$
  with recursive triggers as (
    select c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) definition, t.tgfoid
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname in (
      'catalog_categories','catalog_items','catalog_options','catalog_option_values',
      'catalog_variants','catalog_variant_option_values','catalog_stock_units',
      'catalog_stock_unit_events','catalog_supplier_cost_profiles',
      'catalog_setup_save_requests','agent_actions','notifications'
    )
  ), functions(oid) as (
    select tgfoid from triggers
    union
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and (
      (n.nspname = 'public' and p.proname in (
        'catalog_setup_save','prepare_catalog_setup_write_as_system',
        'commit_catalog_setup_write_as_actor','reject_catalog_setup_write_as_actor'
      ))
      or (n.nspname = 'private' and p.proname in (
        'catalog_family_default_price_save',
        'catalog_supplier_cost_profile_save',
        'agent_catalog_setup_write_apply',
        'agent_catalog_setup_family_state','agent_catalog_setup_write_payload',
        'agent_catalog_setup_variant_projection','agent_catalog_setup_write_compile',
        'agent_catalog_setup_compile_create_variant'
      ))
    )
    union
    select dependency.oid from functions f
    cross join lateral regexp_matches(pg_get_functiondef(f.oid), '(private|public)\.([a-z_][a-z_0-9]*)[[:space:]]*\(', 'g') call
    join pg_namespace n on n.nspname = call[1]
    join pg_proc dependency on dependency.pronamespace = n.oid
      and dependency.proname = call[2] and dependency.prokind = 'f'
  )
  select private.agent_catalog_setup_write_hash(jsonb_build_object(
    'triggers', (select coalesce(jsonb_agg(to_jsonb(t) - 'tgfoid' order by t.relname, t.tgname), '[]'::jsonb) from triggers t),
    'functions', (select coalesce(jsonb_agg(pg_get_functiondef(f.oid) order by pg_get_functiondef(f.oid)), '[]'::jsonb) from functions f)
  ))
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
do $acl$
declare f record;
begin
  for f in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in (
            'agent_catalog_setup_bounded_object',
            'agent_catalog_setup_value_labels',
            'catalog_family_default_price_save',
            'agent_catalog_setup_pricing_projection',
            'agent_catalog_setup_compile_set_pricing',
            'agent_catalog_setup_write_compile',
            'agent_catalog_setup_write_readback',
            'agent_catalog_setup_write_apply',
            'agent_catalog_setup_write_kind_notice',
            'agent_catalog_setup_write_reauthorize',
            'agent_catalog_setup_write_effect_revision'))
       or (n.nspname = 'public' and p.proname in ('commit_catalog_setup_write_as_actor'))
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
declare v_role text; v_writer constant text :=
  'private.catalog_family_default_price_save(uuid,uuid,uuid,numeric,text,jsonb)';
begin
  if pg_catalog.to_regprocedure('private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure(v_writer) is null
     or pg_catalog.to_regprocedure('private.agent_catalog_setup_pricing_projection(uuid,uuid,text,uuid,uuid[])') is null
     or pg_catalog.to_regprocedure('private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)') is null
     or pg_catalog.to_regprocedure('private.agent_catalog_setup_bounded_object(jsonb,integer)') is null
     or pg_catalog.to_regclass('private.agent_catalog_setup_writer_requests') is null then
    raise exception 'agent_catalog_setup_pricing_postflight_missing' using errcode = '55000';
  end if;

  -- The narrow writer is reachable from the commit and from nowhere else. No
  -- app role may execute it, service_role included: the commit is the only
  -- caller and it is already SECURITY DEFINER.
  foreach v_role in array array['public','anon','authenticated','service_role'] loop
    if pg_catalog.has_function_privilege(v_role, v_writer::regprocedure, 'execute') then
      raise exception 'agent_catalog_setup_pricing_writer_reachable: %', v_role
        using errcode = '42501';
    end if;
    if pg_catalog.has_table_privilege(v_role, 'private.agent_catalog_setup_writer_requests', 'select') then
      raise exception 'agent_catalog_setup_pricing_ledger_readable: %', v_role
        using errcode = '42501';
    end if;
  end loop;

  -- The commit no longer names one writer, and the seal names the new one.
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)'::regprocedure),
       'public.catalog_setup_save(') > 0 then
    raise exception 'agent_catalog_setup_pricing_writer_leak' using errcode = '55000';
  end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
       'private.agent_catalog_setup_write_effect_revision()'::regprocedure),
       'catalog_family_default_price_save') = 0 then
    raise exception 'agent_catalog_setup_pricing_seal_incomplete' using errcode = '55000';
  end if;
  if private.agent_catalog_setup_write_kind_operation('set_pricing')
       is distinct from 'set_catalog_pricing' then
    raise exception 'agent_catalog_setup_pricing_operation_missing' using errcode = '55000';
  end if;

  -- W10: this migration seeds no seal either, and installing a kind changes the
  -- effect revision on purpose.
  if exists (select 1 from private.agent_catalog_effect_policy
             where revision = '2026-09-15.catalog-setup-write.v1') then
    raise exception 'agent_catalog_setup_pricing_must_not_activate' using errcode = '55000';
  end if;
end;
$postflight$;

commit;
