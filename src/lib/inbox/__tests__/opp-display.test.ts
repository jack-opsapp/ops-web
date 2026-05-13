import { describe, expect, it } from "vitest";
import { pipelineOppDisplayTitle } from "../opp-display";

const FALLBACK = "[UNTITLED OPPORTUNITY]";

describe("pipelineOppDisplayTitle", () => {
  it("returns the title when present and non-empty", () => {
    expect(
      pipelineOppDisplayTitle(
        { title: "Vinyl deck install", description: "ignored" },
        FALLBACK,
      ),
    ).toBe("Vinyl deck install");
  });

  it("trims surrounding whitespace from the title", () => {
    expect(
      pipelineOppDisplayTitle({ title: "  Vinyl deck  " }, FALLBACK),
    ).toBe("Vinyl deck");
  });

  it("falls back to description when title is empty string", () => {
    expect(
      pipelineOppDisplayTitle(
        { title: "", description: "Vinyl and Railings" },
        FALLBACK,
      ),
    ).toBe("Vinyl and Railings");
  });

  it("falls back to description when title is whitespace only", () => {
    expect(
      pipelineOppDisplayTitle(
        { title: "   ", description: "Vinyl and Railings" },
        FALLBACK,
      ),
    ).toBe("Vinyl and Railings");
  });

  it("falls back to description when title is null", () => {
    expect(
      pipelineOppDisplayTitle(
        { title: null, description: "Vinyl and Railings" },
        FALLBACK,
      ),
    ).toBe("Vinyl and Railings");
  });

  it("truncates long descriptions to keep card height stable", () => {
    const long = "x".repeat(200);
    const result = pipelineOppDisplayTitle(
      { title: "", description: long },
      FALLBACK,
    );
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns the untitled fallback when both fields are empty", () => {
    expect(
      pipelineOppDisplayTitle({ title: "", description: "" }, FALLBACK),
    ).toBe(FALLBACK);
  });

  it("returns the untitled fallback when both fields are null/undefined", () => {
    expect(pipelineOppDisplayTitle({}, FALLBACK)).toBe(FALLBACK);
    expect(
      pipelineOppDisplayTitle({ title: null, description: null }, FALLBACK),
    ).toBe(FALLBACK);
  });
});
