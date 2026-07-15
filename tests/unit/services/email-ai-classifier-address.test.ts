import { describe, expect, it } from "vitest";
import { EmailAIClassifier } from "@/lib/api/services/email-ai-classifier";
import type { ClassificationInput } from "@/lib/api/services/email-ai-classifier";

type CapturedCall = { systemPrompt: string; userPrompt: string };

function fakeOpenAI(
  responseResults: unknown[],
  captured: CapturedCall[]
): import("openai").default {
  return {
    chat: {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content: string }>;
        }) => {
          captured.push({
            systemPrompt: params.messages[0]?.content ?? "",
            userPrompt: params.messages[1]?.content ?? "",
          });
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({ results: responseResults }),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as import("openai").default;
}

function fakeOpenAIContent(content: string | null): import("openai").default {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as import("openai").default;
}

function fakeOpenAIFailure(error: Error): import("openai").default {
  return {
    chat: {
      completions: {
        create: async () => {
          throw error;
        },
      },
    },
  } as unknown as import("openai").default;
}

const context = {
  companyName: "Canpro Deck and Rail",
  industry: "decks",
  ownerEmail: "office@example-contractors.com",
  companyDomains: ["example-contractors.com"],
};

function classificationInput(id: string): ClassificationInput {
  return {
    id,
    threadId: `thread-${id}`,
    from: `Client ${id} <${id}@example.com>`,
    to: ["office@example-contractors.com"],
    subject: "Deck quote",
    snippet: "Please quote my deck.",
    date: "2026-05-26T17:00:00.000Z",
    direction: "inbound",
  };
}

function classificationResult(
  id: string,
  verdict: "lead" | "biz" | "skip" = "lead"
) {
  return {
    id,
    verdict,
    confidence: 0.9,
    stage: verdict === "lead" ? "new_lead" : null,
    client: null,
    dupes: [],
  };
}

describe("classifySingleBatch — address field", () => {
  it("maps the model's addr into client.address", async () => {
    const captured: CapturedCall[] = [];
    const client = fakeOpenAI(
      [
        {
          id: "msg-1",
          verdict: "lead",
          confidence: 0.9,
          stage: "new_lead",
          val: 18500,
          client: {
            name: "Kara Beach",
            email: "kara.beach@example.com",
            phone: "250 538 8340",
            addr: "1220 Wharf Street, Victoria BC V8W 1T8",
            description: "New deck build",
          },
          dupes: [],
        },
      ],
      captured
    );

    const emails: ClassificationInput[] = [
      {
        id: "msg-1",
        threadId: "thread-1",
        from: "Kara Beach <kara.beach@example.com>",
        to: ["office@example-contractors.com"],
        subject: "Deck quote",
        snippet: "short snippet",
        date: "2026-05-26T17:00:00.000Z",
        direction: "inbound",
      },
    ];

    const results = await EmailAIClassifier.classifySingleBatch(
      emails,
      context,
      client
    );

    expect(results).toHaveLength(1);
    expect(results[0].client?.address).toBe(
      "1220 Wharf Street, Victoria BC V8W 1T8"
    );
    expect(results[0].client?.name).toBe("Kara Beach");
  });

  it("returns null address when the model omits it", async () => {
    const captured: CapturedCall[] = [];
    const client = fakeOpenAI(
      [
        {
          id: "msg-2",
          verdict: "lead",
          confidence: 0.8,
          stage: "new_lead",
          client: {
            name: "Sam Rivers",
            email: "sam@example.com",
            phone: null,
            description: "Inquiry",
          },
          dupes: [],
        },
      ],
      captured
    );

    const emails: ClassificationInput[] = [
      {
        id: "msg-2",
        threadId: "thread-2",
        from: "Sam Rivers <sam@example.com>",
        to: ["office@example-contractors.com"],
        subject: "Question",
        snippet: "hi",
        date: "2026-05-26T17:00:00.000Z",
        direction: "inbound",
      },
    ];

    const results = await EmailAIClassifier.classifySingleBatch(
      emails,
      context,
      client
    );
    expect(results[0].client?.address).toBeNull();
  });

  it("passes a body slice far larger than the old 200-char cap to the model", async () => {
    const captured: CapturedCall[] = [];
    const client = fakeOpenAI(
      [classificationResult("msg-3", "skip")],
      captured
    );

    const longBody = "Detailed scope. ".repeat(200); // ~3200 chars
    const emails: ClassificationInput[] = [
      {
        id: "msg-3",
        threadId: "thread-3",
        from: "Lee <lee@example.com>",
        to: ["office@example-contractors.com"],
        subject: "Big job",
        snippet: "snippet only",
        body: longBody,
        date: "2026-05-26T17:00:00.000Z",
        direction: "inbound",
      },
    ];

    await EmailAIClassifier.classifySingleBatch(emails, context, client);

    const payload = JSON.parse(captured[0].userPrompt) as Array<{
      snip: string;
    }>;
    // Old behavior capped at 200; new behavior allows up to 1500.
    expect(payload[0].snip.length).toBeGreaterThan(200);
    expect(payload[0].snip.length).toBe(1500);
  });

  it("falls back to snippet when no body is provided", async () => {
    const captured: CapturedCall[] = [];
    const client = fakeOpenAI(
      [classificationResult("msg-4", "skip")],
      captured
    );

    const emails: ClassificationInput[] = [
      {
        id: "msg-4",
        threadId: "thread-4",
        from: "Pat <pat@example.com>",
        to: ["office@example-contractors.com"],
        subject: "Hi",
        snippet: "snippet text only",
        date: "2026-05-26T17:00:00.000Z",
        direction: "inbound",
      },
    ];

    await EmailAIClassifier.classifySingleBatch(emails, context, client);
    const payload = JSON.parse(captured[0].userPrompt) as Array<{
      snip: string;
    }>;
    expect(payload[0].snip).toBe("snippet text only");
  });
});

