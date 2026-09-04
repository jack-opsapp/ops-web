import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn — custom type-scale tokens survive color merges", () => {
  it("keeps text-micro alongside custom color tokens", () => {
    expect(cn("font-mono text-micro uppercase", "text-text-3")).toContain("text-micro");
    expect(cn("text-micro text-text-3")).toBe("text-micro text-text-3");
  });
  it("still merges size-vs-size and color-vs-color", () => {
    expect(cn("text-micro", "text-data-lg")).toBe("text-data-lg");
    expect(cn("text-text-3", "text-rose")).toBe("text-rose");
  });
  it("built-in sizes merge with token sizes", () => {
    expect(cn("text-micro", "text-[22px]")).toBe("text-[22px]");
  });
  it("keeps the Cake display tokens alongside colour tokens (the shared Button label)", () => {
    // Every <Button> variant pairs `text-cake-button` with a text colour; the
    // size must survive the merge or the label falls back to the 16px default.
    expect(cn("font-cakemono font-light text-cake-button uppercase", "text-ops-accent")).toContain(
      "text-cake-button",
    );
    expect(cn("text-cake-button text-black")).toBe("text-cake-button text-black");
    expect(cn("text-cake-display text-text")).toBe("text-cake-display text-text");
    expect(cn("text-cake-badge", "text-cake-section")).toBe("text-cake-section");
  });
});
