import { describe, it, expect } from "vitest";
import { parseNumber } from "@/lib/catalog-setup/parse-number";

// Ports the identical permissive `parseNumber` from BOTH iOS mappers
// (CatalogCSVMapper.swift + ProductsCSVMapper.swift). Behaviour pinned:
// tolerate `$`, `,`, surrounding whitespace; blank/undefined → null with NO
// error (the Swift original "stays silent on blanks"); negative → error;
// non-numeric → error. The mapper callers add the "required" error when a
// required column comes back blank — parseNumber itself never does.

describe("parseNumber", () => {
  it("returns null for blank/whitespace/undefined/null (no error)", () => {
    expect(parseNumber(undefined)).toEqual({ value: null });
    expect(parseNumber(null)).toEqual({ value: null });
    expect(parseNumber("")).toEqual({ value: null });
    expect(parseNumber("   ")).toEqual({ value: null });
    // a lone newline / tab is still "blank" (Swift trims whitespacesAndNewlines)
    expect(parseNumber("\n\t")).toEqual({ value: null });
  });

  it("strips $, commas and surrounding whitespace", () => {
    expect(parseNumber(" $1,250.50 ")).toEqual({ value: 1250.5 });
    expect(parseNumber("42")).toEqual({ value: 42 });
    expect(parseNumber("$22,000")).toEqual({ value: 22000 });
    expect(parseNumber("0")).toEqual({ value: 0 });
    expect(parseNumber("3.50")).toEqual({ value: 3.5 });
  });

  it("errors on negative", () => {
    const r = parseNumber("-5");
    expect(r.value).toBeNull();
    expect(r.error).toBe("negative");
  });

  it("errors on negative even after stripping symbols", () => {
    const r = parseNumber(" -$1,000 ");
    expect(r.value).toBeNull();
    expect(r.error).toBe("negative");
  });

  it("errors on non-numeric", () => {
    const r = parseNumber("abc");
    expect(r.value).toBeNull();
    expect(r.error).toBe("not_a_number");
  });

  it("treats infinity/NaN-producing inputs as not_a_number", () => {
    // `Number("Infinity")` is finite-false; the Swift `Double()` path would
    // also reject "Infinity" as a price, so we guard with Number.isFinite.
    expect(parseNumber("Infinity").error).toBe("not_a_number");
    expect(parseNumber("1.2.3").error).toBe("not_a_number");
  });
});
