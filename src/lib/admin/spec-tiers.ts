/**
 * SPEC Tier Model v2 — tier identity, designations, pricing shape.
 *
 * Single source of truth for every tier-derived value the operator console
 * renders or invoices (ops-software-bible/SPEC/10_TIER_MODEL_V2.md § 2 + § 6).
 * Mirrors ops-site `src/lib/spec/pricing.ts` so both surfaces read the same
 * numbers; the DB (`spec_capacity.tier`, `spec_projects.tier`) carries a CHECK
 * constraint that admits only these three slugs.
 *
 *  - SPEC-01 · WORKFLOWS   — $2,000 fixed, paid 50/50 (P1 books the slot, P4 at
 *    delivery). Scope sign-off stays an evidence event with no invoice; no P3.
 *  - SPEC-02 · SYSTEMS     — $7,500 fixed, paid in quarters (P1–P4 × $1,875).
 *  - SPEC-03 · PROPRIETARY — from $25,000 (floor). P1 is fixed at a quarter of
 *    the floor; the real total locks at scope sign-off
 *    (`spec_projects.locked_total_cents`) and P2–P4 split the locked remainder.
 *
 * Pure. No I/O. Safe from RSCs, server actions, client components, and tests.
 */

import { SPEC_MILESTONE_LABELS, type SpecPaymentMilestone } from "./spec-types";

// ─── Slugs ───────────────────────────────────────────────────────────────────

/** Ordered from the wedge tier up. Drives sort order and iteration everywhere. */
export const SPEC_TIERS = ["spec01", "spec02", "spec03"] as const;

export type SpecTier = (typeof SPEC_TIERS)[number];

export function isSpecTier(value: unknown): value is SpecTier {
  return value === "spec01" || value === "spec02" || value === "spec03";
}

/**
 * Narrow a DB-sourced tier string. Both tier-bearing tables carry a CHECK
 * constraint, so an unknown value here is drift, not a customer state — we
 * keep the console rendering (wedge tier) and leave a trace instead of
 * throwing a whole page over one row.
 */
export function coerceSpecTier(value: string | null | undefined): SpecTier {
  if (isSpecTier(value)) return value;
  console.warn(`[spec-tiers] unknown tier "${String(value)}" coerced to spec01`);
  return "spec01";
}

// ─── Designations (10_TIER_MODEL_V2 § 2) ─────────────────────────────────────

/** Short form — board cells, chips, rows, conversation. */
export const SPEC_TIER_DESIGNATIONS: Record<SpecTier, string> = {
  spec01: "SPEC-01",
  spec02: "SPEC-02",
  spec03: "SPEC-03",
};

/** Descriptor half of the lockup. SPEC-03's is a classification stamp by design. */
export const SPEC_TIER_DESCRIPTORS: Record<SpecTier, string> = {
  spec01: "WORKFLOWS",
  spec02: "SYSTEMS",
  spec03: "PROPRIETARY",
};

/** Stripe line-item / invoice display names. */
export const SPEC_TIER_STRIPE_DISPLAY_NAMES: Record<SpecTier, string> = {
  spec01: "OPS SPEC-01 — WORKFLOWS",
  spec02: "OPS SPEC-02 — SYSTEMS",
  spec03: "OPS SPEC-03 — PROPRIETARY",
};

/**
 * Short designation for any tier string. Known slugs render their SPEC-0N
 * form; anything else falls through to the raw slug in uppercase so a drifted
 * row is visible rather than mislabelled.
 */
export function formatSpecTier(tier: string): string {
  return isSpecTier(tier) ? SPEC_TIER_DESIGNATIONS[tier] : tier.toUpperCase();
}

/** Full lockup `SPEC-0N · DESCRIPTOR` — headings and card titles. */
export function formatSpecTierLockup(tier: SpecTier): string {
  return `${SPEC_TIER_DESIGNATIONS[tier]} · ${SPEC_TIER_DESCRIPTORS[tier]}`;
}

