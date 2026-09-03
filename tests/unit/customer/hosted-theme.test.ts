import { describe, it, expect } from "vitest";
import {
  accentCarriesText,
  accentForeground,
  buildHostedThemeStyle,
  contrastRatio,
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

describe("CTA label contrast (a business's accent must never hide the one button)", () => {
  const dark = defaultPortalBranding("c1");
  const light = { ...dark, themeMode: "light" as const };

  it("measures WCAG ratios both ways", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#417394", "#0a0a0a")).toBeCloseTo(3.87, 2);
    expect(contrastRatio("#6f94b0", "#0a0a0a")).toBeCloseTo(6.16, 2);
  });

  it("lets a legible accent carry the label", () => {
    expect(accentCarriesText("#6f94b0", "#0a0a0a")).toBe(true);
    expect(buildHostedThemeStyle({ ...dark, accentColor: "#6f94b0" })).toMatchObject({
      "--portal-cta-label": "var(--portal-accent)",
    });
  });

  it("hands the label back to the text token when the accent cannot carry it", () => {
    // The database default is exactly this case: 3.87:1 on the dark canvas.
    expect(accentCarriesText(PORTAL_DEFAULT_ACCENT, "#0a0a0a")).toBe(false);
    expect(buildHostedThemeStyle(dark)).toMatchObject({
      "--portal-cta-label": "var(--portal-text)",
    });
  });

  it("judges the accent against the canvas it is actually drawn on", () => {
    // The same accent passes on the light canvas and fails on the dark one.
    expect(buildHostedThemeStyle(light)).toMatchObject({
      "--portal-cta-label": "var(--portal-accent)",
    });
    expect(buildHostedThemeStyle({ ...light, accentColor: "#c4a868" })).toMatchObject({
      "--portal-cta-label": "var(--portal-text)",
    });
  });
});
