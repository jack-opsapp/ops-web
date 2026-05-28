import { describe, expect, it } from "vitest";
import { projectOpportunityLifecycleActionAuditRow } from "@/lib/api/services/opportunity-lifecycle-action-service";

describe("opportunity lifecycle projected audit rows", () => {
  it("renders the exact dry-run audit row contract without implying approval", () => {
    const row = projectOpportunityLifecycleActionAuditRow({
      companyId: "11111111-1111-4111-8111-111111111111",
      opportunityId: "22222222-2222-4222-8222-222222222222",
      action: "archive_no_meaningful_correspondence",
      executionMode: "dry-run",
      status: "skipped",
      guardReason: "dry_run_projected_apply_not_approved",
      beforeValues: { archived_at: null },
      afterValues: { archived_at: "2026-05-28T20:00:00.000Z" },
      decisionReason: "No meaningful correspondence exists past the archive threshold.",
      decisionEvidence: {
        staleClock: "2026-04-01T16:00:00.000Z",
        thresholdDays: 14,
      },
      approvedActionKey:
        "22222222-2222-4222-8222-222222222222:archive_no_meaningful_correspondence:2026-05-28",
      approvedBy: null,
      approvedAt: null,
      runId: "2026-05-28:dry-run",
      errorCode: null,
      errorMessage: null,
    });

    expect(row).toEqual({
      company_id: "11111111-1111-4111-8111-111111111111",
      opportunity_id: "22222222-2222-4222-8222-222222222222",
      action: "archive_no_meaningful_correspondence",
      approved_action_key:
        "22222222-2222-4222-8222-222222222222:archive_no_meaningful_correspondence:2026-05-28",
      execution_mode: "dry-run",
      status: "skipped",
      guard_reason: "dry_run_projected_apply_not_approved",
      before_values: { archived_at: null },
      after_values: { archived_at: "2026-05-28T20:00:00.000Z" },
      decision_reason: "No meaningful correspondence exists past the archive threshold.",
      decision_evidence: {
        staleClock: "2026-04-01T16:00:00.000Z",
        thresholdDays: 14,
      },
      approved_by: null,
      approved_at: null,
      run_id: "2026-05-28:dry-run",
      error_code: null,
      error_message: null,
      runner: "ops-web",
      approval_status: "dry_run_projection_not_approved",
    });
  });
});
