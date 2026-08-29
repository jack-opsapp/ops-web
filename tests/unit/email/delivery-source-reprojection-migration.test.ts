import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CORRESPONDENCE_NORMALIZATION_REVISION } from "@/lib/agent-control-plane/evidence/normalize-correspondence";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260830113400_delivery_source_normalization_reprojection.sql"
);
const contractPath = resolve(
  process.cwd(),
  "tests/sql/delivery-source-reprojection-contract.sql"
);
const normalizerPath = resolve(
  process.cwd(),
  "src/lib/agent-control-plane/evidence/normalize-correspondence.ts"
);
const ciWorkflowPath = resolve(process.cwd(), ".github/workflows/ci.yml");

const REVISION_V1 = "ops.correspondence.normalized-text.v1";
const REVISION_V2 = "ops.correspondence.normalized-text.v2";

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

/** Executable SQL only — rationale lives in comments and must not be asserted. */
function migrationStatements(): string {
  return migration()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function contract(): string {
  return readFileSync(contractPath, "utf8");
}

/** Executable SQL only — the contract's narration lives in comments. */
function contractStatements(): string {
  return contract()
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("delivery-source normalization revision", () => {
  it("carries the bumped revision the re-normalization writes", () => {
    expect(CORRESPONDENCE_NORMALIZATION_REVISION).toBe(REVISION_V2);
  });

  it("replaces the do-not-bump note with the ordering the bump now requires", () => {
    const source = readFileSync(normalizerPath, "utf8").replace(/\s+/g, " ");

    expect(source).not.toMatch(/DO NOT BUMP THIS/i);
    expect(source).toMatch(
      /20260830113400_delivery_source_normalization_reprojection\.sql/
    );
    // The CHECK is the coupling: the migration must be applied before code
    // writing this constant is deployed.
    expect(source).toMatch(/CHECK/);
    expect(source).toMatch(/APPLIED BEFORE code[^.]*is deployed/i);
  });

  it("keeps the widened CHECK and the constant in lockstep", () => {
    const sql = migrationStatements();

    expect(sql).toContain(`'${CORRESPONDENCE_NORMALIZATION_REVISION}'`);
    // Additive: rows already stamped v1 stay valid until the backfill moves
    // them, and deployed code writing v1 keeps capturing.
    expect(sql).toContain(`'${REVISION_V1}'`);
  });
});

describe("delivery-source normalization re-projection migration", () => {
  it("widens the stored revision CHECK additively instead of replacing v1", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(
      /add constraint agent_provider_delivery_sources_normalization_revision_check\s+check \(\s*normalization_revision in \(\s*'ops\.correspondence\.normalized-text\.v1',\s*'ops\.correspondence\.normalized-text\.v2'\s*\)\s*\)/i
    );
  });

  it("says in the header that the file is safe to apply before any deploy", () => {
    const header = migration().split("\n").slice(0, 60).join("\n");

    expect(header).toMatch(/additive/i);
    expect(header).toMatch(/v1/);
    expect(header).toMatch(/before/i);
    expect(header).toMatch(/deploy/i);
  });

  it("drops the old revision CHECK by lookup rather than by guessed name", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(/from pg_catalog\.pg_constraint/i);
    expect(sql).toMatch(
      /conrelid =\s*'private\.agent_provider_delivery_sources'::regclass/i
    );
    expect(sql).toMatch(/drop constraint %I/i);
  });

  it("lets the capture function accept either known revision, null-safely", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(
      /or coalesce\(p_normalization_revision, ''\) not in \(\s*'ops\.correspondence\.normalized-text\.v1',\s*'ops\.correspondence\.normalized-text\.v2'\s*\)/i
    );
    expect(sql).not.toMatch(
      /p_normalization_revision\s+is distinct from 'ops\.correspondence\.normalized-text\.v1'/i
    );
  });

  it("re-projects an identical re-capture instead of raising", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(
      /v_projection_drift :=\s*v_existing_source\.normalized_subject\s+is distinct from p_normalized_subject\s+or v_existing_source\.normalized_plain_text\s+is distinct from p_normalized_plain_text\s+or v_existing_source\.normalization_revision\s+is distinct from p_normalization_revision\s+or v_existing_source\.normalization_status\s+is distinct from p_normalization_status;/i
    );
    expect(sql).toMatch(
      /if v_projection_drift then[\s\S]*update private\.agent_provider_delivery_sources[\s\S]*set normalized_subject = p_normalized_subject,\s*normalized_plain_text = p_normalized_plain_text,\s*normalization_revision = p_normalization_revision,\s*normalization_status = p_normalization_status\s*where source\.id = v_existing_source\.id;/i
    );
  });

  it("never rewrites the capture-time digest the immutable turns reference", () => {
    const sql = migrationStatements();

    expect(sql).not.toMatch(/set[\s\S]{0,400}source_sha256 =/i);
    expect(sql).toMatch(/v_source_sha256 := v_existing_source\.source_sha256;/);
  });

  it("still raises when the retained source bytes differ", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(
      /or v_existing_source\.content_value is distinct from p_content_value/i
    );
    expect(sql).toMatch(
      /or v_existing_source\.subject is distinct from p_subject/i
    );
    expect(sql).toMatch(
      /not v_projection_drift\s+and v_existing_source\.source_sha256 is distinct from v_source_sha256/i
    );
    expect(
      sql.match(/agent_provider_delivery_source_idempotency_conflict/g)?.length
    ).toBeGreaterThanOrEqual(3);
  });

  it("drops the projection columns from the conflict comparison exactly once", () => {
    const sql = migrationStatements();

    // The four projection columns may only appear in the drift computation and
    // in the UPDATE — never again as a conflict trigger.
    expect(
      sql.match(
        /v_existing_source\.normalized_plain_text\s+is distinct from p_normalized_plain_text/g
      )?.length
    ).toBe(1);
    expect(
      sql.match(
        /v_existing_source\.normalization_status\s+is distinct from p_normalization_status/g
      )?.length
    ).toBe(1);
  });

  it("admits only the projection-only write through the immutability guard", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(
      /create or replace function private\.reject_agent_provider_delivery_source_mutation\(\)/i
    );
    expect(sql).toMatch(/'ops\.agent_provider_delivery_source_reprojection'/);
    expect(sql).toMatch(
      /to_jsonb\(new\) - v_projection_keys\s*=\s*pg_catalog\.to_jsonb\(old\) - v_projection_keys/i
    );
    expect(sql).toMatch(
      /raise exception 'agent_job_memory_record_is_immutable'/
    );
    expect(sql).toMatch(
      /create trigger agent_provider_delivery_sources_immutable\s+before update or delete on private\.agent_provider_delivery_sources/i
    );
    // The shared job-memory guard keeps its own strictness.
    expect(sql).not.toMatch(
      /create or replace function private\.reject_agent_job_memory_mutation/i
    );
  });

  it("keeps the company-data purge escape hatch on delete", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(/'ops\.company_data_purge_company_id'/);
    expect(sql).toMatch(/'request\.jwt\.claims'/);
  });

  it("exposes the backfill read and write paths to service_role only", () => {
    const sql = migrationStatements();

    for (const fn of [
      "public.list_agent_provider_delivery_sources_for_renormalization_as_system(integer, timestamptz, uuid)",
      "public.reproject_agent_provider_delivery_source_as_system(uuid, uuid, text, text, text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function ${fn}`);
      expect(sql).toContain(`grant execute on function ${fn}`);
      expect(sql).toContain(`) to service_role;`);
    }
    expect(
      sql.match(
        /if auth\.role\(\) is distinct from 'service_role' then\s*raise exception 'access_denied' using errcode = '42501';/g
      )?.length
    ).toBeGreaterThanOrEqual(3);
  });

  it("bounds the backfill read", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(/where source\.normalization_status = 'rejected'/i);
    expect(sql).toMatch(/order by source\.delivered_at desc, source\.id desc/i);
    expect(sql).toMatch(
      /least\(greatest\(coalesce\(p_limit, 100\), 1\), 500\)/i
    );
  });

  it("refuses a re-projection that would rewrite anything but the projection", () => {
    const sql = migrationStatements();

    expect(sql).toMatch(/coalesce\(p_normalization_revision, ''\) not in \(/i);
    expect(sql).toMatch(
      /p_normalization_status not in \('normalized', 'rejected'\)/i
    );
    expect(sql).toMatch(/\[SUBJECT OMITTED: UNSAFE SOURCE\]/);
    expect(sql).toMatch(/\[CONTENT OMITTED: UNSAFE SOURCE\]/);
  });

  it("leaves transaction control to its caller so the contract can include it", () => {
    const sql = migrationStatements();

    // The Supabase runner wraps each migration in a transaction, and the SQL
    // contract `\ir`s this file inside its own rolled-back one. An explicit
    // COMMIT here would commit the contract's setup instead of rolling it back.
    expect(sql).not.toMatch(/^begin;$/m);
    expect(sql).not.toMatch(/^commit;$/m);
  });
});

describe("delivery-source re-projection SQL contract", () => {
  it("proves an identical-source re-capture updates the projection in place", () => {
    const sql = contract();

    expect(sql).toMatch(/normalized-text\.v2/);
    expect(sql).toMatch(/re-?projection updated the row in place/i);
    expect(sql).toMatch(/source_sha256/);
  });

  it("proves a different-source re-capture still conflicts", () => {
    const sql = contract();

    expect(sql).toMatch(/agent_provider_delivery_source_idempotency_conflict/);
    expect(sql).toMatch(/sqlstate '23505'/);
  });

  it("rolls every schema and role change back", () => {
    const sql = contractStatements();

    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
    expect(sql).not.toMatch(/^commit;$/m);
  });
});

describe("CI runs the branch's SQL contracts", () => {
  it("executes every contract file this branch added", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");

    for (const contractFile of [
      "tests/sql/email-conversion-photo-related-attachment-shadowing-contract.sql",
      "tests/sql/phase-c-claim-null-safe-contract.sql",
      "tests/sql/contact-form-provenance-gate-contract.sql",
      "tests/sql/delivery-source-reprojection-contract.sql",
    ]) {
      expect(workflow).toContain(`-f ${contractFile}`);
    }
  });
});
