import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SPEC_TIERS,
  SPEC_TIER_DESCRIPTORS,
  SPEC_TIER_DESIGNATIONS,
  SPEC_TIER_MILESTONE_SHAPE,
  SPEC_TIER_STRIPE_DISPLAY_NAMES,
  SPEC_TIER_TOTAL_CENTS,
  coerceSpecTier,
  formatSpecTier,
  formatSpecTierLockup,
  isSpecTier,
  specMilestoneSchedule,
} from "../spec-tiers";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SPEC tier model v2 — slugs", () => {
  it("orders the three v2 slugs from the wedge tier up", () => {
    expect(SPEC_TIERS).toEqual(["spec01", "spec02", "spec03"]);
  });

  it("recognises only v2 slugs", () => {
    expect(isSpecTier("spec01")).toBe(true);
    expect(isSpecTier("spec02")).toBe(true);
    expect(isSpecTier("spec03")).toBe(true);
    expect(isSpecTier("setup")).toBe(false);
    expect(isSpecTier("build")).toBe(false);
    expect(isSpecTier("enterprise")).toBe(false);
    expect(isSpecTier("SPEC01")).toBe(false);
    expect(isSpecTier(null)).toBe(false);
    expect(isSpecTier(undefined)).toBe(false);
    expect(isSpecTier(1)).toBe(false);
  });

  it("passes v2 slugs through coercion untouched", () => {
    expect(coerceSpecTier("spec02")).toBe("spec02");
    expect(coerceSpecTier("spec03")).toBe("spec03");
  });

  it("coerces an unknown slug to the wedge tier and leaves a trace", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(coerceSpecTier("enterprise")).toBe("spec01");
    expect(coerceSpecTier(null)).toBe("spec01");
    expect(coerceSpecTier(undefined)).toBe("spec01");
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain("enterprise");
  });
});

describe("SPEC tier model v2 — designations", () => {
  it("maps every slug to its SPEC-0N designation", () => {
    expect(SPEC_TIER_DESIGNATIONS).toEqual({
      spec01: "SPEC-01",
      spec02: "SPEC-02",
      spec03: "SPEC-03",
    });
  });

  it("maps every slug to its descriptor", () => {
    expect(SPEC_TIER_DESCRIPTORS).toEqual({
      spec01: "WORKFLOWS",
      spec02: "SYSTEMS",
      spec03: "PROPRIETARY",
    });
  });

  it("formats the short designation for board cells and chips", () => {
    expect(formatSpecTier("spec01")).toBe("SPEC-01");
    expect(formatSpecTier("spec02")).toBe("SPEC-02");
    expect(formatSpecTier("spec03")).toBe("SPEC-03");
  });

  it("falls through to the raw slug in uppercase for an unknown value", () => {
    expect(formatSpecTier("spec04")).toBe("SPEC04");
  });

  it("formats the full lockup for headings", () => {
    expect(formatSpecTierLockup("spec01")).toBe("SPEC-01 · WORKFLOWS");
    expect(formatSpecTierLockup("spec02")).toBe("SPEC-02 · SYSTEMS");
    expect(formatSpecTierLockup("spec03")).toBe("SPEC-03 · PROPRIETARY");
  });

  it("carries the Stripe display names from the tier table", () => {
    expect(SPEC_TIER_STRIPE_DISPLAY_NAMES).toEqual({
      spec01: "OPS SPEC-01 — WORKFLOWS",
      spec02: "OPS SPEC-02 — SYSTEMS",
      spec03: "OPS SPEC-03 — PROPRIETARY",
    });
  });
});

describe("SPEC tier model v2 — pricing", () => {
  it("mirrors spec_capacity.total_price_cents (spec03 is the floor)", () => {
    expect(SPEC_TIER_TOTAL_CENTS).toEqual({
      spec01: 200_000,
      spec02: 750_000,
      spec03: 2_500_000,
    });
  });

  it("assigns each tier its payment shape", () => {
    expect(SPEC_TIER_MILESTONE_SHAPE).toEqual({
      spec01: "half_half",
      spec02: "quarters",
      spec03: "floor_quarters",
    });
  });
});

