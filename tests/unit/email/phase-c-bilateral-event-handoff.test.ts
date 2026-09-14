import { describe, expect, it, vi } from "vitest";

import {
  evaluatePhaseCBilateralEvent,
  persistPhaseCBilateralEventHandoff,
  type PhaseCEventMessage,
} from "@/lib/email/phase-c-bilateral-event-handoff";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

function message(
  overrides: Partial<PhaseCEventMessage> &
    Pick<
      PhaseCEventMessage,
      "eventId" | "providerMessageId" | "direction" | "body"
    >
): PhaseCEventMessage {
  const outbound = overrides.direction === "outbound";
  return {
    eventId: overrides.eventId,
    providerMessageId: overrides.providerMessageId,
    direction: overrides.direction,
    occurredAt:
      overrides.occurredAt ??
      (outbound ? "2026-08-20T16:00:00.000Z" : "2026-08-20T17:00:00.000Z"),
    fromEmail:
      overrides.fromEmail ??
      (outbound ? "operator@example.com" : "customer@example.com"),
    toEmails:
      overrides.toEmails ??
      (outbound ? ["customer@example.com"] : ["operator@example.com"]),
    ccEmails: overrides.ccEmails ?? [],
    subject: overrides.subject ?? "Re: Site visit",
    body: overrides.body,
  };
}

function evaluate(messages: PhaseCEventMessage[]) {
  return evaluatePhaseCBilateralEvent({
    messages,
    defaultTimeZone: "America/Vancouver",
    requestedOwnerUserId: OWNER_ID,
    leadTitle: "Owen Schellenberger",
    leadAddress: "2745 Fernwood Rd, Victoria BC",
    operatorEmails: ["operator@example.com"],
    customerEmails: ["customer@example.com"],
  });
}

