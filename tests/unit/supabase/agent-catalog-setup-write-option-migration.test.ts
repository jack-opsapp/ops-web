import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_option.sql";
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

describe("create option as a catalogue setup write kind", () => {
  it("ships one transactional migration ordered after the first four kinds", () => {
    expect(migrationNames).toEqual([
      "20260916050000_agent_catalog_setup_write_option.sql",
    ]);
    expect(migrationNames[0]! > "20260916040000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the spine it extends, or twice", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_option_prerequisite_missing"
    );
    expect(MIGRATION).toContain("private.agent_catalog_setup_write_apply(");
    expect(MIGRATION).toContain("private.agent_catalog_setup_value_labels(");
    expect(MIGRATION).toContain("agent_catalog_setup_option_already_installed");
    expect(MIGRATION).toContain("agent_catalog_setup_option_kind_not_accepted");
    // The spine reserved this kind with no extra scope; assert, never widen.
    expect(MIGRATION).toContain("agent_catalog_setup_option_scope_not_reserved");
    expect(RAW).not.toMatch(
      /alter\s+table\s+private\.agent_catalog_setup_writes/i
    );
    expect(RAW).not.toMatch(/alter\s+table\s+public\.catalog_options/i);
  });

  it("brings no writer of its own: the wizard's save path carries this kind", () => {
    // Every table this kind touches is in catalog_setup_save, so it goes
    // through the same path as the first two kinds and adds no sealed writer.
    expect(MIGRATION).toContain(
      "p_write.kind in ('create_variant', 'set_thresholds', 'create_option')"
    );
    expect(RAW).not.toMatch(/create\s+function\s+private\.catalog_\w+_save/i);
    expect(MIGRATION).toContain("agent_catalog_setup_option_writer_added");
  });

  it("sends every existing variant's whole value set, because the save function dedupes on it", () => {
    const compile = section(
      "create function private.agent_catalog_setup_compile_create_option",
      "-- ── Dispatch"
    );
    // catalog_setup_save groups variants by their option_value_client_ids and
    // refuses a draft with two identical signatures, so a backfill that sent
    // only the new value would give every variant the same one-element
    // signature and be blocked as matrix_signature_conflict.
    expect(compile).toContain("'option_value_client_ids'");
    // The raw id list is removed from each variant doc, not sent beside the
    // client ids: two lists would write every join twice.
    expect(compile).toContain("- 'option_value_ids'");
    expect(compile).toContain("matrix_signature_conflict");
    // An existing value can only be named in that list if the payload declares
    // a client id for it; the row's own id is the stable choice.
    expect(compile).toContain("'client_id'");
  });

  it("refuses a family whose variants cannot be told apart", () => {
    expect(MIGRATION).toContain("catalog_setup_variant_set_ambiguous");
  });

  it("requires the backfill value exactly when there is something to backfill", () => {
    const compile = section(
      "create function private.agent_catalog_setup_compile_create_option",
      "-- ── Dispatch"
    );
    expect(compile).toContain("CATALOG_SETUP_BACKFILL_VALUE_INVALID");
    expect(compile).toContain("CATALOG_SETUP_OPTION_EXISTS");
    expect(compile).toContain("CATALOG_SETUP_OPTION_VALUES_DUPLICATE");
    expect(compile).toContain("CATALOG_SETUP_AFFECTED_VARIANTS_TOO_MANY");
    expect(compile).toContain("value_for_existing_variants");
    // The catalogue's own convention is 10 / 20 / 30.
    expect(compile).toContain("+ 10");
  });

  it("asks for no authority the spine did not already ask for", () => {
    // Options, values and joins are written through catalog_setup_save as the
    // approving operator, against tables whose policies name no setup key — so
    // the compile makes no permission check of its own, unlike the money kinds.
    const compile = section(
      "create function private.agent_catalog_setup_compile_create_option",
      "-- \u2500\u2500 Dispatch"
    );
    expect(compile).not.toContain("has_permission");
    expect(compile).not.toContain("run_setup");
    expect(MIGRATION).toContain("agent_catalog_setup_option_authority_widened");
  });

  it("predicts a created row without an id and proves it against the id map", () => {
    const readback = section(
      "create or replace function private.agent_catalog_setup_write_readback",
      "-- ── Operator notice"
    );
    expect(readback).toContain("agent_new_option");
    expect(readback).toContain("agent_new_option_value_");
    expect(readback).toContain("- 'state'");
    expect(readback).toContain("CATALOG_SETUP_READBACK_MISMATCH");
  });

  it("names the new dimension in the operator's notice without naming its values", () => {
    expect(MIGRATION).toContain(
      "review the new option and the value every variant on file gets."
    );
    expect(MIGRATION).toContain("agent_catalog_setup_option_operation_missing");
  });

  it("is sealed like every other function in this vertical and activates nothing", () => {
    const projection = section(
      "create function private.agent_catalog_setup_option_projection",
      "-- ── Kind 5: create_option"
    );
    expect(projection).toContain("security definer");
    expect(projection).toContain("set search_path = ''");
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain("agent_catalog_setup_option_must_not_activate");
    expect(RAW).not.toMatch(
      /insert\s+into\s+private\.agent_catalog_effect_policy/i
    );
    expect(RAW).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("adds its compile, dispatch and read-back branches", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_compile_create_option"
    );
    expect(MIGRATION).toContain(
      "return private.agent_catalog_setup_compile_create_option(p_company, p_actor, p_request)"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_readback"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_kind_notice"
    );
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_option_projection"
    );
    expect(MIGRATION).toContain("the last of the five kinds");
  });
});
