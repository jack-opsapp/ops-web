import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  generateEditorial,
  type Completion,
} from "@/lib/social/editorial/generator";
const source = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Handoff",
  slug: "handoff",
  published_at: "2026-09-01T12:00:00Z",
  is_live: true,
  thumbnail_url: null,
  text: "Write the delivery address and material list before the crew leaves the shop.",
};
const draft = {
  title: "Before departure",
  hook: "The address belongs on the job.",
  angle: "Prepare the crew handoff",
  caption:
    "Write the delivery address and material list before the crew leaves the shop.",
  cta: "Save this.",
  alt_text: "A field note about a crew handoff.",
  story_type: "operator_protocol",
  slides: [
    {
      headline: "Before departure",
      body: "Write the delivery address and material list.",
    },
  ],
  evidence: [{ claim: "Write the address.", quote: source.text }],
};
const review = {
  approved: true,
  grounded: true,
  current: true,
  distinct: true,
  useful: true,
  format_supported: true,
  reason: "approved",
};
function complete(answer: unknown = draft): Completion {
  return async (request) => ({
    value: request.stage === "writer" ? answer : review,
    usage: { input: 100, output: 100 },
  });
}
describe("bounded writer and independent editor", () => {
  it("gives both stages the exact versioned Sam Parr guide and records its identity", async () => {
    const path = "docs/social/voice/sam-parr-field-guide.md";
    const content = readFileSync(path, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const seen: string[] = [];
    const provider: Completion = async (request) => {
      const data = JSON.parse(request.data);
      expect(data.copywriting_reference).toEqual({ path, sha256, content });
      expect(request.system).toContain("style reference only");
      seen.push(request.stage);
      return {
        value: request.stage === "writer" ? draft : review,
        usage: { input: 100, output: 100 },
      };
    };
    const result = await generateEditorial(
      source,
      "protocol",
      [],
      new Date("2026-09-07"),
      provider
    );
    expect(seen).toEqual(["writer", "editor"]);
    expect(result.references).toEqual([{ path, sha256 }]);
  });
  it("produces a validated package with evidence and usage", async () => {
    const p = await generateEditorial(
      source,
      "protocol",
      [],
      new Date("2026-09-07"),
      complete()
    );
    expect(p.submission.content.caption).toContain(
      "Source: https://opsapp.co/journal/handoff"
    );
    expect(p.usage).toHaveLength(2);
  });
  it("does not release a draft rejected by any editor check", async () => {
    const provider: Completion = async (r) => ({
      value: r.stage === "writer" ? draft : { ...review, current: false },
      usage: { input: 1, output: 1 },
    });
    await expect(
      generateEditorial(
        source,
        "protocol",
        [],
        new Date("2026-09-07"),
        provider
      )
    ).rejects.toThrow("EDITOR_REJECTED");
  });
  it("does not run the editor on fabricated evidence", async () => {
    await expect(
      generateEditorial(
        source,
        "protocol",
        [],
        new Date(),
        complete({
          ...draft,
          evidence: [
            {
              claim: "Win",
              quote: "Every business saves forty hours each week.",
            },
          ],
        })
      )
    ).rejects.toThrow("EVIDENCE");
  });
  it("bounds input before invoking paid generation", async () => {
    let invoked = false;
    const provider: Completion = async () => {
      invoked = true;
      throw Error("should not run");
    };
    await expect(
      generateEditorial(
        { ...source, text: "X".repeat(50000) },
        "protocol",
        [],
        new Date(),
        provider
      )
    ).rejects.toThrow("INPUT_LIMIT");
    expect(invoked).toBe(false);
  });
  it("treats malformed provider output as failure", async () => {
    await expect(
      generateEditorial(source, "protocol", [], new Date(), complete(null))
    ).rejects.toThrow();
  });
});
