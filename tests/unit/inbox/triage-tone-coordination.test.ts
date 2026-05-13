import { describe, it, expect } from "vitest";
import { resolveTriageTone } from "@/lib/inbox/triage-tone-coordination";

describe("resolveTriageTone — accent-slot coordination", () => {
  it("returns undefined when no triage tone is computed", () => {
    expect(resolveTriageTone(undefined, false)).toBeUndefined();
    expect(resolveTriageTone(undefined, true)).toBeUndefined();
  });

  it("demotes accent → neutral when the floating badge is active", () => {
    expect(resolveTriageTone("accent", true)).toBe("neutral");
  });

  it("leaves accent untouched when the floating badge is inactive", () => {
    expect(resolveTriageTone("accent", false)).toBe("accent");
  });

  it("passes rose through unchanged regardless of badge state", () => {
    expect(resolveTriageTone("rose", true)).toBe("rose");
    expect(resolveTriageTone("rose", false)).toBe("rose");
  });

  it("passes tan / lavender / olive / neutral through unchanged in both states", () => {
    for (const tone of ["tan", "lavender", "olive", "neutral"] as const) {
      expect(resolveTriageTone(tone, true)).toBe(tone);
      expect(resolveTriageTone(tone, false)).toBe(tone);
    }
  });
});
