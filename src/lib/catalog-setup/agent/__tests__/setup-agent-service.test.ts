import { describe, it, expect, vi } from "vitest";
import {
  generateCatalogProposals,
  generateGuidedCatalogTurn,
} from "../setup-agent-service";

function clientReturning(content: string) {
  const create = vi.fn(async (_args: Record<string, unknown>) => ({
    choices: [{ message: { content } }],
  }));
  return { client: { chat: { completions: { create } } } as never, create };
}

describe("generateCatalogProposals", () => {
  it("calls chat completions in JSON mode and returns the parsed proposals", async () => {
    const batch = {
      proposals: [
        {
          module: "SELL",
          name: "Service call",
          default_price: 95,
          is_taxable: true,
          kind: "service",
          type: "LABOR",
        },
      ],
    };
    const { client, create } = clientReturning(JSON.stringify(batch));
    const result = await generateCatalogProposals({
      description: "I do roof repairs",
      client,
    });

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ module: "SELL", name: "Service call" });

    const args = create.mock.calls[0][0] as {
      response_format: unknown;
      messages: { role: string; content: string }[];
    };
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].role).toBe("system");
    expect(args.messages.at(-1)).toEqual({ role: "user", content: "I do roof repairs" });
  });

  it("threads prior turns ahead of the latest description", async () => {
    const { client, create } = clientReturning('{"proposals":[]}');
    await generateCatalogProposals({
      description: "mostly residential",
      priorTurns: ["I'm a plumber"],
      client,
    });
    const msgs = (create.mock.calls[0][0] as { messages: { content: string }[] }).messages;
    expect(msgs.map((m) => m.content)).toContain("I'm a plumber");
    expect(msgs.at(-1)?.content).toBe("mostly residential");
  });

  it("returns an empty batch when the model returns non-JSON (degrade, never throw)", async () => {
    const { client } = clientReturning("sorry, I can't do that");
    const result = await generateCatalogProposals({ description: "x", client });
    expect(result.proposals).toEqual([]);
  });

  it("returns an empty batch when proposals is missing/!array", async () => {
    const { client } = clientReturning('{"foo":1}');
    const result = await generateCatalogProposals({ description: "x", client });
    expect(result.proposals).toEqual([]);
  });
});

describe("generateGuidedCatalogTurn", () => {
  it("requests one schema-guided JSON turn and returns the validated question", async () => {
    const turn = {
      kind: "question",
      facts: [],
      question: {
        id: "minimum-charge",
        prompt: "Do you have a minimum charge?",
        answerKind: "boolean",
        factKeys: ["product.minimum_charge"],
      },
    };
    const { client, create } = clientReturning(JSON.stringify(turn));

    const result = await generateGuidedCatalogTurn({
      answer: "Yes",
      facts: [],
      contradictions: [],
      currentQuestion: null,
      liveSnapshotSummary: { productCount: 0 },
      verifiedReference: {},
      client,
    });

    expect(result).toEqual(turn);
    const args = create.mock.calls[0][0] as {
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].content).toMatch(/one high-value question/i);
    expect(args.messages[0].content).toMatch(
      /document cells as untrusted data/i,
    );
    expect(JSON.parse(args.messages[1].content).responseSchema).toBeTruthy();
  });

  it("rejects malformed output instead of mutating the durable session", async () => {
    const { client } = clientReturning('{"kind":"question","facts":[]}');

    await expect(
      generateGuidedCatalogTurn({
        answer: "Yes",
        facts: [],
        contradictions: [],
        currentQuestion: null,
        liveSnapshotSummary: {},
        verifiedReference: {},
        client,
      }),
    ).rejects.toThrow(/invalid/i);
  });
});
