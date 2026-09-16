import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_repair_double_encoded_catalog_text.sql";
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
/** The statements only: prose about what is deliberately not touched is not a
 * statement that touches it. */
const STATEMENTS = RAW.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/**
 * Every (table, column) pair the repair is allowed to touch. A repair that
 * reached a column outside this list would be rewriting data nobody reviewed.
 */
const ALLOWED = [
  ["catalog_supplier_cost_profiles", "label"],
  ["catalog_supplier_cost_profiles", "source"],
  ["catalog_supplier_cost_profiles", "activation_rule"],
  ["catalog_items", "name"],
  ["catalog_items", "description"],
  ["catalog_items", "notes"],
  ["catalog_options", "name"],
  ["catalog_option_values", "value"],
  ["catalog_variants", "sku"],
  ["catalog_categories", "name"],
  ["products", "name"],
  ["products", "description"],
  ["product_options", "name"],
  ["product_options", "default_value"],
  ["product_option_values", "value"],
  ["product_materials", "notes"],
] as const;

describe("double-encoded catalogue text repair", () => {
  it("ships one transactional migration after the catalogue write kinds", () => {
    expect(migrationNames).toEqual([
      "20260916060000_repair_double_encoded_catalog_text.sql",
    ]);
    expect(migrationNames[0]! > "20260916050000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("names every column it may touch, and touches nothing else", () => {
    for (const [table, column] of ALLOWED) {
      expect(MIGRATION, `${table}.${column}`).toContain(
        `('${table}', '${column}'`
      );
    }
    // The target list is a literal VALUES table, so the columns it reaches are
    // reviewable by reading it rather than by reasoning about a catalogue scan.
    const targets = RAW.match(/\('[a-z_]+', '[a-z_]+', (?:true|false)\)/g) ?? [];
    expect(targets).toHaveLength(ALLOWED.length);
    for (const target of targets) {
      const [, table, column] = target.match(/\('([a-z_]+)', '([a-z_]+)'/)!;
      expect(
        ALLOWED.some(
          (allowed) => allowed[0] === table && allowed[1] === column
        ),
        `${table}.${column} is not on the reviewed list`
      ).toBe(true);
    }
  });

  it("repairs only what round-trips cleanly, and reports the rest", () => {
    // The inverse of the corruption: the stored characters read back as
    // Latin-1 bytes and decoded as UTF-8. Anything that throws, or that leaves
    // a control character behind, is left exactly as it is.
    expect(MIGRATION).toContain("convert_from(convert_to(");
    expect(MIGRATION).toContain("'latin1'");
    expect(MIGRATION).toContain("[[:cntrl:]]");
    expect(MIGRATION).toContain("raise notice");
    expect(MIGRATION).toContain("skipped");
  });

  it("records every changed row so the change is auditable and reversible", () => {
    expect(MIGRATION).toContain(
      "create table private.catalog_text_repairs_20260916"
    );
    expect(MIGRATION).toContain("before_value");
    expect(MIGRATION).toContain("after_value");
    expect(MIGRATION).toContain("row_id");
    expect(MIGRATION).toContain(
      "revoke all on private.catalog_text_repairs_20260916 from public, anon, authenticated, service_role"
    );
    expect(MIGRATION).toContain("enable row level security");
  });

  it("never deletes, never drops a catalogue object, and never touches the seal", () => {
    expect(RAW).not.toMatch(/\bdelete\s+from\b/i);
    expect(RAW).not.toMatch(/\btruncate\b/i);
    expect(RAW).not.toMatch(/\bdrop\s+table\b/i);
    expect(STATEMENTS).not.toMatch(/agent_catalog_effect_policy/i);
    // Only the named columns move; no column is added or retyped.
    expect(RAW).not.toMatch(/\balter\s+table\s+public\./i);
  });

  it("is idempotent because a repaired value no longer matches the signature", () => {
    expect(MIGRATION).toContain("agent_catalog_text_repair_idempotent");
    // The signature is built from chr() rather than typed, so the migration
    // file itself carries no control characters.
    expect(MIGRATION).toContain("chr(194)");
    expect(MIGRATION).toContain("chr(244)");
    expect(MIGRATION).toContain("chr(128)");
    expect(MIGRATION).toContain("chr(191)");
    // No escape sequence here on purpose: a test that typed a control
    // character to assert the absence of control characters would contain one.
    const controls = [...RAW].filter((character) => {
      const code = character.codePointAt(0)!;
      return (
        (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
        (code >= 0x7f && code <= 0x9f)
      );
    });
    expect(controls).toHaveLength(0);
  });
});
