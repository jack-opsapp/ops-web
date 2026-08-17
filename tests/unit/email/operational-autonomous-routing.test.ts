import { describe, expect, it } from "vitest";

import { resolveOperationalAutonomousRouting } from "@/lib/api/services/conversation-state/operational-autonomous-routing";
import type { AllowedEmailOpportunityAccess } from "@/lib/email/email-opportunity-access";

type RoutingInput = Parameters<typeof resolveOperationalAutonomousRouting>[0];

const access: AllowedEmailOpportunityAccess = {
  allowed: true,
  actor: { userId: "user-1", companyId: "company-1" },
  operation: "send",
  threadId: "thread-1",
  connectionId: "connection-1",
  providerThreadId: "provider-thread-1",
  opportunityId: "opportunity-1",
  connectionType: "company",
  connectionOwnerId: null,
  pipelineScope: "assigned",
  inboxScope: "assigned",
  usedLegacyPipelineManage: false,
  usedLegacyInboxViewCompany: false,
};

function input(overrides: Partial<RoutingInput> = {}) {
  return {
    authority: "phase_c_stale_lead_follow_up" as const,
    autonomous: true,
    routing: "update_lead_only" as const,
    sourceActivityId: null,
    companyId: "company-1",
    userId: "user-1",
    connectionId: "connection-1",
    opportunityId: "opportunity-1",
    threadId: "provider-thread-1",
    origin: "phase_c",
    profileTypeOverride: "client_followup",
    draftPurposeKind: "operational_outbound" as const,
    signatureWillBeAppended: true,
    emailAccess: access,
    ...overrides,
  };
}

describe("operational autonomous routing", () => {
  it("lets only a canonically authorized Phase C stale-lead follow-up advance an outbound conversation", () => {
    expect(resolveOperationalAutonomousRouting(input())).toBe("draft");
  });

  it("accepts the exact assigned actor when current permissions resolve to all", () => {
    expect(
      resolveOperationalAutonomousRouting(
        input({
          emailAccess: {
            ...access,
            pipelineScope: "all",
            inboxScope: "all",
          },
        })
      )
    ).toBe("draft");
  });

  it("accepts own inbox scope only for the actor's personal mailbox", () => {
    expect(
      resolveOperationalAutonomousRouting(
        input({
          emailAccess: {
            ...access,
            inboxScope: "own",
            connectionType: "individual",
            connectionOwnerId: "user-1",
          },
        })
      )
    ).toBe("draft");
  });

  const bypassAttempts: Array<[string, Partial<RoutingInput>]> = [
    ["no authority", { authority: undefined }],
    ["manual request", { autonomous: false }],
    ["conversation reply", { draftPurposeKind: "conversation_reply" }],
    ["source-bound reply", { sourceActivityId: "activity-1" }],
    ["wrong origin", { origin: "operator" }],
    ["wrong profile", { profileTypeOverride: "client_new_inquiry" }],
    ["signature not fenced", { signatureWillBeAppended: false }],
    [
      "non-send access",
      { emailAccess: { ...access, operation: "edit" as const } },
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
      "other thread",
      {
        emailAccess: {
          ...access,
          providerThreadId: "provider-thread-other",
        },
      },
    ],
    [
      "own-only pipeline scope",
      { emailAccess: { ...access, pipelineScope: "own" as const } },
    ],
    [
      "own-only company inbox scope",
      { emailAccess: { ...access, inboxScope: "own" as const } },
    ],
  ];

  it.each(bypassAttempts)(
    "does not bypass update-only routing for %s",
    (_label, overrides) => {
      expect(resolveOperationalAutonomousRouting(input(overrides))).toBe(
        "update_lead_only"
      );
    }
  );

  it.each([
    ["human review", "require_human_review"],
    ["unknown state", null],
  ] as const)("preserves %s routing", (_label, routing) => {
    expect(resolveOperationalAutonomousRouting(input({ routing }))).toBe(
      routing
    );
  });
});
