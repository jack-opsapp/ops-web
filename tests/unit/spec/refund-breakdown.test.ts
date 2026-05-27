/**
 * Unit tests for `lib/spec/refund-breakdown.ts`.
 *
 * Bible: SPEC/03_WORKFLOW.md § Refund processing — per-milestone procedure.
 *
 * Scenarios:
 *  - mixed-state project (P1 paid, P2 paid, P3 invoiced unpaid, P4 invoiced
 *    partially paid via processor; preview optimistically calls it void)
 *  - already-refunded milestone (noop)
 *  - never-invoiced milestone (noop)
 *  - subset of milestones selected (the rest greyed)
 *  - overdue invoice → void
 *  - partially_refunded → refund remaining
 */
import { describe, expect, it } from "vitest";

import {
  REFUND_MILESTONE_ORDER,
  computeRefundBreakdownPreview,
  type RefundPaymentRow,
} from "@/lib/spec/refund-breakdown";

function makePayment(
  overrides: Partial<RefundPaymentRow> &
    Pick<RefundPaymentRow, "milestone" | "status" | "total_cents">,
): RefundPaymentRow {
  return {
    stripe_payment_intent_id:
      overrides.stripe_payment_intent_id ?? "pi_test",
    stripe_invoice_id: overrides.stripe_invoice_id ?? "in_test",
    amount_refunded_cents: overrides.amount_refunded_cents ?? 0,
    ...overrides,
  };
}

describe("computeRefundBreakdownPreview", () => {
  it("plans actions for a mixed-state project (P1 paid, P2 paid, P3 invoiced, P4 partially refunded)", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "deposit",
        status: "paid",
        total_cents: 75_000,
        stripe_payment_intent_id: "pi_deposit",
      }),
      makePayment({
        milestone: "scope_signoff",
        status: "paid",
        total_cents: 212_500,
        stripe_payment_intent_id: "pi_scope",
      }),
      makePayment({
        milestone: "midpoint",
        status: "invoiced",
        total_cents: 212_500,
        stripe_invoice_id: "in_midpoint",
      }),
      makePayment({
        milestone: "delivery",
        status: "partially_refunded",
        total_cents: 212_500,
        amount_refunded_cents: 100_000,
        stripe_payment_intent_id: "pi_delivery",
      }),
    ];

    const { lines, totals } = computeRefundBreakdownPreview(payments);

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({
      milestone: "deposit",
      action: "refund",
      stripeTargetId: "pi_deposit",
      amountCents: 75_000,
      cashRefundCents: 75_000,
      isGreyed: false,
    });
    expect(lines[1]).toMatchObject({
      milestone: "scope_signoff",
      action: "refund",
      stripeTargetId: "pi_scope",
      amountCents: 212_500,
      cashRefundCents: 212_500,
    });
    expect(lines[2]).toMatchObject({
      milestone: "midpoint",
      action: "void",
      stripeTargetId: "in_midpoint",
      amountCents: 212_500,
      cashRefundCents: 0,
    });
    expect(lines[3]).toMatchObject({
      milestone: "delivery",
      action: "refund",
      stripeTargetId: "pi_delivery",
      amountCents: 112_500,
      cashRefundCents: 112_500,
    });

    // Cash refund excludes the open invoice's face value.
    expect(totals.totalCashRefundCents).toBe(75_000 + 212_500 + 112_500);
    expect(totals.totalNonCashAdjustmentCents).toBe(212_500);
    expect(totals.actionableMilestoneCount).toBe(4);
  });

  it("greys out milestones that aren't selected", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "deposit",
        status: "paid",
        total_cents: 75_000,
      }),
      makePayment({
        milestone: "scope_signoff",
        status: "paid",
        total_cents: 212_500,
      }),
    ];
    const { lines, totals } = computeRefundBreakdownPreview(payments, [
      "deposit",
    ]);
    expect(lines.find((l) => l.milestone === "deposit")).toMatchObject({
      action: "refund",
      isGreyed: false,
    });
    expect(lines.find((l) => l.milestone === "scope_signoff")).toMatchObject({
      action: "noop",
      isGreyed: true,
      note: expect.stringContaining("not selected"),
    });
    expect(totals.actionableMilestoneCount).toBe(1);
    expect(totals.totalCashRefundCents).toBe(75_000);
  });

  it("noops a never-invoiced milestone", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({ milestone: "deposit", status: "paid", total_cents: 75_000 }),
    ];
    const { lines } = computeRefundBreakdownPreview(payments);
    const midpoint = lines.find((l) => l.milestone === "midpoint");
    expect(midpoint).toMatchObject({
      action: "noop",
      hasPayment: false,
      isGreyed: true,
      note: expect.stringContaining("No invoice fired"),
    });
  });

  it("noops an already-refunded milestone", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "deposit",
        status: "refunded",
        total_cents: 75_000,
        amount_refunded_cents: 75_000,
      }),
    ];
    const { lines, totals } = computeRefundBreakdownPreview(payments, [
      "deposit",
    ]);
    expect(lines[0]).toMatchObject({
      milestone: "deposit",
      action: "noop",
      isGreyed: true,
      note: "Already refunded",
    });
    expect(totals.totalCashRefundCents).toBe(0);
  });

  it("noops a fully-refunded `partially_refunded` row", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "deposit",
        status: "partially_refunded",
        total_cents: 75_000,
        amount_refunded_cents: 75_000,
      }),
    ];
    const { lines } = computeRefundBreakdownPreview(payments, ["deposit"]);
    expect(lines[0]).toMatchObject({
      milestone: "deposit",
      action: "noop",
      isGreyed: true,
    });
  });

  it("plans void for an overdue invoice", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "midpoint",
        status: "overdue",
        total_cents: 212_500,
        stripe_invoice_id: "in_overdue",
      }),
    ];
    const { lines } = computeRefundBreakdownPreview(payments, ["midpoint"]);
    expect(lines.find((l) => l.milestone === "midpoint")).toMatchObject({
      action: "void",
      stripeTargetId: "in_overdue",
      amountCents: 212_500,
      cashRefundCents: 0,
    });
  });

  it("noops a disputed payment", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "deposit",
        status: "disputed",
        total_cents: 75_000,
      }),
    ];
    const { lines } = computeRefundBreakdownPreview(payments, ["deposit"]);
    expect(lines[0]).toMatchObject({
      milestone: "deposit",
      action: "noop",
      isGreyed: true,
      note: expect.stringContaining("dispute"),
    });
  });

  it("returns lines in P1 → P4 milestone order regardless of input ordering", () => {
    const payments: RefundPaymentRow[] = [
      makePayment({
        milestone: "delivery",
        status: "paid",
        total_cents: 100,
      }),
      makePayment({
        milestone: "deposit",
        status: "paid",
        total_cents: 100,
      }),
    ];
    const { lines } = computeRefundBreakdownPreview(payments);
    expect(lines.map((l) => l.milestone)).toEqual(REFUND_MILESTONE_ORDER);
  });
});
