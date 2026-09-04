import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/external-api-docs.json";
import es from "@/i18n/dictionaries/es/external-api-docs.json";

/**
 * Flat-key parity for the public developer reference (`/developers/api`).
 * `getExternalApiDocsCopy` casts the selected dictionary to
 * `Record<keyof typeof en, string>`, so a key missing from `es` renders as
 * `undefined` for Spanish readers with no type error. Lock exact parity,
 * flat strings, and identical interpolation tokens.
 */
const TOKEN = /\{(\w+)\}/g;
const tokenSet = (s: string) => [...new Set(s.match(TOKEN) ?? [])].sort();

describe("external-api-docs dictionary — flat-key parity", () => {
  it("es mirrors en exactly — no missing or extra keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("every value is a non-empty flat string in both locales", () => {
    for (const dict of [en, es] as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `external-api-docs[${key}]`).toBe("string");
        expect((value as string).trim().length, `external-api-docs[${key}]`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens are identical between en and es for every key", () => {
    for (const [key, enVal] of Object.entries(en as Record<string, string>)) {
      const esVal = (es as Record<string, string>)[key];
      expect(tokenSet(esVal), `external-api-docs[${key}]`).toEqual(tokenSet(enVal));
    }
  });

  it("names every credential scope exactly as the API contract defines it", () => {
    const scopes = ["intake.write", "analytics.leads.read", "analytics.financial.read"];
    for (const dict of [en, es] as Record<string, string>[]) {
      const text = Object.values(dict).join("\n");
      for (const scope of scopes) {
        expect(text, `scope ${scope} must be spelled in the docs copy`).toContain(scope);
      }
    }
  });
});
