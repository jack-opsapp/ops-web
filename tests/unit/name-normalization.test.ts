import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  normalizePhone,
  normalizeAddress,
  normalizeTitle,
} from "@/lib/utils/name-normalization";

describe("normalizeCompanyName", () => {
  it("strips business suffixes", () => {
    expect(normalizeCompanyName("Smith Roofing Inc.")).toBe("smith roofing");
    expect(normalizeCompanyName("WJ Construction Ltd")).toBe("wj");
    expect(normalizeCompanyName("PATH Developments Limited")).toBe("path");
  });

  it("lowercases and strips non-alphanumeric", () => {
    expect(normalizeCompanyName("O'Brien & Sons")).toBe("o brien sons");
  });

  it("collapses whitespace", () => {
    expect(normalizeCompanyName("  Smith   Roofing  ")).toBe("smith roofing");
  });

  it("handles empty and short strings", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("A")).toBe("a");
  });
});

describe("normalizePhone", () => {
  it("strips non-digits and returns last 10", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1-555-123-4567")).toBe("5551234567");
    expect(normalizePhone("555.123.4567")).toBe("5551234567");
  });

  it("handles short numbers", () => {
    expect(normalizePhone("1234567")).toBe("1234567");
  });

  it("handles empty/null-like input", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("no phone")).toBe("");
  });
});

// ─── SQL-parity vectors ──────────────────────────────────────────────────────
// These vectors are the single source of truth shared with the SQL normalizers
// `private.normalize_address` / `private.normalize_title` (won-conversion
// migration 20260603020000). Every expected value was captured by running the
// SQL function against prod (read-only). The TS and SQL implementations MUST
// agree token-for-token so the convert-time preflight and the nightly
// duplicate scan can never drift (spec §6.1). When you change one, change the
// other and re-verify these vectors against `private.normalize_address`.

// [input, expected] — directionals (w↔west, ne↔northeast, …) and street types
// (ave↔avenue, st↔street, rd↔road, blvd, dr, cres, hwy, pl, ct, ln, …) fold to
// one canonical token; unit/suite/apt + everything after is stripped; periods
// and commas become separators; case + whitespace normalized.
const ADDRESS_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["1240 W 6th Ave", "1240 west 6th avenue"],
  ["1240 West 6th Avenue", "1240 west 6th avenue"],
  ["123 Main Street", "123 main street"],
  ["123 Main St, Suite 200", "123 main street"],
  ["123 Main St Unit 4B", "123 main street"],
  ["123 Main St Apt. 5", "123 main street"],
  ["123 Main St #12", "123 main street"],
  ["123 Main St.", "123 main street"],
  ["", ""],
  ["456 Oak Ave", "456 oak avenue"],
  ["789 N Pine Rd", "789 north pine road"],
  ["789 North Pine Road", "789 north pine road"],
  ["10 NE 2nd Blvd", "10 northeast 2nd boulevard"],
  ["10 northeast 2nd boulevard", "10 northeast 2nd boulevard"],
  ["100 SW Marine Dr", "100 southwest marine drive"],
  ["22 Côte-des-Neiges, Montréal, QC", "22 côte-des-neiges montréal qc"],
  ["500 Boul René-Lévesque, Montreal", "500 boulevard rené-lévesque montreal"],
];

// [input, expected] — email prefixes (RE:/FW:/FWD:) and "New Project -"/"Job:"
// filler stripped; auto-name placeholders ("New project", "proyecto nuevo",
// "{Client}'s Project") collapse to "" so two unnamed projects never produce a
// false same_title signal (spec §6.1, edge #5).
const TITLE_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["New project", ""],
  ["proyecto nuevo", ""],
  ["Acme's Project", ""],
  ["Williams's Project", ""],
  ["Smith's project", ""],
  ["RE: Deck Renovation", "deck renovation"],
  ["Fwd: RE: Roof Repair", "roof repair"],
  ["New Project - Deck Build", "deck build"],
  ["Job: Kitchen Remodel", "kitchen remodel"],
  ["  Deck Renovation  ", "deck renovation"],
  ["", ""],
  ["A Real Project Name", "a real project name"],
];

describe("normalizeAddress", () => {
  it.each(ADDRESS_VECTORS)(
    "normalizes %j → %j (SQL parity)",
    (input, expected) => {
      expect(normalizeAddress(input)).toBe(expected);
    }
  );

  it("treats directional + street-type variants as the same canonical address", () => {
    expect(normalizeAddress("1240 W 6th Ave")).toBe(
      normalizeAddress("1240 West 6th Avenue")
    );
    expect(normalizeAddress("789 N Pine Rd")).toBe(
      normalizeAddress("789 North Pine Road")
    );
  });
});

describe("normalizeTitle", () => {
  it.each(TITLE_VECTORS)(
    "normalizes %j → %j (SQL parity)",
    (input, expected) => {
      expect(normalizeTitle(input)).toBe(expected);
    }
  );

  it("makes auto-name placeholders matching-invisible", () => {
    expect(normalizeTitle("New project")).toBe("");
    expect(normalizeTitle("Acme's Project")).toBe("");
  });
});
