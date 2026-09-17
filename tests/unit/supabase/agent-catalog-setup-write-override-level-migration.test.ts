import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_override_level.sql";
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

/** One definition's text, from its CREATE line to its closing `end $$;`. */
function body(signatureStart: string) {
  const start = RAW.indexOf(signatureStart);
  expect(start, signatureStart).toBeGreaterThan(-1);
  const end = RAW.indexOf("\n$$;\n", start);
  const plpgsqlEnd = RAW.indexOf("\nend $$;\n", start);
  const close = [end, plpgsqlEnd]
    .filter((index) => index > -1)
    .reduce((first, index) => Math.min(first, index));
  return RAW.slice(start, close);
}

const REPLACED = [
  "private.agent_catalog_setup_variant_projection",
  "private.agent_catalog_setup_compile_create_variant",
  "private.agent_catalog_setup_compile_set_thresholds",
  "private.agent_catalog_setup_pricing_projection",
  "private.agent_catalog_setup_compile_set_pricing",
  "private.agent_catalog_setup_supplier_cost_projection",
  "private.catalog_supplier_cost_profile_save",
  "private.agent_catalog_setup_compile_set_supplier_cost",
  "public.commit_catalog_setup_write_as_actor",
] as const;

const CREATED = [
  "private.agent_catalog_setup_override_for",
  "private.agent_catalog_setup_amount_level",
  "private.agent_catalog_setup_override_level_changes",
] as const;

