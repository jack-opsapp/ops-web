import { describe, expect, it } from "vitest";
import { normalizeImageUrl } from "@/lib/utils/image-url";

describe("normalizeImageUrl", () => {
  it("converts protocol-relative urls to https", () => {
    expect(normalizeImageUrl("//21f8aef8a1eb969e43f8925ea58a2f93.cdn.bubble.io/Group%2021.png"))
      .toBe("https://21f8aef8a1eb969e43f8925ea58a2f93.cdn.bubble.io/Group%2021.png");
  });

  it("preserves absolute and local urls", () => {
    expect(normalizeImageUrl("https://example.com/avatar.png")).toBe("https://example.com/avatar.png");
    expect(normalizeImageUrl("/images/fallback.png")).toBe("/images/fallback.png");
  });

  it("returns null for empty values", () => {
    expect(normalizeImageUrl(null)).toBeNull();
    expect(normalizeImageUrl("   ")).toBeNull();
  });
});
