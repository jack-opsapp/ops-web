import { describe, it, expect } from "vitest";
import {
  WIZARD_TRADES,
  WIZARD_TRADE_IDS,
  isWizardTrade,
  getTradeLabel,
  type WizardTradeId,
} from "@/lib/catalog-setup/trade-list";
import { INDUSTRY_PRESETS } from "@/lib/data/industry-presets";

// trade-list is the SINGLE source of the trade tokens consumed by BOTH the
// wizard source picker AND the projects.trade CHECK migration. These invariants
// guarantee the migration array and the picker can never drift apart, every
// token maps to a real industry preset, and no picker option is ever empty.

// The exact 11 tokens locked in the plan (Phase 0 Task 0.3 migration +
// Phase 2 Task 2.9). Order matters: the three legacy values
// (roofing/hvac/plumbing) come first so the CHECK widening is purely additive.
const EXPECTED_TOKENS = [
  "roofing",
  "hvac",
  "plumbing",
  "electrical",
  "flooring",
  "masonry",
  "drywall",
  "concrete",
  "cleaning",
  "windows_and_doors",
  "general",
] as const;

describe("WIZARD_TRADES", () => {
  it("contains exactly the 11 locked tokens in the locked order", () => {
    expect(WIZARD_TRADES.map((t) => t.id)).toEqual(EXPECTED_TOKENS);
  });

  it("leads with the three legacy tokens so the projects.trade CHECK widening is additive", () => {
    expect(WIZARD_TRADES.slice(0, 3).map((t) => t.id)).toEqual([
      "roofing",
      "hvac",
      "plumbing",
    ]);
  });

  it("has unique ids", () => {
    const ids = WIZARD_TRADES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every trade a non-empty human display label", () => {
    for (const t of WIZARD_TRADES) {
      expect(typeof t.label).toBe("string");
      expect(t.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("renders distinct labels (no two trades share a display string)", () => {
    const labels = WIZARD_TRADES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("stores tokens as stable lowercase snake_case slugs (iOS-shared, unrenameable)", () => {
    for (const t of WIZARD_TRADES) {
      expect(t.id).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("maps every trade to a real INDUSTRY_PRESETS key (no dead template option)", () => {
    for (const t of WIZARD_TRADES) {
      expect(t.presetKey).not.toBeNull();
      expect(INDUSTRY_PRESETS[t.presetKey as string]).toBeDefined();
    }
  });
});

describe("WIZARD_TRADE_IDS", () => {
  it("mirrors the WIZARD_TRADES ids exactly (the array the CHECK migration uses)", () => {
    expect(WIZARD_TRADE_IDS).toEqual(EXPECTED_TOKENS);
  });
});

describe("isWizardTrade", () => {
  it("accepts every known token", () => {
    for (const id of WIZARD_TRADE_IDS) {
      expect(isWizardTrade(id)).toBe(true);
    }
  });

  it("rejects unknown / junk values", () => {
    expect(isWizardTrade("painting")).toBe(false);
    expect(isWizardTrade("ROOFING")).toBe(false); // case-sensitive token
    expect(isWizardTrade("")).toBe(false);
    expect(isWizardTrade("windows-and-doors")).toBe(false); // hyphen, not slug
  });
});

describe("getTradeLabel", () => {
  it("returns the display label for a known trade", () => {
    const roofing = WIZARD_TRADES.find((t) => t.id === "roofing");
    expect(getTradeLabel("roofing")).toBe(roofing?.label);
  });

  it("renders windows_and_doors with an ampersand label, not the raw slug", () => {
    const label = getTradeLabel("windows_and_doors");
    expect(label).not.toBe("windows_and_doors");
    expect(label.toLowerCase()).toContain("windows");
    expect(label.toLowerCase()).toContain("doors");
  });
});

describe("WizardTradeId type", () => {
  it("is assignable from each literal token", () => {
    const ids: WizardTradeId[] = [...WIZARD_TRADE_IDS];
    expect(ids).toHaveLength(EXPECTED_TOKENS.length);
  });
});
