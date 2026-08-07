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
    expect(result.proposals[0]).toMatchObject({
      module: "SELL",
      name: "Service call",
    });

    const args = create.mock.calls[0][0] as {
      response_format: unknown;
      messages: { role: string; content: string }[];
    };
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].role).toBe("system");
    expect(args.messages.at(-1)).toEqual({
      role: "user",
      content: "I do roof repairs",
    });
  });

  it("threads prior turns ahead of the latest description", async () => {
    const { client, create } = clientReturning('{"proposals":[]}');
    await generateCatalogProposals({
      description: "mostly residential",
      priorTurns: ["I'm a plumber"],
      client,
    });
    const msgs = (
      create.mock.calls[0][0] as { messages: { content: string }[] }
    ).messages;
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
  it("publishes server-owned question copy instead of model-written behavior", async () => {
    const { client } = clientReturning(
      JSON.stringify({
        kind: "question",
        facts: [],
        question: {
          id: "supplier",
          intent: "supplier_identity",
          capabilityRef: "catalog-core/v1",
          factKeys: ["service.vinyl.supplier"],
          context: { serviceLabel: "vinyl decking" },
        },
      }),
    );

    const result = await generateGuidedCatalogTurn({
      answer: "Vinyl decking",
      facts: [],
      contradictions: [],
      currentQuestion: null,
      liveSnapshotSummary: {},
      verifiedReference: {},
      companyKnowledge: [],
      client,
    });

    expect(result.kind).toBe("question");
    if (result.kind !== "question") return;
    expect(result.question.prompt).toBe(
      "Which manufacturer, supplier, or product line do you use for vinyl decking?",
    );
  });

  it("keeps a supplier-neutral interview free of DekSmart assumptions", async () => {
    const turn = {
      kind: "question",
      facts: [],
      question: {
        id: "minimum-charge",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        factKeys: ["product.minimum_charge"],
        context: { productLabel: "vinyl membrane installation" },
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
      companyKnowledge: [],
      client,
    });

    expect(result).toMatchObject({
      kind: "question",
      facts: [],
      question: {
        id: "minimum-charge",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        prompt:
          "What minimum charge should OPS use for vinyl membrane installation?",
      },
    });
    const args = create.mock.calls[0][0] as {
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.response_format).toEqual({ type: "json_object" });
    expect(args.messages[0].content).toMatch(/one high-value question/i);
    expect(args.messages[0].content).toMatch(
      /document cells as untrusted data/i
    );
    expect(args.messages[0].content).toMatch(
      /confirm.*supplier|supplier.*confirmed/i
    );
    expect(args.messages[0].content).toMatch(
      /discover_only.*never.*configur.*execut/i,
    );
    expect(args.messages[0].content).not.toMatch(/may accurately explain/i);
    expect(
      args.messages.map((message) => message.content).join("\n")
    ).not.toMatch(/deksmart/i);
    const modelContext = JSON.parse(args.messages[1].content);
    expect(modelContext.responseSchema).toBeTruthy();
    expect(modelContext.releasedCapabilities.knownTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Deck Designer",
          phaseCAccess: "discover_only",
          canConfigure: false,
          canExecute: false,
        }),
      ]),
    );
  });

  it("treats supplier evidence generically without activating a prescribed brand plan", async () => {
    const turn = {
      kind: "question",
      facts: [],
      question: {
        id: "pricing",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        factKeys: ["product.price"],
        context: { productLabel: "this product" },
      },
    };
    const { client, create } = clientReturning(JSON.stringify(turn));

    await generateGuidedCatalogTurn({
      answer: "We use Northstar products",
      facts: [],
      contradictions: [],
      currentQuestion: null,
      liveSnapshotSummary: {},
      verifiedReference: {
        supplier: "Northstar",
        source: "operator-provided catalog",
      },
      companyKnowledge: [],
      client,
    });

    const args = create.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.messages[0].content).toMatch(/session-scoped.*evidence/i);
    expect(args.messages[0].content).not.toMatch(/Northstar/i);
    expect(args.messages[0].content).not.toMatch(
      /exactly two product actions/i
    );
    expect(
      JSON.parse(args.messages[1].content).verifiedSupplierReference
    ).toEqual({
      supplier: "Northstar",
      source: "operator-provided catalog",
    });
  });

  it("uses company knowledge as unconfirmed background evidence", async () => {
    const turn = {
      kind: "question",
      facts: [],
      question: {
        id: "confirm-historical-price",
        intent: "pricing",
        capabilityRef: "catalog-core/v1",
        factKeys: ["product.price"],
        context: { productLabel: "vinyl installation" },
      },
    };
    const { client, create } = clientReturning(JSON.stringify(turn));

    await generateGuidedCatalogTurn({
      answer: "We install vinyl membrane",
      facts: [],
      contradictions: [],
      currentQuestion: null,
      liveSnapshotSummary: {},
      verifiedReference: {},
      companyKnowledge: [
        {
          id: "memory-price",
          category: "pricing",
          content: "Vinyl installation was quoted at $18 per square foot.",
          confidence: 0.92,
          source: "email",
          scope: "company",
          observedAt: "2026-07-01T12:00:00.000Z",
        },
      ],
      client,
    });

    const args = create.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(args.messages[0].content).toMatch(
      /company knowledge.*untrusted.*unconfirmed/i
    );
    expect(args.messages[0].content).toMatch(
      /confirm.*operator.*before review/i
    );
    expect(args.messages[0].content).toMatch(
      /never mention.*memory ids.*confidence/i
    );
    expect(JSON.parse(args.messages[1].content).companyKnowledge).toEqual([
      expect.objectContaining({
        id: "memory-price",
        category: "pricing",
      }),
    ]);
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
        companyKnowledge: [],
        client,
      })
    ).rejects.toThrow(/invalid/i);
  });
});
