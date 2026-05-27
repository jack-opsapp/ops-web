/**
 * SPEC refund-breakdown computation (CR-4).
 *
 * Pure, deterministic logic that turns a set of `spec_payments` rows into the
 * per-milestone action plan the refund processor will execute. Used by:
 *
 *   1. The operator UI on `/admin/spec/refunds`, to preview the action plan
 *      BEFORE Jackson clicks "Process refund". Each row shows: milestone,
 *      current payment status, action verb, Stripe target id, amount.
 *
 *   2. The `process-refund` server action, which walks the same plan and
 *      hands each entry to Stripe. The processor records the executed
 *      `refund_breakdown` onto the request row.
 *
 * Bible: SPEC/03_WORKFLOW.md § Refund processing — per-milestone procedure.
 *
 * The mapping is deterministic:
 *   - `paid`                        → refund (Stripe Refunds API on PI)
 *   - `invoiced`, partially paid    → credit_note (+ refund the paid portion)
 *   - `invoiced` or `overdue`, open → void (or mark_uncollectible if Stripe says so)
 *   - `pending`                     → noop (milestone never invoiced)
 *   - `refunded`/`partially_refunded`/`voided`/`uncollectible` → noop (already done)
 *   - `disputed`                    → noop with note (the dispute path handles it)
 *
 * Partial-paid detection: Stripe stores per-invoice partial payment state on
 * the invoice object, not on our `spec_payments` row. The processor inspects
 * `stripe.invoices.retrieve()` at run time; the preview uses the optimistic
 * default — "open invoice → void". The preview is best-effort; the executed
 * `refund_breakdown` is the source of truth for the customer email and the
 * processed-refund detail view.
 *
 * SERVER + UI safe. No Stripe / Supabase imports — pure functions only.
 */

import type {
  SpecPaymentMilestone,
  SpecPaymentStatus,
} from "@/lib/admin/spec-types";

/** Milestone keys, ordered for display (P1 → P4). */
export const REFUND_MILESTONE_ORDER: readonly SpecPaymentMilestone[] = [
  "deposit",
  "scope_signoff",
  "midpoint",
  "delivery",
] as const;

export type RefundActionKind =
  | "refund"
  | "credit_note"
  | "void"
  | "mark_uncollectible"
  | "noop";

/** Per-milestone preview row rendered in the operator UI. */
export interface RefundBreakdownPreviewLine {
  milestone: SpecPaymentMilestone;
  /** P1 / P2 / P3 / P4 display label. */
  label: string;
  /** Whether a `spec_payments` row exists for this milestone. */
  hasPayment: boolean;
  /** Current `spec_payments.status` (null = never invoiced). */
  currentStatus: SpecPaymentStatus | null;
  /** Action the refund processor will take. */
  action: RefundActionKind;
  /** The Stripe target id the action will act on (PI for refund, invoice for void/CN). */
  stripeTargetId: string | null;
  /** Amount the action will move (refund cents OR void/CN face value). */
  amountCents: number;
  /** Cash actually refunded by this line (excludes void / mark_uncollectible). */
  cashRefundCents: number;
  /** Optional contextual note for the operator (e.g. "already refunded"). */
  note: string | null;
  /** True when the line is rendered greyed out (no Stripe action). */
  isGreyed: boolean;
}

/** Subset of a `spec_payments` row needed by the breakdown computation. */
export interface RefundPaymentRow {
  milestone: SpecPaymentMilestone;
  status: SpecPaymentStatus;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  total_cents: number;
  amount_refunded_cents: number | null;
}

/** Aggregate totals for the refund-preview footer. */
export interface RefundBreakdownTotals {
  /** Total cash that will be refunded to the customer's card. */
  totalCashRefundCents: number;
  /** Total face value of void / credit-note / mark_uncollectible actions. */
  totalNonCashAdjustmentCents: number;
  /** Number of milestones that will trigger a Stripe API call. */
  actionableMilestoneCount: number;
}

const MILESTONE_LABEL: Record<SpecPaymentMilestone, string> = {
  deposit: "P1 · DEPOSIT",
  scope_signoff: "P2 · SCOPE",
  midpoint: "P3 · MIDPOINT",
  delivery: "P4 · DELIVERY",
};

/**
 * Compute the per-milestone action plan for a refund request.
 *
 * @param payments     The four (or fewer) `spec_payments` rows for the project.
 * @param milestones   Which milestones the operator has checked (default: all four).
 * @returns            Ordered preview lines + aggregate totals.
 */
export function computeRefundBreakdownPreview(
  payments: RefundPaymentRow[],
  milestones: readonly SpecPaymentMilestone[] = REFUND_MILESTONE_ORDER,
): {
  lines: RefundBreakdownPreviewLine[];
  totals: RefundBreakdownTotals;
} {
  const byMilestone = new Map<SpecPaymentMilestone, RefundPaymentRow>();
  for (const p of payments) {
    byMilestone.set(p.milestone, p);
  }

  const selected = new Set(milestones);

  const lines: RefundBreakdownPreviewLine[] = REFUND_MILESTONE_ORDER.map(
    (milestone) => {
      const label = MILESTONE_LABEL[milestone];
      const payment = byMilestone.get(milestone);

      if (!selected.has(milestone)) {
        return {
          milestone,
          label,
          hasPayment: !!payment,
          currentStatus: payment?.status ?? null,
          action: "noop" as RefundActionKind,
          stripeTargetId: null,
          amountCents: 0,
          cashRefundCents: 0,
          note: "Milestone not selected for refund",
          isGreyed: true,
        };
      }

      if (!payment) {
        return {
          milestone,
          label,
          hasPayment: false,
          currentStatus: null,
          action: "noop",
          stripeTargetId: null,
          amountCents: 0,
          cashRefundCents: 0,
          note: "No invoice fired for this milestone — no action",
          isGreyed: true,
        };
      }

      return planActionForPayment(milestone, label, payment);
    },
  );

  const totals: RefundBreakdownTotals = lines.reduce<RefundBreakdownTotals>(
    (acc, line) => {
      acc.totalCashRefundCents += line.cashRefundCents;
      if (line.action === "void" || line.action === "mark_uncollectible") {
        acc.totalNonCashAdjustmentCents += line.amountCents;
      }
      if (line.action !== "noop") {
        acc.actionableMilestoneCount += 1;
      }
      return acc;
    },
    {
      totalCashRefundCents: 0,
      totalNonCashAdjustmentCents: 0,
      actionableMilestoneCount: 0,
    },
  );

  return { lines, totals };
}

