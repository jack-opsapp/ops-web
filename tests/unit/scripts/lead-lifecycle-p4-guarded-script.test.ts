import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(
  process.cwd(),
  "scripts/lead-lifecycle-p4-non-destructive-actions.ts"
);
const legacyBackfillScriptPath = path.join(
  process.cwd(),
  "scripts/lead-lifecycle-p4-legacy-correspondence-backfill.ts"
);

function scriptSource(): string {
  return readFileSync(scriptPath, "utf8");
}

function legacyBackfillScriptSource(): string {
  return readFileSync(legacyBackfillScriptPath, "utf8");
}

function guardedActionsBlock(): string {
  const match = scriptSource().match(
    /const GUARDED_ACTIONS[\s\S]*?\]\);/
  );
  if (!match) throw new Error("Could not find GUARDED_ACTIONS block");
  return match[0];
}

describe("lead lifecycle P4-12 guarded action script", () => {
  it("whitelists only destructive/reactivation guarded actions for P4-12 apply", () => {
    const block = guardedActionsBlock();

    expect(block).toContain("archive_after_two_unanswered_followups");
    expect(block).toContain("archive_no_meaningful_correspondence");
    expect(block).toContain("move_to_lost_operator_no_response");
    expect(block).toContain("reactivate_on_related_inbound");
    expect(block).not.toContain("create_follow_up_draft");
    expect(block).not.toContain("operator_follow_up_miss");
  });

  it("renders total-vs-scanned production snapshot proof in the dry-run artifact", () => {
    const source = scriptSource();

    expect(source).toContain("## Production Snapshot Proof");
    expect(source).toContain("Pre-run total opportunities");
    expect(source).toContain("Post-run total opportunities");
    expect(source).toContain("Scanned non-deleted opportunities");
    expect(source).toContain("max updated_at");
    expect(source).toContain("Migration applied: no.");
    expect(source).toContain("Production data writes: no.");
  });

  it("renders projected audit rows and legacy evidence boundaries in the dry-run artifact", () => {
    const source = scriptSource();

    expect(source).toContain("## Dry-Run Projected Audit Rows");
    expect(source).toContain("projectOpportunityLifecycleActionAuditRow");
    expect(source).toContain("dry_run_projected_apply_not_approved");
    expect(source).toContain("legacyBackfillPlan");
    expect(source).toContain("Empty P4 proof tables are not treated as no meaningful legacy correspondence.");
  });

  it("blocks guarded archive/lost output when legacy evidence is unresolved", () => {
    const source = scriptSource();

    expect(source).toContain("BLOCKING_LEGACY_EVIDENCE_SKIP_REASONS");
    expect(source).toContain("LEGACY_EVIDENCE_CLEAN_ACTIONS");
    expect(source).toContain("## Legacy Evidence Blocked Guarded Candidates");
    expect(source).toContain("skipped_unresolved_legacy_evidence");
    expect(source).toContain("Guarded candidates blocked by unresolved legacy evidence");
  });

  it("queries pg_proc instead of hardcoding guarded RPC absence", () => {
    for (const source of [scriptSource(), legacyBackfillScriptSource()]) {
      expect(source).toContain("pg_proc");
      expect(source).toContain("execute_opportunity_lifecycle_guarded_action");
      expect(source).not.toContain("guardedRpcExists: false");
    }
  });
});
