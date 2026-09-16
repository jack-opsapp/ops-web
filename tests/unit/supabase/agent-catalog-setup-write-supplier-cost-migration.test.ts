import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_supplier_cost.sql";
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

function section(from: string, to: string) {
  const start = RAW.indexOf(from);
  const end = RAW.indexOf(to);
  expect(start, from).toBeGreaterThan(-1);
  expect(end, to).toBeGreaterThan(start);
  return RAW.slice(start, end);
}

describe("supplier cost as a catalogue setup write kind", () => {
  it("ships one transactional migration ordered after the first three kinds", () => {
    expect(migrationNames).toEqual([
      "20260916040000_agent_catalog_setup_write_supplier_cost.sql",
    ]);
    expect(migrationNames[0]! > "20260916030000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the spine it extends, or twice", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_prerequisite_missing"
    );
    expect(MIGRATION).toContain("private.agent_catalog_setup_write_apply(");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_already_installed"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_kind_not_accepted"
    );
    // The spine reserved this kind's extra scope; assert it, never widen it.
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_scope_not_reserved"
    );
    expect(RAW).not.toMatch(
      /alter\s+table\s+private\.agent_catalog_setup_writes/i
    );
    expect(RAW).not.toMatch(
      /alter\s+table\s+public\.catalog_supplier_cost_profiles/i
    );
  });

  it("keeps one default per variant, demoting before it writes", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_index_missing"
    );
    expect(MIGRATION).toContain("catalog_setup_default_required");
    const writer = section(
      "create function private.catalog_supplier_cost_profile_save",
      "-- ── Kind 4: set_supplier_cost"
    );
    // The demote must come first in the text as well as in intent: the partial
    // unique index is enforced per statement.
    const demote = writer.indexOf("set is_default = false");
    const upsert = writer.indexOf(
      "insert into public.catalog_supplier_cost_profiles("
    );
    expect(demote).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(demote);
    // A soft-deleted row is revived, never re-inserted around the constraint.
    expect(writer).toContain("deleted_at = null");
  });

  it("mirrors the default's cost onto the variant's own cost field", () => {
    const writer = section(
      "create function private.catalog_supplier_cost_profile_save",
      "-- ── Kind 4: set_supplier_cost"
    );
    expect(writer).toContain("update public.catalog_variants");
    expect(writer).toContain("unit_cost_override");
    expect(writer).toContain("trim_scale");
    expect(MIGRATION).toContain("variant_unit_cost_mirrored");
  });

  it("is sealed like every other function in this vertical", () => {
    const writer = section(
      "create function private.catalog_supplier_cost_profile_save",
      "-- ── Kind 4: set_supplier_cost"
    );
    expect(writer).toContain("security definer");
    expect(writer).toContain("set search_path = ''");
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain("has_function_privilege");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_writer_reachable"
    );
    expect(MIGRATION).toContain(
      "array['public','anon','authenticated','service_role']"
    );
    // The spine already named this writer in the seal; it must still be there.
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_seal_incomplete"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_must_not_activate"
    );
    expect(RAW).not.toMatch(
      /insert\s+into\s+private\.agent_catalog_effect_policy/i
    );
  });

  it("stamps provenance the caller cannot forge", () => {
    expect(MIGRATION).toContain("'recorded_by', 'mcp'");
    expect(MIGRATION).toContain("catalog_setup_profile_provenance_missing");
    // The projection hides the server block, which is also what lets the
    // read-back compare a commit-time timestamp for equality.
    expect(MIGRATION).toContain("source - 'ops'");
  });

  it("widens the family pre-image to what this kind can move", () => {
    const state = section(
      "create or replace function private.agent_catalog_setup_family_state",
      "-- ── Supplier cost projection"
    );
    expect(state).toContain("'activation_rule', profile_row.activation_rule");
    expect(state).toContain("'deleted', profile_row.deleted_at is not null");
    // The thresholds migration's byte-identity guarantee must survive.
    expect(state).toContain("price_override_exact");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_pre_image_incomplete"
    );
  });

  it("withholds a row's text rather than refusing the whole cost sheet", () => {
    const projection = section(
      "create function private.agent_catalog_setup_supplier_cost_projection",
      "-- ── The narrow writer for supplier cost profiles"
    );
    expect(projection).toContain("agent_prompt_text_is_safe");
    expect(projection).toContain("'label', null");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_unreadable_text_unhandled"
    );
    // And the caller can never add to the problem.
    const compile = section(
      "create function private.agent_catalog_setup_compile_set_supplier_cost",
      "-- ── Dispatch"
    );
    expect(compile).toContain(
      "private.agent_prompt_text_is_safe(v_label, true)"
    );
  });

  it("keeps the operator notification free of the cost figure", () => {
    expect(MIGRATION).toContain(
      "review a supplier cost change on this catalog item."
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_supplier_cost_notice_leaks_cost"
    );
  });

  it("adds its compile, dispatch, read-back and writer branches", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_compile_set_supplier_cost"
    );
    expect(MIGRATION).toContain(
      "return private.agent_catalog_setup_compile_set_supplier_cost(p_company, p_actor, p_request)"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_readback"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_apply"
    );
    expect(MIGRATION).toContain("private.catalog_supplier_cost_profile_save(");
    expect(MIGRATION).toContain("adding the last kind");
  });
});
