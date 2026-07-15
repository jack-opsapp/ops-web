import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/inbox.json";
import es from "@/i18n/dictionaries/es/inbox.json";

/**
 * Regression guard — flat-key parity + interpolation-token parity for the
 * `inbox` namespace (an active surface, 46 useDictionary("inbox") call sites).
 *
 * Fixed 2026-07-06: es was 49 keys short of en (empty states, tab labels,
 * toasts, today-bar, writeback options, phase-C strings) and carried 4 stale
 * orphan keys. Missing keys silently render English for Spanish users. These
 * tests lock exact en/es parity, forbid nested (non-string) values (both
 * dictionary consumers do flat-key lookup only), and ensure every interpolation
 * token ({count}, {category}, {when}, …) is preserved identically between
 * locales so runtime substitution can never break.
 */
const TOKEN = /\{(\w+)\}/g;
const tokenSet = (s: string) => [...new Set(s.match(TOKEN) ?? [])].sort();

describe("inbox dictionary — flat-key parity", () => {
  it("es mirrors en exactly — no missing or extra keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("every value is a flat string in both locales (no nested objects — t() does flat lookup only)", () => {
    for (const dict of [en, es] as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `inbox[${key}] must be a flat string, not a nested object/array`).toBe(
          "string",
        );
      }
    }
  });

  it("interpolation tokens are identical between en and es for every key", () => {
    for (const [key, enVal] of Object.entries(en as Record<string, string>)) {
      const esVal = (es as Record<string, string>)[key];
      expect(tokenSet(esVal), `inbox[${key}] interpolation-token mismatch`).toEqual(
        tokenSet(enVal),
      );
    }
  });
});
