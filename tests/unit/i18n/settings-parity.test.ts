import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/settings.json";
import es from "@/i18n/dictionaries/es/settings.json";

const TOKEN = /\{(\w+)\}/g;
const tokenSet = (value: string) =>
  [...new Set(value.match(TOKEN) ?? [])].sort();

describe("settings dictionary — flat-key parity", () => {
  it("keeps English and Spanish keys in exact parity", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps every settings value flat", () => {
    for (const dict of [en, es] as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `settings[${key}] must be a flat string`).toBe(
          "string"
        );
      }
    }
  });

  it("keeps interpolation tokens identical in both locales", () => {
    for (const [key, english] of Object.entries(en as Record<string, string>)) {
      const spanish = (es as Record<string, string>)[key];
      expect(
        tokenSet(spanish),
        `settings[${key}] interpolation-token mismatch`
      ).toEqual(tokenSet(english));
    }
  });
});
