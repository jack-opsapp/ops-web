import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import { resolveDecksCompanyAuth } from "@/lib/decks/route-auth";
import {
  getStripe,
  ensureStripeCustomer,
  bucketedIdempotencyKey,
} from "@/lib/stripe/checkout-helpers";
import {
  DECKSET_PRODUCT_KEY,
  DECKSET_PRO_ENTITLEMENT,
  DECKSET_SOURCE_APP,
  buildDecksetCheckoutReturnUrls,
  decksetPriceEnvName,
  decksetPriceId,
  decksetProductId,
  decksetStatusUnlocksPro,
  type DecksetBillingPeriod,
} from "@/lib/decks/billing/stripe-deckset";

const checkoutBodySchema = z.object({
  company_id: z.string().uuid(),
  period: z.enum(["Monthly", "Annual"]),
  entitlement: z.literal(DECKSET_PRO_ENTITLEMENT),
  source_app: z.literal(DECKSET_SOURCE_APP),
});

type CheckoutBody = z.infer<typeof checkoutBodySchema>;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveDecksCompanyAuth(req, {
    logTag: "[decks/checkout]",
    unavailableMessage: "Checkout unavailable",
    errorShape: "code",
  });
  if (auth instanceof NextResponse) return auth;

  const body = await readCheckoutBody(req);
  if (body instanceof NextResponse) return body;

  // iOS persists the provisioned company_id verbatim; Postgres uuids render
  // lowercase. Compare case-insensitively so a historical uppercase copy
  // can't strand a legitimate purchase.
  if (body.company_id.toLowerCase() !== auth.companyId.toLowerCase()) {
    return NextResponse.json(
      { code: "company_scope_mismatch", message: "Company scope mismatch" },
      { status: 403 }
    );
  }

  const priceId = decksetPriceId(body.period);
  if (!priceId) {
    const envName = decksetPriceEnvName(body.period);
    console.error(`[decks/checkout] Missing ${envName}`);
    return NextResponse.json(
      {
        code: "config_missing",
        message: "Deckset Pro checkout is not configured.",
        env: envName,
      },
      { status: 500 }
    );
  }

  const supabase = getServiceRoleClient();

  const { data: mirror, error: mirrorError } = await supabase
    .from("deck_subscriptions")
    .select("status")
    .eq("company_id", auth.companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (mirrorError) {
    console.error(
      "[decks/checkout] Failed to inspect deck subscription",
      mirrorError.message
    );
    return NextResponse.json(
      {
        code: "subscription_lookup_failed",
        message: "Could not inspect Deckset subscription.",
      },
      { status: 503 }
    );
  }

  if (
    mirror?.status &&
    decksetStatusUnlocksPro(
      mirror.status as Parameters<typeof decksetStatusUnlocksPro>[0]
    )
  ) {
    return NextResponse.json(
      {
        code: "already_subscribed",
        message: "Deckset Pro is already active for this company.",
      },
      { status: 409 }
    );
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name, email, stripe_customer_id")
    .eq("id", auth.companyId)
    .maybeSingle();

  if (companyError) {
    console.error(
      "[decks/checkout] Failed to load company",
      companyError.message
    );
    return NextResponse.json(
      { code: "company_lookup_failed", message: "Could not load company." },
      { status: 503 }
    );
  }

  if (!company) {
    return NextResponse.json(
      { code: "company_not_found", message: "Company not found" },
      { status: 404 }
    );
  }

  const stripe = getStripe();
  const stripeCustomerId = await ensureStripeCustomer({
    stripe,
    supabase,
    companyId: company.id as string,
    companyName: company.name as string,
    email: ((company.email as string | null) ?? auth.email) || null,
    existingCustomerId: (company.stripe_customer_id as string | null) ?? null,
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";
  const { successUrl, cancelUrl } = buildDecksetCheckoutReturnUrls({ appUrl });

  // One metadata object reused for both the session and the subscription so
  // the two can never drift.
  const metadata = decksetCheckoutMetadata({
    companyId: company.id as string,
    authUid: auth.uid,
    period: body.period,
    productId: decksetProductId(body.period),
  });

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        client_reference_id: company.id as string,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata,
        subscription_data: {
          metadata,
        },
      },
      {
        idempotencyKey: bucketedIdempotencyKey([
          "company",
          company.id as string,
          "deckset",
          "checkout",
          body.period,
        ]),
      }
    );

    if (!session.url) {
      console.error(
        "[decks/checkout] Stripe returned session with no URL",
        session.id
      );
      return NextResponse.json(
        {
          code: "stripe_error",
          message: "Stripe did not return a checkout URL",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[decks/checkout] Stripe checkout failed", error);
    return NextResponse.json(
      {
        code: "stripe_error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to create checkout session",
      },
      { status: 502 }
    );
  }
}

function decksetCheckoutMetadata(params: {
  companyId: string;
  authUid: string;
  period: DecksetBillingPeriod;
  productId: string;
}): Record<string, string> {
  return {
    product: DECKSET_PRODUCT_KEY,
    entitlement: DECKSET_PRO_ENTITLEMENT,
    productId: params.productId,
    companyId: params.companyId,
    period: params.period,
    purchasedByAuthUid: params.authUid,
    sourceApp: DECKSET_SOURCE_APP,
  };
}

async function readCheckoutBody(
  req: NextRequest
): Promise<CheckoutBody | NextResponse> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { code: "bad_request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = checkoutBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        code: "bad_request",
        message:
          "company_id, period, entitlement, and source_app are required.",
      },
      { status: 400 }
    );
  }

  return parsed.data;
}
