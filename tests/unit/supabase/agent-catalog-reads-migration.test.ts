import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_NAME = "20260829061214_agent_catalog_reads.sql";
const BODY_PATH = join(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/catalog/sql/agent_catalog_reads.body.sql"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  MIGRATION_NAME
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-catalog-reads-runtime.sql"
);
const RECIPE_V24_MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260915224500_agent_catalog_recipe_read_v24.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-catalog-reads-replay-runtime.sql"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function compact(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function replaceExactly(
  value: string,
  oldFragment: string,
  newFragment: string,
  expectedCount: number
) {
  expect(value.split(oldFragment).length - 1).toBe(expectedCount);
  return value.split(oldFragment).join(newFragment);
}

function currentBodyFromReservation(value: string) {
  const scopeCanonical = replaceExactly(
    value,
    "       select pg_catalog.array_agg(scope.value order by scope.value)",
    '       select pg_catalog.array_agg(\n         scope.value order by scope.value collate "C"\n       )',
    1
  );
  const emptySupplierCosts = replaceExactly(
    scopeCanonical,
    `    select pg_catalog.count(*)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from cost_projection projection
    cross join duplicate_state duplicate
    group by duplicate.has_duplicate;`,
    `    select pg_catalog.count(projection.id)::integer,
           coalesce(
             pg_catalog.jsonb_agg(
               projection.cost_item
               order by projection.catalog_variant_id,
                        projection.is_default desc,
                        projection.effective_at desc,
                        projection.safe_label collate "C",
                        projection.currency_code,
                        projection.amount_minor
             ) filter (where projection.id is not null),
             '[]'::jsonb
           ),
           coalesce(
             pg_catalog.bool_or(projection.source_invalid), false
           ) or duplicate.has_duplicate
      into v_supplier_cost_count, v_supplier_costs,
           v_supplier_cost_invalid
    from duplicate_state duplicate
    left join cost_projection projection on true
    group by duplicate.has_duplicate;`,
    1
  );
  return recipeShapeV24(emptySupplierCosts);
}

const OLD_DETAIL_ARGUMENT_TYPES =
  "uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid," +
  "boolean,integer,integer,integer,integer,integer,integer,integer,integer," +
  "integer,integer,integer,integer,integer";
const OLD_WRAPPER_ARGUMENT_TYPES =
  "text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb," +
  "text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer," +
  "integer,integer,integer,integer,integer,integer";
const SHAPE_ARGUMENT_TYPES =
  ",text,integer,integer,integer,integer,integer,integer,integer";

/**
 * Migration 20260915223000 replaced the detail reader and its public wrapper
 * whole rather than patching fragments, so the derivation splices the exact
 * definitions that migration ships. Body and migration cannot drift apart.
 */
function migrationDefinition(name: string) {
  const migration = read(RECIPE_V24_MIGRATION_PATH);
  const start = migration.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("\n$function$;\n", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + "\n$function$;\n".length);
}

