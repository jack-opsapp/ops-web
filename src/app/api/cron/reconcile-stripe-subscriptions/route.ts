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

export const maxDuration = 300;

type CompanyRow = {
  id: string;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_end: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  seat_grace_start_date: string | null;
};

type Patch = {
  subscription_status?: string;
  subscription_end?: string;
  trial_start_date?: string;
  trial_end_date?: string;
  seat_grace_start_date?: string | null;
};

function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
      return "grace";
    case "canceled":
      return "cancelled";
    default:
      return status;
  }
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
      "id, stripe_customer_id, subscription_status, subscription_end, trial_start_date, trial_end_date, seat_grace_start_date"
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

      if (mappedStatus !== company.subscription_status) {
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

      // Grace lifecycle: set on first past_due, clear on recovery.
      if (mappedStatus === "grace" && !company.seat_grace_start_date) {
        patch.seat_grace_start_date = new Date().toISOString();
      } else if (
        (mappedStatus === "active" || mappedStatus === "trial") &&
        company.seat_grace_start_date
      ) {
        patch.seat_grace_start_date = null;
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
