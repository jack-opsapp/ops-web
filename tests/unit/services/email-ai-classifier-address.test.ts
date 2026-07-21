import { describe, expect, it } from "vitest";
import { EmailAIClassifier } from "@/lib/api/services/email-ai-classifier";
import type { ClassificationInput } from "@/lib/api/services/email-ai-classifier";

type CapturedCall = {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: unknown;
};

function fakeOpenAI(
  responseResults: unknown[],
  captured: CapturedCall[]
): import("openai").default {
  return {
    chat: {
      completions: {
        create: async (params: {
          messages: Array<{ role: string; content: string }>;
          response_format?: unknown;
        }) => {
          captured.push({
            systemPrompt: params.messages[0]?.content ?? "",
            userPrompt: params.messages[1]?.content ?? "",
            responseFormat: params.response_format,
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
    expect(captured[0].systemPrompt).toContain(
      "id: copy the exact input id into every result"
    );
    expect(captured[0].systemPrompt).toContain(
      "Return exactly one result for every input email"
    );
    const responseFormat = captured[0].responseFormat as {
      type: string;
      json_schema: {
        strict: boolean;
        schema: {
          properties: {
            results: {
              minItems: number;
              maxItems: number;
              items: {
                required: string[];
                properties: { id: { enum: string[] } };
              };
            };
          };
        };
      };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema.strict).toBe(true);
    const resultsSchema = responseFormat.json_schema.schema.properties.results;
    expect(resultsSchema.minItems).toBe(1);
    expect(resultsSchema.maxItems).toBe(1);
    expect(resultsSchema.items.required).toContain("id");
    expect(resultsSchema.items.properties.id.enum).toEqual(["msg-1"]);
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
  it("rejects duplicate input ids before spending a model call", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      results: [classificationResult("msg-1")],
                    }),
                  },
                },
              ],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1"), classificationInput("msg-1")],
        context,
        client
      )
    ).rejects.toThrow("classification input duplicated id msg-1");
    expect(calls).toBe(0);
  });

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

  it("deterministically binds one missing id when every other result identifies the only remaining input", async () => {
    const missingId = classificationResult("msg-1");
    delete (missingId as { id?: string }).id;

    const results = await EmailAIClassifier.classifySingleBatch(
      [classificationInput("msg-1"), classificationInput("msg-2")],
      context,
      fakeOpenAIContent(
        JSON.stringify({
          results: [missingId, classificationResult("msg-2", "biz")],
        })
      )
    );

    expect(results.map(({ id, verdict }) => ({ id, verdict }))).toEqual([
      { id: "msg-1", verdict: "lead" },
      { id: "msg-2", verdict: "biz" },
    ]);
  });

  it("rejects multiple missing ids because their source mapping is ambiguous", async () => {
    const first = classificationResult("msg-1");
    const second = classificationResult("msg-2");
    delete (first as { id?: string }).id;
    delete (second as { id?: string }).id;

    await expect(
      EmailAIClassifier.classifySingleBatch(
        [classificationInput("msg-1"), classificationInput("msg-2")],
        context,
        fakeOpenAIContent(JSON.stringify({ results: [first, second] }))
      )
    ).rejects.toThrow(
      "model response contained classifications without unambiguous ids"
    );
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

describe("classifyBatch — bounded model-contract recovery", () => {
  it("treats a structured-output refusal as terminal without retrying or fanning out", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return {
              choices: [
                {
                  message: {
                    content: null,
                    refusal: "I cannot classify this content.",
                  },
                },
              ],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifyBatch(
        [classificationInput("msg-1"), classificationInput("msg-2")],
        context,
        client
      )
    ).rejects.toThrow("model refused classification response");
    expect(calls).toBe(1);
  });

  it("does not fan a transport or quota failure out into singleton calls", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            throw new Error("insufficient_quota");
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifyBatch(
        [classificationInput("msg-1"), classificationInput("msg-2")],
        context,
        client
      )
    ).rejects.toThrow("insufficient_quota");
    expect(calls).toBe(1);
  });

  it("retries one incomplete model response before failing the sync cycle", async () => {
    const contents = [
      JSON.stringify({ results: [classificationResult("msg-2")] }),
      JSON.stringify({
        results: [classificationResult("msg-1"), classificationResult("msg-2")],
      }),
    ];
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: contents[calls++],
                },
              },
            ],
          }),
        },
      },
    } as unknown as import("openai").default;

    const results = await EmailAIClassifier.classifyBatch(
      [classificationInput("msg-1"), classificationInput("msg-2")],
      context,
      client
    );

    expect(calls).toBe(2);
    expect(results.map((result) => result.id)).toEqual(["msg-1", "msg-2"]);
  });

  it("stays fail-closed after two incomplete model responses", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({ results: [] }),
                  },
                },
              ],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifyBatch(
        [classificationInput("msg-1")],
        context,
        client
      )
    ).rejects.toThrow("model response omitted classification id msg-1");
    expect(calls).toBe(2);
  });

  it("isolates a repeatedly malformed multi-email response into exact singleton classifications", async () => {
    const requestedBatches: string[][] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: {
            messages: Array<{ role: string; content: string }>;
          }) => {
            const inputs = JSON.parse(params.messages[1].content) as Array<{
              id: string;
            }>;
            requestedBatches.push(inputs.map((input) => input.id));
            const results = inputs.map((input) => {
              const result = classificationResult(input.id);
              delete (result as { id?: string }).id;
              return result;
            });
            return {
              choices: [{ message: { content: JSON.stringify({ results }) } }],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    const results = await EmailAIClassifier.classifyBatch(
      [classificationInput("msg-1"), classificationInput("msg-2")],
      context,
      client
    );

    expect(requestedBatches.slice(0, 2)).toEqual([
      ["msg-1", "msg-2"],
      ["msg-1", "msg-2"],
    ]);
    expect(requestedBatches.slice(2).sort()).toEqual([["msg-1"], ["msg-2"]]);
    expect(results.map((result) => result.id)).toEqual(["msg-1", "msg-2"]);
  });

  it("remains fail-closed when an isolated singleton still has an invalid verdict", async () => {
    const client = {
      chat: {
        completions: {
          create: async (params: {
            messages: Array<{ role: string; content: string }>;
          }) => {
            const inputs = JSON.parse(params.messages[1].content) as Array<{
              id: string;
            }>;
            const results = inputs.map((input) => {
              const result = {
                ...classificationResult(input.id),
                verdict: "lead" as string,
              };
              delete (result as { id?: string }).id;
              if (inputs.length === 1 && input.id === "msg-1") {
                result.verdict = "maybe";
              }
              return result;
            });
            return {
              choices: [{ message: { content: JSON.stringify({ results }) } }],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifyBatch(
        [classificationInput("msg-1"), classificationInput("msg-2")],
        context,
        client
      )
    ).rejects.toThrow("model response contained invalid verdict for msg-1");
  });

  it("stops and awaits singleton workers after the first terminal failure", async () => {
    const requestedBatches: string[][] = [];
    const client = {
      chat: {
        completions: {
          create: async (params: {
            messages: Array<{ role: string; content: string }>;
          }) => {
            const inputs = JSON.parse(params.messages[1].content) as Array<{
              id: string;
            }>;
            const ids = inputs.map((input) => input.id);
            requestedBatches.push(ids);

            if (inputs.length > 1) {
              return {
                choices: [
                  { message: { content: JSON.stringify({ results: [] }) } },
                ],
              };
            }
            if (ids[0] === "msg-1") {
              return {
                choices: [
                  {
                    message: {
                      content: null,
                      refusal: "I cannot classify this content.",
                    },
                  },
                ],
              };
            }

            return {
              choices: [
                { message: { content: JSON.stringify({ results: [] }) } },
              ],
            };
          },
        },
      },
    } as unknown as import("openai").default;

    await expect(
      EmailAIClassifier.classifyBatch(
        [
          classificationInput("msg-1"),
          classificationInput("msg-2"),
          classificationInput("msg-3"),
          classificationInput("msg-4"),
        ],
        context,
        client
      )
    ).rejects.toThrow("model refused classification response");

    expect(requestedBatches).toEqual([
      ["msg-1", "msg-2", "msg-3", "msg-4"],
      ["msg-1", "msg-2", "msg-3", "msg-4"],
      ["msg-1"],
      ["msg-2"],
    ]);
  });
});
