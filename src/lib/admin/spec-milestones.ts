/**
 * SPEC milestone composition — per-tier payment rows + fire gating.
 *
 * Pure. Sits between the tier model (`spec-tiers.ts`, which knows the shape
 * of each tier's schedule) and the data layer (`spec-queries.ts`, which loads
 * the engagement row, its payments, and its acceptance events). Both the
 * Milestones tab and the fire-milestone server action derive their amounts
 * and their "can this fire?" answer from here, so the two can never disagree.
 *
 * Tier Model v2 (10_TIER_MODEL_V2 § 2):
 *  - SPEC-01 pays 50/50 — P1 + P4 only. Scope sign-off is still an evidence
 *    event; it carries no invoice.
 *  - SPEC-02 pays quarters — P1 … P4.
 *  - SPEC-03 pays P1 against the floor at booking; P2–P4 are unknowable until
 *    the total is locked at scope sign-off (`spec_projects.locked_total_cents`).
 *    Until then those checkpoints render `—` and refuse to fire.
 */

import {
  SPEC_TIER_DESIGNATIONS,
  SPEC_TIER_MILESTONE_SHAPE,
  SPEC_TIER_TOTAL_CENTS,
  specMilestoneSchedule,
  type SpecTier,
} from "./spec-tiers";
import {
  SPEC_MILESTONE_LABELS,
  type SpecAcceptanceEventType,
  type SpecMilestoneRow,
  type SpecMilestonesTab,
  type SpecPaymentMilestone,
  type SpecPaymentStatus,
} from "./spec-types";

/** The slice of a `spec_payments` row the milestone surfaces need. */
export interface MilestonePaymentLike {
  id: string;
  milestone: SpecPaymentMilestone;
  status: SpecPaymentStatus;
  total_cents: number;
  invoiced_at: string | null;
  paid_at: string | null;
  due_date: string | null;
  stripe_invoice_id: string | null;
}

export interface MilestoneContext {
  tier: SpecTier;
  /** Already validated via `readLockedTotalCents`. */
  lockedTotalCents: number | null;
  walkthroughCompletedAt: string | null;
  acceptanceTypes: Set<SpecAcceptanceEventType>;
}

export interface MilestoneFireability {
  fireable: boolean;
  reason: string | null;
  /** The amount this checkpoint would invoice; null when not yet knowable. */
  amountCents: number | null;
}

/**
 * Read `spec_projects.locked_total_cents` defensively. The column has no CHECK
 * constraint, so a value below the floor (or a non-integer) is drift — we log
 * it and treat the total as unlocked, which fails closed: nothing invoices.
 * Fixed-total tiers ignore the column entirely.
 */
export function readLockedTotalCents(tier: SpecTier, raw: unknown): number | null {
  if (raw == null) return null;
  if (SPEC_TIER_MILESTONE_SHAPE[tier] !== "floor_quarters") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  const floor = SPEC_TIER_TOTAL_CENTS[tier];
  if (!Number.isInteger(n) || n < floor) {
    console.error(
      `[spec-milestones] locked_total_cents ${String(raw)} is invalid for ${tier} (floor ${floor}) — treating the total as unlocked`,
    );
    return null;
  }
  return n;
}

export function milestoneFireability(
  params: MilestoneContext & { milestone: SpecPaymentMilestone; hasExistingPayment: boolean },
): MilestoneFireability {
  const { tier, lockedTotalCents, walkthroughCompletedAt, acceptanceTypes, milestone, hasExistingPayment } =
    params;
  const schedule = specMilestoneSchedule(tier, lockedTotalCents);
  const entry = schedule.entries.find((e) => e.milestone === milestone);
  if (!entry) {
    return {
      fireable: false,
      reason: `No payment at this checkpoint for ${SPEC_TIER_DESIGNATIONS[tier]}`,
      amountCents: null,
    };
  }
  const blocked = (reason: string): MilestoneFireability => ({
    fireable: false,
    reason,
    amountCents: entry.amountCents,
  });

  if (milestone === "deposit") {
    // P1 is fired by the Stripe webhook on `checkout.session.completed`. The
    // operator never fires it by hand from this surface.
    return blocked("P1 fires automatically via Stripe webhook");
  }
  if (hasExistingPayment) return blocked("Already invoiced");

  if (milestone === "scope_signoff" && !acceptanceTypes.has("scope_signoff")) {
    return blocked("Awaiting customer scope sign-off");
  }
  if (milestone === "midpoint" && !acceptanceTypes.has("midpoint_accepted")) {
    return blocked("Awaiting customer midpoint acceptance");
  }
  if (milestone === "delivery") {
    if (!walkthroughCompletedAt) return blocked("Walkthrough not yet stamped");
    if (!acceptanceTypes.has("delivery_accepted")) return blocked("Awaiting customer delivery acceptance");
  }

  if (entry.amountCents == null) {
    return { fireable: false, reason: "Total not locked — lock it on the scope doc", amountCents: null };
  }
  return { fireable: true, reason: null, amountCents: entry.amountCents };
}

/**
 * Compose the Milestones tab for an engagement. Rows follow the tier's
 * schedule; any payment that exists off-schedule (drift) is appended so money
 * is never hidden, and is marked non-fireable.
 */
export function composeMilestonesTab(
  params: MilestoneContext & { payments: MilestonePaymentLike[] },
): SpecMilestonesTab {
  const { tier, lockedTotalCents, walkthroughCompletedAt, acceptanceTypes, payments } = params;
  const schedule = specMilestoneSchedule(tier, lockedTotalCents);
  const byMilestone = new Map<SpecPaymentMilestone, MilestonePaymentLike>();
  for (const p of payments) byMilestone.set(p.milestone, p);

  const rows: SpecMilestoneRow[] = schedule.entries.map((entry) => {
    const existing = byMilestone.get(entry.milestone);
    const fire = milestoneFireability({
      tier,
      lockedTotalCents,
      walkthroughCompletedAt,
      acceptanceTypes,
      milestone: entry.milestone,
      hasExistingPayment: !!existing,
    });
    return {
      id: existing?.id ?? null,
      milestone: entry.milestone,
      label: entry.label,
      status: existing ? existing.status : "not_yet_fired",
      amountCents: existing?.total_cents ?? entry.amountCents,
      invoicedAt: existing?.invoiced_at ?? null,
      paidAt: existing?.paid_at ?? null,
      dueDate: existing?.due_date ?? null,
      stripeInvoiceId: existing?.stripe_invoice_id ?? null,
      fireable: fire.fireable,
      fireBlockedReason: fire.reason,
    };
  });

  const scheduled = new Set(schedule.entries.map((e) => e.milestone));
  for (const p of payments) {
    if (scheduled.has(p.milestone)) continue;
    rows.push({
      id: p.id,
      milestone: p.milestone,
      label: SPEC_MILESTONE_LABELS[p.milestone],
      status: p.status,
      amountCents: p.total_cents,
      invoicedAt: p.invoiced_at,
      paidAt: p.paid_at,
      dueDate: p.due_date,
      stripeInvoiceId: p.stripe_invoice_id,
      fireable: false,
      fireBlockedReason: `Off-schedule for ${SPEC_TIER_DESIGNATIONS[tier]}`,
    });
  }

  return {
    tier,
    totalCents: schedule.totalCents,
    totalIsFloor: schedule.totalIsFloor,
    totalLocked: schedule.totalLocked,
    rows,
  };
}
