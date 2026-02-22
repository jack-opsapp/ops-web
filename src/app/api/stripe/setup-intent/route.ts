/**
 * POST /api/stripe/setup-intent
 *
 * Creates a Stripe SetupIntent for collecting a payment method.
 * Ensures the company has a Stripe customer ID (creates one if missing).
 * Body: { companyId: string }
 * Returns: { clientSecret: string }
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
        console.error("[stripe/setup-intent] Failed to save stripe_customer_id:", updateError.message);
        return NextResponse.json({ error: "Failed to update company" }, { status: 500 });
      }
    }

    // Create SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
    });

    return NextResponse.json({ clientSecret: setupIntent.client_secret });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create setup intent";
    console.error("[stripe/setup-intent] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
