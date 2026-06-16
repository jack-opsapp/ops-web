-- ROLLBACK for 20260616205309_catalog_setup_save_persist_unit_cost.
--
-- Removes the 12 unit_cost lines the forward migration inserted into
-- public.catalog_setup_save, restoring the prior body. This re-introduces the
-- original bug (the RPC drops products.unit_cost again), so only run it to back
-- the fix out. Not in the apply path (rollbacks/ subdir). Run as postgres.
--
-- Self-verifying: it reconstructs the body by removing exactly the 12 inserted
-- lines (the 2 column-list entries, the 2 four-line VALUES case blocks, and the
-- 2 SET clauses), asserts 12 lines were removed and no `unit_cost` remains, and
-- asserts the result md5 equals the captured pre-image
-- (c89e57e14e4d02091b1b17d3c6f6c6c5). If the function has been modified since the
-- forward migration, the md5 guard makes this abort rather than clobber newer work.
do $rb$
declare
  v_src text;
  v_lines text[];
  v_out text[] := array[]::text[];
  v_mark boolean[];
  n int; i int;
  v_trim text;
  v_removed int := 0;
  v_when    text := $q$when coalesce(v_product_doc->>'unit_cost', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (v_product_doc->>'unit_cost')::numeric$q$;
  v_setline text := $q$unit_cost = coalesce(excluded.unit_cost, public.products.unit_cost),$q$;
  v_new text;
  c_expected_md5 constant text := 'c89e57e14e4d02091b1b17d3c6f6c6c5';
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname = 'public' and p.proname = 'catalog_setup_save';

  if v_src is null then raise exception 'catalog_setup_save not found — aborting'; end if;
  if position('unit_cost' in v_src) = 0 then
    raise notice 'catalog_setup_save has no unit_cost — nothing to roll back'; return;
  end if;

  v_lines := string_to_array(v_src, E'\n');
  n := array_length(v_lines, 1);
  v_mark := array_fill(false, array[n]);

  for i in 1..n loop
    v_trim := btrim(v_lines[i]);
    if v_trim = 'unit_cost,' or v_trim = v_setline then
      v_mark[i] := true;
    elsif v_trim = v_when then
      -- structural guard: the inserted VALUES block is exactly  case / when / else null / end,
      if btrim(v_lines[i-1]) <> 'case' or btrim(v_lines[i+1]) <> 'else null' or btrim(v_lines[i+2]) <> 'end,' then
        raise exception 'unexpected VALUES case shape around line % — aborting rollback', i;
      end if;
      v_mark[i-1] := true; v_mark[i] := true; v_mark[i+1] := true; v_mark[i+2] := true;
    end if;
  end loop;

  for i in 1..n loop
    if v_mark[i] then v_removed := v_removed + 1; else v_out := array_append(v_out, v_lines[i]); end if;
  end loop;

  if v_removed <> 12 then
    raise exception 'expected to remove 12 lines, removed % — aborting', v_removed;
  end if;

  v_new := array_to_string(v_out, E'\n');

  if position('unit_cost' in v_new) <> 0 then
    raise exception 'unit_cost still present after reverse-transform — aborting';
  end if;
  if md5(v_new) <> c_expected_md5 then
    raise exception 'reverse-transform md5 % != captured pre-image % — function changed since; aborting',
      md5(v_new), c_expected_md5;
  end if;

  execute v_new;
end
$rb$;
