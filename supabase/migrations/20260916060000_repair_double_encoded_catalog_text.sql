-- Repair catalogue text that was UTF-8 encoded and then encoded again as if it
-- were Latin-1, by the hand-written SQL that loaded Canpro's cost sheets before
-- there was a write surface.
--
-- WHAT IS WRONG. An em dash is U+2014. Encoded as UTF-8 it is the three bytes
-- E2 80 94. Read back as Latin-1 and encoded as UTF-8 again, those three BYTES
-- become three CHARACTERS — U+00E2, U+0080, U+0094 — and that is what is stored.
-- U+0080 is a C1 control character, so `private.agent_p2_optional_canonical_text`
-- nulls any label carrying one and `private.agent_p2_catalog_detail_v1` then
-- raises `agent_catalog_source_data_invalid` for the whole family. On the local
-- copy of production that makes `get_catalog_item` with cost access fail on 92
-- of Canpro's 103 variants: the text is not merely ugly, it is unreadable to
-- every surface that refuses control characters.
--
-- WHAT THIS REPAIRS, AND WHAT IT LEAVES ALONE. The scan is the general
-- double-encoding signature — a UTF-8 lead character U+00C2..U+00F4 followed by
-- one or more continuation characters U+0080..U+00BF — across the named text
-- and jsonb columns of every company's catalogue. On the local copy of
-- production that signature matches four distinct sequences and nothing else:
--
--   U+00E2 U+0080 U+0094  ->  U+2014  em dash    176 occurrences (label, source)
--   U+00E2 U+0080 U+0093  ->  U+2013  en dash      5 occurrences (source)
--   U+00C2 U+00BE         ->  U+00BE  ¾            1 occurrence  (an option value, 1¾")
--   U+00C3 U+0097         ->  U+00D7  ×            1 occurrence  (a family description)
--
-- The signature alone is a heuristic, so it never decides anything on its own.
-- A row is repaired only when its value survives the exact inverse of the
-- corruption — read the characters back as Latin-1 bytes, decode them as UTF-8 —
-- AND the result carries no control character. Anything that throws on the way,
-- or that would still be unreadable afterwards, is left exactly as it is and
-- counted in a NOTICE. Every one of the 168 rows found locally passes both
-- tests; the guards are there for the rows this has not seen.
--
-- IDEMPOTENT. A repaired value no longer matches the signature — verified for
-- every local row before writing this — so a second run finds nothing and
-- changes nothing. The postflight asserts that directly.
--
-- AUDITABLE AND REVERSIBLE. Every changed row's table, column, id, before and
-- after go into `private.catalog_text_repairs_20260916`, which is revoked from
-- every app role. Reversing this migration is an UPDATE from that table.
--
-- NOT AN EFFECT CHANGE. This migration writes data. It defines no trigger and
-- redefines none of the functions `private.agent_catalog_setup_write_effect_revision()`
-- hashes, so the catalogue write vertical's seal is unaffected and this file
-- neither reads nor writes `private.agent_catalog_effect_policy`.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '600s';

do $prerequisites$
declare v_missing text[];
begin
  select pg_catalog.array_agg(required.name order by required.name)
    into v_missing
  from (
    values
      ('public.catalog_supplier_cost_profiles'),
      ('public.catalog_items'),
      ('public.catalog_options'),
      ('public.catalog_option_values'),
      ('public.catalog_variants'),
      ('public.catalog_categories'),
      ('public.products'),
      ('public.product_options'),
      ('public.product_option_values'),
      ('public.product_materials')
  ) required(name)
  where pg_catalog.to_regclass(required.name) is null;
  if v_missing is not null then
    raise exception 'agent_catalog_text_repair_prerequisite_missing: %',
      pg_catalog.array_to_string(v_missing, ',') using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('private.catalog_text_repairs_20260916') is not null then
    raise exception 'agent_catalog_text_repair_already_installed' using errcode = '55000';
  end if;
end;
$prerequisites$;

-- ── The ledger ─────────────────────────────────────────────────────────────
-- One row per value this migration changes, holding both sides. Nothing in the
-- application may read it: it exists so a human can audit or undo the change.
create table private.catalog_text_repairs_20260916 (
  id bigint generated always as identity primary key,
  table_name text not null,
  column_name text not null,
  row_id uuid not null,
  before_value text not null,
  after_value text not null,
  repaired_at timestamptz not null default clock_timestamp()
);
alter table private.catalog_text_repairs_20260916 enable row level security;
alter table private.catalog_text_repairs_20260916 force row level security;
revoke all on private.catalog_text_repairs_20260916 from public, anon, authenticated, service_role;
create index catalog_text_repairs_20260916_target
  on private.catalog_text_repairs_20260916(table_name, column_name, row_id);
comment on table private.catalog_text_repairs_20260916 is
  'Audit trail for the 2026-09-16 repair of double-encoded catalogue text. Reversing the repair is an UPDATE from before_value.';

-- ── The repair, and the guards on it ───────────────────────────────────────
-- Temporary: this is a one-off data repair, not a capability. Both functions
-- are dropped before the transaction commits.
create function pg_temp.double_encoding_signature() returns text
language sql immutable as $$
  -- A UTF-8 lead character followed by continuation characters. Built from
  -- chr() so this migration file carries no control character of its own.
  select '[' || chr(194) || '-' || chr(244) || '][' || chr(128) || '-' || chr(191) || ']+'
$$;

create function pg_temp.repaired_text(p_value text) returns text
language plpgsql immutable as $$
declare v_repaired text;
begin
  if p_value is null or p_value !~ pg_temp.double_encoding_signature() then
    return null;
  end if;
  begin
    -- The exact inverse of the corruption: the stored characters are the bytes
    -- the original text encoded to, so read them back as bytes and decode.
    v_repaired := convert_from(convert_to(p_value, 'LATIN1'), 'UTF8');
  exception when others then
    -- Not Latin-1 representable: this was never a double-encoding of ours.
    return null;
  end;
  if v_repaired is null or v_repaired = p_value then
    return null;
  end if;
  -- A repair that leaves a control character behind has not repaired anything
  -- the surfaces refusing control characters can use.
  if v_repaired ~ '[[:cntrl:]]' then
    return null;
  end if;
  return v_repaired;
end $$;

do $repair$
declare
  v_target record;
  v_changed integer;
  v_skipped integer;
  v_total_changed integer := 0;
  v_total_skipped integer := 0;
begin
  for v_target in
    select target.table_name, target.column_name, target.is_json
    from (
      values
        -- (table, column, the column is jsonb)
        ('catalog_supplier_cost_profiles', 'label', false),
        ('catalog_supplier_cost_profiles', 'source', true),
        ('catalog_supplier_cost_profiles', 'activation_rule', true),
        ('catalog_items', 'name', false),
        ('catalog_items', 'description', false),
        ('catalog_items', 'notes', false),
        ('catalog_options', 'name', false),
        ('catalog_option_values', 'value', false),
        ('catalog_variants', 'sku', false),
        ('catalog_categories', 'name', false),
        ('products', 'name', false),
        ('products', 'description', false),
        ('product_options', 'name', false),
        ('product_options', 'default_value', false),
        ('product_option_values', 'value', false),
        ('product_materials', 'notes', false)
    ) target(table_name, column_name, is_json)
  loop
    -- Rows that carry the signature but cannot be repaired safely: reported,
    -- never guessed at.
    execute format(
      'select count(*) from public.%I where %I is not null'
      || ' and %I::text ~ pg_temp.double_encoding_signature()'
      || ' and pg_temp.repaired_text(%I::text) is null',
      v_target.table_name, v_target.column_name,
      v_target.column_name, v_target.column_name)
    into v_skipped;

    execute format(
      'with candidate as ('
      || ' select id, %1$I::text as before_value,'
      || '        pg_temp.repaired_text(%1$I::text) as after_value'
      || ' from public.%2$I'
      || ' where %1$I is not null'
      || '   and %1$I::text ~ pg_temp.double_encoding_signature()'
      || '), safe as (select * from candidate where after_value is not null),'
      || ' logged as ('
      || '   insert into private.catalog_text_repairs_20260916'
      || '     (table_name, column_name, row_id, before_value, after_value)'
      || '   select %2$L, %1$L, id, before_value, after_value from safe'
      || ' )'
      || ' update public.%2$I target set %1$I = safe.after_value%3$s'
      || ' from safe where target.id = safe.id',
      v_target.column_name, v_target.table_name,
      case when v_target.is_json then '::jsonb' else '' end);
    get diagnostics v_changed = row_count;

    v_total_changed := v_total_changed + v_changed;
    v_total_skipped := v_total_skipped + v_skipped;
    if v_changed > 0 or v_skipped > 0 then
      raise notice 'catalog text repair: %.% repaired % row(s), skipped % row(s)',
        v_target.table_name, v_target.column_name, v_changed, v_skipped;
    end if;
  end loop;
  raise notice 'catalog text repair: % row(s) repaired, % row(s) left unchanged and unreadable',
    v_total_changed, v_total_skipped;
end;
$repair$;

do $postflight$
declare
  v_target record;
  v_remaining integer;
  v_repairable integer := 0;
  v_logged bigint;
begin
  -- Idempotence, asserted rather than assumed: nothing the repair touched still
  -- looks repairable, so a second run of this migration would change nothing.
  for v_target in
    select target.table_name, target.column_name
    from (
      values
        ('catalog_supplier_cost_profiles', 'label'),
        ('catalog_supplier_cost_profiles', 'source'),
        ('catalog_supplier_cost_profiles', 'activation_rule'),
        ('catalog_items', 'name'),
        ('catalog_items', 'description'),
        ('catalog_items', 'notes'),
        ('catalog_options', 'name'),
        ('catalog_option_values', 'value'),
        ('catalog_variants', 'sku'),
        ('catalog_categories', 'name'),
        ('products', 'name'),
        ('products', 'description'),
        ('product_options', 'name'),
        ('product_options', 'default_value'),
        ('product_option_values', 'value'),
        ('product_materials', 'notes')
    ) target(table_name, column_name)
  loop
    execute format(
      'select count(*) from public.%I where pg_temp.repaired_text(%I::text) is not null',
      v_target.table_name, v_target.column_name)
    into v_remaining;
    v_repairable := v_repairable + v_remaining;
  end loop;
  if v_repairable <> 0 then
    raise exception 'agent_catalog_text_repair_idempotent: % row(s) still repairable',
      v_repairable using errcode = '55000';
  end if;

  -- The ledger holds a row for every value that moved, and every one of them
  -- differs from the value it replaced.
  select count(*) into v_logged from private.catalog_text_repairs_20260916;
  if exists (select 1 from private.catalog_text_repairs_20260916
             where before_value = after_value) then
    raise exception 'agent_catalog_text_repair_ledger_invalid' using errcode = '55000';
  end if;
  raise notice 'catalog text repair: % ledger row(s) recorded', v_logged;

  if pg_catalog.has_table_privilege('anon', 'private.catalog_text_repairs_20260916', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'private.catalog_text_repairs_20260916', 'select')
     or pg_catalog.has_table_privilege('service_role', 'private.catalog_text_repairs_20260916', 'select') then
    raise exception 'agent_catalog_text_repair_ledger_readable' using errcode = '42501';
  end if;
end;
$postflight$;

drop function pg_temp.repaired_text(text);
drop function pg_temp.double_encoding_signature();

commit;
