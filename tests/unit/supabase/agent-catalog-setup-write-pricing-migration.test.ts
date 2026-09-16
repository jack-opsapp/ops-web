import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_pricing.sql";
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

describe("catalogue pricing as a catalogue setup write kind", () => {
  it("ships one transactional migration ordered after the first two kinds", () => {
    expect(migrationNames).toEqual([
      "20260916030000_agent_catalog_setup_write_pricing.sql",
    ]);
    expect(migrationNames[0]! > "20260916020000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the spine it extends, or twice", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_pricing_prerequisite_missing"
    );
    expect(MIGRATION).toContain("private.agent_catalog_setup_write_readback(");
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_compile_set_thresholds("
    );
    expect(MIGRATION).toContain("agent_catalog_setup_pricing_already_installed");
    // The spine's kind CHECK already names this kind; assert, never widen.
    expect(MIGRATION).toContain(
      "agent_catalog_setup_pricing_kind_not_accepted"
    );
    expect(RAW).not.toMatch(
      /alter\s+table\s+private\.agent_catalog_setup_writes/i
    );
  });

  it("adds the compile, its dispatch branch and its read-back branch", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_compile_set_pricing"
    );
    expect(MIGRATION).toContain(
      "return private.agent_catalog_setup_compile_set_pricing(p_company, p_actor, p_request)"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_readback"
    );
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_pricing_projection("
    );
    expect(MIGRATION).toContain("adding a later kind");
  });

  it("brings its own narrow writer for the field catalog_setup_save cannot reach", () => {
    expect(MIGRATION).toContain(
      "create function private.catalog_family_default_price_save"
    );
    // Sealed the same way as every other function in this vertical.
    const writer = RAW.slice(
      RAW.indexOf("create function private.catalog_family_default_price_save"),
      RAW.indexOf("-- ── Pricing projection")
    );
    expect(writer).toContain("security definer");
    expect(writer).toContain("set search_path = ''");
    expect(writer).toContain("public.catalog_items");
    expect(writer.toLowerCase()).toContain("default_price::text");
    // Only that one row, and only its two columns.
    expect(writer).toMatch(/set default_price =[\s\S]*?updated_at = clock_timestamp\(\)/);
  });

  it("revokes the writer from every app role and proves it in a postflight", () => {
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain("catalog_family_default_price_save");
    expect(MIGRATION).toContain("has_function_privilege");
    expect(MIGRATION).toContain("agent_catalog_setup_pricing_writer_reachable");
    // service_role is named explicitly: the commit is already definer, so even
    // the service lane has no business calling the writer directly.
    expect(MIGRATION).toContain(
      "array['public','anon','authenticated','service_role']"
    );
    expect(MIGRATION).toContain("agent_catalog_setup_pricing_ledger_readable");
  });

  it("moves the effect seal by naming the new writer, and seeds no seal", () => {
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_effect_revision"
    );
    expect(MIGRATION).toContain("agent_catalog_setup_pricing_seal_incomplete");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_pricing_must_not_activate"
    );
    // W10: nothing may insert into the effect policy.
    expect(RAW).not.toMatch(/insert\s+into\s+private\.agent_catalog_effect_policy/i);
  });

  it("makes the commit's writer per-kind instead of naming catalog_setup_save", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_apply"
    );
    expect(MIGRATION).toContain("agent_catalog_setup_pricing_writer_leak");
    const commit = RAW.slice(
      RAW.indexOf(
        "create or replace function public.commit_catalog_setup_write_as_actor"
      ),
      RAW.indexOf("-- ── Reauthorization")
    );
    expect(commit).toContain("private.agent_catalog_setup_write_apply(v_write)");
    expect(commit).not.toContain("public.catalog_setup_save(");
    // The operator's own claims still wrap the write: the save path is INVOKER.
    expect(commit).toContain("request.jwt.claims");
  });

  it("requires the setup authority the wizard route requires", () => {
    expect(MIGRATION).toContain("catalog.run_setup");
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_reauthorize"
    );
    expect(MIGRATION).toContain(
      "p_write.kind in ('set_pricing', 'set_supplier_cost')"
    );
  });

  it("bounds the caller's own jsonb and reserves the server's provenance key", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_bounded_object"
    );
    expect(MIGRATION).toContain("p_depth > 3");
    expect(MIGRATION).toContain("v_key = 'ops'");
    expect(MIGRATION).toContain("'recorded_by', 'mcp'");
  });

  it("refuses a price list it would have to truncate", () => {
    expect(MIGRATION).toContain("catalog_setup_affected_variants_too_many");
    expect(MIGRATION).toContain("catalog_setup_currency_invalid");
    expect(MIGRATION).toContain("catalog_setup_no_change");
  });
});
