import { describe, expect, it } from "vitest";

import { decideResponseDisposition } from "../response-disposition";
import type { AcceptSignal, CleanMessage } from "../types";

const noAccept: AcceptSignal = {
  detected: false,
  confidence: "low",
  basis: [],
  evidenceMessageIds: [],
};

function customerSaid(body: string): CleanMessage {
  return {
    providerMessageId: "m-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "sarah@gmail.com",
    fromName: "Sarah Lee",
    sentAt: "2026-09-01T12:00:00.000Z",
    cleanBody: body,
    rawBody: body,
    isRealCustomerInbound: true,
    attachments: [],
  };
}

function decide(body: string, scheduleFactsAvailable: boolean | null) {
  return decideResponseDisposition({
    messages: [customerSaid(body)],
    accept: noAccept,
    scheduleFactsAvailable,
  });
}

const SCHEDULE_QUESTIONS = [
  "When can you fit us in?",
  "Can you come out Monday?",
  "Could we move the install to Friday?",
];

describe("decideResponseDisposition — scheduling with verified context", () => {
  it("drafts a scheduling reply when the schedule is verifiably readable", () => {
    for (const body of SCHEDULE_QUESTIONS) {
      expect(decide(body, true)).toEqual({
        disposition: "reply_required",
        mode: "schedule",
        reason:
          "Scheduling question with server-verified schedule context available.",
      });
    }
  });

  it("holds for a human when the schedule read failed", () => {
    for (const body of SCHEDULE_QUESTIONS) {
      expect(decide(body, false)).toEqual({
        disposition: "operator_input_required",
        mode: "schedule",
        reason: "Schedule timing needs calendar verification before reply.",
      });
    }
  });

  it("holds for a human when the schedule was never probed", () => {
    for (const body of SCHEDULE_QUESTIONS) {
      expect(decide(body, null)).toEqual({
        disposition: "operator_input_required",
        mode: "schedule",
        reason: "Schedule timing needs calendar verification before reply.",
      });
    }
  });
});

describe("decideResponseDisposition — non-scheduling messages are unaffected", () => {
  it("still answers a plain question regardless of schedule availability", () => {
    for (const available of [true, false, null] as const) {
      expect(decide("What is the total on the estimate?", available)).toEqual({
        disposition: "reply_required",
        mode: "answer",
        reason:
          "The latest customer message asks a question or requests action.",
      });
    }
  });

  it("still closes the loop on an acknowledgement", () => {
    expect(decide("Thanks!", true)).toEqual({
      disposition: "no_reply_required",
      mode: "no_reply",
      reason: "Latest message closes the loop. No reply needed.",
    });
  });

  it("still holds a material decision reversal even with a readable schedule", () => {
    const decision = decide(
      "Actually, we've decided to hold off on the project for now.",
      true
    );
    expect(decision.disposition).toBe("operator_input_required");
    expect(decision.mode).toBe("clarify");
  });

  it("returns no_reply when there is no real customer inbound at all", () => {
    expect(
      decideResponseDisposition({
        messages: [],
        accept: noAccept,
        scheduleFactsAvailable: true,
      })
    ).toEqual({
      disposition: "no_reply_required",
      mode: "no_reply",
      reason: "No real customer inbound is awaiting a response.",
    });
  });
});
