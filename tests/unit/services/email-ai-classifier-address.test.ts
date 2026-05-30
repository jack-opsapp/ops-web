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

const context = {
  companyName: "Canpro Deck and Rail",
  industry: "decks",
  ownerEmail: "office@example-contractors.com",
  companyDomains: ["example-contractors.com"],
};

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
    const client = fakeOpenAI([], captured);

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
    const client = fakeOpenAI([], captured);

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