describe("Phase C bilateral event handoff", () => {
  it("keeps Crystal's call request in review without inventing a booking", () => {
    const result = evaluate([
      message({
        eventId: "event-crystal",
        providerMessageId: "1a01fbc3eba7a4fb",
        direction: "inbound",
        subject: "Re: Deck quote",
        body: "I'd like to set up a call to discuss moving forward with your quote.",
      }),
    ]);

    expect(result).toMatchObject({
      status: "review",
      reviewReason: "event_date_or_time_unresolved",
      proposalEventId: "event-crystal",
      acceptanceEventId: null,
      eventKind: "call",
      startsAt: null,
    });
  });

  it("emits a ready site-visit envelope only after the customer accepts the exact proposal", () => {
    const result = evaluate([
      message({
        eventId: "event-proposal",
        providerMessageId: "message-proposal",
        direction: "outbound",
        body: "Can we book a site visit for Thursday August 27 at 2:00 p.m. at 2745 Fernwood Rd?",
      }),
      message({
        eventId: "event-acceptance",
        providerMessageId: "message-acceptance",
        direction: "inbound",
        occurredAt: "2026-08-21T17:00:00.000Z",
        body: "Thursday August 27 at 2:00 p.m. works for us. Confirmed.",
      }),
    ]);

    expect(result).toEqual({
      status: "ready",
      reviewReason: null,
      proposalEventId: "event-proposal",
      proposalMessageId: "message-proposal",
      acceptanceEventId: "event-acceptance",
      acceptanceMessageId: "message-acceptance",
      requestedOwnerUserId: OWNER_ID,
      eventKind: "site_visit",
      eventTitle: "Site visit — Owen Schellenberger",
      startsAt: "2026-08-27T21:00:00.000Z",
      endsAt: "2026-08-27T22:00:00.000Z",
      eventTimezone: "America/Vancouver",
      location: "2745 Fernwood Rd",
      attendees: [
        { email: "customer@example.com", role: "customer" },
        { email: "operator@example.com", role: "operator" },
      ],
    });
  });

  it("requires acceptance of the latest counterproposal", () => {
    const result = evaluate([
      message({
        eventId: "event-original",
        providerMessageId: "message-original",
        direction: "outbound",
        body: "Can we meet Wednesday August 26 at 10:00 a.m.?",
      }),
      message({
        eventId: "event-counter",
        providerMessageId: "message-counter",
        direction: "inbound",
        body: "Could we do Thursday August 27 at 2:00 p.m. instead?",
      }),
      message({
        eventId: "event-counter-accepted",
        providerMessageId: "message-counter-accepted",
        direction: "outbound",
        occurredAt: "2026-08-20T18:00:00.000Z",
        body: "Thursday August 27 at 2:00 p.m. works. Confirmed.",
      }),
    ]);

    expect(result).toMatchObject({
      status: "ready",
      proposalEventId: "event-counter",
      acceptanceEventId: "event-counter-accepted",
      startsAt: "2026-08-27T21:00:00.000Z",
    });
  });

  it("never counts quoted history as authored bilateral acceptance", () => {
    const result = evaluate([
      message({
        eventId: "event-proposal",
        providerMessageId: "message-proposal",
        direction: "outbound",
        body: "Can we book a site visit Thursday August 27 at 2:00 p.m.?",
      }),
      message({
        eventId: "event-quote-only",
        providerMessageId: "message-quote-only",
        direction: "inbound",
        body: [
          "On Thu, Aug 20, 2026 at 9:00 AM Operator wrote:",
          "> Can we book a site visit Thursday August 27 at 2:00 p.m.?",
          "> Confirmed.",
        ].join("\n"),
      }),
    ]);

    expect(result).toMatchObject({
      status: "review",
      reviewReason: "bilateral_confirmation_missing",
      proposalEventId: "event-proposal",
      acceptanceEventId: null,
    });
  });

  it("routes an unknown participant's confirmation to review", () => {
    const result = evaluate([
      message({
        eventId: "event-proposal",
        providerMessageId: "message-proposal",
        direction: "outbound",
        body: "Can we meet Thursday August 27 at 2:00 p.m.?",
      }),
      message({
        eventId: "event-unknown",
        providerMessageId: "message-unknown",
        direction: "inbound",
        fromEmail: "landlord@example.net",
        body: "Thursday August 27 at 2:00 p.m. works. Confirmed.",
      }),
    ]);

    expect(result).toMatchObject({
      status: "review",
      reviewReason: "event_participant_authority_unresolved",
      acceptanceEventId: null,
    });
  });

  it("persists the auditable decision before one idempotent OPS handoff and never books a provider", async () => {
    const evaluation = evaluate([
      message({
        eventId: "event-proposal",
        providerMessageId: "message-proposal",
        direction: "outbound",
        body: "Can we book a site visit Thursday August 27 at 2:00 p.m.?",
      }),
      message({
        eventId: "event-acceptance",
        providerMessageId: "message-acceptance",
        direction: "inbound",
        body: "Confirmed. Thursday August 27 at 2:00 p.m. works for us.",
      }),
    ]);
    expect(evaluation.status).toBe("ready");

    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "record_opportunity_lifecycle_decision") {
        return { data: { id: "decision-1", status: "proposed" }, error: null };
      }
      if (name === "record_phase_c_bilateral_event_handoff") {
        return {
          data: {
            id: "handoff-1",
            idempotency_key: params.p_idempotency_key,
            status: "ready",
            initial_status: "ready",
            initial_review_reason: null,
            review_reason: null,
          },
          error: null,
        };
      }
      if (name === "settle_opportunity_lifecycle_decision") {
        return {
          data: { id: "decision-1", status: "applied" },
          error: null,
        };
      }
      throw new Error(`unexpected RPC ${name}`);
    });

    const first = await persistPhaseCBilateralEventHandoff({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      evaluation: evaluation as Exclude<typeof evaluation, { status: "none" }>,
    });
    const second = await persistPhaseCBilateralEventHandoff({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      evaluation: evaluation as Exclude<typeof evaluation, { status: "none" }>,
    });

    expect(first).toEqual(second);
    expect(rpc.mock.calls.slice(0, 3).map(([name]) => name)).toEqual([
      "record_opportunity_lifecycle_decision",
      "record_phase_c_bilateral_event_handoff",
      "settle_opportunity_lifecycle_decision",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "record_phase_c_bilateral_event_handoff",
      expect.objectContaining({
        p_proposal_event_id: "event-proposal",
        p_acceptance_event_id: "event-acceptance",
        p_status: "ready",
      })
    );
    expect(
      rpc.mock.calls.some(([name]) =>
        /calendar|site_visit|google|microsoft/i.test(name)
      )
    ).toBe(false);
  });

  it("persists unresolved intent as review with no fabricated acceptance", async () => {
    const evaluation = evaluate([
      message({
        eventId: "event-crystal",
        providerMessageId: "message-crystal",
        direction: "inbound",
        body: "I'd like to set up a call to discuss moving forward.",
      }),
    ]);
    expect(evaluation.status).toBe("review");
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "record_opportunity_lifecycle_decision") {
        return {
          data: { id: "decision-review", status: "review" },
          error: null,
        };
      }
      return {
        data: {
          id: "handoff-review",
          idempotency_key: params.p_idempotency_key,
          status: "review",
          initial_status: "review",
          initial_review_reason: params.p_review_reason,
          review_reason: params.p_review_reason,
        },
        error: null,
      };
    });

    await persistPhaseCBilateralEventHandoff({
      supabase: { rpc } as never,
      companyId: COMPANY_ID,
      opportunityId: OPPORTUNITY_ID,
      evaluation: evaluation as Exclude<typeof evaluation, { status: "none" }>,
    });

    expect(rpc).toHaveBeenCalledWith(
      "record_phase_c_bilateral_event_handoff",
      expect.objectContaining({
        p_proposal_event_id: "event-crystal",
        p_acceptance_event_id: null,
        p_status: "review",
        p_review_reason: "event_date_or_time_unresolved",
      })
    );
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("persisted handoff lifecycle replay", () => {
  const evaluation = {
    status: "ready" as const,
    reviewReason: null,
    proposalEventId: "6939bdfb-a52d-4c67-9dd2-07a8cb7d0849",
    proposalMessageId: "proposal-message",
    acceptanceEventId: "92bad29c-d534-4d6d-ab64-34141811deb1",
    acceptanceMessageId: "acceptance-message",
    requestedOwnerUserId: OWNER_ID,
    eventKind: "site_visit" as const,
    eventTitle: "Site visit",
    startsAt: "2026-08-27T21:00:00.000Z",
    endsAt: "2026-08-27T22:00:00.000Z",
    eventTimezone: "America/Vancouver",
    location: null,
    attendees: [
      { email: "customer@example.com", role: "customer" as const },
      { email: "operator@example.com", role: "operator" as const },
    ],
  };

  function persistedRow(
    overrides: Record<string, unknown>,
    error: { message: string } | null = null
  ) {
    const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === "record_opportunity_lifecycle_decision") {
        return { data: { id: "decision-1", status: "applied" }, error: null };
      }
      if (name === "record_phase_c_bilateral_event_handoff") {
        return {
          data: [
            {
              id: "adb94ea2-1da9-41f5-8691-fd4e165be807",
              idempotency_key: params.p_idempotency_key,
              company_id: COMPANY_ID,
              opportunity_id: OPPORTUNITY_ID,
              decision_id: "decision-1",
              proposal_event_id: evaluation.proposalEventId,
              acceptance_event_id: evaluation.acceptanceEventId,
              requested_owner_user_id: OWNER_ID,
              initial_status: "ready",
              initial_review_reason: null,
              status: "ready",
              review_reason: null,
              ...overrides,
            },
          ],
          error,
        };
      }
      if (name === "settle_opportunity_lifecycle_decision") {
        return { data: { id: "decision-1", status: "applied" }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    return rpc;
  }

  it.each([
    ["review", "event_time_unresolved"],
    ["consumed", null],
    ["cancelled", null],
  ] as const)(
    "preserves a ready handoff that has moved to %s",
    async (status, reviewReason) => {
      const rpc = persistedRow({ status, review_reason: reviewReason });
      await expect(
        persistPhaseCBilateralEventHandoff({
          supabase: { rpc },
          companyId: COMPANY_ID,
          opportunityId: OPPORTUNITY_ID,
          evaluation,
        })
      ).resolves.toMatchObject({
        id: "adb94ea2-1da9-41f5-8691-fd4e165be807",
        status,
        reviewReason,
      });
      expect(rpc.mock.calls.map(([name]) => name)).toEqual([
        "record_opportunity_lifecycle_decision",
        "record_phase_c_bilateral_event_handoff",
        "settle_opportunity_lifecycle_decision",
      ]);
    }
  );

  it.each([
    ["immutable initial status", { initial_status: "review" }],
    ["missing immutable status", { initial_status: undefined }],
    [
      "immutable review reason",
      { initial_review_reason: "event_owner_unresolved" },
    ],
    ["missing immutable reason", { initial_review_reason: undefined }],
    ["idempotency key", { idempotency_key: "other-proposal" }],
    ["unknown current status", { status: "unknown" }],
    ["missing current status", { status: undefined }],
    ["review without reason", { status: "review", review_reason: null }],
    ["malformed current reason", { review_reason: 12 }],
  ])("rejects a mismatched or malformed %s", async (_name, overrides) => {
    const rpc = persistedRow(overrides);
    await expect(
      persistPhaseCBilateralEventHandoff({
        supabase: { rpc },
        companyId: COMPANY_ID,
        opportunityId: OPPORTUNITY_ID,
        evaluation,
      })
    ).rejects.toThrow("Phase C bilateral event handoff returned no result");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("retains the database immutable-proposal conflict instead of acknowledging it", async () => {
    const rpc = persistedRow(
      { status: "review", review_reason: "event_time_unresolved" },
      { message: "bilateral_event_handoff_replay_conflict" }
    );
    await expect(
      persistPhaseCBilateralEventHandoff({
        supabase: { rpc },
        companyId: COMPANY_ID,
        opportunityId: OPPORTUNITY_ID,
        evaluation,
      })
    ).rejects.toThrow("bilateral_event_handoff_replay_conflict");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
