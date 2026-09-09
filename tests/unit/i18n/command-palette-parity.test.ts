import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/command-palette.json";
import es from "@/i18n/dictionaries/es/command-palette.json";
import type { Namespace } from "@/i18n/types";

/**
 * The command palette is the only surface that renders every OPS noun at once,
 * so its dictionary is a contract: the palette reads these keys, and a missing
 * one renders the raw dot-key to the operator. `t()` (src/i18n/client.tsx) and
 * renderServerString() (src/i18n/server-render.ts) both do FLAT lookup only —
 * a nested object silently resolves to nothing.
 */

// Compile-time guard: the namespace must be registered in src/i18n/types.ts,
// or useDictionary("command-palette") does not typecheck at the call site.
const NAMESPACE: Namespace = "command-palette";

/** Every key the rewritten palette consumes. Deleting one is a regression. */
const REQUIRED_KEYS = [
  "input.placeholder",
  "group.projects",
  "group.clients",
  "group.leads",
  "group.tasks",
  "group.documents",
  "group.countSeparator",
  "group.create",
  "group.navigation",
  "group.settings",
  "group.system",
  "empty.title",
  "empty.body",
  "error.title",
  "error.retry",
  "footer.navigate",
  "footer.select",
  "footer.close",
  "row.invoice",
  "row.estimate",
  "system.sync",
  "system.reportBug",
  "system.shortcuts",
  "system.signOut",
];

describe("command-palette dictionary", () => {
  it("is a registered namespace", () => {
    expect(NAMESPACE).toBe("command-palette");
  });

  it("es mirrors en exactly — no missing or extra keys", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("carries every key the palette renders", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en, `en missing ${key}`).toHaveProperty([key]);
      expect(es, `es missing ${key}`).toHaveProperty([key]);
    }
  });

  it("every value is a non-empty flat string in both locales", () => {
    for (const [locale, dict] of [
      ["en", en],
      ["es", es],
    ] as [string, Record<string, unknown>][]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `${locale}[${key}] must be a flat string`).toBe("string");
        expect((value as string).trim().length, `${locale}[${key}] is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the tactical state titles in the // UPPERCASE register", () => {
    for (const dict of [en, es] as Record<string, string>[]) {
      for (const key of ["empty.title", "error.title"]) {
        const value = dict[key];
        expect(value.startsWith("// "), `${key} must lead with the // marker`).toBe(true);
        expect(value, `${key} must be uppercase`).toBe(value.toUpperCase());
      }
    }
  });

  it("holds the OPS product voice — no exclamation points, no emoji", () => {
    for (const [locale, dict] of [
      ["en", en],
      ["es", es],
    ] as [string, Record<string, string>][]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `${locale}[${key}] must not shout`).not.toContain("!");
        expect(
          /\p{Extended_Pictographic}/u.test(value),
          `${locale}[${key}] must not contain emoji`,
        ).toBe(false);
      }
    }
  });
});
