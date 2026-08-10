import { describe, expect, it } from "vitest";

import { resolveConversationAnchor } from "../resolve-conversation";
import { resolveParticipantSide } from "../resolve-participant-side";

describe("job conversation anchors", () => {
  it("keeps a converted opportunity and project on the opportunity conversation", () => {
    expect(
      resolveConversationAnchor({
        eventOpportunityId: "00000000-0000-4000-8000-000000000101",
        activityOpportunityId: "00000000-0000-4000-8000-000000000101",
        activityProjectId: "00000000-0000-4000-8000-000000000201",
      })
    ).toEqual({
      kind: "opportunity",
      id: "00000000-0000-4000-8000-000000000101",
    });
  });

  it("uses a project anchor only when no durable opportunity anchor exists", () => {
    expect(
      resolveConversationAnchor({
        eventOpportunityId: null,
        activityOpportunityId: null,
        activityProjectId: "00000000-0000-4000-8000-000000000201",
      })
    ).toEqual({
      kind: "project",
      id: "00000000-0000-4000-8000-000000000201",
    });
  });

  it("rejects conflicting durable opportunity evidence instead of guessing", () => {
    expect(() =>
      resolveConversationAnchor({
        eventOpportunityId: "00000000-0000-4000-8000-000000000101",
        activityOpportunityId: "00000000-0000-4000-8000-000000000102",
        activityProjectId: null,
      })
    ).toThrow("CONVERSATION_ANCHOR_CONFLICT");
  });

  it("does not use a provider thread as the conversation boundary", () => {
    const firstSource = {
      providerThreadId: "provider-thread-shared-across-jobs",
      eventOpportunityId: "00000000-0000-4000-8000-000000000101",
      activityOpportunityId: "00000000-0000-4000-8000-000000000101",
      activityProjectId: null,
    };
    const returningCustomerSource = {
      providerThreadId: "provider-thread-shared-across-jobs",
      eventOpportunityId: "00000000-0000-4000-8000-000000000102",
      activityOpportunityId: "00000000-0000-4000-8000-000000000102",
      activityProjectId: null,
    };

    expect(resolveConversationAnchor(firstSource)).not.toEqual(
      resolveConversationAnchor(returningCustomerSource)
    );
  });
});

describe("delivered-turn participant sides", () => {
  const inboundBase = {
    direction: "inbound" as const,
    partyRole: "customer",
    sourceActivityId: "00000000-0000-4000-8000-000000000301",
    senderEmail: " CUSTOMER@Example.com ",
    actorUserId: null,
  };

  it.each([
    ["client", "00000000-0000-4000-8000-000000000401"],
    ["sub_client", "00000000-0000-4000-8000-000000000402"],
    ["related_contact", "customer@example.com"],
  ] as const)(
    "maps one confirmed %s inbound participant to user",
    (kind, id) => {
      expect(
        resolveParticipantSide({
          ...inboundBase,
          confirmedCustomerParticipants: [{ kind, id }],
        })
      ).toEqual({
        side: "user",
        participantId: `${kind}:${id}`,
        status: "resolved",
        revision: "job-participant-side:v1",
      });
    }
  );

  it("keeps multiple matching customer identities ambiguous", () => {
    expect(
      resolveParticipantSide({
        ...inboundBase,
        confirmedCustomerParticipants: [
          {
            kind: "client",
            id: "00000000-0000-4000-8000-000000000401",
          },
          {
            kind: "sub_client",
            id: "00000000-0000-4000-8000-000000000402",
          },
        ],
      })
    ).toEqual({
      side: null,
      participantId: "ambiguous:email:customer@example.com",
      status: "ambiguous",
      revision: "job-participant-side:v1",
    });
  });

  it("never guesses a customer-role inbound sender with no confirmed identity", () => {
    expect(
      resolveParticipantSide({
        ...inboundBase,
        confirmedCustomerParticipants: [],
      })
    ).toEqual({
      side: null,
      participantId: "ambiguous:email:customer@example.com",
      status: "ambiguous",
      revision: "job-participant-side:v1",
    });
  });

  it("keeps a high-confidence thread marker ambiguous without an independently confirmed customer", () => {
    expect(
      resolveParticipantSide({
        ...inboundBase,
        confirmedCustomerParticipants: [
          {
            kind: "high_confidence_related_contact",
            id: "customer@example.com",
          },
        ],
      })
    ).toEqual({
      side: null,
      participantId: "ambiguous:email:customer@example.com",
      status: "ambiguous",
      revision: "job-participant-side:v1",
    });
  });

  it("maps an OPS-delivered outbound message to assistant", () => {
    expect(
      resolveParticipantSide({
        direction: "outbound",
        partyRole: "ops",
        sourceActivityId: "00000000-0000-4000-8000-000000000301",
        senderEmail: "ops@example.com",
        actorUserId: "00000000-0000-4000-8000-000000000501",
        confirmedCustomerParticipants: [],
      })
    ).toEqual({
      side: "assistant",
      participantId: "ops_user:00000000-0000-4000-8000-000000000501",
      status: "resolved",
      revision: "job-participant-side:v1",
    });
  });

  it("keeps an outbound message not proven as OPS ambiguous", () => {
    expect(
      resolveParticipantSide({
        direction: "outbound",
        partyRole: "unknown",
        sourceActivityId: "00000000-0000-4000-8000-000000000301",
        senderEmail: "unknown@example.com",
        actorUserId: null,
        confirmedCustomerParticipants: [],
      })
    ).toEqual({
      side: null,
      participantId: "ambiguous:email:unknown@example.com",
      status: "ambiguous",
      revision: "job-participant-side:v1",
    });
  });
});
