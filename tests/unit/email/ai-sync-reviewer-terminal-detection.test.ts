import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISyncReviewer } from "@/lib/api/services/ai-sync-reviewer";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/services/openai-clients", () => ({
  getSyncOpenAI: () => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  }),
}));

describe("AISyncReviewer terminal stage guard", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("promotes clear acceptance evidence to likely_won even when the model returns an active stage", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [
                {
                  tid: "thread-1",
                  stage: "quoted",
                  summary: "Client has the estimate.",
                },
              ],
            }),
          },
        },
      ],
    });

    const result = await AISyncReviewer.evaluateSingleBatch(
      [
        {
          threadId: "thread-1",
          messages: [
            {
              from: "canprojack@gmail.com",
              to: ["liane@example.com"],
              subject: "Deck estimate",
              bodyText: "Attached is the estimate for the deck resurfacing.",
              date: "2026-06-20T18:00:00.000Z",
              direction: "outbound",
            },
            {
              from: "liane@example.com",
              to: ["canprojack@gmail.com"],
              subject: "Re: Deck estimate",
              bodyText:
                "Sounds Great! 4204 Springridge Cres. Thanks . 250 216 6119 Cell",
              date: "2026-06-21T18:00:00.000Z",
              direction: "inbound",
            },
          ],
        },
      ],
      "Canpro Deck and Rail",
      "canprojack@gmail.com"
    );

    expect(result).toEqual([
      {
        threadId: "thread-1",
        newStage: "quoted",
        terminalFlag: "likely_won",
        summary: "Client has the estimate.",
      },
    ]);
  });
});
