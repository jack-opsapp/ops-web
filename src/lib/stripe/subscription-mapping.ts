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

// ─── Add-ons ─────────────────────────────────────────────────────────────────
//
// Two add-ons sit alongside the core subscription:
//   - data_setup            → one-time charge, gates `companies.data_setup_purchased`
//   - priority_support_*    → recurring, gates `companies.has_priority_support`
//
// Resolved the same way base plans are: env vars hold the Stripe price ID,
// and helpers map back from a price ID to a stable internal label so the
// webhook handler can route a checkout.session.completed event to the right
// fulfillment path.

export type OpsAddon =
  | "data_setup"
  | "priority_support_monthly"
  | "priority_support_annual";

/**
 * Map of every add-on name to its Stripe price ID env var. Read at call
 * time (not module import) so per-environment price IDs work in dev/preview/
 * production without rebuilds.
 */
export const ADDON_PRICE_MAP: Record<OpsAddon, string | undefined> = {
  get data_setup() {
    return process.env.STRIPE_PRICE_DATA_SETUP;
  },
  get priority_support_monthly() {
    return process.env.STRIPE_PRICE_PRIORITY_SUPPORT_MONTHLY;
  },
  get priority_support_annual() {
    return process.env.STRIPE_PRICE_PRIORITY_SUPPORT_ANNUAL;
  },
};

/**
 * Resolve an OPS add-on label from a Stripe price ID. Returns null when the
 * price is a base plan price or unknown — callers in the webhook use this
 * return value to decide whether to enter the add-on fulfillment branch.
 */
export function addonFromPriceId(
  priceId: string | null | undefined
): OpsAddon | null {
  if (!priceId) return null;
  const entries = Object.entries(ADDON_PRICE_MAP) as Array<
    [OpsAddon, string | undefined]
  >;
  for (const [addon, env] of entries) {
    if (env && env === priceId) return addon;
  }
  return null;
}

/**
 * True when the price ID is either the monthly or annual priority-support
 * SKU. Used by the subscription webhook to decide whether to flip the
 * `has_priority_support` entitlement on the company.
 */
export function isPrioritySupportPrice(
  priceId: string | null | undefined
): boolean {
  const addon = addonFromPriceId(priceId);
  return addon === "priority_support_monthly" || addon === "priority_support_annual";
}
