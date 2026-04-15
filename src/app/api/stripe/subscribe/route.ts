/**
 * POST /api/stripe/subscribe
 *
 * Creates a Stripe subscription for a company.
 * Optionally attaches a payment method. Updates the company record in Supabase.
 * Body: { companyId: string, plan: 'starter'|'team'|'business', period: 'Monthly'|'Annual', paymentMethodId?: string }
 * Returns: { subscriptionId: string, status: string, clientSecret?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  mapStripeStatus,
  MAX_SEATS_BY_PLAN,
  type OpsSubscriptionPlan,
} from "@/lib/stripe/subscription-mapping";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

function decodeFirebaseToken(
  authHeader: string
): { uid: string; email: string } | null {
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );
    return { uid: payload.sub || payload.user_id, email: payload.email };
  } catch {
    return null;
  }
}

const VALID_PLANS = ["starter", "team", "business"] as const;
const VALID_PERIODS = ["Monthly", "Annual"] as const;

type Plan = (typeof VALID_PLANS)[number];
type Period = (typeof VALID_PERIODS)[number];

function getPriceId(plan: Plan, period: Period): string | undefined {
  const priceMap: Record<string, string | undefined> = {
    starter_Monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY,
    starter_Annual: process.env.STRIPE_PRICE_STARTER_ANNUAL,
    team_Monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
    team_Annual: process.env.STRIPE_PRICE_TEAM_ANNUAL,
    business_Monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY,
    business_Annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL,
  };

  return priceMap[`${plan}_${period}`];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const user = decodeFirebaseToken(authHeader);
  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const { companyId, plan, period, paymentMethodId } = await req.json();

    // Validate required fields
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }
    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json(
        { error: `Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        { error: `Invalid period. Must be one of: ${VALID_PERIODS.join(", ")}` },
        { status: 400 }
      );
    }

    const priceId = getPriceId(plan, period);
    if (!priceId) {
      console.error(`[stripe/subscribe] Missing price env var for ${plan}_${period}`);
      return NextResponse.json({ error: "Price configuration not found" }, { status: 500 });
    }

    const supabase = getServiceRoleClient();
    const stripe = getStripe();

    // Fetch company
    const { data: company, error: fetchError } = await supabase
      .from("companies")
      .select("id, name, stripe_customer_id, subscription_status")
      .eq("id", companyId)
      .single();

    if (fetchError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // N2 — Refuse to create a second subscription while one is already live.
    // Without this check, a UI bug, stale tab, or confused user clicking
    // "Upgrade" twice would create two Stripe subscriptions on the same
    // customer and double-bill them. Plan changes should go through a
    // dedicated upgrade/downgrade route (not yet built).
    if (
      company.subscription_status &&
      ["active", "trial", "grace"].includes(company.subscription_status)
    ) {
      return NextResponse.json(
        {
          error:
            "Company already has an active subscription. Cancel the existing subscription first.",
        },
        { status: 409 }
      );
    }

    // Ensure Stripe customer exists.
    //
    // Race condition protection: if two /subscribe calls land concurrently for
    // the same company (user double-click + flaky network), both may read a
    // null stripe_customer_id. Without protection each would create a fresh
    // Stripe customer and orphan one.
    //
    // Defense in two layers:
    //   1. Stripe Idempotency-Key on customer.create — concurrent creates with
    //      the same key return the same customer, no duplicate in Stripe.
    //   2. Compare-and-swap on the Supabase update — only write if the column
    //      is still null. If we lose the race, re-read and use whatever the
    //      winning call wrote (which will be the same Stripe customer ID
    //      because of idempotency key #1).
    let stripeCustomerId = company.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create(
        {
          email: user.email,
          name: company.name,
          metadata: { companyId },
        },
        { idempotencyKey: `company-${companyId}-customer` }
      );

      const { data: claimed, error: claimErr } = await supabase
        .from("companies")
        .update({ stripe_customer_id: customer.id })
        .eq("id", companyId)
        .is("stripe_customer_id", null)
        .select("stripe_customer_id")
        .maybeSingle();

      if (claimErr) {
        console.error("[stripe/subscribe] CAS update failed:", claimErr.message);
        return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
      }

      if (claimed?.stripe_customer_id) {
        stripeCustomerId = claimed.stripe_customer_id;
      } else {
        // Lost the race. Re-read to get the winning customer ID.
        const { data: winner, error: readErr } = await supabase
          .from("companies")
          .select("stripe_customer_id")
          .eq("id", companyId)
          .single();
        if (readErr || !winner?.stripe_customer_id) {
          return NextResponse.json({ error: "Failed to resolve customer" }, { status: 500 });
        }
        stripeCustomerId = winner.stripe_customer_id;
        console.log(`[stripe/subscribe] Lost customer-create race for ${companyId}, using winning ID ${stripeCustomerId}`);
      }
    }

    // Attach payment method if provided
    if (paymentMethodId) {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId,
      });

      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }

    // Create subscription.
    //
    // N1 — Idempotency key on subscriptions.create protects against double-
    // click / race conditions that slip past the N2 "already active" check
    // (two concurrent /subscribe calls can both read status=null and both
    // pass the guard). The key is scoped to company + plan + period so that
    // legitimate upgrade/downgrade flows (eventually, via a separate route)
    // don't collide. Stripe idempotency-key TTL is 24h, plenty for
    // deduping immediate double-submits but short enough that a legitimate
    // re-subscribe after cancellation the next day works.
    const subscription = await stripe.subscriptions.create(
      {
        customer: stripeCustomerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
      },
      { idempotencyKey: `company-${companyId}-sub-${plan}-${period}` }
    );

    // Update company in Supabase
    // In Stripe v20+, current_period_end moved from Subscription to SubscriptionItem
    const periodEnd = subscription.items.data[0]?.current_period_end;
    const subscriptionEnd = periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : new Date().toISOString();

    // Derive status from Stripe's actual state. Stripe returns `incomplete`
    // for the common case (payment_behavior: default_incomplete + 3DS), which
    // maps to null → we leave subscription_status untouched until the webhook
    // catches the confirmation (or expiry).
    const mappedStatus = mapStripeStatus(subscription.status);

    const companyUpdates: Record<string, unknown> = {
      subscription_plan: plan,
      subscription_period: period,
      subscription_end: subscriptionEnd,
      subscription_ids_json: JSON.stringify([subscription.id]),
      // Tier seat limit — kept in sync with subscription_plan on every write.
      max_seats: MAX_SEATS_BY_PLAN[plan as OpsSubscriptionPlan],
      // Clear any lingering grace window from a prior failed subscription.
      seat_grace_start_date: null,
    };

    if (mappedStatus !== null) {
      companyUpdates.subscription_status = mappedStatus;
    }

    // If the new subscription starts in a trial window, persist it. The webhook
    // will overwrite these on subsequent state changes, but we set them here so
    // the UI has correct countdown data immediately without waiting for the webhook.
    if (subscription.trial_start) {
      companyUpdates.trial_start_date = new Date(subscription.trial_start * 1000).toISOString();
    }
    if (subscription.trial_end) {
      companyUpdates.trial_end_date = new Date(subscription.trial_end * 1000).toISOString();
    }

    const { error: subUpdateError } = await supabase
      .from("companies")
      .update(companyUpdates)
      .eq("id", companyId);

    if (subUpdateError) {
      console.error("[stripe/subscribe] Failed to update subscription fields:", subUpdateError.message);
    }

    // Extract clientSecret if payment requires confirmation
    // In Stripe v20+, payment_intent is nested in payment_settings; use expand + assertion
    const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;
    const paymentIntent = (latestInvoice as unknown as { payment_intent?: Stripe.PaymentIntent })
      ?.payment_intent ?? null;
    const clientSecret = paymentIntent?.client_secret ?? undefined;

    return NextResponse.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      clientSecret,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create subscription";
    console.error("[stripe/subscribe] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
