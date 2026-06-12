import { describe, it, expect } from "vitest";
import {
  computeLedger,
  mondayOf,
  periodRange,
  localIsoDate,
  type InvoiceArRow,
} from "@/lib/api/services/books-service";

const NOW = new Date("2026-06-11T12:00:00");

function invoice(partial: Partial<InvoiceArRow>): InvoiceArRow {
  return {
    id: "inv-1",
    client_id: "client-1",
    project_id: null,
    status: "sent",
    due_date: null,
    balance_due: 0,
    ...partial,
  };
}

const EMPTY = { payments: [], expenses: [], invoices: [], allocations: [], now: NOW };

describe("computeLedger — NET", () => {
  it("nets payments in against expenses out with margin", () => {
    const ledger = computeLedger({
      ...EMPTY,
      payments: [{ amount: 1000, payment_date: "2026-06-01", invoice_id: null }],
      expenses: [{ id: "e1", amount: 400, expense_date: "2026-06-02" }],
    });
    expect(ledger.paymentsIn).toBe(1000);
    expect(ledger.expensesOut).toBe(400);
    expect(ledger.net).toBe(600);
    expect(ledger.marginPct).toBeCloseTo(60);
  });

  it("returns zero margin when there are no payments", () => {
    const ledger = computeLedger({
      ...EMPTY,
      expenses: [{ id: "e1", amount: 400, expense_date: "2026-06-02" }],
    });
    expect(ledger.net).toBe(-400);
    expect(ledger.marginPct).toBe(0);
  });
});

describe("computeLedger — weekly nets", () => {
  it("buckets by Monday-start week across a month boundary", () => {
    // 2026-05-31 is a Sunday (week of Mon May 25); 2026-06-01 is a Monday.
    const ledger = computeLedger({
      ...EMPTY,
      payments: [
        { amount: 100, payment_date: "2026-05-31", invoice_id: null },
        { amount: 200, payment_date: "2026-06-01", invoice_id: null },
      ],
      expenses: [{ id: "e1", amount: 50, expense_date: "2026-06-03" }],
    });
    expect(ledger.weeklyNets).toEqual([
      { weekStart: "2026-05-25", net: 100 },
      { weekStart: "2026-06-01", net: 150 },
    ]);
    expect(ledger.avgPerWeek).toBeCloseTo(125);
    expect(ledger.lowWeek).toEqual({ weekStart: "2026-05-25", net: 100 });
  });

  it("mondayOf maps Sunday to the prior Monday", () => {
    expect(mondayOf(new Date("2026-05-31T08:00:00"))).toBe("2026-05-25");
    expect(mondayOf(new Date("2026-06-01T08:00:00"))).toBe("2026-06-01");
  });
});

describe("computeLedger — A/R aging", () => {
  it("buckets balances by overdue days at the 30/60/90 boundaries", () => {
    const day = (offset: number) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    const ledger = computeLedger({
      ...EMPTY,
      invoices: [
        invoice({ id: "a", balance_due: 10, due_date: day(-5) }), // not yet due → 0-30
        invoice({ id: "b", balance_due: 20, due_date: day(30) }), // 30d overdue → 0-30
        invoice({ id: "c", balance_due: 30, due_date: day(31) }), // 31d → 31-60
        invoice({ id: "d", balance_due: 40, due_date: day(60) }), // 60d → 31-60
        invoice({ id: "e", balance_due: 50, due_date: day(61) }), // 61d → 61-90
        invoice({ id: "f", balance_due: 60, due_date: day(91) }), // 91d → 90+
        invoice({ id: "g", balance_due: 70, due_date: null }), // no due date → 0-30, not overdue
      ],
    });
    expect(ledger.ar.buckets).toEqual({ b0_30: 100, b31_60: 70, b61_90: 50, b90p: 60 });
    expect(ledger.ar.total).toBe(280);
    expect(ledger.ar.overdueTotal).toBe(200); // b,c,d,e,f
    expect(ledger.ar.overdueCount).toBe(5);
  });

  it("excludes paid/void/draft/written_off and zero balances; picks top chase", () => {
    const ledger = computeLedger({
      ...EMPTY,
      invoices: [
        invoice({ id: "a", status: "paid", balance_due: 999 }),
        invoice({ id: "b", status: "void", balance_due: 999 }),
        invoice({ id: "c", status: "draft", balance_due: 999 }),
        invoice({ id: "d", status: "sent", balance_due: 0 }),
        invoice({ id: "e", status: "sent", balance_due: 100, client_id: "c1" }),
        invoice({ id: "f", status: "past_due", balance_due: 250, client_id: "c2" }),
      ],
    });
    expect(ledger.ar.total).toBe(350);
    expect(ledger.ar.topChase).toEqual({ clientId: "c2", amount: 250 });
  });

  it("returns null top chase on empty data", () => {
    const ledger = computeLedger(EMPTY);
    expect(ledger.ar.topChase).toBeNull();
    expect(ledger.ar.total).toBe(0);
    expect(ledger.lowWeek).toBeNull();
    expect(ledger.jobs.bars).toEqual([]);
  });
});