describe("classifySingleBatch — completeness boundary", () => {
  it("propagates a transport failure instead of checkpointing synthetic skips", async () => {
    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1")],
        context,
        fakeOpenAIFailure(new Error("model unavailable"))
      )
    ).rejects.toThrow("batch classification failed: model unavailable");
  });

  it.each([
    ["empty content", null, "model response was empty"],
    ["invalid JSON", "not-json", "model response was not valid JSON"],
    [
      "empty results",
      JSON.stringify({ results: [] }),
      "model response omitted classification id msg-1",
    ],
    [
      "duplicate result",
      JSON.stringify({
        results: [classificationResult("msg-1"), classificationResult("msg-1")],
      }),
      "model response duplicated classification id msg-1",
    ],
    [
      "unknown result",
      JSON.stringify({ results: [classificationResult("not-requested")] }),
      "model response contained unknown classification id not-requested",
    ],
  ])("rejects a %s", async (_case, content, expectedMessage) => {
    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1")],
        context,
        fakeOpenAIContent(content)
      )
    ).rejects.toThrow(expectedMessage);
  });

  it("rejects a partial result set", async () => {
    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1"), classificationInput("msg-2")],
        context,
        fakeOpenAIContent(
          JSON.stringify({ results: [classificationResult("msg-2")] })
        )
      )
    ).rejects.toThrow("model response omitted classification id msg-1");
  });

  it("rejects an unknown verdict instead of treating it as an intentional skip", async () => {
    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1")],
        context,
        fakeOpenAIContent(
          JSON.stringify({
            results: [{ ...classificationResult("msg-1"), verdict: "maybe" }],
          })
        )
      )
    ).rejects.toThrow("model response contained invalid verdict for msg-1");
  });

  it("returns one result per input in input order and preserves explicit non-lead verdicts", async () => {
    const results = await EmailAIClassifier.classifySingleBatch(
      [classificationInput("msg-1"), classificationInput("msg-2")],
      context,
      fakeOpenAIContent(
        JSON.stringify({
          results: [
            classificationResult("msg-2", "biz"),
            classificationResult("msg-1", "skip"),
          ],
        })
      )
    );

    expect(results.map(({ id, verdict }) => ({ id, verdict }))).toEqual([
      { id: "msg-1", verdict: "skip" },
      { id: "msg-2", verdict: "biz" },
    ]);
  });

  it("accepts an explicit skip even when the model omits irrelevant lead confidence", async () => {
    const explicitSkip = classificationResult("msg-1", "skip");
    delete (explicitSkip as { confidence?: number }).confidence;

    const results = await EmailAIClassifier.classifySingleBatch(
      [classificationInput("msg-1")],
      context,
      fakeOpenAIContent(JSON.stringify({ results: [explicitSkip] }))
    );

    expect(results).toEqual([
      expect.objectContaining({ id: "msg-1", verdict: "skip" }),
    ]);
  });
});
