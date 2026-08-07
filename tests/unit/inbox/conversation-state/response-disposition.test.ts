import { describe, expect, it } from "vitest";

import { decideResponseDisposition } from "@/lib/api/services/conversation-state/response-disposition";
import type {
  AcceptSignal,
  CleanMessage,
} from "@/lib/api/services/conversation-state/types";

const noAccept: AcceptSignal = {
  detected: false,
  confidence: "low",
  basis: [],
  evidenceMessageIds: [],
};

function inbound(body: string, over: Partial<CleanMessage> = {}): CleanMessage {
  return {
    providerMessageId: "message-1",
    direction: "inbound",
    partyRole: "customer",
    fromEmail: "customer@example.com",
    fromName: "Customer",
    sentAt: "2026-08-07T16:00:00.000Z",
    cleanBody: body,
    rawBody: body,
    isRealCustomerInbound: true,
    attachments: [],
    ...over,
  };
}

describe("decideResponseDisposition", () => {
  it.each([
    "I appreciate it!",
    "Ok thanks",
    "Thank you",
    "You're welcome",
    "All sounds great! Have a good day!",
    "The return was submitted.",
    "Thanks for the quote.",
    "Quote received, thanks.",
    "I can send the photos later.",
    "I will let you know when we are ready.",
    "We will review this and get back to you.",
  ])("does not manufacture a reply to a closed-loop message: %s", (body) => {
    expect(
      decideResponseDisposition({ messages: [inbound(body)], accept: noAccept })
    ).toMatchObject({ disposition: "no_reply_required", mode: "no_reply" });
  });

  it("lets a real request outrank acknowledgement language", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("Thanks — can you also install the gate?")],
        accept: noAccept,
      })
    ).toMatchObject({ disposition: "reply_required", mode: "answer" });
  });

  it("requires a reply to a high-confidence acceptance", () => {
    const accept: AcceptSignal = {
      detected: true,
      confidence: "high",
      basis: ["explicit_accept_language"],
      evidenceMessageIds: ["message-1"],
    };

    expect(
      decideResponseDisposition({
        messages: [inbound("Yes, let's go ahead with the quote.")],
        accept,
      })
    ).toMatchObject({ disposition: "reply_required", mode: "close_loop" });
  });

  it("does not let an earlier acceptance override the latest acknowledgement", () => {
    const accept: AcceptSignal = {
      detected: true,
      confidence: "high",
      basis: ["explicit_accept_language"],
      evidenceMessageIds: ["message-accept"],
    };

    expect(
      decideResponseDisposition({
        messages: [
          inbound("Yes, let's go ahead.", {
            providerMessageId: "message-accept",
            sentAt: "2026-08-07T15:00:00.000Z",
          }),
          inbound("Thanks for the quote.", {
            providerMessageId: "message-thanks",
            sentAt: "2026-08-07T16:00:00.000Z",
          }),
        ],
        accept,
      })
    ).toMatchObject({ disposition: "no_reply_required", mode: "no_reply" });
  });

  it.each([
    "We have decided not to go ahead.",
    "Please hold off for now — we are not ready to proceed.",
    "We changed our mind and need to cancel the project.",
  ])("holds a material decision reversal for operator review: %s", (body) => {
    expect(
      decideResponseDisposition({
        messages: [inbound(body)],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "operator_input_required",
      mode: "clarify",
    });
  });

  it("holds an availability question when no verified schedule context exists", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("Are you available August 13 or 14?")],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "operator_input_required",
      mode: "schedule",
    });
  });

  it("holds a declarative schedule change for operator review", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("Let's move it to Thursday at 8.")],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "operator_input_required",
      mode: "schedule",
    });
  });

  it.each([
    "I will send the photos on Tuesday.",
    "Thanks for coming by Tuesday.",
  ])("does not treat an ordinary weekday mention as scheduling: %s", (body) => {
    expect(
      decideResponseDisposition({ messages: [inbound(body)], accept: noAccept })
    ).toMatchObject({ disposition: "no_reply_required", mode: "no_reply" });
  });

  it("does not mistake an ordinary weekday for scheduling when intent still needs review", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("We reviewed the estimate on Monday.")],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "operator_input_required",
      mode: "clarify",
    });
  });

  it("answers a timed document request without treating it as an appointment", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("Can you send the revised quote by Tuesday?")],
        accept: noAccept,
      })
    ).toMatchObject({ disposition: "reply_required", mode: "answer" });
  });

  it.each([
    "The deposit has not been paid.",
    "The form was not submitted.",
    "The transfer still isn't done.",
    "The deposit for the project, after we checked with accounting, has not yet been paid.",
  ])(
    "holds an incomplete administrative step for operator review: %s",
    (body) => {
      expect(
        decideResponseDisposition({
          messages: [inbound(body)],
          accept: noAccept,
        })
      ).toMatchObject({
        disposition: "operator_input_required",
        mode: "clarify",
      });
    }
  );

  it.each([
    "Please send the revised estimate.",
    "Could you confirm the total?",
    "Let me know whether the gate is included.",
  ])(
    "recognizes a direct request without relying on bare action words: %s",
    (body) => {
      expect(
        decideResponseDisposition({
          messages: [inbound(body)],
          accept: noAccept,
        })
      ).toMatchObject({ disposition: "reply_required", mode: "answer" });
    }
  );

  it("fails an unknown declarative intent to operator review instead of drafting or suppressing it", () => {
    expect(
      decideResponseDisposition({
        messages: [inbound("The measurements changed after the site visit.")],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "operator_input_required",
      mode: "clarify",
    });
  });

  it("acknowledges and advances when the latest customer message carries genuinely new material", () => {
    expect(
      decideResponseDisposition({
        messages: [
          inbound("Here are the photos.", {
            attachments: [
              {
                filename: "deck.jpg",
                mimeType: "image/jpeg",
                sizeBytes: 400_000,
                kind: "image",
                requiresInspection: true,
                inspection: {
                  summary: "deck photo",
                  isSignedEstimate: false,
                  facts: {},
                  model: "gpt-5.4",
                },
              },
            ],
          }),
        ],
        accept: noAccept,
      })
    ).toMatchObject({
      disposition: "reply_required",
      mode: "acknowledge_and_advance",
    });
  });
});
