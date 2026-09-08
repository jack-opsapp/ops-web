import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeMilestonesTab,
  milestoneFireability,
  readLockedTotalCents,
} from "../spec-milestones";
import type { SpecAcceptanceEventType } from "../spec-types";

afterEach(() => {
  vi.restoreAllMocks();
});

const accepted = (...types: SpecAcceptanceEventType[]) => new Set(types);

const paidDeposit = {
  id: "pay-p1",
  milestone: "deposit" as const,
  status: "paid" as const,
  total_cents: 100_000,
  invoiced_at: "2026-09-01T00:00:00Z",
  paid_at: "2026-09-01T00:05:00Z",
  due_date: "2026-09-16",
  stripe_invoice_id: "in_p1",
};

describe("readLockedTotalCents", () => {
  it("returns null when the engagement has no locked total", () => {
    expect(readLockedTotalCents("spec03", null)).toBeNull();
    expect(readLockedTotalCents("spec03", undefined)).toBeNull();
  });

  it("passes a valid locked total through", () => {
    expect(readLockedTotalCents("spec03", 3_100_000)).toBe(3_100_000);
  });

  it("fails closed on a locked total below the floor and leaves a trace", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readLockedTotalCents("spec03", 2_000_000)).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("ignores a locked total on a fixed-price tier", () => {
    expect(readLockedTotalCents("spec02", 9_000_000)).toBeNull();
  });
});

describe("composeMilestonesTab — SPEC-01 (50/50)", () => {
  it("lists only P1 and P4, with P4 blocked until delivery is accepted", () => {
    const tab = composeMilestonesTab({
      tier: "spec01",
      lockedTotalCents: null,
      walkthroughCompletedAt: null,
      payments: [paidDeposit],
      acceptanceTypes: accepted("tos_accepted", "scope_signoff"),
    });
    expect(tab.tier).toBe("spec01");
    expect(tab.totalCents).toBe(200_000);
    expect(tab.totalIsFloor).toBe(false);
    expect(tab.totalLocked).toBe(true);
    expect(tab.rows.map((r) => r.label)).toEqual(["P1", "P4"]);
    expect(tab.rows[0]).toMatchObject({ milestone: "deposit", status: "paid", amountCents: 100_000, id: "pay-p1" });
    expect(tab.rows[1]).toMatchObject({
      milestone: "delivery",
      status: "not_yet_fired",
      amountCents: 100_000,
      fireable: false,
      fireBlockedReason: "Walkthrough not yet stamped",
    });
  });

  it("still surfaces an off-schedule payment row so money is never hidden", () => {
    const strayP2 = { ...paidDeposit, id: "pay-p2", milestone: "scope_signoff" as const, total_cents: 50_000 };
    const tab = composeMilestonesTab({
      tier: "spec01",
      lockedTotalCents: null,
      walkthroughCompletedAt: null,
      payments: [paidDeposit, strayP2],
      acceptanceTypes: accepted(),
    });
    expect(tab.rows.map((r) => r.label)).toEqual(["P1", "P4", "P2"]);
    expect(tab.rows[2]).toMatchObject({
      id: "pay-p2",
      status: "paid",
      amountCents: 50_000,
      fireable: false,
      fireBlockedReason: "Off-schedule for SPEC-01",
    });
  });
});

describe("composeMilestonesTab — SPEC-02 (quarters)", () => {
  it("lists four checkpoints and opens P2 once scope is signed", () => {
    const tab = composeMilestonesTab({
      tier: "spec02",
      lockedTotalCents: null,
      walkthroughCompletedAt: null,
      payments: [{ ...paidDeposit, total_cents: 187_500 }],
      acceptanceTypes: accepted("scope_signoff"),
    });
    expect(tab.totalCents).toBe(750_000);
    expect(tab.rows.map((r) => [r.label, r.amountCents, r.fireable])).toEqual([
      ["P1", 187_500, false],
      ["P2", 187_500, true],
      ["P3", 187_500, false],
      ["P4", 187_500, false],
    ]);
    expect(tab.rows[2].fireBlockedReason).toBe("Awaiting customer midpoint acceptance");
  });
});

