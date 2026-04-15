/**
 * GET /api/cron/reconcile-stripe-subscriptions
 *
 * Vercel cron: runs daily. Walks every company with a stripe_customer_id,
 * pulls its current Stripe subscription, and reconciles four columns:
 *   - subscription_status     (mapped from Stripe status)
 *   - subscription_end        (current_period_end)
 *   - trial_start_date
 *   - trial_end_date
 *   - seat_grace_start_date   (set when newly past_due, cleared on recovery)
 *
 * Catches state drift caused by missed webhooks (network, signature failures,
 * outages). The same logic the webhook applies, run defensively against truth.
 *
 * This is the runtime sibling of scripts/backfill-subscription-dates.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  mapStripeStatus,
  planFromStripePriceId,
  MAX_SEATS_BY_PLAN,
  type OpsSubscriptionStatus,
} from "@/lib/stripe/subscription-mapping";

export const maxDuration = 300;

// Terminal states that reconcile must never revert. `expired` is a local
// decision made by the grace-expiry cron (Stripe has no equivalent), and
// `cancelled` is set on user cancellation — if Stripe somehow reactivates we
// expect it to come in through the webhook, not through this nightly job.
const STICKY_STATUSES: ReadonlyArray<OpsSubscriptionStatus> = ["expired", "cancelled"];

type CompanyRow = {
  id: string;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_end: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  seat_grace_start_date: string | null;
  max_seats: number | null;
};

type Patch = {
  subscription_status?: string;
  subscription_plan?: string;
  subscription_period?: string;
  subscription_end?: string;
  trial_start_date?: string;
  trial_end_date?: string;
  seat_grace_start_date?: string | null;
  max_seats?: number;
};

function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

function pickSubscription(list: Stripe.Subscription[]): Stripe.Subscription | null {
  if (list.length === 0) return null;
  const live = list.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  if (live) return live;
  return [...list].sort((a, b) => b.created - a.created)[0];
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceRoleClient();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const { data: companies, error } = await supabase
    .from("companies")
    .select(
      "id, stripe_customer_id, subscription_status, subscription_plan, subscription_end, trial_start_date, trial_end_date, seat_grace_start_date, max_seats"
    )
    .not("stripe_customer_id", "is", null);

  if (error) {
    console.error("[reconcile-stripe] Failed to fetch companies:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let updated = 0;
  let inSync = 0;
  let noSubs = 0;
  let errors = 0;

  for (const company of (companies ?? []) as CompanyRow[]) {
    try {
      const subs = await stripe.subscriptions.list({
        customer: company.stripe_customer_id!,
        status: "all",
        limit: 10,
      });
      const sub = pickSubscription(subs.data);
      if (!sub) {
        noSubs++;
        continue;
      }

      const patch: Patch = {};
      const mappedStatus = mapStripeStatus(sub.status);
      const periodEnd = sub.items.data[0]?.current_period_end;
      const subscriptionEnd = toIso(periodEnd);
      const trialStart = toIso(sub.trial_start);
      const trialEnd = toIso(sub.trial_end);
      const priceId = sub.items.data[0]?.price?.id;
      const planInfo = planFromStripePriceId(priceId);

      // Status drift: only adjust if we have a concrete mapping AND the
      // current local status is NOT a sticky terminal state. This prevents
      // reconcile from reverting `expired` (set by the grace-expiry cron)
      // back to `grace` while Stripe still says past_due.
      const currentIsSticky = STICKY_STATUSES.includes(
        company.subscription_status as OpsSubscriptionStatus
      );
      if (
        mappedStatus !== null &&
        !currentIsSticky &&
        mappedStatus !== company.subscription_status
      ) {
        patch.subscription_status = mappedStatus;
      }

      if (subscriptionEnd && subscriptionEnd !== company.subscription_end) {
        patch.subscription_end = subscriptionEnd;
      }
      if (trialStart && trialStart !== company.trial_start_date) {
        patch.trial_start_date = trialStart;
      }
      if (trialEnd && trialEnd !== company.trial_end_date) {
        patch.trial_end_date = trialEnd;
      }

      // Plan drift: if the Stripe price maps to a known OPS plan, keep
      // subscription_plan and max_seats in sync. Catches out-of-band upgrades
      // via the Stripe Dashboard or billing portal. Skip on sticky states for
      // the same reason as status above.
      if (planInfo && !currentIsSticky) {
        if (planInfo.plan !== company.subscription_plan) {
          patch.subscription_plan = planInfo.plan;
        }
        const expectedSeats = MAX_SEATS_BY_PLAN[planInfo.plan];
        if (expectedSeats !== company.max_seats) {
          patch.max_seats = expectedSeats;
        }
      }

      // Grace lifecycle: set on first past_due, clear on recovery. Same
      // sticky-state guard applies.
      if (!currentIsSticky) {
        if (mappedStatus === "grace" && !company.seat_grace_start_date) {
          patch.seat_grace_start_date = new Date().toISOString();
        } else if (
          (mappedStatus === "active" || mappedStatus === "trial") &&
          company.seat_grace_start_date
        ) {
          patch.seat_grace_start_date = null;
        }
      }

      if (Object.keys(patch).length === 0) {
        inSync++;
        continue;
      }

      const { error: updErr } = await supabase
        .from("companies")
        .update(patch)
        .eq("id", company.id);

      if (updErr) {
        console.error(`[reconcile-stripe] update failed for ${company.id}: ${updErr.message}`);
        errors++;
        continue;
      }

      console.log(`[reconcile-stripe] drift fixed: ${company.id}`, patch);
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reconcile-stripe] ${company.id} failed: ${msg}`);
      errors++;
    }
  }

  const summary = { ok: true, updated, inSync, noSubs, errors };
  console.log("[reconcile-stripe] summary:", summary);
  return NextResponse.json(summary);
}
