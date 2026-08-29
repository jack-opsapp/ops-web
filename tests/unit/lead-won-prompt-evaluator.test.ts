import { describe, expect, it } from "vitest";

import {
  evaluateLeadWonProposal,
  LEAD_WON_PROPOSING_STATUSES,
  type LeadWonOpportunityRow,
} from "@/lib/api/services/lead-won-prompt-service";
import { ProjectStatus } from "@/lib/types/models";

const PROJECT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const OPP_ID = "cccccccc-0000-4000-8000-000000000003";

function makeRow(overrides: Partial<LeadWonOpportunityRow> = {}): LeadWonOpportunityRow {
  return {
    id: OPP_ID,
    stage: "quoted",
    assigned_to: null,
    archived_at: null,
    deleted_at: null,
    title: "Calloway re-roof",
    contact_name: "Dana Calloway",
    won_prompt_declined_at: null,
    ...overrides,
  };
}

function evaluate(args: {
  newStatus?: ProjectStatus;
  userId?: string | null;
  row?: LeadWonOpportunityRow | null;
  canEdit?: boolean;
}) {
  return evaluateLeadWonProposal({
    newStatus: args.newStatus ?? ProjectStatus.Accepted,
    projectId: PROJECT_ID,
    userId: args.userId === undefined ? USER_ID : args.userId,
    row: args.row === undefined ? makeRow() : args.row,
    canEditLead: () => args.canEdit ?? true,
  });
}

describe("evaluateLeadWonProposal", () => {
  it("proposes for every active status and only those", () => {
    for (const status of [
      ProjectStatus.Accepted,
      ProjectStatus.InProgress,
      ProjectStatus.Completed,
      ProjectStatus.Closed,
    ]) {
      expect(LEAD_WON_PROPOSING_STATUSES.has(status)).toBe(true);
      expect(evaluate({ newStatus: status })).not.toBeNull();
    }
    for (const status of [
      ProjectStatus.RFQ,
      ProjectStatus.Estimated,
      ProjectStatus.Archived,
    ]) {
      expect(LEAD_WON_PROPOSING_STATUSES.has(status)).toBe(false);
      expect(evaluate({ newStatus: status })).toBeNull();
    }
  });

  it("requires an actor", () => {
    expect(evaluate({ userId: null })).toBeNull();
    expect(evaluate({ userId: "" })).toBeNull();
  });

  it("requires a server row (offline / unlinked / invisible → no ask)", () => {
    expect(evaluate({ row: null })).toBeNull();
  });

  it("a recorded decline is permanent", () => {
    expect(
      evaluate({ row: makeRow({ won_prompt_declined_at: "2026-08-20T10:00:00Z" }) })
    ).toBeNull();
  });

  it("won is moot; lost and discarded are terminal", () => {
    for (const stage of ["won", "lost", "discarded"]) {
      expect(evaluate({ row: makeRow({ stage }) })).toBeNull();
    }
  });

  it("never surfaces an action the viewer cannot take", () => {
    expect(evaluate({ canEdit: false })).toBeNull();
  });

  it("labels job-first: title, else contact name, else null for the host fallback", () => {
    expect(evaluate({})?.leadLabel).toBe("Calloway re-roof");
    expect(
      evaluate({ row: makeRow({ title: "   " }) })?.leadLabel
    ).toBe("Dana Calloway");
    expect(
      evaluate({ row: makeRow({ title: null, contact_name: "  " }) })?.leadLabel
    ).toBeNull();
  });

  it("carries the ids and actor through unchanged", () => {
    const proposal = evaluate({});
    expect(proposal).toEqual({
      opportunityId: OPP_ID,
      projectId: PROJECT_ID,
      leadLabel: "Calloway re-roof",
      userId: USER_ID,
    });
  });
});