// ─── Pricing + payment shape ─────────────────────────────────────────────────

/**
 * Tier total in CAD cents. Mirrors `spec_capacity.total_price_cents`
 * (re-seeded 2026-07-14). spec03's figure is the FLOOR — the engagement's real
 * total lives on `spec_projects.locked_total_cents` once locked.
 */
export const SPEC_TIER_TOTAL_CENTS: Record<SpecTier, number> = {
  spec01: 200_000,
  spec02: 750_000,
  spec03: 2_500_000,
};

export type SpecMilestoneShape = "half_half" | "quarters" | "floor_quarters";

export const SPEC_TIER_MILESTONE_SHAPE: Record<SpecTier, SpecMilestoneShape> = {
  spec01: "half_half",
  spec02: "quarters",
  spec03: "floor_quarters",
};

export interface SpecMilestoneScheduleEntry {
  milestone: SpecPaymentMilestone;
  /** "P1" … "P4" */
  label: string;
  /** null = not yet knowable (spec03 before the total is locked). */
  amountCents: number | null;
}

export interface SpecMilestoneSchedule {
  tier: SpecTier;
  /** Locked total when known, otherwise the tier's published total / floor. */
  totalCents: number;
  /** true when `totalCents` is the spec03 floor rather than a locked figure. */
  totalIsFloor: boolean;
  /** false only for spec03 before scope sign-off locks the total. */
  totalLocked: boolean;
  /** Only the milestones that carry a payment for this tier, in fire order. */
  entries: SpecMilestoneScheduleEntry[];
}

function entry(milestone: SpecPaymentMilestone, amountCents: number | null): SpecMilestoneScheduleEntry {
  return { milestone, label: SPEC_MILESTONE_LABELS[milestone], amountCents };
}

/**
 * Per-tier payment schedule (10_TIER_MODEL_V2 § 2). `lockedTotalCents` is read
 * from the engagement row; it only means something for the floor_quarters
 * shape and is ignored for fixed-total tiers.
 */
export function specMilestoneSchedule(
  tier: SpecTier,
  lockedTotalCents: number | null,
): SpecMilestoneSchedule {
  const floor = SPEC_TIER_TOTAL_CENTS[tier];

  switch (SPEC_TIER_MILESTONE_SHAPE[tier]) {
    case "half_half": {
      const p1 = Math.floor(floor / 2);
      return {
        tier,
        totalCents: floor,
        totalIsFloor: false,
        totalLocked: true,
        entries: [entry("deposit", p1), entry("delivery", floor - p1)],
      };
    }
    case "quarters": {
      const q = Math.floor(floor / 4);
      return {
        tier,
        totalCents: floor,
        totalIsFloor: false,
        totalLocked: true,
        entries: [
          entry("deposit", q),
          entry("scope_signoff", q),
          entry("midpoint", q),
          entry("delivery", floor - 3 * q),
        ],
      };
    }
    case "floor_quarters": {
      const p1 = Math.floor(floor / 4);
      if (lockedTotalCents == null) {
        return {
          tier,
          totalCents: floor,
          totalIsFloor: true,
          totalLocked: false,
          entries: [
            entry("deposit", p1),
            entry("scope_signoff", null),
            entry("midpoint", null),
            entry("delivery", null),
          ],
        };
      }
      if (!Number.isInteger(lockedTotalCents) || lockedTotalCents < floor) {
        throw new Error(
          `specMilestoneSchedule: lockedTotalCents must be an integer ≥ the ${floor} floor, got ${lockedTotalCents}`,
        );
      }
      const remainder = lockedTotalCents - p1;
      const part = Math.floor(remainder / 3);
      return {
        tier,
        totalCents: lockedTotalCents,
        totalIsFloor: false,
        totalLocked: true,
        entries: [
          entry("deposit", p1),
          entry("scope_signoff", part),
          entry("midpoint", part),
          entry("delivery", remainder - 2 * part),
        ],
      };
    }
  }
}
