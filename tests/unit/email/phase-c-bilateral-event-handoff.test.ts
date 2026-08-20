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
