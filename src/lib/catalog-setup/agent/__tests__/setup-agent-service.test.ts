import { describe, it, expect, vi } from "vitest";
import { generateCatalogProposals } from "../setup-agent-service";

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