describe("composeMilestonesTab — SPEC-03 (floor, locked at scope sign-off)", () => {
  it("shows the floor and keeps P2–P4 unknown and blocked until the total is locked", () => {
    const tab = composeMilestonesTab({
      tier: "spec03",
      lockedTotalCents: null,
      walkthroughCompletedAt: "2026-09-04T00:00:00Z",
      payments: [{ ...paidDeposit, total_cents: 625_000 }],
      acceptanceTypes: accepted("scope_signoff", "midpoint_accepted", "delivery_accepted"),
    });
    expect(tab.totalCents).toBe(2_500_000);
    expect(tab.totalIsFloor).toBe(true);
    expect(tab.totalLocked).toBe(false);
    expect(tab.rows.map((r) => [r.label, r.amountCents, r.fireable])).toEqual([
      ["P1", 625_000, false],
      ["P2", null, false],
      ["P3", null, false],
      ["P4", null, false],
    ]);
    expect(tab.rows[1].fireBlockedReason).toBe("Total not locked — lock it on the scope doc");
  });

  it("prices P2–P4 from the locked remainder once locked", () => {
    const tab = composeMilestonesTab({
      tier: "spec03",
      lockedTotalCents: 3_100_000,
      walkthroughCompletedAt: null,
      payments: [{ ...paidDeposit, total_cents: 625_000 }],
      acceptanceTypes: accepted("scope_signoff"),
    });
    expect(tab.totalCents).toBe(3_100_000);
    expect(tab.totalIsFloor).toBe(false);
    expect(tab.totalLocked).toBe(true);
    expect(tab.rows.map((r) => [r.label, r.amountCents, r.fireable])).toEqual([
      ["P1", 625_000, false],
      ["P2", 825_000, true],
      ["P3", 825_000, false],
      ["P4", 825_000, false],
    ]);
  });
});

describe("milestoneFireability", () => {
  const base = {
    lockedTotalCents: null,
    walkthroughCompletedAt: null,
    hasExistingPayment: false,
  };

  it("never lets the operator fire P1", () => {
    const r = milestoneFireability({ ...base, tier: "spec02", milestone: "deposit", acceptanceTypes: accepted() });
    expect(r.fireable).toBe(false);
    expect(r.reason).toMatch(/Stripe webhook/);
    expect(r.amountCents).toBe(187_500);
  });

  it("refuses a checkpoint that carries no payment for the tier", () => {
    const r = milestoneFireability({
      ...base,
      tier: "spec01",
      milestone: "scope_signoff",
      acceptanceTypes: accepted("scope_signoff"),
    });
    expect(r).toEqual({ fireable: false, reason: "No payment at this checkpoint for SPEC-01", amountCents: null });
  });

  it("refuses a second invoice for the same checkpoint", () => {
    const r = milestoneFireability({
      ...base,
      tier: "spec02",
      milestone: "scope_signoff",
      acceptanceTypes: accepted("scope_signoff"),
      hasExistingPayment: true,
    });
    expect(r.fireable).toBe(false);
    expect(r.reason).toBe("Already invoiced");
  });

  it("refuses an unlocked SPEC-03 checkpoint even when the prerequisite is met", () => {
    const r = milestoneFireability({
      ...base,
      tier: "spec03",
      milestone: "scope_signoff",
      acceptanceTypes: accepted("scope_signoff"),
    });
    expect(r).toEqual({
      fireable: false,
      reason: "Total not locked — lock it on the scope doc",
      amountCents: null,
    });
  });

  it("names the missing prerequisite before the unlocked total", () => {
    const r = milestoneFireability({
      ...base,
      tier: "spec03",
      milestone: "scope_signoff",
      acceptanceTypes: accepted(),
    });
    expect(r.reason).toBe("Awaiting customer scope sign-off");
  });

  it("fires a locked SPEC-03 checkpoint at the split amount", () => {
    const r = milestoneFireability({
      ...base,
      tier: "spec03",
      lockedTotalCents: 3_100_000,
      milestone: "midpoint",
      acceptanceTypes: accepted("scope_signoff", "midpoint_accepted"),
    });
    expect(r).toEqual({ fireable: true, reason: null, amountCents: 825_000 });
  });

  it("requires the walkthrough stamp and delivery acceptance for P4", () => {
    const noStamp = milestoneFireability({
      ...base,
      tier: "spec01",
      milestone: "delivery",
      acceptanceTypes: accepted("delivery_accepted"),
    });
    expect(noStamp.reason).toBe("Walkthrough not yet stamped");
    const noAccept = milestoneFireability({
      ...base,
      tier: "spec01",
      milestone: "delivery",
      walkthroughCompletedAt: "2026-09-04T00:00:00Z",
      acceptanceTypes: accepted(),
    });
    expect(noAccept.reason).toBe("Awaiting customer delivery acceptance");
    const ok = milestoneFireability({
      ...base,
      tier: "spec01",
      milestone: "delivery",
      walkthroughCompletedAt: "2026-09-04T00:00:00Z",
      acceptanceTypes: accepted("delivery_accepted"),
    });
    expect(ok).toEqual({ fireable: true, reason: null, amountCents: 100_000 });
  });
});
