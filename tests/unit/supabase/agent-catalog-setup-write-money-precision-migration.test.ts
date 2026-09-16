import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_money_precision.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));

function read(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const RAW = read(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "missing")
);
const MIGRATION = RAW.toLowerCase();

const PRICING_SOURCE = read(
  join(
    process.cwd(),
    "supabase/migrations/20260916030000_agent_catalog_setup_write_pricing.sql"
  )
);
const COST_SOURCE = read(
  join(
    process.cwd(),
    "supabase/migrations/20260916040000_agent_catalog_setup_write_supplier_cost.sql"
  )
);

describe("catalogue money is written at the currency's minor unit", () => {
  it("ships one transactional migration ordered after every write kind", () => {
    expect(migrationNames).toEqual([
      "20260916070000_agent_catalog_setup_write_money_precision.sql",
    ]);
    expect(migrationNames[0]! > "20260916060000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the functions it replaces or the read's own exponent table", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_prerequisite_missing"
    );
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)"
    );
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)"
    );
    expect(MIGRATION).toContain(
      "private.agent_currency_minor_exponent_or_null(text)"
    );
    expect(MIGRATION).toContain("private.agent_money_to_minor_units(numeric,text)");
    // A table that answered differently would install a guard refusing the
    // currencies OPS bills in, so the assumption is asserted, not trusted.
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_exponent_unexpected"
    );
  });

  it("replaces exactly the two compile functions that write money, and nothing else", () => {
    expect(RAW).toContain(
      "create or replace function private.agent_catalog_setup_compile_set_pricing("
    );
    expect(RAW).toContain(
      "create or replace function private.agent_catalog_setup_compile_set_supplier_cost("
    );
    // Two definitions in the file, both replacements.
    expect(RAW.split("create or replace function ").length - 1).toBe(2);
    expect(RAW.split(/create function /).length - 1).toBe(0);
    // Nothing else in the vertical is redefined. The sibling writers are named
    // inside the carried bodies, which is what makes them the carried bodies —
    // what must not appear is a definition of one.
    for (const other of [
      "agent_catalog_setup_compile_create_variant",
      "agent_catalog_setup_compile_set_thresholds",
      "agent_catalog_setup_compile_create_option",
      "agent_catalog_setup_write_compile",
      "agent_catalog_setup_write_apply",
      "agent_catalog_setup_write_effect_revision",
      "catalog_family_default_price_save",
      "catalog_supplier_cost_profile_save",
      "catalog_setup_save",
      "commit_catalog_setup_write_as_actor",
    ]) {
      expect(MIGRATION, other).not.toContain(`function private.${other}(`);
      expect(MIGRATION, other).not.toContain(`function public.${other}(`);
    }
    // No schema moves and no row moves: this file replaces two function bodies.
    for (const forbidden of [
      "agent_catalog_effect_policy",
      "create table",
      "alter table",
      "drop function",
      "insert into",
      "delete from",
      // ("never truncated" appears in a carried comment; the statement is not.)
      "truncate table",
      "truncate public.",
      "\nupdate ",
    ]) {
      expect(MIGRATION, forbidden).not.toContain(forbidden);
    }
  });

  it("raises one named error, from the same table the catalogue read uses", () => {
    expect(RAW.split("CATALOG_SETUP_MONEY_PRECISION_INVALID").length - 1).toBe(
      4
    );
    // Prerequisite list, the CAD and USD assertions, and one call in each body.
    expect(
      RAW.split("private.agent_currency_minor_exponent_or_null(").length - 1
    ).toBe(5);
    // 22023 is the class the sibling input refusals already use.
    expect(MIGRATION).toContain(
      "raise exception 'catalog_setup_money_precision_invalid' using errcode = '22023'"
    );
    // The guard is on value exactness in minor units, which is the read's own
    // test, so trailing zeros pass and 16.925 CAD does not.
    expect(MIGRATION).toContain("pg_catalog.trunc(");
    expect(MIGRATION).toContain("pg_catalog.power(10::numeric, v_minor)");
  });

  it("carries the two bodies through byte for byte apart from the guard", () => {
    // Everything but the declaration and the check must be the text the two
    // authored migrations already shipped: a silent drift here would revert a
    // rule those files' own proofs established.
    const guardShapes = [
      /\n {2}v_minor smallint;\n/g,
      // The pricing guard sits inside an `if ... then` block and is indented to
      // it; the supplier-cost guard is at the function's own level.
      /\n\n( {2}| {4})-- Money at the currency's own minor unit[\s\S]*?\n\1end if;\n/g,
    ];
    let stripped = RAW;
    for (const shape of guardShapes) stripped = stripped.replace(shape, "\n");
    for (const [name, source] of [
      ["agent_catalog_setup_compile_set_pricing", PRICING_SOURCE],
      ["agent_catalog_setup_compile_set_supplier_cost", COST_SOURCE],
    ] as const) {
      const original = source.slice(
        source.indexOf(`create function private.${name}(`),
        source.indexOf("\nend $$;\n", source.indexOf(`create function private.${name}(`)) +
          "\nend $$;\n".length
      );
      expect(original.length).toBeGreaterThan(1_000);
      expect(stripped).toContain(
        original.replace(
          `create function private.${name}(`,
          `create or replace function private.${name}(`
        )
      );
    }
  });

  it("keeps the security posture and asserts it landed", () => {
    expect(MIGRATION).toContain("security definer set search_path = ''");
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_posture_lost"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_guard_missing"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_executable"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_money_precision_incomplete"
    );
  });

  it("says in its header that it moves the effect seal on purpose", () => {
    expect(MIGRATION).toContain("effect seal");
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_write_effect_revision()"
    );
    expect(MIGRATION).toContain("intended");
  });
});
