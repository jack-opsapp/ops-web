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
    expect(MIGRATION).toContain("pre_repair_sha256");
    expect(MIGRATION).toContain("repaired_sha256");
    expect(MIGRATION).toContain(
      "agent_site_visit_nullable_client_source_drift"
    );
  });

  it("allows a missing client only when the opportunity remains visible", () => {
    const nullableClientGate =
      "client_id is null or client.id is not null and private.agent_user_can_access_entity";
    const nullableResolvedClientGate =
      "resolved_client_id is null or client.id is not null and private.agent_user_can_access_entity";

    expect(BODY_COMPACT).toContain(nullableClientGate);
    expect(BODY_COMPACT).toContain(nullableResolvedClientGate);
    expect(BODY_COMPACT).not.toContain(
      "raw.opportunity_id is not null and raw.client_id is not null"
    );
    expect(BODY_COMPACT).not.toContain(
      "source.resolved_client_id is not null and client.id is not null"
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
  });

  it("proves the production-shaped null client and hostile non-null client cases", () => {
    for (const vector of [
      "8e300000-0000-4000-8000-000000000010",
      "8e500000-0000-4000-8000-000000000010",
      "8e500000-0000-4000-8000-000000000011",
      "8e500000-0000-4000-8000-000000000012",
      "nullable-client",
      "foreign-client",
      "project-linked-nullable-client",
    ]) {
      expect(RUNTIME, vector).toContain(vector);
    }
    expect(RUNTIME).toContain("{result,sections,lead,client_ref}");
    expect(RUNTIME).toContain("agent_site_visit_not_found_or_not_visible");
  });
});