describe("specMilestoneSchedule — SPEC-01 (50/50)", () => {
  it("carries a payment at P1 and P4 only", () => {
    const s = specMilestoneSchedule("spec01", null);
    expect(s.totalCents).toBe(200_000);
    expect(s.totalIsFloor).toBe(false);
    expect(s.totalLocked).toBe(true);
    expect(s.entries).toEqual([
      { milestone: "deposit", label: "P1", amountCents: 100_000 },
      { milestone: "delivery", label: "P4", amountCents: 100_000 },
    ]);
  });

  it("ignores a locked total on a fixed-price tier", () => {
    expect(specMilestoneSchedule("spec01", 999_999).entries).toEqual(
      specMilestoneSchedule("spec01", null).entries,
    );
  });
});

describe("specMilestoneSchedule — SPEC-02 (quarters)", () => {
  it("splits $7,500 into four equal checkpoints", () => {
    const s = specMilestoneSchedule("spec02", null);
    expect(s.totalCents).toBe(750_000);
    expect(s.totalIsFloor).toBe(false);
    expect(s.totalLocked).toBe(true);
    expect(s.entries).toEqual([
      { milestone: "deposit", label: "P1", amountCents: 187_500 },
      { milestone: "scope_signoff", label: "P2", amountCents: 187_500 },
      { milestone: "midpoint", label: "P3", amountCents: 187_500 },
      { milestone: "delivery", label: "P4", amountCents: 187_500 },
    ]);
  });
});

describe("specMilestoneSchedule — SPEC-03 (floor, locked at scope sign-off)", () => {
  it("fixes P1 at a quarter of the floor and leaves P2–P4 unknown until locked", () => {
    const s = specMilestoneSchedule("spec03", null);
    expect(s.totalCents).toBe(2_500_000);
    expect(s.totalIsFloor).toBe(true);
    expect(s.totalLocked).toBe(false);
    expect(s.entries).toEqual([
      { milestone: "deposit", label: "P1", amountCents: 625_000 },
      { milestone: "scope_signoff", label: "P2", amountCents: null },
      { milestone: "midpoint", label: "P3", amountCents: null },
      { milestone: "delivery", label: "P4", amountCents: null },
    ]);
  });

  it("splits the locked remainder three ways once the total is locked", () => {
    const s = specMilestoneSchedule("spec03", 3_100_000);
    expect(s.totalCents).toBe(3_100_000);
    expect(s.totalIsFloor).toBe(false);
    expect(s.totalLocked).toBe(true);
    expect(s.entries).toEqual([
      { milestone: "deposit", label: "P1", amountCents: 625_000 },
      { milestone: "scope_signoff", label: "P2", amountCents: 825_000 },
      { milestone: "midpoint", label: "P3", amountCents: 825_000 },
      { milestone: "delivery", label: "P4", amountCents: 825_000 },
    ]);
  });

  it("lands residual cents on P4 so the checkpoints sum to the locked total", () => {
    const s = specMilestoneSchedule("spec03", 3_100_001);
    const sum = s.entries.reduce((acc, e) => acc + (e.amountCents ?? 0), 0);
    expect(sum).toBe(3_100_001);
    expect(s.entries[3]).toEqual({ milestone: "delivery", label: "P4", amountCents: 825_001 });
  });

  it("locks exactly at the floor without touching P1", () => {
    const s = specMilestoneSchedule("spec03", 2_500_000);
    expect(s.totalLocked).toBe(true);
    expect(s.entries.map((e) => e.amountCents)).toEqual([625_000, 625_000, 625_000, 625_000]);
  });

  it("refuses a locked total below the floor", () => {
    expect(() => specMilestoneSchedule("spec03", 2_499_999)).toThrow(/floor/);
  });

  it("refuses a non-integer locked total", () => {
    expect(() => specMilestoneSchedule("spec03", 2_600_000.5)).toThrow(/integer/);
  });
});
