import { describe, expect, it } from "vitest";

import { resolveSourceBoundAutonomousRouting } from "@/lib/api/services/conversation-state/source-bound-autonomous-routing";
import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

const access: AllowedEmailOpportunityAccess = {
  allowed: true,
  actor: { userId: "user-1", companyId: "company-1" },
  operation: "send",
  threadId: null,
  connectionId: "connection-1",
  providerThreadId: null,
  opportunityId: "opportunity-1",
  connectionType: "company",
  connectionOwnerId: null,
  pipelineScope: "assigned",
  inboxScope: "assigned",
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function input(
  overrides: Partial<
    Parameters<typeof resolveSourceBoundAutonomousRouting>[0]
  > = {}
) {
  return {
    authority: "assigned_contact_form_review" as const,
    autonomous: true,
    routing: null,
    sourceActivityId: "activity-1",
    authorizedSourceActivityId: "activity-1",
    companyId: "company-1",
    userId: "user-1",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    origin: "phase_c",
    profileTypeOverride: "client_new_inquiry",
    emailAccess: access,
    ...overrides,
  };
}

describe("source-bound autonomous routing", () => {
  it("accepts only the assignment-authorized contact-form review path", () => {
    expect(resolveSourceBoundAutonomousRouting(input())).toBe("draft");
  });

  it.each([
    ["manual request", { autonomous: false }],
    ["missing source", { sourceActivityId: null }],
    ["unverified source", { authorizedSourceActivityId: null }],
    ["mismatched source", { authorizedSourceActivityId: "activity-other" }],
    ["wrong origin", { origin: "operator" }],
    ["wrong profile", { profileTypeOverride: "general" }],
    [
      "non-send access",
      { emailAccess: { ...access, operation: "edit" as const } },
    ],
    [
      "existing inbox thread",
      {
        emailAccess: {
          ...access,
          threadId: "thread-1",
          providerThreadId: "provider-thread-1",
        },
      },
    ],
    [
      "other actor",
      {
        emailAccess: {
          ...access,
          actor: { userId: "user-other", companyId: "company-1" },
        },
      },
    ],
    [
      "other opportunity",
      { emailAccess: { ...access, opportunityId: "opportunity-other" } },
    ],
  ])("fails closed for %s", (_label, overrides) => {
    expect(resolveSourceBoundAutonomousRouting(input(overrides))).toBeNull();
  });

  it("preserves the ordinary conversation router when no authority is present", () => {
    expect(
      resolveSourceBoundAutonomousRouting(
        input({ authority: undefined, routing: "require_human_review" })
      )
    ).toBe("require_human_review");
  });
});
