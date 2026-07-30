import { describe, expect, it } from "vitest";
import {
  appendGuidedInput,
  reviseLatestGuidedInput,
} from "../input-ledger";

const question = {
  id: "service",
  intent: "service_selection" as const,
  capabilityRef: "catalog-core/v1" as const,
  prompt: "What service do you want to set up first?",
  answerKind: "text" as const,
  factKeys: ["customer_products.first_service_line"],
};

describe("Phase C operator input ledger", () => {
  it("appends an immediately visible queued input", () => {
    const result = appendGuidedInput({
      ledger: [],
      answer: "Vinyl decking",
      currentQuestion: question,
      nextInputRevision: 1,
      inputId: "input-1",
      now: "2026-07-27T20:00:00.000Z",
    });

    expect(result.entry).toMatchObject({
      id: "input-1",
      revision: 1,
      state: "queued",
      answer: "Vinyl decking",
    });
    expect(result.message).toMatchObject({
      id: "operator-input:input-1",
      inputId: "input-1",
      state: "queued",
      content: "Vinyl decking",
    });
  });

  it("keeps quick follow-ups queued in revision order", () => {
    const first = appendGuidedInput({
      ledger: [],
      answer: "Vinyl decking",
      currentQuestion: question,
      nextInputRevision: 1,
      inputId: "input-1",
      now: "2026-07-27T20:00:00.000Z",
    });
    const second = appendGuidedInput({
      ledger: first.ledger,
      answer: "We use DekSmart",
      currentQuestion: question,
      nextInputRevision: 2,
      inputId: "input-2",
      now: "2026-07-27T20:00:01.000Z",
    });

    expect(
      second.ledger
        .filter((entry) => entry.state === "queued")
        .map((entry) => entry.answer),
    ).toEqual(["Vinyl decking", "We use DekSmart"]);
  });

  it("edits only the newest queued input and preserves a hidden audit entry", () => {
    const appended = appendGuidedInput({
      ledger: [],
      answer: "We use DekSmart",
      currentQuestion: question,
      nextInputRevision: 1,
      inputId: "input-1",
      now: "2026-07-27T20:00:00.000Z",
    });
    const edited = reviseLatestGuidedInput({
      ledger: appended.ledger,
      operation: "edit",
      expectedInputId: "input-1",
      answer: "We use DekSmart 68 mil",
      nextInputRevision: 2,
      replacementInputId: "input-2",
      now: "2026-07-27T20:00:02.000Z",
    });

    expect(edited.ledger).toEqual([
      expect.objectContaining({
        id: "input-1",
        state: "superseded",
      }),
      expect.objectContaining({
        id: "input-2",
        state: "queued",
        supersedesId: "input-1",
        answer: "We use DekSmart 68 mil",
      }),
    ]);
  });

  it("removes only the newest queued input", () => {
    const appended = appendGuidedInput({
      ledger: [],
      answer: "Ignore that",
      currentQuestion: question,
      nextInputRevision: 1,
      inputId: "input-1",
      now: "2026-07-27T20:00:00.000Z",
    });
    const removed = reviseLatestGuidedInput({
      ledger: appended.ledger,
      operation: "remove",
      expectedInputId: "input-1",
      nextInputRevision: 2,
      now: "2026-07-27T20:00:02.000Z",
    });

    expect(removed.ledger[0]).toMatchObject({
      id: "input-1",
      state: "removed",
    });
    expect(removed.replacement).toBeNull();
  });

  it("refuses to change an accepted input or an older queued input", () => {
    expect(() =>
      reviseLatestGuidedInput({
        ledger: [
          {
            id: "input-1",
            revision: 1,
            questionId: "service",
            answer: "Vinyl",
            displayKind: "text",
            displayContent: "Vinyl",
            state: "accepted",
            createdAt: "2026-07-27T20:00:00.000Z",
            updatedAt: "2026-07-27T20:00:00.000Z",
          },
        ],
        operation: "remove",
        expectedInputId: "input-1",
        nextInputRevision: 2,
        now: "2026-07-27T20:00:02.000Z",
      }),
    ).toThrow(/newest queued/i);
  });
});
