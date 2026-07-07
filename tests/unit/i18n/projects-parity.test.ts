import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/projects.json";
import es from "@/i18n/dictionaries/es/projects.json";

/**
 * Regression guard — flat-key parity for the `projects` namespace.
 *
 * Bug (2026-07-06): es/projects.json shipped `financial`, `photoFeed`,
 * `sidebar`, and `tabs` as NESTED objects while en kept them FLAT
 * ("financial.budgetOverview": "..."). Both dictionary consumers —
 * the client t() in src/i18n/client.tsx (`dict[key]`) and the server
 * renderServerString() in src/i18n/server-render.ts (which copies only
 * `typeof v === "string"` entries) — do FLAT key lookup only. A nested es
 * object therefore never resolved: every string in those four sections
 * silently fell back to English or rendered the raw dot-key for Spanish
 * users. These tests lock the dictionary flat and at exact en/es parity so
 * the regression cannot recur.
 */
describe("projects dictionary — flat-key parity", () => {
  it("es mirrors en exactly — no missing or extra keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("every value is a flat string in both locales (no nested objects — t() does flat lookup only)", () => {
    // A nested object or array would resolve to typeof "object"; the flat t()
    // (dict[key]) only returns leaf strings. `table.loading.skeleton` is an
    // intentional empty string (skeleton row renders no text), so emptiness is
    // allowed — the guard here is strictly against non-string (nested) values.
    for (const dict of [en, es] as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `projects[${key}] must be a flat string, not a nested object/array`).toBe(
          "string",
        );
      }
    }
  });

  it("the four formerly-nested sections resolve as flat dot-keys in both locales", () => {
    const sampled = [
      "financial.budgetOverview",
      "photoFeed.noPhotos",
      "sidebar.projectHealth",
      "tabs.financial",
    ];
    for (const key of sampled) {
      expect(en, `en missing ${key}`).toHaveProperty([key]);
      expect(es, `es missing ${key}`).toHaveProperty([key]);
    }
  });
});
