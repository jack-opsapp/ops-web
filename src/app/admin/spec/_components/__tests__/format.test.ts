import { describe, expect, it } from "vitest";
import { formatTier } from "../format";

describe("formatTier (overview shell)", () => {
  it("renders the SPEC-0N designation for v2 slugs", () => {
    expect(formatTier("spec01")).toBe("SPEC-01");
    expect(formatTier("spec02")).toBe("SPEC-02");
    expect(formatTier("spec03")).toBe("SPEC-03");
  });

  it("surfaces an unknown slug in uppercase rather than mislabelling it", () => {
    expect(formatTier("spec09")).toBe("SPEC09");
  });
});
