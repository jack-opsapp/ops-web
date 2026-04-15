/**
 * Shared Stripe → OPS subscription mapping.
 *
 * Centralised so the webhook handler, POST /api/stripe/subscribe, and the
 * reconciliation cron all derive status, plan, and seat limits the same way.
 * Any divergence between these three call sites caused bugs in the past.
 */

import type Stripe from "stripe";

// ─── Status ──────────────────────────────────────────────────────────────────

export type OpsSubscriptionStatus =
  | "active"
  | "trial"
  | "grace"
  | "expired"
  | "cancelled";

/**
 * Maps every Stripe.Subscription.Status value to an OPS status, or `null` to
 * signal "don't touch the status field" — used for `incomplete`, where the
 * subscription hasn't really come into existence yet (customer hasn't
 * confirmed payment) and we want to leave whatever `/api/stripe/subscribe`
 * wrote in place.
 *
 * The CHECK constraint on companies.subscription_status allows only
 * ('trial','active','grace','expired','cancelled') — any mapper result that
 * isn't one of those must be filtered out before writing.
 */
export function mapStripeStatus(
  status: Stripe.Subscription.Status
): OpsSubscriptionStatus | null {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
      return "grace";
    case "paused":
      // Stripe's "paused" is temporary; treat like grace so the user sees a
      // warning but retains access until we decide to expire them.
      return "grace";
    case "canceled":
      return "cancelled";
    case "incomplete_expired":
      // Customer never confirmed payment; Stripe voided the subscription.
      return "cancelled";
    case "unpaid":
      // Stripe exhausted all retries. Terminal for us.
      return "expired";
    case "incomplete":
      // Pre-confirmation state. Do not touch the status column.
      return null;
    default: {
      // Exhaustiveness check — if Stripe adds a new status this will fail to
      // compile and force a review instead of silently passing through.
      const _exhaustive: never = status;
      void _exhaustive;
      return null;
    }
  }
}

// ─── Plan + Seats ────────────────────────────────────────────────────────────

export type OpsSubscriptionPlan = "starter" | "team" | "business";

export const MAX_SEATS_BY_PLAN: Record<OpsSubscriptionPlan | "trial", number> = {
  trial: 10,
  starter: 3,
  team: 5,
  business: 10,
};

/**
 * Resolve the OPS plan name from a Stripe price ID by checking against the
 * STRIPE_PRICE_* env vars. Returns null if the price doesn't match any
 * configured plan (e.g. add-ons, legacy prices).
 */
export function planFromStripePriceId(
  priceId: string | null | undefined
): { plan: OpsSubscriptionPlan; period: "Monthly" | "Annual" } | null {
  if (!priceId) return null;

  const candidates: Array<{
    plan: OpsSubscriptionPlan;
    period: "Monthly" | "Annual";
    env: string | undefined;
  }> = [
    { plan: "starter", period: "Monthly", env: process.env.STRIPE_PRICE_STARTER_MONTHLY },
    { plan: "starter", period: "Annual", env: process.env.STRIPE_PRICE_STARTER_ANNUAL },
    { plan: "team", period: "Monthly", env: process.env.STRIPE_PRICE_TEAM_MONTHLY },
    { plan: "team", period: "Annual", env: process.env.STRIPE_PRICE_TEAM_ANNUAL },
    { plan: "business", period: "Monthly", env: process.env.STRIPE_PRICE_BUSINESS_MONTHLY },
    { plan: "business", period: "Annual", env: process.env.STRIPE_PRICE_BUSINESS_ANNUAL },
  ];

  const match = candidates.find((c) => c.env && c.env === priceId);
  return match ? { plan: match.plan, period: match.period } : null;
}
