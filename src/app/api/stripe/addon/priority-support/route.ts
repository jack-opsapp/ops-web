/**
 * POST /api/stripe/addon/priority-support
 *
 * Creates a Stripe Checkout Session (mode='subscription') for the
 * recurring Priority Support add-on. Body: `{ period: 'monthly' | 'annual' }`.
 *
 * Entitlement (`companies.has_priority_support = true`) is set in the
 * webhook on `checkout.session.completed`. Cancellations flow through
 * `customer.subscription.updated` / `customer.subscription.deleted`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getStripe,
  decodeFirebaseToken,
  ensureStripeCustomer,
  buildAddonReturnUrls,
} from "@/lib/stripe/checkout-helpers";
import { ADDON_PRICE_MAP } from "@/lib/stripe/subscription-mapping";

const VALID_PERIODS = ["monthly", "annual"] as const;
type PeriodInput = (typeof VALID_PERIODS)[number];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = decodeFirebaseToken(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { code: "unauthorized", message: "Sign in to purchase add-ons" },
      { status: 401 }
    );
  }

  let body: { companyId?: string; period?: string };
  try {
    body = (await req.json()) as { companyId?: string; period?: string };
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { companyId } = body;
  const period = body.period as PeriodInput | undefined;

  if (!companyId) {
    return NextResponse.json(
      { code: "missing_company", message: "companyId is required" },
      { status: 400 }
    );
  }

  if (!period || !VALID_PERIODS.includes(period)) {
    return NextResponse.json(
      {
        code: "invalid_period",
        message: `period must be one of: ${VALID_PERIODS.join(", ")}`,
      },
      { status: 400 }
    );
  }

  const priceId =
    period === "annual"
      ? ADDON_PRICE_MAP.priority_support_annual
      : ADDON_PRICE_MAP.priority_support_monthly;

  if (!priceId) {
    console.error(
      `[stripe/addon/priority-support] price env var missing for period=${period}`
    );
    return NextResponse.json(
      { code: "config_missing", message: "Add-on price not configured" },
      { status: 400 }
    );
  }

  const supabase = getServiceRoleClient();
  const stripe = getStripe();

  const { data: company, error: fetchErr } = await supabase
    .from("companies")
    .select("id, name, email, stripe_customer_id, has_priority_support")
    .eq("id", companyId)
    .single();

  if (fetchErr || !company) {
    return NextResponse.json(
      { code: "company_not_found", message: "Company not found" },
      { status: 404 }
    );
  }

  if (company.has_priority_support) {
    return NextResponse.json(
      {
        code: "already_active",
        message:
          "Priority Support is already active. Manage it in the billing portal.",
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
    addon: "priority_support",
  });

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        client_reference_id: company.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          addon: "priority_support",
          period,
          companyId: company.id,
          purchasedByAuthUid: user.uid,
        },
        subscription_data: {
          metadata: {
            addon: "priority_support",
            period,
            companyId: company.id,
          },
        },
      },
      {
        idempotencyKey: `company-${company.id}-checkout-priority-${period}`,
      }
    );

    if (!session.url) {
      console.error(
        "[stripe/addon/priority-support] Stripe returned session with no URL",
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
    console.error("[stripe/addon/priority-support] Stripe error:", err);
    return NextResponse.json(
      { code: "stripe_error", message },
      { status: 400 }
    );
  }
}
