import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260727103300_external_lead_projection.sql"
);
const source = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8").toLowerCase()
  : "";
const contractPath = resolve(
  process.cwd(),
  "tests/sql/external-lead-projection-contract.sql"
);
const contract = existsSync(contractPath)
  ? readFileSync(contractPath, "utf8").toLowerCase()
  : "";

describe("external lead projection migration", () => {
  it("extends the existing handle/version/baseline foundation", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(source).not.toContain("create table private.external_lead_handles");
    expect(source).not.toContain(
      "create table private.external_lead_projection_versions"
    );
    expect(source).toContain("refresh_external_lead_projection_as_system");
    expect(source).toContain("build_external_lead_public_projection");
    expect(source).toContain("projection_schema_version");
  });

  it("uses the production UUID project mirrors without text parsing", () => {
    expect(source).toMatch(
      /select coalesce\(\s*opportunity\.project_ref,\s*opportunity\.project_id\s*\)/
    );
    expect(source).not.toContain(
      "private.try_parse_uuid(opportunity.project_id)"
    );
  });

  it("covers every externally visible dependency with same-transaction triggers", () => {
    for (const dependency of [
      "opportunities",
      "external_lead_lifecycle_facts",
      "external_lead_source_projections",
      "opportunity_dispositions",
      "projects",
      "invoices",
      "payments",
    ]) {
      expect(source).toContain(dependency);
    }
    expect(source).toContain("external_lead_projection_on_opportunity");
    expect(source).toContain("external_lead_projection_on_lifecycle");
    expect(source).toContain("external_lead_projection_on_project");
    expect(source).toContain("external_lead_projection_on_invoice");
    expect(source).toContain("external_lead_projection_on_payment");
  });

  it("reads shared trigger identifiers through a table-neutral JSON row", () => {
    expect(source).toContain("v_dependency_row jsonb");
    expect(source).toMatch(
      /v_dependency_row := case when tg_op = 'delete'\s+then to_jsonb\(old\) else to_jsonb\(new\) end/
    );
    expect(source).toMatch(
      /v_dependency_row ->> 'opportunity_id'[\s\S]*?v_dependency_row ->> 'id'/
    );
  });

  it("keeps raw attribution and internal identifiers out of public payloads", () => {
    expect(source).toContain("external_lead_projection_public_allowlist");
    expect(source).toContain("normalized_source_projection");
    expect(source).not.toMatch(
      /public_projection[\s\S]{0,500}(contact_email|contact_phone|assigned_to|storage_object_key)/
    );
    expect(source).toContain("'operation', 'deletion'");
    expect(source).toContain("'operation', 'merge'");
  });

  it("adds a leased, resumable, verification-gated backfill", () => {
    expect(source).toContain(
      "create table private.external_lead_projection_backfill_runs"
    );
    for (const command of [
      "inspect_external_lead_projection_backfill_as_system",
      "start_external_lead_projection_backfill_as_system",
      "claim_external_lead_projection_backfill_as_system",
      "process_external_lead_projection_backfill_as_system",
      "verify_external_lead_projection_backfill_as_system",
    ]) {
      expect(source).toContain(command);
      expect(source).toMatch(
        new RegExp(
          `grant execute on function public\\.${command}[\\s\\S]*?to service_role`
        )
      );
    }
    expect(source).toContain("for update skip locked");
    expect(source).toContain("lease_generation");
    expect(source).toContain("lease_token");
    expect(source).toContain("business_row_checksum");
  });

  it("retains current baselines and prunes only old incremental versions", () => {
    expect(source).toContain("interval '30 days'");
    expect(source).toContain("external_lead_projection_baselines");
    expect(source).toContain(
      "prune_external_lead_projection_versions_as_system"
    );
  });

  it("ships a rollback-only executable contract", () => {
    expect(existsSync(contractPath)).toBe(true);
    expect(contract).toContain("stable_public_handle");
    expect(contract).toContain("company_monotonic_sequence");
    expect(contract).toContain("projection_dependency_refresh");
    expect(contract).toContain("ops_external_api_sql_contract_pass");
    expect(contract.trimEnd()).toMatch(/rollback;$/);
  });
});
