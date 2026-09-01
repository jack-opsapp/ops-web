import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_mcp_postgres_uuid_compatibility.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);

function read(path: string) {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

function readRaw(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const MIGRATION = read(MIGRATION_PATH);
const RUNTIME = read(
  join(process.cwd(), "tests/sql/agent-mcp-postgres-uuid-runtime.sql")
);
const RUNTIME_RAW = readRaw(
  join(process.cwd(), "tests/sql/agent-mcp-postgres-uuid-runtime.sql")
);
const REPLAY = read(
  join(process.cwd(), "tests/sql/agent-mcp-postgres-uuid-replay-runtime.sql")
);
const ARTIFACT_BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/artifacts/sql/agent_artifact_reads.body.sql"
  )
);
const SITE_VISIT_BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/site-visits/sql/agent_site_visit_reads.body.sql"
  )
);
const INTEGRATION_BODY = read(
  join(
    process.cwd(),
    "src/lib/agent-control-plane/services/p2/integrations/sql/agent_integration_health_read.body.sql"
  )
);

const AFFECTED_FUNCTIONS = [
  "agent_p2_artifact_uuid_from_text",
  "agent_p2_site_visit_uuid_from_text",
  "agent_p2_integration_health_summary_v1",
  "agent_p2_task_uuid_from_text",
  "agent_p2_task_context_v1",
] as const;

const PREFIXED_EVIDENCE_READERS = [
  "read_agent_job_conversation_context_as_system",
  "read_agent_correspondence_evidence_page_as_system",
  "read_agent_job_history_as_system",
  "read_agent_job_conversation_context_as_system_v7_core",
  "read_agent_correspondence_evidence_page_as_system_v7_core",
  "read_agent_job_history_as_system_v7_core",
] as const;

const POSTGRES_UUID_PATTERN =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const RFC_ONLY_UUID_PATTERN =
  /\[1-[58]\]\[0-9a-f\]\{3\}|\[89ab\]\[0-9a-f\]\{3\}/;

describe("MCP PostgreSQL UUID compatibility repair", () => {
  it("ships one closed additive migration with runtime and replay proofs", () => {
    expect(migrationNames).toEqual([
      "20260830160000_agent_mcp_postgres_uuid_compatibility.sql",
    ]);
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("repairs exactly the five sealed live database-ID readers", () => {
    expect(AFFECTED_FUNCTIONS).toHaveLength(5);
    expect(new Set(AFFECTED_FUNCTIONS).size).toBe(5);
    for (const functionName of AFFECTED_FUNCTIONS) {
      expect(MIGRATION, functionName).toContain(functionName);
      expect(REPLAY, functionName).toContain(functionName);
    }
    expect(MIGRATION).toContain(
      "v_expected_function_count constant integer := 5"
    );
    expect(MIGRATION).toContain("pre_repair_sha256");
    expect(MIGRATION).toContain("repaired_sha256");
    expect(MIGRATION).toContain("agent_mcp_postgres_uuid_source_drift");
    expect(MIGRATION).toContain("extensions.digest(");
  });

  it("guards live conversation and evidence readers without rewriting them", () => {
    expect(PREFIXED_EVIDENCE_READERS).toHaveLength(6);
    expect(new Set(PREFIXED_EVIDENCE_READERS).size).toBe(6);
    for (const functionName of PREFIXED_EVIDENCE_READERS) {
      expect(MIGRATION, functionName).toContain(functionName);
      expect(RUNTIME, functionName).toContain(functionName);
      expect(REPLAY, functionName).toContain(functionName);
    }
    expect(MIGRATION).toContain(
      "agent_mcp_postgres_uuid_prefixed_evidence_gate"
    );
  });

  it("uses one lowercase PostgreSQL UUID shape in migration and body mirrors", () => {
    expect(MIGRATION).toContain(POSTGRES_UUID_PATTERN);
    expect(MIGRATION).toMatch(RFC_ONLY_UUID_PATTERN);
    for (const source of [ARTIFACT_BODY, SITE_VISIT_BODY, INTEGRATION_BODY]) {
      expect(source).toContain(POSTGRES_UUID_PATTERN);
      expect(source).not.toMatch(RFC_ONLY_UUID_PATTERN);
    }
    expect(ARTIFACT_BODY).toContain("if p_value !~");
    expect(ARTIFACT_BODY).not.toContain("if p_value !~*");
  });

  it("proves non-RFC PostgreSQL IDs and rejects noncanonical text", () => {
    for (const vector of [
      "d3000000-0000-4000-d300-000000000003",
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]) {
      expect(RUNTIME, vector).toContain(vector);
    }
    expect(RUNTIME_RAW).toContain("D3000000-0000-4000-D300-000000000003");
    expect(RUNTIME).toContain("d3000000-0000-4000-d300-00000000003");
    expect(RUNTIME).toContain("source_invalid");
    expect(RUNTIME).toContain("job_conversation_turn:");
    expect(RUNTIME).toContain("email_attachment:");
  });

  it("preserves complete function identity, ACLs, and replay bytes", () => {
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
    expect(MIGRATION).toContain("not pg_catalog.has_function_privilege");
    expect(REPLAY).toContain("source_digest");
  });
});
