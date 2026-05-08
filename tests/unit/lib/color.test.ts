import { describe, it, expect } from "vitest";
import { withAlpha } from "@/lib/utils/color";

describe("withAlpha", () => {
  it("converts a 6-char hex with leading # to rgba", () => {
    expect(withAlpha("#D99A3E", 50)).toBe("rgba(217, 154, 62, 0.5)");
  });

  it("accepts 6-char hex without the leading #", () => {
    expect(withAlpha("9DB582", 100)).toBe("rgba(157, 181, 130, 1)");
  });

  it("matches the legacy ${hex}33 / 55 / 80 alpha-suffix mapping", () => {
    // Legacy: 0x33 / 0xFF ≈ 0.20, 0x55 / 0xFF ≈ 0.33, 0x80 / 0xFF ≈ 0.50.
    // The cleanup standardizes on the percent-rounded equivalent.
    expect(withAlpha("#000000", 20)).toBe("rgba(0, 0, 0, 0.2)");
    expect(withAlpha("#000000", 33)).toBe("rgba(0, 0, 0, 0.33)");
    expect(withAlpha("#000000", 50)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("clamps alpha below 0 to 0", () => {
    expect(withAlpha("#FFFFFF", -10)).toBe("rgba(255, 255, 255, 0)");
  });

  it("clamps alpha above 100 to 100", () => {
    expect(withAlpha("#FFFFFF", 150)).toBe("rgba(255, 255, 255, 1)");
  });

  it("throws on shorthand 3-char hex", () => {
    expect(() => withAlpha("#FFF", 50)).toThrow(/malformed hex/);
  });

  it("throws on hex containing non-hex characters", () => {
    expect(() => withAlpha("#GGGGGG", 50)).toThrow(/malformed hex/);
  });

  it("throws on 8-char hex (no double-encoded alpha)", () => {
    // The whole point of this utility is to *replace* the legacy 8-char
    // form. Passing one in indicates a caller hasn't migrated yet.
    expect(() => withAlpha("#D99A3E80", 50)).toThrow(/malformed hex/);
  });
});