describe("computeLedger — jobs", () => {
  it("computes per-job nets with allocation amount fallback to percentage", () => {
    const ledger = computeLedger({
      ...EMPTY,
      payments: [
        { amount: 1000, payment_date: "2026-06-01", invoice_id: "inv-p1" },
        { amount: 500, payment_date: "2026-06-02", invoice_id: "inv-p2" },
      ],
      expenses: [
        { id: "e1", amount: 300, expense_date: "2026-06-03" },
        { id: "e2", amount: 200, expense_date: "2026-06-04" },
      ],
      invoices: [
        invoice({ id: "inv-p1", project_id: "proj-1", status: "paid" }),
        invoice({ id: "inv-p2", project_id: "proj-2", status: "paid" }),
      ],
      allocations: [
        // explicit amount wins
        { expense_id: "e1", project_id: "proj-1", percentage: 100, amount: 250 },
        // percentage fallback: 200 × 50% = 100
        { expense_id: "e2", project_id: "proj-2", percentage: 50, amount: null },
      ],
    });
    const byProject = Object.fromEntries(ledger.jobs.bars.map((b) => [b.projectId, b.net]));
    expect(byProject["proj-1"]).toBe(750);
    expect(byProject["proj-2"]).toBe(400);
    expect(ledger.jobs.profitable).toBe(2);
    expect(ledger.jobs.losers).toBe(0);
    // margins: 75% and 80% → avg 77.5%
    expect(ledger.jobs.avgMarginPct).toBeCloseTo(77.5);
  });

  it("displaces the 4th bar with a worst loser below the noise floor", () => {
    const payments = ["p1", "p2", "p3", "p4"].map((p, i) => ({
      amount: 1000 - i * 100,
      payment_date: "2026-06-01",
      invoice_id: `inv-${p}`,
    }));
    const invoices = ["p1", "p2", "p3", "p4"].map((p) =>
      invoice({ id: `inv-${p}`, project_id: `proj-${p}`, status: "paid" }),
    );
    const ledger = computeLedger({
      ...EMPTY,
      payments,
      expenses: [{ id: "e1", amount: 900, expense_date: "2026-06-02" }],
      invoices,
      allocations: [{ expense_id: "e1", project_id: "proj-loser", percentage: 100, amount: 900 }],
    });
    expect(ledger.jobs.bars).toHaveLength(4);
    const ids = ledger.jobs.bars.map((b) => b.projectId);
    expect(ids).toContain("proj-loser"); // -900 < -500 floor displaces the 4th
    expect(ids).not.toContain("proj-p4");
    expect(ledger.jobs.losers).toBe(1);
  });
});

describe("localIsoDate", () => {
  it("serializes the LOCAL calendar date (toISOString would shift a day west of UTC)", () => {
    // 23:30 local on May 31 — in any UTC-minus zone, toISOString().slice(0,10)
    // would report June 1. The boundary must stay May 31.
    const lateNight = new Date(2026, 4, 31, 23, 30, 0);
    expect(localIsoDate(lateNight)).toBe("2026-05-31");

    const earlyMorning = new Date(2026, 5, 1, 0, 5, 0);
    expect(localIsoDate(earlyMorning)).toBe("2026-06-01");
  });

  it("keeps last_month's end inside the month at any time of day", () => {
    const lateAfternoon = new Date(2026, 5, 11, 17, 30, 0); // 5:30pm local
    const { end } = periodRange("last_month", lateAfternoon);
    expect(localIsoDate(end)).toBe("2026-05-31");
  });
});

describe("periodRange", () => {
  it("computes calendar-aligned windows", () => {
    const { start: monthStart } = periodRange("this_month", NOW);
    expect(monthStart.getDate()).toBe(1);
    expect(monthStart.getMonth()).toBe(5);

    const { start: lastStart, end: lastEnd } = periodRange("last_month", NOW);
    expect(lastStart.getMonth()).toBe(4);
    expect(lastEnd.getMonth()).toBe(4);
    expect(lastEnd.getDate()).toBe(31);

    const { start: qStart } = periodRange("this_quarter", NOW);
    expect(qStart.getMonth()).toBe(3); // Q2 = April

    const { start: yStart } = periodRange("ytd", NOW);
    expect(yStart.getMonth()).toBe(0);
    expect(yStart.getDate()).toBe(1);
  });
});
