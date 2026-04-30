/**
 * POST /api/stripe/addon/data-setup
 *
 * Creates a Stripe Checkout Session (mode='payment') for the one-time
 * Data Setup add-on. Returns a `{ url }` the client can redirect to.
 *
 * The actual fulfillment — flipping companies.data_setup_purchased,
 * inserting into data_setup_requests, sending the ops email, and
 * dropping a notification — happens in the `/api/webhooks/stripe`
 * handler when Stripe fires `checkout.session.completed`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getStripe,
  decodeFirebaseToken,
  ensureStripeCustomer,
  buildAddonReturnUrls,
  bucketedIdempotencyKey,
} from "@/lib/stripe/checkout-helpers";
import { ADDON_PRICE_MAP } from "@/lib/stripe/subscription-mapping";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = decodeFirebaseToken(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { code: "unauthorized", message: "Sign in to purchase add-ons" },
      { status: 401 }
    );
  }

  let body: { companyId?: string };
  try {
    body = (await req.json()) as { companyId?: string };
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const companyId = body.companyId;
  if (!companyId) {
    return NextResponse.json(
      { code: "missing_company", message: "companyId is required" },
      { status: 400 }
    );
  }

  const priceId = ADDON_PRICE_MAP.data_setup;
  if (!priceId) {
    console.error("[stripe/addon/data-setup] STRIPE_PRICE_DATA_SETUP missing");
    return NextResponse.json(
      { code: "config_missing", message: "Add-on price not configured" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const stripe = getStripe();

  const { data: company, error: fetchErr } = await supabase
    .from("companies")
    .select("id, name, email, stripe_customer_id, data_setup_purchased")
    .eq("id", companyId)
    .single();

  if (fetchErr || !company) {
    return NextResponse.json(
      { code: "company_not_found", message: "Company not found" },
      { status: 404 }
    );
  }

  // Block re-purchase of a one-time add-on. data_setup_purchased flips back
  // to false only via admin override on `companies` — there's no consumer-
  // facing refund flow yet — so this guard is safe.
  if (company.data_setup_purchased) {
    return NextResponse.json(
      {
        code: "already_purchased",
        message: "Data Setup has already been purchased for this company",
      },
      { status: 409 }
    );
  }

  const stripeCustomerId = await ensureStripeCustomer({
    stripe,
    supabase,
    companyId: company.id,
    companyName: company.name,
    email: (company.email as string | null) ?? user.email,
    existingCustomerId: (company.stripe_customer_id as string | null) ?? null,
  });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  const { successUrl, cancelUrl } = buildAddonReturnUrls({
    appUrl,
    addon: "data_setup",
  });

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: stripeCustomerId,
        client_reference_id: company.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        // Stripe surfaces this on the receipt and downstream webhooks so the
        // fulfillment handler can route off the metadata without re-reading
        // the line items.
        metadata: {
          addon: "data_setup",
          companyId: company.id,
          purchasedByAuthUid: user.uid,
        },
        payment_intent_data: {
          metadata: {
            addon: "data_setup",
            companyId: company.id,
          },
          // The receipt is informational; the official confirmation is the
          // separate DataSetupRequest email sent from the webhook.
          receipt_email: (company.email as string | null) ?? user.email ?? undefined,
        },
        // Mirror the existing /subscribe idempotency posture. Two double-
        // clicks on the Purchase button reuse the same Stripe Session
        // instead of creating duplicates that would charge the user twice
        // if both succeeded.
      },
      {
        idempotencyKey: bucketedIdempotencyKey([
          "company",
          company.id,
          "checkout",
          "data-setup",
        ]),
      }
    );

    if (!session.url) {
      console.error(
        "[stripe/addon/data-setup] Stripe returned session with no URL",
        session.id
      );
      return NextResponse.json(
        { code: "stripe_error", message: "Stripe did not return a checkout URL" },
        { status: 400 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session";
    console.error("[stripe/addon/data-setup] Stripe error:", err);
    return NextResponse.json(
      { code: "stripe_error", message },
      { status: 400 }
    );
  }
}
