import { describe, it, expect } from "vitest";
import {
  accentForeground,
  buildHostedThemeStyle,
  normalizeHexColor,
  relativeLuminance,
  sanitizeBranding,
} from "@/lib/customer-identity/hosted-theme";
import { PORTAL_DEFAULT_ACCENT, defaultPortalBranding } from "@/lib/portal/defaults";

describe("normalizeHexColor", () => {
  it("accepts 6-digit hex with or without the hash, lowercasing", () => {
    expect(normalizeHexColor("#417394")).toBe("#417394");
    expect(normalizeHexColor("417394")).toBe("#417394");
    expect(normalizeHexColor("  #ABCDEF ")).toBe("#abcdef");
  });

  it("expands 3-digit shorthand", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor("F0F")).toBe("#ff00ff");
  });

  it("rejects everything else", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("rgb(1,2,3)")).toBeNull();
    expect(normalizeHexColor("#gggggg")).toBeNull();
  });
});

describe("relativeLuminance / accentForeground", () => {
  it("computes the WCAG poles", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("puts dark text on light accents and light text on dark accents", () => {
    expect(accentForeground("#ffffff")).toBe("dark");
    expect(accentForeground("#f5d90a")).toBe("dark"); // safety yellow
    expect(accentForeground("#000000")).toBe("light");
    expect(accentForeground("#417394")).toBe("light"); // portal default
    // OPS steel blue: the design system itself puts black text on the filled
    // accent (Button primary = bg-ops-accent text-black); the math agrees.
    expect(accentForeground("#6f94b0")).toBe("dark");
  });
});

describe("sanitizeBranding", () => {
  it("returns the same object when the accent is already valid", () => {
    const branding = defaultPortalBranding("co");
    expect(sanitizeBranding(branding)).toBe(branding);
  });

  it("falls back to the database default accent for malformed values", () => {
    const branding = { ...defaultPortalBranding("co"), accentColor: "not-a-color" };
    expect(sanitizeBranding(branding).accentColor).toBe(PORTAL_DEFAULT_ACCENT);
  });

  it("normalizes shorthand so the theme generator never sees it", () => {
    const branding = { ...defaultPortalBranding("co"), accentColor: "#abc" };
    expect(sanitizeBranding(branding).accentColor).toBe("#aabbcc");
  });
});

describe("buildHostedThemeStyle", () => {
  it("carries every portal var plus a contrast-aware on-accent token", () => {
    const style = buildHostedThemeStyle(defaultPortalBranding("co")) as Record<string, string>;
    expect(style["--portal-accent"]).toBe(PORTAL_DEFAULT_ACCENT);
    expect(style["--portal-bg"]).toBeDefined();
    expect(style["--portal-text"]).toBeDefined();
    expect(style["--portal-accent-text"]).toBe("var(--cs-on-accent-light)");
  });

  it("switches the on-accent token for a light accent", () => {
    const branding = { ...defaultPortalBranding("co"), accentColor: "#f5d90a" };
    const style = buildHostedThemeStyle(branding) as Record<string, string>;
    expect(style["--portal-accent-text"]).toBe("var(--cs-on-accent-dark)");
  });

  it("never emits a NaN color for a broken accent", () => {
    const branding = { ...defaultPortalBranding("co"), accentColor: "zzz" };
    const style = buildHostedThemeStyle(branding) as Record<string, string>;
    expect(JSON.stringify(style)).not.toContain("NaN");
  });
});
