import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATION_SUFFIX = "_agent_site_visit_nullable_client_visibility.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(MIGRATION_SUFFIX));

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

const MIGRATION = read(
  join(process.cwd(), "supabase/migrations", migrationNames[0] ?? "MISSING")
);
const BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/site-visits/sql/agent_site_visit_reads.body.sql"
  )
);
const RUNTIME = read(
  join(process.cwd(), "tests/sql/agent-site-visit-nullable-client-runtime.sql")
);
const REPLAY = read(
  join(
    process.cwd(),
    "tests/sql/agent-site-visit-nullable-client-replay-runtime.sql"
  )
);
const POSTGRES_RUNTIME = read(
  join(
    process.cwd(),
    "tests/integration/agent-control-plane/p2-postgres-runtime.test.ts"
  )
);
const BODY_COMPACT = BODY.replace(/\s+/g, " ").trim();

const AFFECTED_FUNCTIONS = [
  "private.agent_p2_site_visit_list_v1",
  "private.agent_p2_site_visit_context_v1",
  "private.agent_p2_site_visit_attention_v1",
] as const;

describe("site-visit nullable-client visibility repair", () => {
  it("ships one closed append-only migration with runtime and replay proofs", () => {
    expect(migrationNames).toEqual([
      "20260830170000_agent_site_visit_nullable_client_visibility.sql",
    ]);
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("repairs exactly the list, exact-context, and attention projections", () => {
    expect(AFFECTED_FUNCTIONS).toHaveLength(3);
    for (const functionName of AFFECTED_FUNCTIONS) {
      expect(MIGRATION, functionName).toContain(functionName);
      expect(REPLAY, functionName).toContain(functionName);
    }
    expect(MIGRATION).toContain(
      "v_expected_function_count constant integer := 3"
    );
    expect(MIGRATION).toContain(
      "v_expected_replacement_count constant integer := 19"
    );
    expect(MIGRATION).toContain("pre_repair_sha256");
    expect(MIGRATION).toContain("repaired_sha256");
    expect(MIGRATION).toContain(
      "agent_site_visit_nullable_client_source_drift"
    );
  });

  it("allows a missing client only when the opportunity remains visible", () => {
    const nullableClientGate =
      "not raw.has_client_reference and opportunity.client_ref is null and opportunity.client_id is null or not raw.client_reference_invalid";
    const nullableResolvedClientGate =
      "not source.has_client_reference and opportunity.client_ref is null and opportunity.client_id is null or not source.client_reference_invalid";

    expect(BODY_COMPACT).toContain(nullableClientGate);
    expect(BODY_COMPACT).toContain(nullableResolvedClientGate);
    expect(
      BODY_COMPACT.split(
        "raw.project_id is null and not raw.has_client_reference and p_resolved_permission_scopes"
      ).length - 1
    ).toBe(2);
    expect(BODY_COMPACT).toContain(
      "source.project_id is null and not source.has_client_reference and p_resolved_permission_scopes"
    );
    expect(BODY_COMPACT).not.toContain(
      "raw.opportunity_id is not null and raw.client_id is not null"
    );
    expect(
      BODY_COMPACT.split(
        "visit.client_ref is not null or visit.client_id is not null"
      ).length - 1
    ).toBe(5);
    expect(BODY_COMPACT.split("as client_reference_invalid").length - 1).toBe(
      5
    );
    expect(BODY_COMPACT).toContain(
      "opportunity.client_ref is null or opportunity.client_id is null or opportunity.client_ref = opportunity.client_id"
    );
    expect(BODY_COMPACT).toContain(
      "raw.client_id is null or coalesce( opportunity.client_ref, opportunity.client_id ) is null or raw.client_id = coalesce"
    );
    expect(BODY_COMPACT).toContain(
      "selected.effective_client_id as resolved_client_id"
    );
    expect(BODY_COMPACT).toContain("'opportunity'");
    expect(BODY_COMPACT).toContain("opportunity.id is not null");
  });

  it("seals source identity, metadata, ACLs, and idempotent replay", () => {
    for (const field of [
      "procedure.oid",
      "procedure.proowner",
      "procedure.proacl",
      "procedure.proconfig",
      "procedure.prosecdef",
      "procedure.provolatile",
      "procedure.proparallel",
      "procedure.proisstrict",
      "procedure.proargtypes",
      "procedure.prorettype",
    ]) {
      expect(MIGRATION, field).toContain(field);
      expect(REPLAY, field).toContain(field);
    }
    expect(MIGRATION).toContain("extensions.digest(");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(MIGRATION).toContain(
        `pg_catalog.has_function_privilege(\n               '${role}'`
      );
      expect(REPLAY).toContain(
        `pg_catalog.has_function_privilege(\n               '${role}'`
      );
    }
    expect(REPLAY).toContain("source_digest");
    expect(POSTGRES_RUNTIME).toContain("site_visit_adversarial_drift_sql");
    expect(POSTGRES_RUNTIME).toContain("site_visit_adversarial_verify_sql");
    expect(POSTGRES_RUNTIME).toContain("site_visit_adversarial_restore_sql");
    expect(POSTGRES_RUNTIME).toContain(
      '"agent_site_visit_nullable_client_source_drift",\n                "55000"'
    );
    expect(POSTGRES_RUNTIME).toContain(
      "pg_catalog.to_jsonb(procedure) - 'prosrc' as metadata"
    );
  });

  it("proves the production-shaped null client and hostile non-null client cases", () => {
    for (const vector of [
      "8e300000-0000-4000-8000-000000000010",
      "8e300000-0000-4000-8000-000000000020",
      "8e300000-0000-4000-8000-000000000021",
      "8e500000-0000-4000-8000-000000000010",
      "8e500000-0000-4000-8000-000000000011",
      "8e500000-0000-4000-8000-000000000012",
      "8e500000-0000-4000-8000-000000000013",
      "8e500000-0000-4000-8000-000000000014",
      "8e500000-0000-4000-8000-000000000015",
      "8e500000-0000-4000-8000-000000000016",
      "8e500000-0000-4000-8000-000000000017",
      "8e500000-0000-4000-8000-000000000018",
      "8e500000-0000-4000-8000-000000000019",
      "8e500000-0000-4000-8000-000000000020",
      "8e500000-0000-4000-8000-000000000021",
      "8e500000-0000-4000-8000-000000000022",
      "8e500000-0000-4000-8000-000000000023",
      "8e500000-0000-4000-8000-000000000024",
      "8e500000-0000-4000-8000-000000000025",
      "nullable-client",
      "foreign-client",
      "opportunity-client-fallback",
      "foreign-opportunity-client",
      "visit-opportunity-client-mismatch",
      "opportunity-client-mirror-conflict",
      "visit-client-mirror-conflict",
      "unlinked-client",
      "malformed-non-null-client-id",
      "project-linked-nullable-client",
      "ordinary-client",
      "genuine-unlinked",
      "visit-only-one-sided-client",
      "opportunity-only-one-sided-client",
      "visit-legacy-client-id-only",
      "opportunity-legacy-client-id-only",
      "actor-hidden-client",
    ]) {
      expect(RUNTIME, vector).toContain(vector);
    }
    expect(RUNTIME).toContain("{result,sections,lead,client_ref}");
    expect(RUNTIME).toContain("agent_site_visit_not_found_or_not_visible");
  });
});
