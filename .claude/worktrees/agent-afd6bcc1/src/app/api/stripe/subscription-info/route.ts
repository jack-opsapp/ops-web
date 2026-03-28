/**
 * GET /api/stripe/subscription-info?companyId=xxx
 *
 * Fetches the current Stripe subscription details for a company.
 * Returns subscription status, plan, billing interval, period dates, etc.
 * Query: { companyId: string }
 * Returns: SubscriptionInfoResponse
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

function parseSubscriptionIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === "string");
    return [];
  } catch {
    return [];
  }
}

function determinePlanName(priceId: string): string | null {
  const priceMap: Record<string, string> = {};
  if (process.env.STRIPE_PRICE_STARTER_MONTHLY) priceMap[process.env.STRIPE_PRICE_STARTER_MONTHLY] = "starter";
  if (process.env.STRIPE_PRICE_STARTER_ANNUAL) priceMap[process.env.STRIPE_PRICE_STARTER_ANNUAL] = "starter";
  if (process.env.STRIPE_PRICE_TEAM_MONTHLY) priceMap[process.env.STRIPE_PRICE_TEAM_MONTHLY] = "team";
  if (process.env.STRIPE_PRICE_TEAM_ANNUAL) priceMap[process.env.STRIPE_PRICE_TEAM_ANNUAL] = "team";
  if (process.env.STRIPE_PRICE_BUSINESS_MONTHLY) priceMap[process.env.STRIPE_PRICE_BUSINESS_MONTHLY] = "business";
  if (process.env.STRIPE_PRICE_BUSINESS_ANNUAL) priceMap[process.env.STRIPE_PRICE_BUSINESS_ANNUAL] = "business";
  return priceMap[priceId] ?? null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }

  const user = decodeFirebaseToken(authHeader);
  if (!user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  try {
    const companyId = req.nextUrl.searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const supabase = getServiceRoleClient();
    const stripe = getStripe();

    // Fetch company
    const { data: company, error: fetchError } = await supabase
      .from("companies")
      .select("id, stripe_customer_id, subscription_ids_json")
      .eq("id", companyId)
      .single();

    if (fetchError || !company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (!company.stripe_customer_id) {
      // No Stripe customer — return empty response (trial user)
      return NextResponse.json({
        subscription_id: null,
        status: null,
        plan_name: null,
        price_id: null,
        current_period_start: null,
        current_period_end: null,
        billing_interval: null,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_end: null,
        default_payment_method: null,
      });
    }

    // Resolve subscription ID from stored JSON or by listing active subscriptions
    const storedIds = parseSubscriptionIds(company.subscription_ids_json);
    let subscriptionId: string | null = storedIds[0] ?? null;

    if (!subscriptionId) {
      const subscriptions = await stripe.subscriptions.list({
        customer: company.stripe_customer_id,
        status: "active",
        limit: 1,
      });
      subscriptionId = subscriptions.data[0]?.id ?? null;
    }

    if (!subscriptionId) {
      // No active subscription found
      return NextResponse.json({
        subscription_id: null,
        status: null,
        plan_name: null,
        price_id: null,
        current_period_start: null,
        current_period_end: null,
        billing_interval: null,
        cancel_at_period_end: false,
        canceled_at: null,
        trial_end: null,
        default_payment_method: null,
      });
    }

    // Fetch subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Extract subscription item details
    const item = subscription.items.data[0];
    const priceId = item?.price?.id ?? null;
    const billingInterval = item?.price?.recurring?.interval ?? null;
    const periodStart = item?.current_period_start
      ? new Date(item.current_period_start * 1000).toISOString()
      : null;
    const periodEnd = item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null;

    const planName = priceId ? determinePlanName(priceId) : null;
    const canceledAt = subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null;
    const trialEnd = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : null;

    const defaultPm =
      typeof subscription.default_payment_method === "string"
        ? subscription.default_payment_method
        : subscription.default_payment_method?.id ?? null;

    return NextResponse.json({
      subscription_id: subscription.id,
      status: subscription.status,
      plan_name: planName,
      price_id: priceId,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      billing_interval: billingInterval,
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: canceledAt,
      trial_end: trialEnd,
      default_payment_method: defaultPm,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch subscription info";
    console.error("[stripe/subscription-info] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
