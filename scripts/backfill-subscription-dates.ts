/* ── scripts/backfill-subscription-dates.ts ── */
/*
 * Backfill trial_start_date, trial_end_date, and seat_grace_start_date on
 * the companies table by pulling canonical values from Stripe.
 *
 * These columns were defined in migration 004 but never written by any code
 * path prior to the webhook/subscribe-route fix. This script reconciles the
 * historical state.
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-subscription-dates.ts           # report only
 *   npx tsx scripts/backfill-subscription-dates.ts --apply   # write changes
 */

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!STRIPE_KEY) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const stripe = new Stripe(STRIPE_KEY);

type CompanyRow = {
  id: string;
  name: string | null;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_ids_json: string | null;
  trial_start_date: string | null;
  trial_end_date: string | null;
  seat_grace_start_date: string | null;
};

type Patch = {
  trial_start_date?: string | null;
  trial_end_date?: string | null;
  seat_grace_start_date?: string | null;
};

function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

function pickSubscription(list: Stripe.Subscription[]): Stripe.Subscription | null {
  if (list.length === 0) return null;
  // Prefer the one that is currently active/trialing/past_due; otherwise most recent.
  const live = list.find((s) =>
    ["active", "trialing", "past_due"].includes(s.status)
  );
  if (live) return live;
  return [...list].sort((a, b) => b.created - a.created)[0];
}

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const { data: companies, error } = await supabase
    .from("companies")
    .select(
      "id, name, stripe_customer_id, subscription_status, subscription_ids_json, trial_start_date, trial_end_date, seat_grace_start_date"
    )
    .not("stripe_customer_id", "is", null);

  if (error) {
    console.error("[backfill] Failed to fetch companies:", error.message);
    process.exit(1);
  }
  if (!companies || companies.length === 0) {
    console.log("[backfill] No companies with stripe_customer_id found.");
    return;
  }

  console.log(`[backfill] Scanning ${companies.length} companies with Stripe customers...`);

  let updated = 0;
  let skipped = 0;
  let noSubs = 0;
  let errors = 0;

  for (const company of companies as CompanyRow[]) {
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
      const stripeTrialStart = toIso(sub.trial_start);
      const stripeTrialEnd = toIso(sub.trial_end);

      if (stripeTrialStart && company.trial_start_date !== stripeTrialStart) {
        patch.trial_start_date = stripeTrialStart;
      }
      if (stripeTrialEnd && company.trial_end_date !== stripeTrialEnd) {
        patch.trial_end_date = stripeTrialEnd;
      }

      // Grace period: set if past_due and not already set; clear if active/trialing.
      if (sub.status === "past_due" && !company.seat_grace_start_date) {
        // We do not know the true original failure time from Stripe cheaply here;
        // use the subscription's current_period_end (when it would have renewed)
        // if available, else now. This errs on the side of a longer grace window.
        const item = sub.items.data[0];
        const periodEnd = item?.current_period_end;
        patch.seat_grace_start_date = periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : new Date().toISOString();
      } else if (
        (sub.status === "active" || sub.status === "trialing") &&
        company.seat_grace_start_date
      ) {
        patch.seat_grace_start_date = null;
      }

      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }

      console.log(
        `[backfill] ${company.id} (${company.name ?? "?"}) stripe_status=${sub.status}`,
        patch
      );

      if (APPLY) {
        const { error: updErr } = await supabase
          .from("companies")
          .update(patch)
          .eq("id", company.id);
        if (updErr) {
          console.error(`  ↳ update failed: ${updErr.message}`);
          errors++;
          continue;
        }
      }
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] ${company.id} failed: ${msg}`);
      errors++;
    }
  }

  console.log("");
  console.log("[backfill] Summary:");
  console.log(`  ${APPLY ? "Updated" : "Would update"}: ${updated}`);
  console.log(`  Already in sync:   ${skipped}`);
  console.log(`  No subscriptions:  ${noSubs}`);
  console.log(`  Errors:            ${errors}`);
  if (!APPLY && updated > 0) {
    console.log("");
    console.log("Re-run with --apply to persist.");
  }
}

main().catch((err) => {
  console.error("[backfill] Fatal:", err);
  process.exit(1);
});
