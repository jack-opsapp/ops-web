import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_thresholds.sql";
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

describe("variant thresholds as a catalogue setup write kind", () => {
  it("ships one transactional migration ordered after the spine", () => {
    expect(migrationNames).toEqual([
      "20260916020000_agent_catalog_setup_write_thresholds.sql",
    ]);
    expect(migrationNames[0]! > "20260916010000").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the spine it extends, or twice", () => {
    expect(MIGRATION).toContain(
      "agent_catalog_setup_thresholds_prerequisite_missing"
    );
    expect(MIGRATION).toContain(
      "public.prepare_catalog_setup_write_as_system("
    );
    expect(MIGRATION).toContain("private.agent_catalog_setup_write_compile(");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_thresholds_already_installed"
    );
    // The spine's kind CHECK already names this kind; assert, never widen.
    expect(MIGRATION).toContain(
      "agent_catalog_setup_thresholds_kind_not_accepted"
    );
    expect(RAW).not.toMatch(
      /alter\s+table\s+private\.agent_catalog_setup_writes/i
    );
  });

  it("adds the compile, its dispatch branch and nothing else per kind", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_compile_set_thresholds"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_compile"
    );
    expect(MIGRATION).toContain(
      "return private.agent_catalog_setup_compile_create_variant(p_company, p_actor, p_request)"
    );
    expect(MIGRATION).toContain(
      "return private.agent_catalog_setup_compile_set_thresholds(p_company, p_actor, p_request)"
    );
    expect(MIGRATION).toContain("adding a later kind");
  });

  it("makes the prepare and the commit kind-agnostic instead of adding a second one", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_kind_operation"
    );
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_kind_notice"
    );
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_readback"
    );
    expect(MIGRATION).toContain(
      "create or replace function public.prepare_catalog_setup_write_as_system"
    );
    expect(MIGRATION).toContain(
      "create or replace function public.commit_catalog_setup_write_as_actor"
    );
    // The replaced prepare and commit must no longer name one kind inline.
    expect(MIGRATION).toContain("agent_catalog_setup_thresholds_kind_leak");
    const commitBody = RAW.slice(
      RAW.indexOf(
        "create or replace function public.commit_catalog_setup_write_as_actor"
      ),
      RAW.indexOf("-- ── Grants ")
    );
    expect(commitBody).not.toContain("agent_new_variant");
    expect(commitBody).toContain(
      "private.agent_catalog_setup_write_readback(v_write, v_save)"
    );
    // The write still goes through the wizard's own save, as the operator.
    expect(commitBody).toContain("public.catalog_setup_save(");
    expect(commitBody).toContain("set_config('request.jwt.claim.sub'");
  });

  it("reports the same fallback ladder get_catalog_item reports", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_threshold_projection"
    );
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_threshold_level"
    );
    for (const origin of ["'variant'", "'family'", "'category'", "'none'"]) {
      expect(MIGRATION).toContain(origin);
    }
    expect(MIGRATION).toContain("coalesce(p_variant, p_family, p_category)");
    expect(MIGRATION).toContain("default_warning_threshold");
    expect(MIGRATION).toContain("default_critical_threshold");
    // The category default only counts when it is this company's live category.
    expect(MIGRATION).toContain("category.company_id = p_company");
    expect(MIGRATION).toContain("category.deleted_at is null");
  });

  it("keeps whole units honest in both directions", () => {
    expect(MIGRATION).toContain("private.agent_catalog_setup_whole(v_value)");
    expect(MIGRATION).toContain(
      "raise exception 'catalog_setup_thresholds_not_whole'"
    );
    expect(MIGRATION).toContain("'^(0|[1-9][0-9]{0,8})$'");
  });

  it("names every refusal the repository maps for this kind", () => {
    for (const code of [
      "catalog_setup_write_input_invalid",
      "catalog_setup_evidence_missing",
      "catalog_setup_evidence_invalid",
      "catalog_setup_variant_not_found",
      "catalog_setup_family_not_found",
      "catalog_setup_thresholds_invalid",
      "catalog_setup_thresholds_not_whole",
      "catalog_setup_no_change",
      "catalog_setup_source_stale",
      "catalog_setup_readback_mismatch",
      "catalog_setup_write_kind_unavailable",
    ]) {
      expect(MIGRATION).toContain(`raise exception '${code}'`);
    }
  });

  it("changes only the target variant's two threshold fields in the payload", () => {
    expect(MIGRATION).toContain(
      "private.agent_catalog_setup_write_payload(v_state)"
    );
    expect(MIGRATION).toContain("'warning_threshold',");
    expect(MIGRATION).toContain("'critical_threshold',");
    expect(MIGRATION).toContain("variant_doc.value->>'id' = v_variant::text");
    expect(MIGRATION).toContain("else variant_doc.value end");
    // Exactly one variant in the family's document may match the target.
    expect(MIGRATION).toContain("v_matches is distinct from 1");
  });

  it("re-sends a price the operator did not change exactly as it is stored", () => {
    // catalog_setup_save replaces a variant row from its document, so every
    // sibling's price is re-sent. The 4-decimal money projection is the same
    // number but not the same numeric: 200 came back as 200.0000.
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_family_state"
    );
    expect(MIGRATION).toContain(
      "create or replace function private.agent_catalog_setup_write_payload"
    );
    expect(MIGRATION).toContain(
      "'price_override_exact', variant_row.price_override::text"
    );
    expect(MIGRATION).toContain(
      "'price_override', variant_doc.value->'price_override_exact'"
    );
    expect(MIGRATION).toContain(
      "agent_catalog_setup_thresholds_price_scale_leak"
    );
    // The replaced payload still names no family object: naming one would force
    // is_active = true and deleted_at = null on the family row.
    const payloadBody = RAW.slice(
      RAW.indexOf(
        "create or replace function private.agent_catalog_setup_write_payload"
      ),
      RAW.indexOf("-- ── Threshold projection ")
    );
    expect(payloadBody).toContain("'family_id'");
    expect(payloadBody).not.toContain("'family',");
  });

  it("counts only what it does, and activates nothing on merge", () => {
    expect(MIGRATION).toContain("'variants_updated', 1");
    expect(MIGRATION).toContain("'thresholds_changed', v_changed");
    expect(MIGRATION).toContain("'stock_events_recorded', 0");
    expect(MIGRATION).toContain("'prices_changed', 0");
    expect(MIGRATION).toContain("'messages_sent', 0");
    expect(MIGRATION).toContain("'accounting_sync_enqueued', 0");
    expect(MIGRATION).toContain(
      "agent_catalog_setup_thresholds_must_not_activate"
    );
    expect(RAW).not.toMatch(
      /insert\s+into\s+private\.agent_catalog_effect_policy/i
    );
    // Installing a kind moves the effect revision on purpose.
    expect(MIGRATION).toContain("changes the effect revision");
  });

  it("revokes every new function from the app roles", () => {
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain(
      "grant execute on function %i.%i(%s) to service_role"
    );
    for (const name of [
      "agent_catalog_setup_threshold_level",
      "agent_catalog_setup_threshold_projection",
      "agent_catalog_setup_compile_set_thresholds",
      "agent_catalog_setup_write_readback",
      "agent_catalog_setup_write_kind_operation",
      "agent_catalog_setup_write_kind_notice",
    ]) {
      expect(MIGRATION).toContain(`'${name}'`);
    }
  });
});
