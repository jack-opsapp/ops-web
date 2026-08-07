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
