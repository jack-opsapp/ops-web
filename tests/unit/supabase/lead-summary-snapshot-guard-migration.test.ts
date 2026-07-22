import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260721144000_lead_summary_snapshot_guard.sql"
);

const source = readFileSync(migrationPath, "utf8");
const rollbackContract = readFileSync(
  join(process.cwd(), "tests/sql/lead-assignment-contract.sql"),
  "utf8"
);

describe("lead summary snapshot guard migration", () => {
  it("exposes one service-role-only summary writer and revokes public execution", () => {
    expect(source).toContain(
      "create or replace function public.commit_lead_summary_snapshot"
    );
    expect(source).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(source).toMatch(
      /revoke all on function public\.commit_lead_summary_snapshot[\s\S]*from public, anon, authenticated/i
    );
    expect(source).toMatch(
      /grant execute on function public\.commit_lead_summary_snapshot[\s\S]*to service_role/i
    );
  });

  it("locks the opportunity and rejects stale assignment, row, counter, or meaningful-event snapshots before writing", () => {
    expect(source).toMatch(
      /from public\.opportunities opportunity[\s\S]*for update/i
    );
    expect(source).toContain("assignment_snapshot_mismatch");
    expect(source).toContain("opportunity_snapshot_mismatch");
    expect(source).toContain("conversation_snapshot_mismatch");
    expect(source).toMatch(/count\(\*\)::bigint/i);
    expect(source).toMatch(/event\.is_meaningful/i);
    expect(source).toMatch(/event\.opportunity_projection_applied/i);
    expect(source).toMatch(
      /v_latest_meaningful_event_id is distinct from p_expected_latest_meaningful_event_id/i
    );
  });

  it("fails retryably under the opportunity lock when a meaningful event is awaiting projection", () => {
    const serviceRoleGuard = source.indexOf(
      "coalesce(auth.role(), '') <> 'service_role'"
    );
    const opportunityLock = source.indexOf("for update;");
    const pendingProjectionGuard = source.indexOf(
      "private.opportunity_has_pending_meaningful_email"
    );
    const exactRetry = source.indexOf("'already_applied'::text");
    const summaryUpdate = source.indexOf(
      "update public.opportunities opportunity"
    );

    expect(serviceRoleGuard).toBeGreaterThan(-1);
    expect(opportunityLock).toBeGreaterThan(serviceRoleGuard);
    expect(pendingProjectionGuard).toBeGreaterThan(opportunityLock);
    expect(source).toMatch(
      /if private\.opportunity_has_pending_meaningful_email\([\s\S]*?raise exception 'meaningful correspondence projection pending'[\s\S]*?errcode = '40001'/i
    );
    expect(exactRetry).toBeGreaterThan(pendingProjectionGuard);
    expect(summaryUpdate).toBeGreaterThan(pendingProjectionGuard);
  });

  it("binds generation to the prior summary snapshot and treats an exact retry as already applied", () => {
    expect(source).toContain("p_expected_prior_summary text");
    expect(source).toContain("p_expected_prior_summary_updated_at timestamptz");
    expect(source).toMatch(
      /v_opportunity\.ai_summary is distinct from p_expected_prior_summary/i
    );
    expect(source).toMatch(
      /v_opportunity\.ai_summary_updated_at is distinct from p_expected_prior_summary_updated_at/i
    );

    const alreadyApplied = source.indexOf("'already_applied'::text");
    const priorSnapshotMismatch = source.indexOf(
      "'summary_snapshot_mismatch'::text"
    );
    expect(alreadyApplied).toBeGreaterThan(-1);
    expect(priorSnapshotMismatch).toBeGreaterThan(alreadyApplied);
  });

  it("rejects older or conflicting generation stamps before any update", () => {
    expect(source).toMatch(
      /v_opportunity\.ai_summary_updated_at\s*>\s*p_generated_at/i
    );
    expect(source).toContain("stale_summary_generation");
    expect(source).toMatch(
      /v_opportunity\.ai_summary_updated_at\s*=\s*p_generated_at/i
    );
    expect(source).toContain("summary_generation_conflict");

    const staleGuard = source.indexOf("'stale_summary_generation'::text");
    const update = source.indexOf("update public.opportunities opportunity");
    expect(staleGuard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(staleGuard);
  });

  it("updates summary fields only and never mutates manual stage or assignment", () => {
    const updateBody = source.match(
      /update public\.opportunities opportunity[\s\S]*?return query/i
    )?.[0];
    expect(updateBody).toBeDefined();
    expect(updateBody).toContain("ai_summary = btrim(p_summary)");
    expect(updateBody).toContain("ai_summary_updated_at = p_generated_at");
    expect(updateBody).not.toContain("assigned_to =");
    expect(updateBody).not.toContain("stage =");
    expect(updateBody).not.toContain("stage_manually_set =");
  });

  it("has a rollback-only SQL contract proving a pending event cannot be crossed", () => {
    expect(rollbackContract).toContain(
      "lead_summary_snapshot_rpc_is_service_only"
    );
    expect(rollbackContract).toContain(
      "lead_summary_snapshot_exact_retry_is_idempotent"
    );
    expect(rollbackContract).toContain(
      "lead_summary_pending_meaningful_projection_denied"
    );
    expect(rollbackContract).toContain(
      "lead_summary_pending_projection_preserves_prior_summary"
    );
    const raceStart = rollbackContract.indexOf(
      "-- A summary generator may have read the complete projected snapshot"
    );
    const raceEnd = rollbackContract.indexOf(
      "\ndo $contract$\nbegin",
      raceStart + 1
    );
    const raceContract = rollbackContract.slice(raceStart, raceEnd);
    expect(raceStart).toBeGreaterThan(-1);
    expect(raceEnd).toBeGreaterThan(raceStart);
    expect(raceContract).toMatch(
      /perform public\.commit_lead_summary_snapshot\([\s\S]*?when sqlstate '40001'/i
    );
    expect(raceContract).toContain(
      "lead_summary_pending_projection_preserves_prior_summary"
    );
    expect(rollbackContract.trimEnd()).toMatch(/rollback;$/i);
  });
});
