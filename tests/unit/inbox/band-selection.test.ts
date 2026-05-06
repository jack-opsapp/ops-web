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
  ballInCourt: null,
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
        ballInCourt: "user",
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
        ballInCourt: "user",
      }),
    ).toBe("needs-input");
  });

  it("returns 'auto-sent' when phaseC === 'auto_sent' and not closed/needs-input", () => {
    expect(
      selectBand({
        ...base,
        phaseC: "auto_sent",
        aiSummary: "x",
        ballInCourt: "user",
      }),
    ).toBe("auto-sent");
  });

  it("returns 'summary' when aiSummary is present and no higher precedence", () => {
    expect(
      selectBand({
        ...base,
        aiSummary: "Summary text",
        ballInCourt: "user",
      }),
    ).toBe("summary");
  });

  it("returns 'ball-yours' when ballInCourt === 'user' and no summary", () => {
    expect(
      selectBand({
        ...base,
        ballInCourt: "user",
      }),
    ).toBe("ball-yours");
  });

  it("returns null when nothing applies", () => {
    expect(selectBand(base)).toBeNull();
  });

  it("ball-yours requires actual 'user' value (not 'them')", () => {
    expect(selectBand({ ...base, ballInCourt: "them" })).toBeNull();
  });
});