describe("catalogue writes never change the level a value resolves at", () => {
  it("ships one transactional migration ordered after the cost re-alignment", () => {
    expect(migrationNames).toEqual([
      "20260916090000_agent_catalog_setup_write_override_level.sql",
    ]);
    expect(migrationNames[0]! > "20260916080000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION).toContain("set local lock_timeout = '5s';");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install over anything but the exact bodies production shipped", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_override_level_prerequisite_missing"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_override_level_already_installed"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_override_level_source_drift"
    );
    // Every replaced body and every body relied on, pinned to the fingerprint
    // the release runbook recorded for production.
    for (const [signature, fingerprint] of [
      ["private.agent_catalog_setup_variant_projection(uuid,uuid,uuid)", "41e5b7f216fabf9947e12ab07b9f30be"],
      ["private.agent_catalog_setup_compile_create_variant(uuid,uuid,jsonb)", "6cd327573d82f71b5aed5658c15e05e0"],
      ["private.agent_catalog_setup_compile_set_thresholds(uuid,uuid,jsonb)", "20a0c7e406051f638dd0ba27ca66a546"],
      ["private.agent_catalog_setup_pricing_projection(uuid,uuid,text,uuid,uuid[])", "be04f362f89aef524f3b4ede3799826c"],
      ["private.agent_catalog_setup_compile_set_pricing(uuid,uuid,jsonb)", "d637920c83e3bf53d1a421e425ea5755"],
      ["private.agent_catalog_setup_supplier_cost_projection(uuid,uuid,uuid)", "9734dded044596743922079724600b69"],
      ["private.catalog_supplier_cost_profile_save(uuid,uuid,uuid,jsonb,text)", "055e527e7b0534c390c08158cd7d9b09"],
      ["private.agent_catalog_setup_compile_set_supplier_cost(uuid,uuid,jsonb)", "adfdd78019b3f27f8b4601aa0d4102b2"],
      ["public.commit_catalog_setup_write_as_actor(uuid,uuid,uuid,uuid,text,text)", "e515d98f1e3d761539e2f259f99a12b9"],
      ["public.catalog_setup_save(uuid,text,jsonb)", "f5c4630d0282d999b5b691c22b63d84a"],
      ["private.agent_catalog_setup_write_readback(private.agent_catalog_setup_writes,jsonb)", "ad8f149143d8a48b8d88253eb2dbb3e1"],
      ["private.agent_catalog_setup_write_apply(private.agent_catalog_setup_writes)", "f5fabc043b7f97e8dec7d614c03c2ac2"],
      ["private.agent_catalog_setup_write_payload(jsonb)", "80e79a55e0c77b0e095d1ec7fceb4f08"],
      ["private.agent_catalog_setup_family_state(uuid,uuid,boolean)", "bb1586bd33ff5f60ca831b8c8b6f11d2"],
      ["private.agent_catalog_setup_threshold_level(numeric,numeric,numeric)", "78e299f25fa95bd6e7116e96d7ec515b"],
      ["private.agent_catalog_setup_threshold_projection(uuid,uuid,uuid)", "8590f95ca81b266f6e1dec4ecbfcd05f"],
      ["private.agent_catalog_setup_write_effect_revision()", "a56dcc88d2f1a917d48833066bd6eb32"],
    ] as const) {
      expect(RAW, signature).toContain(`('${signature}', '${fingerprint}')`);
    }
  });

  it("replaces exactly the nine bodies it names and creates exactly three", () => {
    for (const name of REPLACED) {
      expect(RAW, name).toContain(`create or replace function ${name}(`);
    }
    for (const name of CREATED) {
      expect(RAW, name).toContain(`create function ${name}(`);
    }
    expect(RAW.split("create or replace function ").length - 1).toBe(9);
    expect(RAW.split(/\ncreate function /).length - 1).toBe(3);
    // catalog_setup_save, the readback and the writer dispatcher stay as they are.
    for (const untouched of [
      "public.catalog_setup_save",
      "private.agent_catalog_setup_write_readback",
      "private.agent_catalog_setup_write_apply",
      "private.agent_catalog_setup_write_payload",
      "private.agent_catalog_setup_family_state",
      "private.agent_catalog_setup_write_effect_revision",
      "private.catalog_family_default_price_save",
    ]) {
      expect(MIGRATION, untouched).not.toContain(`function ${untouched}(`);
    }
    // No schema moves, and no row moves: the seal table is read, never written.
    for (const forbidden of [
      "create table",
      "alter table",
      "drop function",
      "insert into private.agent_catalog_effect_policy",
      "update private.agent_catalog_effect_policy",
      "delete from private.agent_catalog_effect_policy",
      "update public.catalog_items",
    ]) {
      expect(MIGRATION, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps the rule in one function and routes every mirroring writer through it", () => {
    const rule = body("create function private.agent_catalog_setup_override_for(");
    // Numeric equality, never text: 15 and 15.0000 are the same answer.
    expect(rule).toContain("p_requested = p_inherited then null");
    expect(rule).toContain("else p_requested end");
    for (const writer of [
      "create or replace function private.agent_catalog_setup_compile_create_variant(",
      "create or replace function private.agent_catalog_setup_compile_set_thresholds(",
      "create or replace function private.agent_catalog_setup_compile_set_pricing(",
      "create or replace function private.agent_catalog_setup_compile_set_supplier_cost(",
      "create or replace function private.catalog_supplier_cost_profile_save(",
    ]) {
      expect(body(writer), writer).toContain(
        "private.agent_catalog_setup_override_for("
      );
    }
  });

  it("removes the pinning behaviour from set_pricing along with the comment that defended it", () => {
    const pricing = body(
      "create or replace function private.agent_catalog_setup_compile_set_pricing("
    );
    expect(pricing).not.toContain("pinning a variant to the price it already");
    expect(pricing).not.toContain(
      "to_jsonb(private.agent_catalog_setup_exact(v_new_price))"
    );
    expect(pricing).toContain(
      "to_jsonb(private.agent_catalog_setup_exact(v_override))"
    );
    expect(pricing).toContain("v_shadowing > 128");
    const projection = body(
      "create or replace function private.agent_catalog_setup_pricing_projection("
    );
    expect(projection).toContain("'shadowing_variants'");
    expect(projection).toContain("'redundant'");
    expect(projection).toContain("variant_row.price_override is not null");
  });

  it("aims the supplier-cost mirror at the family's level and never writes the family cost", () => {
    const writer = body(
      "create or replace function private.catalog_supplier_cost_profile_save("
    );
    expect(writer).toContain("select family.default_unit_cost into v_family_cost");
    expect(writer).toContain(
      "set unit_cost_override = private.agent_catalog_setup_override_for(\n             pg_catalog.trim_scale(v_default_cost), v_family_cost)"
    );
    expect(writer.toLowerCase()).not.toMatch(/update\s+public\.catalog_items/);
    const compile = body(
      "create or replace function private.agent_catalog_setup_compile_set_supplier_cost("
    );
    expect(compile).toContain(
      "private.agent_catalog_setup_override_for(v_new_default_cost, v_family_cost)"
    );
    expect(compile).toContain(
      "'variant_unit_cost', private.agent_catalog_setup_amount_level(v_after_cost, v_family_cost)"
    );
  });

  it("shows the level on both sides of every proposal that shows one of these fields", () => {
    const projection = body(
      "create or replace function private.agent_catalog_setup_variant_projection("
    );
    expect(projection).not.toContain("'sale_price_source'");
    expect(projection).toContain("'sale_price', private.agent_catalog_setup_amount_level(");
    expect(projection).toContain("'unit_cost', private.agent_catalog_setup_amount_level(");
    expect(projection).toContain(
      "'warning_threshold', private.agent_catalog_setup_threshold_level("
    );
    const create = body(
      "create or replace function private.agent_catalog_setup_compile_create_variant("
    );
    expect(create).not.toContain("'sale_price_source'");
    expect(create).toContain("'price_override', private.agent_catalog_setup_money(v_price_override)");
    const cost = body(
      "create or replace function private.agent_catalog_setup_supplier_cost_projection("
    );
    expect(cost).toContain(
      "'variant_unit_cost', private.agent_catalog_setup_amount_level("
    );
  });

  it("keeps the money-precision guard the replaced compile bodies already carried", () => {
    for (const name of [
      "create or replace function private.agent_catalog_setup_compile_create_variant(",
      "create or replace function private.agent_catalog_setup_compile_set_pricing(",
      "create or replace function private.agent_catalog_setup_compile_set_supplier_cost(",
    ]) {
      expect(body(name), name).toContain("CATALOG_SETUP_MONEY_PRECISION_INVALID");
    }
  });

  it("guards the commit: snapshot before the write, refusal after it, before the read-back", () => {
    const commit = body(
      "create or replace function public.commit_catalog_setup_write_as_actor("
    );
    const snapshot = commit.indexOf("into v_levels_before");
    const apply = commit.indexOf("v_save := private.agent_catalog_setup_write_apply(v_write);");
    const guard = commit.indexOf(
      "private.agent_catalog_setup_override_level_changes("
    );
    const readback = commit.indexOf("private.agent_catalog_setup_write_readback(");
    expect(snapshot).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(snapshot);
    expect(guard).toBeGreaterThan(apply);
    expect(readback).toBeGreaterThan(guard);
    expect(commit).toContain(
      "raise exception 'CATALOG_SETUP_OVERRIDE_LEVEL_CHANGED' using errcode = '55000'"
    );
    const changes = body(
      "create function private.agent_catalog_setup_override_level_changes("
    );
    // A new variant counts as changed from NULL; an untouched redundant
    // override does not count at all.
    expect(changes).toContain("left join prior on prior.id = live.id");
    for (const field of [
      "price_override",
      "unit_cost_override",
      "warning_threshold",
      "critical_threshold",
      "unit_id",
    ]) {
      expect(changes, field).toContain(
        `where live.${field} is distinct from prior.${field}`
      );
    }
    expect(changes).toContain("category.default_warning_threshold");
  });

  it("restates the grants and proves in its postflight that the tools fail closed", () => {
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain(
      "grant execute on function %i.%i(%s) to service_role"
    );
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_executable");
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_posture_lost");
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_incomplete: % of 12");
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_guard_missing");
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_rule_bypassed");
    expect(MIGRATION).toContain("agent_catalog_setup_override_level_effect_unmoved");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_override_level_seal_still_matches"
    );
    expect(MIGRATION).toContain(
      "where revision = '2026-09-15.catalog-setup-write.v1'\n      and effect_sha256 = v_effect_after"
    );
  });
});
