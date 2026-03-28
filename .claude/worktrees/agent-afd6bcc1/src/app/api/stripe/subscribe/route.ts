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
      .select("id, name, stripe_customer_id")
      .eq("id", companyId)
      .single();

    if (fetchError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Ensure Stripe customer exists
    let stripeCustomerId = company.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: company.name,
        metadata: { companyId },
      });

      stripeCustomerId = customer.id;

      const { error: updateError } = await supabase
        .from("companies")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", companyId);

      if (updateError) {
        console.error("[stripe/subscribe] Failed to save stripe_customer_id:", updateError.message);
        return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
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

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });

    // Update company in Supabase
    // In Stripe v20+, current_period_end moved from Subscription to SubscriptionItem
    const periodEnd = subscription.items.data[0]?.current_period_end;
    const subscriptionEnd = periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : new Date().toISOString();

    const { error: subUpdateError } = await supabase
      .from("companies")
      .update({
        subscription_status: "active",
        subscription_plan: plan,
        subscription_period: period,
        subscription_end: subscriptionEnd,
        subscription_ids_json: JSON.stringify([subscription.id]),
      })
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
