import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SUFFIX = "_agent_schedule_readiness_manifest_bridge.sql";
const migrationNames = readdirSync(
  join(process.cwd(), "supabase/migrations")
).filter((name) => name.endsWith(SUFFIX));
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations",
  migrationNames[0] ?? "MISSING"
);
const RUNTIME_PATH = join(
  process.cwd(),
  "tests/sql/agent-schedule-readiness-manifest-bridge-runtime.sql"
);
const REPLAY_PATH = join(
  process.cwd(),
  "tests/sql/agent-schedule-readiness-manifest-bridge-replay-runtime.sql"
);

function read(path: string): string {
  try {
    return readFileSync(path, "utf8").toLowerCase();
  } catch {
    return "";
  }
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function functionDefinition(sql: string, name: string): string {
  const marker = `create or replace function ${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) return "";
  const remainder = sql.slice(start);
  const delimiter = /\bas\s+(\$[a-z0-9_]*\$)/.exec(remainder)?.[1];
  if (!delimiter) return "";
  const end = remainder.indexOf(`${delimiter};`);
  return end < 0 ? "" : remainder.slice(0, end + delimiter.length + 1);
}

const MIGRATION = read(MIGRATION_PATH);
const COMPACT_MIGRATION = compact(MIGRATION);
const RUNTIME = read(RUNTIME_PATH);
const REPLAY = read(REPLAY_PATH);

const SCHEDULE_SIGNATURE =
  "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,timestamp with time zone,timestamp with time zone,text[],text[],text,timestamp with time zone,bigint,timestamp with time zone,uuid,integer";
const READINESS_SIGNATURE =
  "text,uuid,uuid,text,text[],text,text,text,text[],text,text,text,text,text,timestamp with time zone,timestamp with time zone,text[],timestamp with time zone,bigint,timestamp with time zone,uuid,integer";

const REPAIRED_SIGNATURES = [
  `private.read_agent_scheduled_jobs_as_system_v6_core(${SCHEDULE_SIGNATURE})`,
  `private.read_agent_job_readiness_issues_as_system_v6_core(${READINESS_SIGNATURE})`,
  `private.read_agent_scheduled_jobs_as_system_v7_core(${SCHEDULE_SIGNATURE})`,
  `private.read_agent_job_readiness_issues_as_system_v7_core(${READINESS_SIGNATURE})`,
  `public.read_agent_scheduled_jobs_as_system(${SCHEDULE_SIGNATURE})`,
  `public.read_agent_job_readiness_issues_as_system(${READINESS_SIGNATURE})`,
] as const;

describe("schedule/readiness manifest bridge repair", () => {
  it("ships one later additive migration plus dedicated PG17 runtime and replay proofs", () => {
    expect(migrationNames).toHaveLength(1);
    expect(migrationNames[0]).toMatch(
      /^(?!20260830120000)\d{14}_agent_schedule_readiness_manifest_bridge\.sql$/
    );
    expect(Number(migrationNames[0]!.slice(0, 14))).toBeGreaterThan(
      20260830120000
    );
    expect(MIGRATION).not.toBe("");
    expect(RUNTIME).not.toBe("");
    expect(REPLAY).not.toBe("");
    expect(MIGRATION.trim().endsWith("commit;")).toBe(true);
    expect(RUNTIME.trim().endsWith("rollback;")).toBe(true);
    expect(REPLAY.trim().endsWith("rollback;")).toBe(true);
  });

  it("repairs exactly the two schedule/readiness readers at v6, v7, and v8", () => {
    expect(REPAIRED_SIGNATURES).toHaveLength(6);
    expect(new Set(REPAIRED_SIGNATURES).size).toBe(6);
    for (const signature of REPAIRED_SIGNATURES) {
      expect(COMPACT_MIGRATION, signature).toContain(`'${signature}'`);
    }
    expect(COMPACT_MIGRATION).toContain(
      "v_expected_function_count constant integer := 6"
    );
    expect(COMPACT_MIGRATION).toContain(
      "agent_schedule_readiness_manifest_bridge_source_drift"
    );
    expect(COMPACT_MIGRATION).toContain("v_pre_repair_sha256");
    expect(COMPACT_MIGRATION).toContain("v_repaired_sha256");
  });

  it("uses a private tool-scoped bridge and leaves the generic helper untouched", () => {
    const helper = compact(
      functionDefinition(
        MIGRATION,
        "private.reprove_agent_schedule_readiness_jsonb_for_manifest"
      )
    );
    expect(helper).not.toBe("");
    expect(helper).toContain(
      "language plpgsql stable called on null input security definer"
    );
    expect(helper).toContain(
      "set search_path = pg_catalog, private, extensions, pg_temp"
    );
    expect(helper).toContain(
      "p_reader_name not in ('scheduled_jobs', 'job_readiness_issues')"
    );
    for (const pair of [
      [
        "2026-08-12.capability-manifest.v4",
        "2026-08-14.capability-manifest.v6",
      ],
      [
        "2026-08-14.capability-manifest.v6",
        "2026-08-20.capability-manifest.v7",
      ],
      [
        "2026-08-20.capability-manifest.v7",
        "2026-08-22.capability-manifest.v8",
      ],
    ]) {
      expect(helper).toContain(`'${pair[0]}'`);
      expect(helper).toContain(`'${pair[1]}'`);
    }
    expect(helper).toContain(
      "invalid_agent_schedule_readiness_manifest_bridge_request"
    );
    expect(helper).toContain(
      "invalid_agent_schedule_readiness_manifest_bridge_source"
    );
    expect(helper).toContain("using errcode = '22023'");
    expect(COMPACT_MIGRATION).not.toContain(
      "create or replace function private.reprove_agent_read_jsonb_for_manifest("
    );
    expect(COMPACT_MIGRATION).toMatch(
      /revoke all on function private\.reprove_agent_schedule_readiness_jsonb_for_manifest\(\s*jsonb,\s*text,\s*uuid,\s*text,\s*text,\s*text\s*\) from public, anon, authenticated, service_role;/
    );
  });

  it("passes through only the exact bound marker-free production empty envelopes", () => {
    const helper = compact(
      functionDefinition(
        MIGRATION,
        "private.reprove_agent_schedule_readiness_jsonb_for_manifest"
      )
    );
    for (const field of [
      "company_id",
      "permission_snapshot_revision",
      "source_fence",
      "source_versions",
      "occurrences",
      "occurrence_proofs",
      "returned_occurrence_count",
      "next_cursor_claims",
      "has_more",
      "candidates",
      "scanned_candidate_count",
      "next_scan_cursor_claims",
      "scan_has_more",
      "evidence",
    ]) {
      expect(helper, field).toContain(`'${field}'`);
    }
    expect(helper).toContain(
      "v_source_fence ->> 'source_domain' is distinct from 'operations'"
    );
    expect(helper).toContain(
      "v_source_fence ->> 'source_type' is distinct from 'operational_read_revision'"
    );
    expect(helper).toContain(
      "v_source_fence ->> 'source_id' is distinct from 'private.agent_operational_read_revisions'"
    );
    expect(helper).toContain("^revision:[0-9]+$");
    expect(helper).toContain("return p_result;");
    expect(helper).toContain("v_manifest_count = 0");
    expect(helper).toContain("v_proof_count = 0");
    expect(helper).toContain("v_bound_proof_count");
    expect(helper).toContain(
      "proof.value -> 'occurrence_ref' = occurrence.value -> 'occurrence_ref'"
    );
    expect(helper).toContain(
      "proof.value -> 'projection' -> 'job' -> 'job_ref' = candidate.value -> 'job_ref'"
    );
    expect(helper).toContain("v_proof_count <> v_bound_proof_count");
  });

  it("pins source and repaired bodies and proves catalog identity across replay", () => {
    for (const hash of [
      "cbab1a800894cafff2c49ae8a39acb9246a2196c98dcce8af1db7eaafc1b55e7",
      "1ab779c3ec9c219ee6b79d4943c8c6c79d26d74637813488f5b32c457cfe71a1",
      "4f02d94867ac64c42b028e3211d5d5568707cea7b001ce9df0668549240fddbd",
      "23fc832cdbde1af33581ef41061beddf3aa9e5f59900341c8df0f8bd54da173c",
      "bdb685f62c0515032f89b766eba4b9225a0afd3f2dccbe4e1c6dc767a200b2ea",
      "e975e2c39005410de6326067754348f491a23380074a2dddc6fd2e6464d36447",
    ]) {
      expect(COMPACT_MIGRATION).toContain(hash);
    }
    for (const catalogField of [
      "oid",
      "proowner",
      "proacl",
      "proconfig",
      "prosecdef",
      "provolatile",
      "proparallel",
      "proisstrict",
      "pronargdefaults",
      "proargdefaults",
    ]) {
      expect(COMPACT_MIGRATION, catalogField).toContain(catalogField);
      expect(REPLAY, catalogField).toContain(catalogField);
    }
    expect(REPLAY).toContain("\\ir ../../supabase/migrations/");
    expect(REPLAY).toContain("execute schedule_v8_prepared");
    expect(REPLAY).toContain("execute readiness_v8_prepared");
  });

  it("exercises the real frozen chain, exact empties, strict failures, hashes, and prepared plans", () => {
    for (const marker of [
      "2026-08-12.capability-manifest.v4",
      "2026-08-14.capability-manifest.v6",
      "2026-08-20.capability-manifest.v7",
      "2026-08-22.capability-manifest.v8",
    ]) {
      expect(RUNTIME).toContain(marker);
    }
    expect(RUNTIME).toContain("prepare schedule_v8_prepared");
    expect(RUNTIME).toContain("prepare readiness_v8_prepared");
    expect(RUNTIME).toContain("invalid_agent_manifest_reproof_source");
    expect(RUNTIME).toContain("exact_empty_schedule_byte_identity");
    expect(RUNTIME).toContain("exact_empty_readiness_byte_identity");
    expect(RUNTIME).toContain("generic_helper_marker_free_rejected");
    expect(RUNTIME).toContain("proofless_nonempty_rejected");
    expect(RUNTIME).toContain("mismatched_company_rejected");
    expect(RUNTIME).toContain("mismatched_permission_revision_rejected");
    expect(RUNTIME).toContain("mismatched_operations_fence_rejected");
    expect(RUNTIME).toContain("partial_proof_rejected");
    expect(RUNTIME).toContain("mixed_manifest_rejected");
    expect(RUNTIME).toContain("extensions.digest(");
    expect(RUNTIME).toContain("pg_get_functiondef(");
  });
});
