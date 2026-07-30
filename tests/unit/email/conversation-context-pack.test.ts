import { describe, expect, it } from "vitest";

import {
  MAX_CONVERSATION_CONTEXT_RETRIEVAL_ROUNDS,
  buildConversationContextPack,
  canRetrieveConversationContext,
  countConversationTokens,
  retrieveConversationContext,
} from "@/lib/api/services/conversation-context-pack";
import type { TrustedEmailMessage } from "@/lib/api/services/conversation-fact-fold";

function message(
  index: number,
  overrides: Partial<TrustedEmailMessage> = {}
): TrustedEmailMessage {
  const inbound = index % 2 === 0;
  return {
    activityId: `activity-${index}`,
    eventId: `event-${index}`,
    evidenceKey: `event-${index}`,
    providerMessageId: `message-${index}`,
    providerThreadId: "thread-authorized",
    connectionId: "connection-1",
    occurredAt: new Date(Date.UTC(2026, 6, 1 + index, 12)).toISOString(),
    direction: inbound ? "inbound" : "outbound",
    authorRole: inbound ? "customer" : "operator",
    subject: "Deck estimate",
    body: `Conversation message ${index}.`,
    ...overrides,
  };
}

describe("conversation context pack", () => {
  it("uses deterministic model token counts and stays inside its hard budget", () => {
    const input = {
      messages: Array.from({ length: 12 }, (_, index) =>
        message(index, {
          body: `Message ${index} ${"detail ".repeat(50)}`,
        })
      ),
      olderSummary: "The customer wants a cedar deck.",
      currentFacts: { stage: "quoted", contact: "Kevin Falk" },
      tokenBudget: 700,
    };

    const first = buildConversationContextPack(input);
    const second = buildConversationContextPack(input);

    expect(first.tokenCount).toBe(second.tokenCount);
    expect(first.promptText).toBe(second.promptText);
    expect(first.tokenCount).toBe(countConversationTokens(first.promptText));
    expect(first.tokenCount).toBeLessThanOrEqual(700);
  });

  it("chunks oversized bodies and reports exactly what was clipped", () => {
    const messages = [
      ...Array.from({ length: 8 }, (_, index) =>
        message(index, {
          body: `Recent ${index}: ${"update ".repeat(45)}`,
        })
      ),
      message(8, {
        body: Array.from(
          { length: 20 },
          (_, index) => `Paragraph ${index}: ${"scope ".repeat(80)}`
        ).join("\n\n"),
      }),
    ];

    const pack = buildConversationContextPack({
      messages,
      olderSummary: "Older context summary",
      currentFacts: { stage: "quoted" },
      tokenBudget: 650,
      maxChunkTokens: 120,
    });

    expect(pack.manifest.clipped).toBe(true);
    expect(pack.manifest.totalMessages).toBe(9);
    expect(pack.manifest.omittedMessages).toBeGreaterThan(0);
    expect(pack.manifest.retrievalAvailable).toBe(true);
    expect(pack.manifest.partialMessageIds).toContain("message-8");
    expect(pack.manifest.omittedDateRange).not.toBeNull();
    expect(pack.promptText).toContain("CONTEXT MANIFEST");
    expect(pack.selectedChunks.some((chunk) => chunk.partial)).toBe(true);
  });

  it("prioritizes the latest customer inbound and recent alternating turns", () => {
    const messages = Array.from({ length: 10 }, (_, index) =>
      message(index, {
        body: `Turn ${index}: ${"context ".repeat(35)}`,
      })
    );
    const pack = buildConversationContextPack({
      messages,
      currentFacts: { stage: "negotiation" },
      tokenBudget: 520,
    });

    expect(pack.manifest.includedMessageIds).toContain("message-8");
    expect(pack.selectedChunks.at(-1)?.messageId).toBe("message-9");
    expect(
      new Set(pack.selectedChunks.map((chunk) => chunk.authorRole))
    ).toEqual(new Set(["customer", "operator"]));
  });

  it("retrieves only authorized older evidence by fact, query, date, and evidence key", () => {
    const authorized = [
      message(0, {
        evidenceKey: "old-price",
        body: "The revised total is $8,400 including glass railing.",
      }),
      message(1, {
        evidenceKey: "old-schedule",
        body: "Installation is booked for Friday morning.",
      }),
      message(2, {
        evidenceKey: "recent-neutral",
        body: "Thanks for the update.",
      }),
    ];

    const result = retrieveConversationContext({
      messages: authorized,
      request: {
        factKind: "price",
        query: "glass railing total",
        evidenceKeys: ["old-price", "not-authorized"],
        before: "2026-07-02T00:00:00.000Z",
      },
      tokenBudget: 220,
    });

    expect(result.unresolved).toBe(false);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      evidenceKey: "old-price",
      providerThreadId: "thread-authorized",
    });
    expect(result.text).toContain("$8,400");
    expect(result.text).not.toContain("Friday morning");
    expect(result.text).not.toContain("not-authorized");
  });

  it("hard-stops automatic retrieval after two rounds", () => {
    expect(MAX_CONVERSATION_CONTEXT_RETRIEVAL_ROUNDS).toBe(2);
    expect(canRetrieveConversationContext(0)).toBe(true);
    expect(canRetrieveConversationContext(1)).toBe(true);
    expect(canRetrieveConversationContext(2)).toBe(false);
  });
});
