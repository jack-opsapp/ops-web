/**
 * POST /api/stripe/subscription
 *
 * Handles all subscription lifecycle operations.
 * Replaces Bubble workflows: create_subscription_setup_intent,
 * complete_subscription, create_subscription_with_payment,
 * cancel_subscription, subscribe_user_to_plan.
 *
 * Body: { action: string, companyId: string, ...actionParams }
 * Auth: Firebase JWT in Authorization header
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { verifyFirebaseToken } from "@/lib/firebase/admin-verify";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

// ─── Price ID Map ────────────────────────────────────────────────────────────

const PRICE_IDS: Record<string, Record<string, string>> = {
  starter: {
    Monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "",
    Annual: process.env.STRIPE_PRICE_STARTER_ANNUAL ?? "",
  },
  team: {
    Monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY ?? "",
    Annual: process.env.STRIPE_PRICE_TEAM_ANNUAL ?? "",
  },
  business: {
    Monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? "",
    Annual: process.env.STRIPE_PRICE_BUSINESS_ANNUAL ?? "",
  },
};

function getPriceId(plan: string, period: string): string {
  const priceId = PRICE_IDS[plan]?.[period];
  if (!priceId) throw new Error(`Unknown plan/period: ${plan}/${period}`);
  return priceId;
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function requireAuth(req: NextRequest): Promise<void> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  await verifyFirebaseToken(token);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getOrCreateStripeCustomer(
  stripe: Stripe,
  companyId: string
): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data: company } = await supabase
    .from("companies")
    .select("stripe_customer_id, name, email")
    .eq("id", companyId)
    .single();

  if (company?.stripe_customer_id) {
    return company.stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    name: company?.name ?? undefined,
    email: company?.email ?? undefined,
    metadata: { supabase_company_id: companyId },
  });

  // Persist the customer ID
  await supabase
    .from("companies")
    .update({ stripe_customer_id: customer.id })
    .eq("id", companyId);

  return customer.id;
}

async function updateCompanySubscription(
  companyId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("companies")
    .update(updates)
    .eq("id", companyId);
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function handleSetupIntent(
  stripe: Stripe,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { companyId, userId } = body as { companyId: string; userId: string };

  const customerId = await getOrCreateStripeCustomer(stripe, companyId);

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    metadata: { supabase_company_id: companyId, user_id: userId },
  });

  // Ephemeral key for mobile Stripe SDK (not needed for web, but keep for iOS parity)
  const ephemeralKey = await stripe.ephemeralKeys.create(
    { customer: customerId },
    { apiVersion: "2024-06-20" }
  );

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
    ephemeralKey: ephemeralKey.secret,
  });
}

async function handleCompleteSubscription(
  stripe: Stripe,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { companyId, userId, plan, period, paymentMethodId } = body as {
    companyId: string;
    userId: string;
    plan: string;
    period: "Monthly" | "Annual";
    paymentMethodId?: string;
  };

  const customerId = await getOrCreateStripeCustomer(stripe, companyId);
  const priceId = getPriceId(plan, period);

  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { supabase_company_id: companyId, user_id: userId, plan, period },
  };

  if (paymentMethodId) {
    subscriptionParams.default_payment_method = paymentMethodId;
  }

  const subscription = await stripe.subscriptions.create(subscriptionParams);

  // current_period_end is on each subscription item in Stripe v20+
  const periodEnd = subscription.items.data[0]?.current_period_end;

  await updateCompanySubscription(companyId, {
    subscription_status: "active",
    subscription_plan: plan,
    subscription_period: period,
    subscription_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  });

  return NextResponse.json({ success: true, subscriptionId: subscription.id });
}

async function handleCancelSubscription(
  stripe: Stripe,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { companyId } = body as { companyId: string };

  const supabase = getServiceRoleClient();
  const { data: company } = await supabase
    .from("companies")
    .select("stripe_customer_id")
    .eq("id", companyId)
    .single();

  if (company?.stripe_customer_id) {
    // List active subscriptions and cancel them
    const subscriptions = await stripe.subscriptions.list({
      customer: company.stripe_customer_id,
      status: "active",
    });

    for (const sub of subscriptions.data) {
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  await updateCompanySubscription(companyId, {
    subscription_status: "cancelled",
  });

  return NextResponse.json({ success: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const { action } = body;

  const stripe = getStripe();

  try {
    switch (action) {
      case "setup-intent":
        return await handleSetupIntent(stripe, body);

      case "complete":
        return await handleCompleteSubscription(stripe, body);

      case "cancel":
        return await handleCancelSubscription(stripe, body);

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    console.error(`[stripe/subscription] action=${action}`, err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Stripe operation failed",
      },
      { status: 500 }
    );
  }
}
