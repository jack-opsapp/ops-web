-- catalog_setup_save: persist products.unit_cost (additive, body-only).
--
-- PROBLEM
--   The ~6380-line public.catalog_setup_save RPC silently dropped products.unit_cost:
--   it was absent from the products INSERT column list + VALUES AND from BOTH
--   ON CONFLICT (id) DO UPDATE SET clauses (the create-mode block and the edit-mode
--   block). So a wizard-created product landed with unit_cost = NULL even when the
--   user entered a cost. The OPS-Web Catalog Setup Wizard already emits `unit_cost`
--   in its payload doc (payload-builder.ts) — the RPC just ignored it. (iOS does NOT
--   send a cost key through this RPC today; its Guided-Catalog cost path writes
--   products.unit_cost directly via REST, so this change is forward-compatible for
--   iOS and — see below — protects iOS-edited products from cost wipes.)
--
-- FIX (mirrors the existing minimum_charge handling)
--   * INSERT: add `unit_cost` to the column list + a VALUES expression
--       case when coalesce(v_product_doc->>'unit_cost','') ~ '^-?[0-9]+(\.[0-9]+)?$'
--            then (v_product_doc->>'unit_cost')::numeric else null end
--     -> yields NULL when the doc omits cost (NOT 0, unlike default_price/base_price
--        which are NOT NULL default 0), so an explicit 0 is still written while an
--        omitted key stays NULL and is preserved by the UPDATE below.
--   * ON CONFLICT DO UPDATE: `unit_cost = coalesce(excluded.unit_cost, public.products.unit_cost)`
--     -> a conflict-update that omits cost can never wipe an existing cost. This is a
--        deliberate deviation from the function's uniform bare-`excluded` pattern,
--        required because the only conflict-updating callers deliberately withhold
--        cost: the web merge doc omits unit_cost when on-file cost is null, and the
--        iOS Advanced "edit" flow conflict-updates products by id with no cost field
--        at all (a bare `excluded` would NULL those products' cost). Other columns
--        keep the bare-`excluded` form because their conflict-updating callers
--        re-send them, so they are not a wipe vector.
--
-- SCOPE
--   unit_cost ONLY. No signature/return change (still (uuid, text, jsonb) -> jsonb),
--   so iOS — which shares this DB across App Store versions — is unaffected; no other
--   column, trigger, RLS, or identity logic is touched.
--
-- APPLY STRATEGY
--   The 6380-line body is NEVER hand-retyped. This migration fetches the live
--   pg_get_functiondef, inserts the 12 unit_cost lines at content-anchored positions
--   (after the bare `base_price,` column entry, before the pricing_unit VALUES entry,
--   and after `base_price = excluded.base_price,` in each SET clause), and asserts the
--   anchors hit exactly twice each (create + edit block) and that exactly 12 lines were
--   added — aborting (rolling back) if the function ever drifted from this shape. The
--   rebuilt CREATE OR REPLACE is EXECUTEd in this single transaction, so a parse error
--   rolls back harmlessly. Idempotent: no-op if unit_cost is already present.
--
--   Verified on prod ijeekuhbatykdomumfjx (2026-06-16): md5(transform(pre-image)) ==
--   md5(live def) — only the 12 intended lines changed. Sentinel (rolled back):
--   create=12.34, preserve-after-omit=12.34, explicit-zero=0, new-value=99.
do $mig$
declare
  v_src text;
  v_lines text[];
  v_out text[] := array[]::text[];
  v_line text;
  v_trim text;
  v_indent text;
  c_collist int := 0;
  c_values  int := 0;
  c_set     int := 0;
  v_when    text := $q$when coalesce(v_product_doc->>'unit_cost', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_product_doc->>'unit_cost')::numeric$q$;
  v_setline text := $q$unit_cost = coalesce(excluded.unit_cost, public.products.unit_cost),$q$;
  v_pu_anchor text := $q$coalesce(nullif(btrim(v_product_doc->>'pricing_unit'), ''), 'each'),$q$;
  v_new   text;
  v_added int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'catalog_setup_save';

  if v_src is null then
    raise exception 'catalog_setup_save not found — aborting';
  end if;

  if position('unit_cost' in v_src) > 0 then
    raise notice 'catalog_setup_save already references unit_cost — skipping (already migrated)';
    return;
  end if;

  v_lines := string_to_array(v_src, E'\n');

  foreach v_line in array v_lines loop
    v_trim   := btrim(v_line);
    v_indent := substring(v_line from '^[ ]*');

    -- VALUES: insert the unit_cost case immediately BEFORE the pricing_unit value line
    if v_trim = v_pu_anchor then
      v_out := array_append(v_out, v_indent || 'case');
      v_out := array_append(v_out, v_indent || '  ' || v_when);
      v_out := array_append(v_out, v_indent || '  else null');
      v_out := array_append(v_out, v_indent || 'end,');
      c_values := c_values + 1;
    end if;

    v_out := array_append(v_out, v_line);

    -- COLUMN LIST: after the bare `base_price,` entry
    if v_trim = 'base_price,' then
      v_out := array_append(v_out, v_indent || 'unit_cost,');
      c_collist := c_collist + 1;
    -- SET clause: after `base_price = excluded.base_price,`
    elsif v_trim = 'base_price = excluded.base_price,' then
      v_out := array_append(v_out, v_indent || v_setline);
      c_set := c_set + 1;
    end if;
  end loop;

  if c_collist <> 2 or c_values <> 2 or c_set <> 2 then
    raise exception 'anchor count mismatch (collist=%, values=%, set=%) — function drifted, aborting',
      c_collist, c_values, c_set;
  end if;

  v_added := array_length(v_out, 1) - array_length(v_lines, 1);
  if v_added <> 12 then
    raise exception 'unexpected added-line count % (expected 12) — aborting', v_added;
  end if;

  v_new := array_to_string(v_out, E'\n');

  execute v_new;
end
$mig$;
