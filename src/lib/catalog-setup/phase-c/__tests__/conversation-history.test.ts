import { describe, expect, it } from "vitest";
import {
  advanceGuidedConversation,
  normalizeGuidedConversation,
} from "../conversation-history";
import type { GuidedQuestion } from "../types";

const currentQuestion: GuidedQuestion = {
  id: "service",
  prompt: "What service do you want to set up first?",
  answerKind: "text",
  factKeys: ["customer_products.first_service_line"],
};

describe("Phase C durable conversation history", () => {
  it("seeds the current assistant question for a legacy active session", () => {
    expect(
      normalizeGuidedConversation([], [currentQuestion], 4),
    ).toEqual([
      {
        id: "assistant:4:service",
        role: "assistant",
        kind: "text",
        content: "What service do you want to set up first?",
        version: 4,
      },
    ]);
  });

  it("advances the transcript once with the answer and next question", () => {
    const conversation = normalizeGuidedConversation(
      [],
      [currentQuestion],
      4,
    );
    const nextQuestion: GuidedQuestion = {
      id: "supplier",
      prompt: "Which supplier do you use?",
      answerKind: "text",
      factKeys: ["suppliers.primary"],
    };

    expect(
      advanceGuidedConversation({
        conversation,
        currentQuestion,
        answer: "Vinyl membrane installation",
        nextQuestion,
        nextVersion: 5,
      }),
    ).toEqual([
      conversation[0],
      {
        id: "operator:5:service",
        role: "operator",
        kind: "text",
        content: "Vinyl membrane installation",
        version: 5,
      },
      {
        id: "assistant:5:supplier",
        role: "assistant",
        kind: "text",
        content: "Which supplier do you use?",
        version: 5,
      },
    ]);
  });

  it("represents uploads by filename without storing spreadsheet rows in the transcript", () => {
    const conversation = advanceGuidedConversation({
      conversation: [],
      currentQuestion,
      answer: {
        kind: "catalog_source_document",
        filename: "vinyl-pricing.xlsx",
        rows: [{ Product: "Vinyl" }],
        rowCount: 1,
      },
      nextQuestion: null,
      nextVersion: 1,
    });

    expect(conversation).toEqual([
      {
        id: "assistant:0:service",
        role: "assistant",
        kind: "text",
        content: "What service do you want to set up first?",
        version: 0,
      },
      {
        id: "operator:1:service",
        role: "operator",
        kind: "source_document",
        content: "vinyl-pricing.xlsx",
        filename: "vinyl-pricing.xlsx",
        version: 1,
      },
    ]);
    expect(JSON.stringify(conversation)).not.toContain("Product");
  });

  it("keeps a refined repeat of the same question ID as a new turn", () => {
    const conversation = advanceGuidedConversation({
      conversation: normalizeGuidedConversation(
        [],
        [currentQuestion],
        1,
      ),
      currentQuestion,
      answer: "Vinyl",
      nextQuestion: {
        ...currentQuestion,
        prompt: "Tell me more about the vinyl service.",
      },
      nextVersion: 2,
    });

    expect(
      conversation.filter((message) => message.role === "assistant"),
    ).toEqual([
      expect.objectContaining({ id: "assistant:1:service" }),
      expect.objectContaining({
        id: "assistant:2:service",
        content: "Tell me more about the vinyl service.",
      }),
    ]);
  });
});
