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
});