function planActionForPayment(
  milestone: SpecPaymentMilestone,
  label: string,
  payment: RefundPaymentRow,
): RefundBreakdownPreviewLine {
  const base = {
    milestone,
    label,
    hasPayment: true,
    currentStatus: payment.status,
  } as const;

  switch (payment.status) {
    case "paid": {
      // Refund the full captured amount on the Payment Intent.
      return {
        ...base,
        action: "refund",
        stripeTargetId: payment.stripe_payment_intent_id,
        amountCents: payment.total_cents,
        cashRefundCents: payment.total_cents,
        note: null,
        isGreyed: false,
      };
    }

    case "invoiced":
    case "overdue": {
      // Open invoice → void at run time. The processor will detect partial
      // payment via Stripe and re-plan as credit_note + refund if needed.
      return {
        ...base,
        action: "void",
        stripeTargetId: payment.stripe_invoice_id,
        amountCents: payment.total_cents,
        cashRefundCents: 0,
        note: "Void the open invoice; processor escalates to mark_uncollectible if Stripe rejects",
        isGreyed: false,
      };
    }

    case "partially_refunded": {
      // Partially refunded historically — refund the remaining captured balance
      // (the processor checks the live PI; preview uses the row's tracked refund total).
      const remaining =
        payment.total_cents - (payment.amount_refunded_cents ?? 0);
      if (remaining <= 0) {
        return {
          ...base,
          action: "noop",
          stripeTargetId: payment.stripe_payment_intent_id,
          amountCents: 0,
          cashRefundCents: 0,
          note: "Already fully refunded in prior pass",
          isGreyed: true,
        };
      }
      return {
        ...base,
        action: "refund",
        stripeTargetId: payment.stripe_payment_intent_id,
        amountCents: remaining,
        cashRefundCents: remaining,
        note: `${formatPaidPortion(payment.amount_refunded_cents ?? 0)} already refunded · ${formatPaidPortion(remaining)} remaining`,
        isGreyed: false,
      };
    }

    case "refunded":
      return {
        ...base,
        action: "noop",
        stripeTargetId: payment.stripe_payment_intent_id,
        amountCents: 0,
        cashRefundCents: 0,
        note: "Already refunded",
        isGreyed: true,
      };

    case "voided":
      return {
        ...base,
        action: "noop",
        stripeTargetId: payment.stripe_invoice_id,
        amountCents: 0,
        cashRefundCents: 0,
        note: "Already voided",
        isGreyed: true,
      };

    case "uncollectible":
      return {
        ...base,
        action: "noop",
        stripeTargetId: payment.stripe_invoice_id,
        amountCents: 0,
        cashRefundCents: 0,
        note: "Already marked uncollectible",
        isGreyed: true,
      };

    case "disputed":
      return {
        ...base,
        action: "noop",
        stripeTargetId: payment.stripe_payment_intent_id,
        amountCents: 0,
        cashRefundCents: 0,
        note: "Stripe dispute open — handled by the dispute flow, not the refund processor",
        isGreyed: true,
      };

    case "pending":
      return {
        ...base,
        action: "noop",
        stripeTargetId: null,
        amountCents: 0,
        cashRefundCents: 0,
        note: "Milestone never invoiced — no action",
        isGreyed: true,
      };

    default: {
      // Exhaustive guard — surfaces if a new payment status is added to
      // SpecPaymentStatus without updating this function.
      const exhaustive: never = payment.status;
      return {
        ...base,
        action: "noop",
        stripeTargetId: null,
        amountCents: 0,
        cashRefundCents: 0,
        note: `Unknown payment status: ${String(exhaustive)}`,
        isGreyed: true,
      };
    }
  }
}

function formatPaidPortion(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ─── Executed-breakdown shape (matches refund_breakdown jsonb) ───────────────

/**
 * Persisted shape of a single line in `spec_refund_requests.refund_breakdown`.
 *
 * Bible reference (02_DATA_MODEL.md § spec_refund_requests):
 *   [
 *     { "milestone": "deposit", "stripe_resource_id": "pi_...", "action": "refund",
 *       "amount_cents": 75000, "status": "succeeded", "executed_at": "ISO-8601",
 *       "error": null }
 *   ]
 */
export interface RefundBreakdownExecutedLine {
  milestone: SpecPaymentMilestone;
  action: RefundActionKind;
  stripe_resource_id: string | null;
  amount_cents: number;
  cash_refund_cents: number;
  status: "succeeded" | "failed" | "skipped";
  executed_at: string;
  error: string | null;
}
