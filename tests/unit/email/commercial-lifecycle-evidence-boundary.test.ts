import { describe, expect, it } from "vitest";

// lifecycleEvidenceForOutcome is exported solely for this boundary contract.
import { lifecycleEvidenceForOutcome } from "@/lib/api/services/conversation-state/acceptance-evaluation";

const DECISIVE = "22222222-2222-4222-8222-222222222222";

function event(id: string, messageId: string, occurredAt: string) {
  return {
    id,
    activity_id: null,
    connection_id: "33333333-3333-4333-8333-333333333333",
    provider_thread_id: "thread-1",
    provider_message_id: messageId,
    direction: "inbound",
    party_role: "customer",
    from_email: "c@example.com",
    to_emails: [],
    cc_emails: [],
    occurred_at: occurredAt,
  } as never;
}

function message(evidenceKey: string, providerMessageId: string) {
  return {
    evidenceKey,
    connectionId: "33333333-3333-4333-8333-333333333333",
    providerThreadId: "thread-1",
    providerMessageId,
    occurredAt: "2026-09-01T00:00:00.000Z",
    direction: "inbound",
    authorRole: "customer",
    subject: "",
    body: "",
  } as never;
}

describe("commercial lifecycle evidence boundary", () => {
  const events = [
    event("11111111-1111-4111-8111-111111111111", "m1", "2026-08-30T00:00:00Z"),
    event(DECISIVE, "m2", "2026-08-31T00:00:00Z"),
    event("33333333-3333-4333-8333-333333333334", "m3", "2026-09-01T00:00:00Z"),
  ];
  const messages = [
    message("11111111-1111-4111-8111-111111111111", "m1"),
    message(DECISIVE, "m2"),
    message("33333333-3333-4333-8333-333333333334", "m3"),
  ];
  const outcome = {
    decisiveEvidenceKey: DECISIVE,
    decisiveMessageId: "m2",
    evidenceMessageIds: ["m1", "m2", "m3"],
  } as never;

  it("excludes events that arrived after the decisive event", () => {
    const evidence = lifecycleEvidenceForOutcome({ outcome, events, messages });
    expect(evidence.evidenceEventIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      DECISIVE,
    ]);
    expect(evidence.evidenceMessageIds).toEqual(["m1", "m2"]);
    expect(evidence.sourceEventId).toBe(DECISIVE);
  });

  // The real drift: the detector's own evidenceMessageIds set expands as mail
  // lands, so a weaker test that only appends an event the detector never named
  // would pass even without the boundary. Expand both.
  it("is stable when later correspondence keeps arriving", () => {
    const first = lifecycleEvidenceForOutcome({ outcome, events, messages });
    const later = lifecycleEvidenceForOutcome({
      outcome: {
        decisiveEvidenceKey: DECISIVE,
        decisiveMessageId: "m2",
        evidenceMessageIds: ["m1", "m2", "m3", "m4"],
      } as never,
      events: [
        ...events,
        event(
          "44444444-4444-4444-8444-444444444444",
          "m4",
          "2026-09-02T00:00:00Z"
        ),
      ],
      messages: [
        ...messages,
        message("44444444-4444-4444-8444-444444444444", "m4"),
      ],
    });
    expect(later.evidenceEventIds).toEqual(first.evidenceEventIds);
    expect(later.evidenceMessageIds).toEqual(first.evidenceMessageIds);
  });

  it("always includes the decisive event, satisfying the receipt precondition", () => {
    const evidence = lifecycleEvidenceForOutcome({ outcome, events, messages });
    expect(evidence.evidenceEventIds).toContain(evidence.sourceEventId);
  });

  it("throws when the decisive event is absent from the loaded episode", () => {
    expect(() =>
      lifecycleEvidenceForOutcome({ outcome, events: [events[0]], messages })
    ).toThrow(/no decisive event/i);
  });
});
