import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_catalog_setup_write_variant.sql";
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

const POLICY_REVISION = "2026-09-15.catalog-setup-write.v1";
const MANIFEST_V28 = "2026-09-15.capability-manifest.v28";
const MANIFEST_V20 = "2026-09-04.capability-manifest.v20";
const CONSENT_V18 = "2026-09-15.mcp-consent-catalog.v18";
const CONSENT_V9 = "2026-09-04.mcp-consent-catalog.v9";
const EXPOSURE_V24 = "2026-09-15.mcp-exposure.v24";
const EXPOSURE_V23 = "2026-09-10.mcp-exposure.v23";

describe("catalogue setup writes staged behind operator approval", () => {
  it("ships exactly one transactional migration ordered after the V24 recipe read", () => {
    expect(migrationNames).toEqual([
      "20260916010000_agent_catalog_setup_write_variant.sql",
    ]);
    expect(migrationNames[0]! > "20260915224500").toBe(true);
    expect(MIGRATION.trimStart().startsWith("--")).toBe(true);
    expect(MIGRATION).toContain("\nbegin;\n");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
  });

  it("refuses to install without the writer it delegates to", () => {
    expect(MIGRATION).toContain("agent_catalog_setup_write_prerequisite_missing");
    expect(MIGRATION).toContain("public.catalog_setup_save(uuid,text,jsonb)");
    expect(MIGRATION).toContain("agent_catalog_setup_write_already_installed");
  });

  it("creates the one shared proposal table with a kind discriminator", () => {
    expect(MIGRATION).toContain("create table private.agent_catalog_setup_writes");
    for (const kind of [
      "create_variant",
      "set_thresholds",
      "set_pricing",
      "set_supplier_cost",
      "create_option",
    ]) {
      expect(MIGRATION).toContain(`'${kind}'`);
    }
    for (const column of [
      "kind text not null check",
      "family_id uuid not null",
      "pre_image_hash text not null",
      "payload jsonb not null",
      "input_hash text not null",
      "preview_hash text not null",
      "effect_sha256 text not null",
      "policy_revision text not null",
      "expires_at timestamptz not null",
      "committed_at timestamptz",
      "rejected_at timestamptz",
      "confirmation_id uuid unique",
      "commit_key text",
      "receipt jsonb",
    ]) {
      expect(MIGRATION).toContain(column);
    }
    expect(MIGRATION).toContain(
      "unique (company_id, actor_user_id, oauth_client_id, idempotency_key)"
    );
    expect(MIGRATION).toContain(
      "expires_at > created_at and expires_at <= created_at + interval '31 minutes'"
    );
  });

  it("forces row security and revokes the table from every app role", () => {
    expect(MIGRATION).toContain(
      "alter table private.agent_catalog_setup_writes enable row level security"
    );
    expect(MIGRATION).toContain(
      "alter table private.agent_catalog_setup_writes force row level security"
    );
    expect(MIGRATION).toContain(
      "revoke all on private.agent_catalog_setup_writes from public, anon, authenticated, service_role"
    );
    for (const index of ["grant", "company", "actor", "client", "family"]) {
      expect(MIGRATION).toContain(`agent_catalog_setup_writes_${index} on`);
    }
  });

  it("gates the queue row behind its own restrictive policies and reader", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_can_read"
    );
    expect(MIGRATION).toContain(
      "create function public.can_read_catalog_setup_write_action"
    );
    expect(MIGRATION).toContain(
      "create function public.filter_catalog_setup_write_actions_as_actor"
    );
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(MIGRATION).toContain(
        `create policy agent_catalog_setup_write_${operation} on public.agent_actions as restrictive`
      );
    }
    expect(MIGRATION).toContain("'approve_catalog_setup_write'");
    expect(MIGRATION).toContain(
      "grant execute on function public.can_read_catalog_setup_write_action(uuid, uuid) to anon, authenticated"
    );
    expect(MIGRATION).toContain(
      "grant execute on function public.filter_catalog_setup_write_actions_as_actor(uuid, uuid, uuid[]) to service_role"
    );
  });

  it("seals the effects it delegates to and activates nothing on merge", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_effect_revision"
    );
    expect(MIGRATION).toContain("'catalog_setup_save'");
    expect(MIGRATION).toContain("'catalog_supplier_cost_profile_save'");
    expect(MIGRATION).toContain("catalog_stock_unit_events");
    expect(MIGRATION).toContain("catalog_supplier_cost_profiles");
    expect(MIGRATION).toContain(POLICY_REVISION);
    expect(MIGRATION).toContain("catalog_setup_write_activation_required");
    expect(MIGRATION).toContain("catalog_setup_write_effect_policy_changed");
    expect(MIGRATION).toContain("agent_catalog_setup_write_must_not_activate");
    // W10: the migration must never seed the seal it checks for.
    expect(RAW).not.toMatch(/insert\s+into\s+private\.agent_catalog_effect_policy/i);
  });

  it("pins prepare authority to exposure V24 and manifest v28 alone", () => {
    expect(MIGRATION).toContain(
      "create function private.assert_agent_catalog_setup_write_authority"
    );
    expect(MIGRATION).toContain(
      `p_capability_manifest_revision is distinct from '${MANIFEST_V28}'`
    );
    expect(MIGRATION).toContain(
      `p_exposure_revision is distinct from '${EXPOSURE_V24}'`
    );
    expect(MIGRATION).toContain(
      "array['ops.catalog.prepare','ops.catalog.read']"
    );
    expect(MIGRATION).toContain(
      "array['agent.review','catalog.manage','catalog.products.view','catalog.view']"
    );
    expect(MIGRATION).toContain(`'${CONSENT_V18}'`);
    // The supplier-cost kind's extra scope is reserved now, not later.
    expect(MIGRATION).toContain("'prepare_set_supplier_cost' then array['ops.catalog_costs.read']");
  });

  it("exposes exactly one prepare, one commit and one reject, service_role only", () => {
    expect(MIGRATION).toContain(
      "create function public.prepare_catalog_setup_write_as_system"
    );
    expect(MIGRATION).toContain(
      "create function public.commit_catalog_setup_write_as_actor"
    );
    expect(MIGRATION).toContain(
      "create function public.reject_catalog_setup_write_as_actor"
    );
    expect(MIGRATION).toContain(
      "revoke all on function %i.%i(%s) from public,anon,authenticated,service_role"
    );
    expect(MIGRATION).toContain(
      "grant execute on function %i.%i(%s) to service_role"
    );
    expect(MIGRATION).toContain("auth.role() is distinct from 'service_role'");
  });

  it("commits through catalog_setup_save as the approving operator", () => {
    expect(MIGRATION).toContain("public.catalog_setup_save(");
    expect(MIGRATION).toContain("'agent-catalog-setup-write:' || p_change_set_id::text");
    expect(MIGRATION).toContain("set_config('request.jwt.claims'");
    expect(MIGRATION).toContain("set_config('request.jwt.claim.role'");
    expect(MIGRATION).toContain("set_config('request.jwt.claim.sub'");
    expect(MIGRATION).toContain("private.get_current_user_id() is distinct from p_actor_user_id");
    expect(MIGRATION).toContain("private.get_user_company_id() is distinct from p_company_id");
    expect(MIGRATION).toContain("catalog_setup_operator_identity_unavailable");
  });

  it("names every failure the repository maps", () => {
    for (const code of [
      "catalog_setup_write_input_invalid",
      "catalog_setup_write_idempotency_conflict",
      "catalog_setup_write_authority_revision_invalid",
      "catalog_setup_write_authority_stale_or_denied",
      "catalog_setup_write_grant_stale_or_denied",
      "catalog_setup_write_authority_denied",
      "catalog_setup_write_confirmation_invalid",
      "catalog_setup_write_confirmation_stale",
      "catalog_setup_write_record_not_found",
      "catalog_setup_write_action_conflict",
      "catalog_setup_write_already_committed",
      "catalog_setup_write_kind_unavailable",
      "catalog_setup_source_stale",
      "catalog_setup_save_blocked",
      "catalog_setup_readback_mismatch",
      "catalog_setup_variant_exists",
      "catalog_setup_price_required",
      "catalog_setup_option_coverage_invalid",
      "catalog_setup_option_value_invalid",
      "catalog_setup_thresholds_invalid",
      "catalog_setup_currency_mismatch",
      "catalog_setup_evidence_missing",
      "catalog_setup_evidence_invalid",
    ]) {
      expect(MIGRATION).toContain(`raise exception '${code}'`);
    }
  });

  it("records opening stock as a receive event and never nulls a live field", () => {
    expect(MIGRATION).toContain("'event_type', 'receive'");
    expect(MIGRATION).toContain("'stock_unit_client_id', 'agent_new_stock_unit'");
    expect(MIGRATION).toContain("'variant_client_id', 'agent_new_variant'");
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_payload"
    );
    expect(MIGRATION).toContain("'mode', 'edit'");
    // The payload names family_id and never a `family` object: naming one
    // would force is_active = true and deleted_at = null on the family row.
    const payloadBody = RAW.slice(
      RAW.indexOf("create function private.agent_catalog_setup_write_payload"),
      RAW.indexOf("create function private.agent_catalog_setup_variant_projection")
    );
    expect(payloadBody).toContain("'family_id'");
    expect(payloadBody).not.toContain("'family',");
    for (const field of [
      "'sku'",
      "'quantity'",
      "'price_override'",
      "'warning_threshold'",
      "'critical_threshold'",
      "'unit_id'",
      "'excluded'",
      "'option_value_ids'",
    ]) {
      expect(MIGRATION).toContain(field);
    }
  });

  it("adds a rate-limit policy of its own rather than widening the V19 trial", () => {
    expect(MIGRATION).toContain("mcp-catalog-setup-write-prepare:2026-09-15.v1");
    expect(MIGRATION).toContain(
      "create function public.consume_catalog_setup_write_prepare_rate_limit_as_system"
    );
    expect(MIGRATION).toContain("agent_mcp_rate_limit_buckets_policy_closed");
    // Every previously accepted policy id survives the CHECK rewrite.
    for (const policy of [
      "mcp-lightweight-read:2026-08-23.v1",
      "mcp-evidence-search:2026-08-23.v1",
      "mcp-day-closeout-prepare:2026-08-30.v1",
      "mcp-collections-prepare:2026-08-31.v1",
      "mcp-dispatch-confirmation-prepare:2026-09-03.v1",
      "mcp-customer-update-prepare:2026-09-04.v1",
      "mcp-schedule-change-prepare:2026-09-06.v1",
      "mcp-financial-document-prepare:2026-09-07.v1",
      "mcp-catalog-prepare:2026-09-08.v1",
      "mcp-site-visit-workflow:2026-09-10.v1",
    ]) {
      expect(MIGRATION).toContain(policy);
    }
    for (const capability of [
      "prepare_create_catalog_variant",
      "prepare_set_variant_thresholds",
      "prepare_set_catalog_pricing",
      "prepare_set_supplier_cost",
      "prepare_create_catalog_option",
    ]) {
      expect(MIGRATION).toContain(capability);
    }
  });

  it("teaches consent v18 and manifest v28 additively, keeping v9/v20 named", () => {
    expect(MIGRATION).toContain("agent_catalog_setup_write_anchor_drift");
    expect(MIGRATION).toContain("agent_catalog_setup_write_consent_postflight");
    expect(MIGRATION).toContain("agent_catalog_setup_write_manifest_postflight");
    for (const revision of [
      CONSENT_V18,
      CONSENT_V9,
      MANIFEST_V28,
      MANIFEST_V20,
      EXPOSURE_V24,
    ]) {
      expect(MIGRATION).toContain(revision.toLowerCase());
    }
    expect(MIGRATION).toContain(
      "prepare exact catalog changes for named operator approval in ops; never change stock or prices without that approval"
    );
    // The dark V19 catalogue-trial label keeps its exact bytes.
    expect(MIGRATION).toContain(
      "inspect source rows and prepare exact catalog changes for named operator approval in ops"
    );
    expect(MIGRATION).toContain(EXPOSURE_V23);
  });

  it("dispatches one kind today and documents where the other four attach", () => {
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_compile_create_variant"
    );
    expect(MIGRATION).toContain(
      "create function private.agent_catalog_setup_write_compile"
    );
    expect(MIGRATION).toContain("adding a later kind");
    expect(MIGRATION).toContain("agent_catalog_setup_compile_<kind>");
  });
});
