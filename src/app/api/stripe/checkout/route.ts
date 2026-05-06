/**
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout Session in `mode='subscription'` for one of the
 * three core plans (starter / team / business) at the requested billing
 * cadence. Returns `{ url }` so the client can redirect to Stripe-hosted
 * Checkout. Stripe collects payment info, Stripe creates the subscription,
 * Stripe fires `customer.subscription.created` → our webhook flips
 * `companies.subscription_status` to `active`.
 *
 * Why this exists separately from `/api/stripe/subscribe`:
 *   `/subscribe` creates a subscription server-side using a previously-saved
 *   default payment method (set via SetupIntent in /settings/billing). That
 *   path is what the in-app upgrade modal uses for already-paying users.
 *
 *   This route is the "I have no card on file" path — used by the lockout
 *   overlay's CompactPricingCard on an admin whose subscription has expired.
 *   Without this, the lockout could be bypassed: the admin clicks "Subscribe",
 *   lands on /settings (which is exempt from lockout), and gains UI access
 *   without ever entering payment info. The Checkout Session forces the
 *   payment-info step before any DB state changes.
 *
 * State integrity:
 *   The CALLER does NOT update `subscription_status`. The webhook is the only
 *   source of truth — see `/api/webhooks/stripe/route.ts`. Until the webhook
 *   fires the company stays in its current state (e.g. `expired`), so the
 *   lockout overlay continues to block access. If the user abandons checkout,
 *   the lockout never clears.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getStripe,
  decodeFirebaseToken,
  ensureStripeCustomer,
  bucketedIdempotencyKey,
} from "@/lib/stripe/checkout-helpers";

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
  const user = decodeFirebaseToken(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { code: "unauthorized", message: "Sign in to subscribe" },
      { status: 401 }
    );
  }

  let body: { companyId?: string; plan?: string; period?: string };
  try {
    body = (await req.json()) as {
      companyId?: string;
      plan?: string;
      period?: string;
    };
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const companyId = body.companyId;
  const plan = body.plan as Plan | undefined;
  const period = (body.period ?? "Monthly") as Period;

  if (!companyId) {
    return NextResponse.json(
      { code: "missing_company", message: "companyId is required" },
      { status: 400 }
    );
  }
  if (!plan || !VALID_PLANS.includes(plan)) {
    return NextResponse.json(
      {
        code: "invalid_plan",
        message: `plan must be one of: ${VALID_PLANS.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json(
      {
        code: "invalid_period",
        message: `period must be one of: ${VALID_PERIODS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const priceId = getPriceId(plan, period);
  if (!priceId) {
    console.error(
      `[stripe/checkout] Missing price env var for ${plan}_${period}`
    );
    return NextResponse.json(
      {
        code: "config_missing",
        message:
          "This plan is currently unavailable. Contact support so we can update the pricing configuration.",
        plan,
        period,
      },
      { status: 500 }
    );
  }

  const supabase = getServiceRoleClient();
  const stripe = getStripe();

  const { data: company, error: fetchErr } = await supabase
    .from("companies")
    .select("id, name, email, stripe_customer_id, subscription_status")
    .eq("id", companyId)
    .single();

  if (fetchErr || !company) {
    return NextResponse.json(
      { code: "company_not_found", message: "Company not found" },
      { status: 404 }
    );
  }

  // Refuse to create a second subscription while one is already live.
  // Mirrors the guard in /api/stripe/subscribe — if a tester is already on
  // an active sub and clicks a checkout card again, route them to the
  // billing portal rather than creating a duplicate.
  if (
    company.subscription_status &&
    ["active", "trial", "grace"].includes(company.subscription_status)
  ) {
    return NextResponse.json(
      {
        code: "already_subscribed",
        message:
          "This company already has an active subscription. Manage it from Settings → Subscription.",
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

  // Land back on /settings with the result query so the subscription tab
  // can flash a confirmation toast. The webhook is the source of truth for
  // subscription_status; the success URL is purely UX.
  const successUrl = `${appUrl}/settings?tab=subscription&result=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/settings?tab=subscription&result=cancelled`;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        client_reference_id: company.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        // payment_method_collection: "always" forces card collection even on
        // free trials. Defense against the "no card on file" lockout bypass —
        // the user MUST enter payment details before Stripe creates any
        // subscription record. Without this, a configured-trial setup could
        // grant access without payment info.
        payment_method_collection: "always",
        // Our webhook keys off `customer.subscription.created` directly via
        // the customer ID. metadata is informational for downstream
        // reconciliation queries.
        metadata: {
          companyId: company.id,
          plan,
          period,
          purchasedByAuthUid: user.uid,
        },
        subscription_data: {
          metadata: {
            companyId: company.id,
            plan,
            period,
          },
        },
      },
      {
        // 15-minute bucket: legitimate retry-after-abandon yields a fresh
        // session, but two rapid double-clicks share the same session URL.
        idempotencyKey: bucketedIdempotencyKey([
          "company",
          company.id,
          "checkout",
          "subscription",
          plan,
          period,
        ]),
      }
    );

    if (!session.url) {
      console.error(
        "[stripe/checkout] Stripe returned session with no URL",
        session.id
      );
      return NextResponse.json(
        { code: "stripe_error", message: "Stripe did not return a checkout URL" },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session";
    console.error("[stripe/checkout] Stripe error:", err);
    return NextResponse.json(
      { code: "stripe_error", message },
      { status: 502 }
    );
  }
}
