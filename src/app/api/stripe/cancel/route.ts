/**
 * POST /api/stripe/cancel
 *
 * Cancels a company's Stripe subscription at the end of the current billing period.
 * Looks up the subscription ID from the company's subscription_ids_json field,
 * falling back to listing active subscriptions for the Stripe customer.
 * Body: { companyId: string }
 * Returns: { success: true }
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
    const { companyId } = await req.json();

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
      return NextResponse.json({ error: "No Stripe customer found for this company" }, { status: 400 });
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
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
    }

    // Schedule the subscription to cancel at the end of the current paid
    // period. Stripe keeps the subscription status as "active" until the
    // period ends, then fires customer.subscription.deleted — that webhook
    // (and ONLY that webhook) is the authoritative writer of
    // subscription_status='cancelled' on companies.
    //
    // We deliberately do NOT write subscription_status here. Writing it as
    // 'cancelled' immediately would lock the customer out of the app the
    // instant they scheduled cancellation, even though they have already
    // paid for the remaining days in the period. (Bug e67562e5.)
    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Return the scheduled cancellation date so the UI can show "Cancels on
    // <date>" without needing to read it back from Stripe separately.
    // `cancel_at` is a unix seconds timestamp once cancellation is scheduled;
    // fall back to current_period_end if Stripe hasn't populated cancel_at yet.
    const cancelAtUnix =
      updated.cancel_at ??
      (updated as unknown as { current_period_end?: number | null })
        .current_period_end ??
      null;
    const cancelAtIso =
      cancelAtUnix !== null && cancelAtUnix !== undefined
        ? new Date(cancelAtUnix * 1000).toISOString()
        : null;

    return NextResponse.json({
      success: true,
      cancelAtPeriodEnd: true,
      cancelAt: cancelAtIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to cancel subscription";
    console.error("[stripe/cancel] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
