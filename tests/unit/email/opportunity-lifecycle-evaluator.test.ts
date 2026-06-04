import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  evaluateOpportunityLifecycle,
  type OpportunityLifecycleMeaningfulEvent,
  type OpportunityLifecycleOpportunity,
} from "@/lib/email/opportunity-lifecycle-evaluator";

const now = new Date("2026-05-27T18:00:00.000Z");
const settings = {
  ...DEFAULT_LEAD_LIFECYCLE_SETTINGS,
  followUpAfterDays: 3,
};

function opportunity(
  overrides: Partial<OpportunityLifecycleOpportunity> = {}
): OpportunityLifecycleOpportunity {
  return {
    id: "opp-1",
    stage: "quoted",
    archivedAt: null,
    deletedAt: null,
    projectId: null,
    projectRef: null,
    createdAt: "2026-05-01T18:00:00.000Z",
    stageEnteredAt: "2026-05-01T18:00:00.000Z",
    ...overrides,
  };
}

function event(
  overrides: Partial<OpportunityLifecycleMeaningfulEvent> = {}
): OpportunityLifecycleMeaningfulEvent {
  return {
    id: "event-1",
    direction: "outbound",
    isMeaningful: true,
    occurredAt: "2026-05-20T18:00:00.000Z",
    partyRole: "ops",
    linkedContactKind: "customer",
    ...overrides,
  };
}

describe("opportunity lifecycle evaluator dry-run decisions", () => {
  it("creates a follow-up draft when the last meaningful correspondence is stale OPS outbound", () => {
    expect(
      evaluateOpportunityLifecycle({
        opportunity: opportunity(),
        lifecycleState: null,
        meaningfulEvents: [event()],
        settings,
        now,
      })
    ).toMatchObject({
      action: "create_follow_up_draft",
      dryRun: true,
    });
  });

  it("archives after two unanswered follow-ups plus seven days", () => {
    expect(
      evaluateOpportunityLifecycle({
        opportunity: opportunity(),
        lifecycleState: {
          unansweredFollowUpCount: 2,
          secondFollowUpSentAt: "2026-05-19T17:00:00.000Z",
        },
        meaningfulEvents: [event({ occurredAt: "2026-05-19T17:00:00.000Z" })],
        settings,
        now,
      })
    ).toMatchObject({
      action: "archive_after_two_unanswered_followups",
      dryRun: true,
    });
  });

  it("archives when there has been no meaningful correspondence for more than fourteen days", () => {
    expect(
      evaluateOpportunityLifecycle({
        opportunity: opportunity({
          createdAt: "2026-05-01T18:00:00.000Z",
          stageEnteredAt: "2026-05-01T18:00:00.000Z",
        }),
        lifecycleState: null,
        meaningfulEvents: [],
        settings,
        now,
      })
    ).toMatchObject({
      action: "archive_no_meaningful_correspondence",
      dryRun: true,
    });
  });

  it("surfaces an operator follow-up miss for unreplied inbound under thirty days", () => {
    expect(
      evaluateOpportunityLifecycle({
        opportunity: opportunity(),
        lifecycleState: null,
        meaningfulEvents: [
          event({
            direction: "inbound",
            partyRole: "customer",
            occurredAt: "2026-05-10T18:00:00.000Z",
          }),
        ],
        settings,
        now,
      })
    ).toMatchObject({
      action: "operator_follow_up_miss",
      dryRun: true,
    });
  });

  it("archives unreplied inbound past the no-response window — archive-first (lost/discard deferred to phase C)", () => {
    const decision = evaluateOpportunityLifecycle({
      opportunity: opportunity({ stage: "negotiation" }),
      lifecycleState: null,
      meaningfulEvents: [
        event({
          direction: "inbound",
          partyRole: "customer",
          occurredAt: "2026-04-20T18:00:00.000Z",
        }),
      ],
      settings,
      now,
    });
    expect(decision).toMatchObject({
      action: "archive_operator_no_response",
      dryRun: true,
    });
    // A beyond-qualified archive is the strong lost candidate phase C will
    // reclassify — the evidence flag preserves that signal.
    expect((decision.evidence as { beyondQualified?: boolean }).beyondQualified).toBe(true);
  });

  it("archives an unreplied inbound in an early stage too — the 'forgot to follow up' lead, no beyond-qualified gate", () => {
    const decision = evaluateOpportunityLifecycle({
      opportunity: opportunity({ stage: "new_lead" }),
      lifecycleState: null,
      meaningfulEvents: [
        event({
          direction: "inbound",
          partyRole: "customer",
          occurredAt: "2026-04-20T18:00:00.000Z",
        }),
      ],
      settings,
      now,
    });
    expect(decision).toMatchObject({
      action: "archive_operator_no_response",
      dryRun: true,
    });
    // Early-stage archive → more likely a cold/forgotten lead than a lost deal.
    expect((decision.evidence as { beyondQualified?: boolean }).beyondQualified).toBe(false);
  });

  it("ignores terminal and protected opportunities", () => {
    for (const protectedOpportunity of [
      opportunity({ stage: "won" }),
      opportunity({ stage: "lost" }),
      opportunity({ stage: "discarded" }),
      opportunity({ archivedAt: "2026-05-01T00:00:00.000Z" }),
      opportunity({ deletedAt: "2026-05-01T00:00:00.000Z" }),
      opportunity({ projectId: "project-1" }),
      opportunity({ projectRef: "project-2" }),
    ]) {
      expect(
        evaluateOpportunityLifecycle({
          opportunity: protectedOpportunity,
          lifecycleState: null,
          meaningfulEvents: [event({ occurredAt: "2026-05-01T18:00:00.000Z" })],
          settings,
          now,
        })
      ).toMatchObject({
        action: "no_action",
        ignored: true,
      });
    }
  });

  it("reactivates when an archived opportunity receives a related meaningful inbound", () => {
    expect(
      evaluateOpportunityLifecycle({
        opportunity: opportunity({ archivedAt: "2026-05-20T00:00:00.000Z" }),
        lifecycleState: null,
        meaningfulEvents: [
          event({
            direction: "inbound",
            partyRole: "customer",
            linkedContactKind: "related_contact",
            occurredAt: "2026-05-26T18:00:00.000Z",
          }),
        ],
        settings,
        now,
      })
    ).toMatchObject({
      action: "reactivate_on_related_inbound",
      dryRun: true,
    });
  });
});
