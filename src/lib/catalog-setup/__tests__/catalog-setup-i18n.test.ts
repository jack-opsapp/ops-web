import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/catalog-setup.json";
import es from "@/i18n/dictionaries/es/catalog-setup.json";

// Keys the three downstream surfaces (rail, card grid, totals header) bind to.
// If a surface references a key not in this list, add it here AND to both
// dictionaries — the parity test then guarantees es never drifts from en.
const REQUIRED_KEYS = [
  // canvas + rail titles
  "title",
  "rail.title",
  // section labels
  "section.sell",
  "section.stock",
  "section.types",
  "section.review",
  // card actions
  "action.accept",
  "action.edit",
  "action.reject",
  "action.merge",
  "action.keep",
  // states
  "state.needsPrice",
  "state.duplicate",
  "state.suggested",
  "state.tracked",
  // source tags
  "source.import",
  "source.suggested",
  "source.template",
  "source.manual",
  // running totals
  "totals.proposed",
  "totals.added",
  // build-it CTA
  "build.cta",
];

describe("catalog-setup dictionary", () => {
  it("en has every required wizard key", () => {
    for (const k of REQUIRED_KEYS) {
      expect(en, `missing en key ${k}`).toHaveProperty([k]);
    }
  });

  it("es mirrors en exactly (no missing/extra keys)", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("every value is a non-empty string in both locales", () => {
    for (const dict of [en, es] as Record<string, unknown>[]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(typeof v, `${k} must be a string`).toBe("string");
        expect((v as string).length, `${k} must be non-empty`).toBeGreaterThan(0);
      }
    }
  });

  it("honors OPS voice: // prefix titles, [bracket] micro-text, no emoji, no exclamation", () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const dict of [en, es] as Record<string, string>[]) {
      // section titles carry the `//` prefix
      expect(dict["title"].startsWith("//")).toBe(true);
      expect(dict["rail.title"].startsWith("//")).toBe(true);
      // instructional micro-text uses [brackets]
      expect(dict["subtitle"].startsWith("[")).toBe(true);
      // section labels are UPPERCASE authority
      expect(dict["section.sell"]).toBe(dict["section.sell"].toUpperCase());
      expect(dict["action.accept"]).toBe(dict["action.accept"].toUpperCase());
      expect(dict["build.cta"]).toBe(dict["build.cta"].toUpperCase());
      // brand voice: no emoji, no exclamation points anywhere
      for (const v of Object.values(dict)) {
        expect(emoji.test(v), `emoji in: ${v}`).toBe(false);
        expect(v.includes("!"), `exclamation in: ${v}`).toBe(false);
      }
    }
  });

  it("never says \"AI\" (OPS describes behavior, not the model)", () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      for (const v of Object.values(dict)) {
        expect(/\bAI\b/.test(v), `\"AI\" in: ${v}`).toBe(false);
      }
    }
  });

  it("interpolates the build/notify {count} token in both locales", () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      expect(dict["build.caption"]).toContain("{count}");
      expect(dict["notify.body"]).toContain("{count}");
    }
  });
});