function replaceDefinition(value: string, name: string) {
  const start = value.indexOf(`create or replace function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = value.indexOf("\n$function$;\n", start);
  expect(end).toBeGreaterThan(start);
  return (
    value.slice(0, start) +
    migrationDefinition(name) +
    value.slice(end + "\n$function$;\n".length)
  );
}

function recipeShapeV24(value: string) {
  const withDrops = replaceExactly(
    value,
    "create or replace function private.agent_p2_catalog_hash_ref(",
    `-- The detail reader and its public wrapper gained the exposure-selected recipe
-- shape. Dropping the pre-shape signatures keeps exactly one overload
-- resolvable by name, so PostgREST can never pick a stale projection.
drop function if exists private.agent_p2_catalog_detail_v1(
  uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,text,uuid,
  boolean,integer,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer
);
drop function if exists public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer
);

create or replace function private.agent_p2_catalog_hash_ref(`,
    1
  );
  const withDetail = replaceDefinition(
    withDrops,
    "private.agent_p2_catalog_detail_v1"
  );
  const withWrapper = replaceDefinition(
    withDetail,
    "public.read_agent_catalog_item_as_system"
  );
  const withHelper = replaceExactly(
    withWrapper,
    "create or replace function private.agent_p2_catalog_normalized_text_v1(",
    `-- Recipe shape v2 reports a line's authored quantity at four decimal places
-- beside the three-decimal milliunit integer, which silently drops anything
-- finer than a thousandth. Four decimals covers every authored quantity in
-- production today; a finer value still returns null and fails the source
-- check rather than being rounded into a wrong number.
${migrationDefinition(
      "private.agent_p2_catalog_float8_decimal4_v1"
    )}\ncreate or replace function private.agent_p2_catalog_normalized_text_v1(`,
    1
  );
  const withDetailSignatures = replaceExactly(
    withHelper,
    `private.agent_p2_catalog_detail_v1(${OLD_DETAIL_ARGUMENT_TYPES})`,
    `private.agent_p2_catalog_detail_v1(${OLD_DETAIL_ARGUMENT_TYPES}${SHAPE_ARGUMENT_TYPES})`,
    2
  );
  const withWrapperSignatures = replaceExactly(
    withDetailSignatures,
    `public.read_agent_catalog_item_as_system(${OLD_WRAPPER_ARGUMENT_TYPES})`,
    `public.read_agent_catalog_item_as_system(${OLD_WRAPPER_ARGUMENT_TYPES}${SHAPE_ARGUMENT_TYPES})`,
    2
  );
  const withWrappedSignatures = replaceExactly(
    withWrapperSignatures,
    `public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;`,
    `public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,
  text,integer,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated, service_role;`,
    1
  );
  const withGrant = replaceExactly(
    withWrappedSignatures,
    `public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer
) to service_role;`,
    `public.read_agent_catalog_item_as_system(
  text,uuid,uuid,uuid,uuid,text,text[],text,text[],text,text,text,jsonb,
  text,uuid,boolean,integer,integer,integer,integer,integer,integer,integer,
  integer,integer,integer,integer,integer,integer,
  text,integer,integer,integer,integer,integer,integer,integer
) to service_role;`,
    1
  );
  const withAclEntry = replaceExactly(
    withGrant,
    "    'private.agent_p2_catalog_float8_milliunits_v1(double precision)',\n",
    "    'private.agent_p2_catalog_float8_milliunits_v1(double precision)',\n" +
      "    'private.agent_p2_catalog_float8_decimal4_v1(double precision)',\n",
    1
  );
  return replaceExactly(
    withAclEntry,
    `  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'private.agent_p2_catalog_float8_milliunits_v1(double precision)'
    )`,
    `  if exists (
    select 1
    from pg_catalog.unnest(array[
      'private.agent_p2_catalog_float8_decimal4_v1(double precision)'
    ]::text[]) required(signature)
    where not exists (
      select 1
      from pg_catalog.pg_proc procedure
      where procedure.oid = pg_catalog.to_regprocedure(required.signature)
        and procedure.provolatile = 'i'
        and procedure.proisstrict
        and procedure.proparallel = 's'
        and not procedure.prosecdef
        and procedure.proconfig @> array[
          'search_path=""', 'extra_float_digits=3'
        ]::text[]
        and pg_catalog.cardinality(procedure.proconfig) = 2
        and not pg_catalog.has_function_privilege(
          'public', procedure.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'anon', procedure.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'authenticated', procedure.oid, 'EXECUTE'
        )
        and not pg_catalog.has_function_privilege(
          'service_role', procedure.oid, 'EXECUTE'
        )
    )
  ) then
    raise exception 'agent_catalog_decimal4_postflight_invalid'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'private.agent_p2_catalog_float8_milliunits_v1(double precision)'
    )`,
    1
  );
}

function definition(sql: string, name: string) {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const tail = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(tail)?.[1];
  if (!delimiter) return "";
  const end = tail.indexOf(`${delimiter};`);
  return end < 0 ? "" : tail.slice(0, end + delimiter.length + 1);
}

const BODY = read(BODY_PATH);
const MIGRATION = read(MIGRATION_PATH);
const SQL = BODY.toLowerCase();
const COMPACT = compact(BODY);
const LIST_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_list_v1")
);
const DETAIL_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_detail_v1")
);
const ATTENTION_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_attention_v1")
);
const CONTEXT_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_read_context_v1")
);
const EXPECTED_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_expected_candidate_v1")
);
const VARIANT_SOURCE_PRIVATE = compact(
  definition(SQL, "private.agent_p2_catalog_variant_source_v1")
);
const LIST_PUBLIC = compact(
  definition(SQL, "public.read_agent_catalog_items_as_system")
);
const DETAIL_PUBLIC = compact(
  definition(SQL, "public.read_agent_catalog_item_as_system")
);
const RUNTIME = compact(read(RUNTIME_PATH));
const REPLAY = compact(read(REPLAY_PATH));
const RESERVED = readdirSync(join(process.cwd(), "supabase/migrations")).filter(
  (name) => name.endsWith("_agent_catalog_reads.sql")
);

describe("P2 catalogue read SQL", () => {
  it("keeps its generated reservation immutable and derives the current body exactly", () => {
    expect(RESERVED).toEqual([MIGRATION_NAME]);
    expect(BODY).not.toBe("");
    expect(MIGRATION).not.toBe(BODY);
    expect(currentBodyFromReservation(MIGRATION)).toBe(BODY);
    expect(SQL).toMatch(/(?:^|\n)begin;\s/);
    expect(SQL.trim().endsWith("commit;")).toBe(true);
    expect(SQL).toContain("task 18 canonical catalogue read body");
    expect(SQL).toContain("do $prerequisites$");
    expect(SQL).toContain("do $postflight$");
  });

  it("keeps the standalone OAuth bootstrap compatible with its full client insert", () => {
    for (const clientColumn of [
      "client_name text not null",
      "redirect_uris text[] not null",
      "token_endpoint_auth_method text not null",
      "grant_types text[] not null",
      "response_types text[] not null",
      "scope text not null",
      "registration_source text not null",
      "scope_ceiling text[] not null",
      "consent_catalog_revision text not null",
      "exposure_revision text not null",
    ]) {
      expect(RUNTIME).toContain(clientColumn);
    }
    expect(RUNTIME).toContain(
      "insert into private.mcp_oauth_clients( client_id, client_name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, scope, registration_source, scope_ceiling, consent_catalog_revision, exposure_revision )"
    );
    expect(RUNTIME).toContain("private.mcp_oauth_labels_for_scopes(");
  });

  it("defines fixed invoker projections and exactly two service-only public RPCs", () => {
    for (const value of [LIST_PRIVATE, DETAIL_PRIVATE, ATTENTION_PRIVATE]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("security invoker");
      expect(value).toContain("set search_path = ''");
    }
    for (const value of [LIST_PUBLIC, DETAIL_PUBLIC]) {
      expect(value).not.toBe("");
      expect(value).toContain("stable");
      expect(value).toContain("security definer");
      expect(value).toContain("set search_path = ''");
      expect(value).toContain("auth.role() is distinct from 'service_role'");
    }
    expect(
      COMPACT.match(/create or replace function public\.read_agent_/g)
    ).toHaveLength(2);
  });

  it("re-proves the current grant, actor permissions, exact candidate variants, and catalogue revision", () => {
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_grants");
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_clients");
    expect(CONTEXT_PRIVATE).toContain("private.resolve_agent_actor_authority(");
    expect(CONTEXT_PRIVATE).toContain("private.mcp_oauth_labels_for_scopes(");
    expect(CONTEXT_PRIVATE).toContain("'catalog'");
    expect(EXPECTED_PRIVATE).toContain("'ops.catalog.read'");
    expect(EXPECTED_PRIVATE).toContain("'catalog.view'");
    expect(EXPECTED_PRIVATE).toContain("'catalog.products.view'");
    expect(EXPECTED_PRIVATE).toContain("'ops.catalog_costs.read'");
    expect(EXPECTED_PRIVATE).toContain("'finances.view'");
    expect(EXPECTED_PRIVATE).toContain("'supplier_costs'");
    expect(COMPACT).not.toContain("finances.view' = 'assigned'");
    expect(COMPACT).not.toContain("catalog.products.view' = 'assigned'");
  });

  it("pins 25/26/501 gates, closed search/detail selectors, and exact money", () => {
    expect(LIST_PRIVATE).toContain("p_item_limit not between 1 and 25");
    expect(LIST_PRIVATE).toContain("p_page_fetch_limit");
    expect(LIST_PRIVATE).toContain("p_source_limit is distinct from 501");
    expect(LIST_PRIVATE).toContain(
      "p_query_kind not in ('family', 'sku', 'category', 'tag')"
    );
    expect(LIST_PRIVATE).toContain(
      "p_active_state not in ('active', 'all', 'inactive')"
    );
    expect(LIST_PRIVATE).toContain("p_stock_states");
    expect(LIST_PRIVATE).toContain("p_after_updated_at");
    expect(LIST_PRIVATE).toContain("p_after_variant_id");
    expect(DETAIL_PRIVATE).toContain(
      "p_item_kind not in ('catalog_family', 'catalog_variant')"
    );
    expect(DETAIL_PRIVATE).toContain("p_include_supplier_costs");
    expect(DETAIL_PRIVATE).toContain("private.agent_money_to_minor_units(");
    expect(CONTEXT_PRIVATE).toContain(
      "private.agent_currency_minor_exponent_or_null("
    );
    expect(COMPACT).toContain(
      "create or replace function private.agent_p2_catalog_milliunits_v1( p_value numeric )"
    );
    expect(COMPACT).toContain(
      "create or replace function private.agent_p2_catalog_float8_milliunits_v1( p_value double precision )"
    );
    expect(COMPACT).toContain("set extra_float_digits = 3");
    expect(COMPACT).toContain("p_value::text::numeric");
    expect(ATTENTION_PRIVATE).toContain("limit p_page_fetch_limit");
    expect(ATTENTION_PRIVATE).not.toContain("limit p_item_limit");
    expect(ATTENTION_PRIVATE).toContain("limit 65");
    expect(ATTENTION_PRIVATE).toContain("v_cost_source_count >= 65");
    expect(ATTENTION_PRIVATE).toContain(
      "pg_catalog.jsonb_array_length(v_items) > p_item_limit"
    );
    expect(COMPACT).toContain('order by distinct_tag.value collate "c"');
    expect(VARIANT_SOURCE_PRIVATE).toContain(
      "pg_catalog.regexp_replace( pg_catalog.btrim(family.name), '[[:space:]]+', ' ', 'g' )"
    );
    expect(VARIANT_SOURCE_PRIVATE).toContain(
      "pg_catalog.regexp_replace( pg_catalog.btrim(tag.name), '[[:space:]]+', ' ', 'g' )"
    );
    expect(VARIANT_SOURCE_PRIVATE).toContain("category.id as category_id");
  });

  it("physically bounds nested tag and option-assignment fan-out before aggregation", () => {
    expect(VARIANT_SOURCE_PRIVATE).toContain("order by item_tag.id limit 65");
    expect(VARIANT_SOURCE_PRIVATE).toContain("source.tag_count >= 65");
    expect(VARIANT_SOURCE_PRIVATE).toContain(
      "with raw_label_values as materialized"
    );
    expect(VARIANT_SOURCE_PRIVATE).toContain(
      "value_row.sort_order, value_row.id, assignment.id limit 129"
    );
    expect(VARIANT_SOURCE_PRIVATE).toContain("labels.label_count >= 129");
  });

  it("round-trips every live double-precision quantity before the exact milliunit boundary", () => {
    for (const convertedValue of [
      "private.agent_p2_catalog_float8_milliunits_v1( recipe.quantity_value )",
      "private.agent_p2_catalog_float8_milliunits_v1( variant.quantity )",
      "private.agent_p2_catalog_float8_milliunits_v1( coalesce( variant.warning_threshold, family.default_warning_threshold, category.default_warning_threshold ) )",
      "private.agent_p2_catalog_float8_milliunits_v1( coalesce( variant.critical_threshold, family.default_critical_threshold, category.default_critical_threshold ) )",
    ]) {
      expect(COMPACT).toContain(convertedValue);
    }
    expect(COMPACT).toContain(
      "if p_value in ( 'nan'::double precision, 'infinity'::double precision, '-infinity'::double precision ) then return null"
    );
    expect(COMPACT).not.toContain("quantity_value::numeric");
    expect(COMPACT).not.toContain("variant.quantity::numeric");
    expect(currentBodyFromReservation(MIGRATION)).toBe(BODY);
    expect(read(RUNTIME_PATH)).toContain(
      "$live_double_precision_values_fail_closed$"
    );
  });

  it("binds canonical opaque proof/evidence and omits private/provider/cost data by default", () => {
    expect(COMPACT).toContain("private.canonical_agent_projection_json(");
    expect(COMPACT).toContain("ops_proof:v1:");
    expect(COMPACT).toContain("ops_evidence:v1:");
    for (const forbidden of [
      "'notes',",
      "'contact',",
      "'contacts',",
      "'external_id',",
      "'external_source',",
      "'image_url',",
      "'image_path',",
      "'profile_key',",
      "'activation_rule',",
      "'source',",
      "'source_json',",
      "'supplier_contact',",
      "'storage_path',",
      "'unit_cost_override',",
      "'default_unit_cost',",
    ]) {
      expect(LIST_PRIVATE).not.toContain(forbidden);
      expect(DETAIL_PRIVATE).not.toContain(forbidden);
      expect(ATTENTION_PRIVATE).not.toContain(forbidden);
    }
  });

  it("ships rollback-only PG17 authority, privacy, bound, index, cost, and replay proof", () => {
    for (const marker of [
      "runtime_requires_postgresql_17",
      "base_catalog_authority",
      "supplier_cost_authority",
      "supplier_cost_redacted_by_default",
      "source_501_fails_closed",
      "page_25_26",
      "keyset_has_no_duplicates",
      "detail_child_bounds",
      "exact_money_rejects_fractional_minor",
      "attention_is_bounded",
      "variant_nested_sources_are_bounded",
      "proof_binding",
      "private_acl",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    for (const marker of [
      "task18_forward_ledger",
      "task18_replay_source",
      "task18_replay_reads",
      "function_acl_stable",
    ]) {
      expect(REPLAY).toContain(marker);
    }
  });
});
