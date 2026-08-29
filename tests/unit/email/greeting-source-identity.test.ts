import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assembleConversationState,
  type AssembleConversationStateInput,
  type RawThreadMessage,
} from "@/lib/api/services/conversation-state/conversation-state";
import { buildDraftStateContext } from "@/lib/api/services/conversation-state/draft-context";
import type { OperatorIdentity } from "@/lib/api/services/conversation-state/types";

const OPERATOR: OperatorIdentity = {
  emails: new Set(["canprojack@example.com"]),
  domains: new Set(["canprodeck.example"]),
  phones: new Set<string>(),
  addresses: new Set<string>(),
  companyName: "Canpro Deck and Rail",
};

function message(overrides: Partial<RawThreadMessage>): RawThreadMessage {
  return {
    providerMessageId: "message-1",
    fromEmail: "customer@example.com",
    fromName: null,
    toEmails: ["canprojack@example.com"],
    subject: "Deck quote",
    sentAt: "2026-08-20T16:00:00.000Z",
    rawBody: "Can you quote a deck?",
    ...overrides,
  };
}

function state(
  rawMessages: RawThreadMessage[],
  extra: Partial<AssembleConversationStateInput> = {}
) {
  return assembleConversationState({
    threadId: "thread-1",
    connectionId: "connection-1",
    companyId: "company-1",
    operator: OPERATOR,
    stage: "qualifying",
    rawMessages,
    ...extra,
  });
}

const ROSE = message({
  providerMessageId: "message-rose",
  fromEmail: "rose@contractor.example",
  subject: "Deck quote for the Millers",
  sentAt: "2026-08-21T18:00:00.000Z",
  rawBody: "Following up on the Miller deck — can you send pricing?",
});

const MARK = message({
  providerMessageId: "message-mark",
  fromEmail: "mark@homeowner.example",
  subject: "Deck quote for the Millers",
  sentAt: "2026-08-20T16:00:00.000Z",
  rawBody:
    "We are hoping to start in September. What does a 12x16 cedar deck run?\n\nThanks,\nMark",
});

describe("greeting identity on a multi-party thread", () => {
  it("greets the sender of the exact source message, not the newest voice", () => {
    const resolved = state([MARK, ROSE], {
      sourceProviderMessageId: "message-mark",
    });

    expect(resolved.recipient.email).toBe("mark@homeowner.example");
  });

  it("still greets the latest customer when no source message is named", () => {
    const resolved = state([MARK, ROSE]);

    expect(resolved.recipient.email).toBe("rose@contractor.example");
  });

  it("ignores a source id that is not in the thread", () => {
    const resolved = state([MARK, ROSE], {
      sourceProviderMessageId: "message-that-never-arrived",
    });

    expect(resolved.recipient.email).toBe("rose@contractor.example");
  });
});

describe("greeting first name when the provider sends no display name", () => {
  it("reads the name the customer signed off with", () => {
    const resolved = state([MARK], {
      sourceProviderMessageId: "message-mark",
    });
    const context = buildDraftStateContext(resolved);

    expect(context.recipientName).toBeNull();
    expect(context.greetingFirstName).toBe("Mark");
  });

  it("prefers a real display name over the signature", () => {
    const resolved = state([
      { ...MARK, fromName: "Mark Whitfield" },
    ]);
    const context = buildDraftStateContext(resolved);

    expect(context.greetingFirstName).toBe("Mark");
    expect(context.recipientName).toBe("Mark Whitfield");
  });

  it("never guesses a name from a signature-less message", () => {
    const resolved = state([
      message({
        providerMessageId: "message-plain",
        rawBody: "What does a 12x16 cedar deck run? Hoping to start soon.",
      }),
    ]);
    const context = buildDraftStateContext(resolved);

    expect(context.greetingFirstName).toBeNull();
  });

  it("never mistakes a closing word for a name", () => {
    for (const closing of [
      "Thanks",
      "Regards",
      "Cheers",
      "Best regards",
      "Sincerely",
    ]) {
      const resolved = state([
        message({
          providerMessageId: `message-${closing.replace(/\s+/g, "-")}`,
          rawBody: `Can you quote the deck?\n\n${closing}`,
        }),
      ]);

      expect(buildDraftStateContext(resolved).greetingFirstName).toBeNull();
    }
  });

  it("never returns an address, a phone, or a sentence as a name", () => {
    for (const trailer of [
      "mark@homeowner.example",
      "604-555-0134",
      "Looking forward to hearing back from you soon about this",
      "18 Cedar Road, Vancouver",
    ]) {
      const resolved = state([
        message({
          providerMessageId: "message-trailer",
          rawBody: `Can you quote the deck?\n\nThanks,\n${trailer}`,
        }),
      ]);

      expect(buildDraftStateContext(resolved).greetingFirstName).toBeNull();
    }
  });
});

describe("drafter wiring", () => {
  it("hands the authorized source message id to the state builder", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/api/services/ai-draft-service.ts"),
      "utf8"
    );

    expect(source).toMatch(
      /buildConversationState\(\s*internalThreadId,\s*authorizedSourceActivity\?\.email_message_id \?\? null\s*\)/
    );
  });
});
