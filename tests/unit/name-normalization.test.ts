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

describe("normalizeAddress", () => {
  it("lowercases and normalizes whitespace", () => {
    expect(normalizeAddress("123 Main Street")).toBe("123 main street");
  });

  it("strips unit/suite/apt designators", () => {
    expect(normalizeAddress("123 Main St, Suite 200")).toBe("123 main st");
    expect(normalizeAddress("123 Main St Unit 4B")).toBe("123 main st");
    expect(normalizeAddress("123 Main St Apt. 5")).toBe("123 main st");
    expect(normalizeAddress("123 Main St #12")).toBe("123 main st");
  });

  it("strips trailing periods", () => {
    expect(normalizeAddress("123 Main St.")).toBe("123 main st");
  });

  it("handles empty input", () => {
    expect(normalizeAddress("")).toBe("");
  });
});

describe("normalizeTitle", () => {
  it("strips email prefixes", () => {
    expect(normalizeTitle("RE: Deck Renovation")).toBe("deck renovation");
    expect(normalizeTitle("Fwd: RE: Roof Repair")).toBe("roof repair");
  });

  it("strips common trade filler words", () => {
    expect(normalizeTitle("New Project - Deck Build")).toBe("deck build");
    expect(normalizeTitle("Job: Kitchen Remodel")).toBe("kitchen remodel");
  });

  it("lowercases and trims", () => {
    expect(normalizeTitle("  Deck Renovation  ")).toBe("deck renovation");
  });
});
