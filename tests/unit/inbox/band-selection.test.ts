import { describe, it, expect } from "vitest";
import {
  selectBand,
  type BandThreadInput,
} from "@/lib/inbox/band-selection";

const base: BandThreadInput = {
  closed: false,
  agent: { needsInput: false },
  phaseC: "none",
  aiSummary: null,
};

describe("selectBand", () => {
  it("returns 'closed' when thread.closed is true (highest precedence)", () => {
    expect(
      selectBand({
        ...base,
        closed: true,
        agent: { needsInput: true },
        phaseC: "ai_drafted",
        aiSummary: "x",
      }),
    ).toBe("closed");
  });

  it("returns 'needs-input' when agent.needsInput overrides everything else", () => {
    expect(
      selectBand({
        ...base,
        agent: { needsInput: true },
        phaseC: "auto_sent",
        aiSummary: "x",
      }),
    ).toBe("needs-input");
  });

  it("returns 'auto-sent' when phaseC === 'auto_sent' and not closed/needs-input", () => {
    expect(
      selectBand({
        ...base,
        phaseC: "auto_sent",
        aiSummary: "x",
      }),
    ).toBe("auto-sent");
  });

  it("returns 'summary' when aiSummary is present and no higher precedence", () => {
    expect(
      selectBand({
        ...base,
        aiSummary: "Summary text",
      }),
    ).toBe("summary");
  });

  it("returns null when nothing applies", () => {
    expect(selectBand(base)).toBeNull();
  });
});
