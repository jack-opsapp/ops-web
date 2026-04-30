/**
 * GET /api/stripe/addon/prices
 *
 * Returns the live unit prices for the three add-on SKUs so the
 * subscription tab can render them without any hardcoded numbers.
 * Format:
 *   {
 *     dataSetup:               { amount: number; currency: string } | null,
 *     prioritySupportMonthly:  { amount: number; currency: string } | null,
 *     prioritySupportAnnual:   { amount: number; currency: string } | null
 *   }
 *
 * Per the spec: any failure must return null for that slot — the UI
 * renders "—" rather than "$0".
 */
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { ADDON_PRICE_MAP } from "@/lib/stripe/subscription-mapping";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

interface PriceSlot {
  amount: number;
  currency: string;
}

async function safeRetrieve(
  stripe: Stripe,
  priceId: string | undefined
): Promise<PriceSlot | null> {
  if (!priceId) return null;
  try {
    const price = await stripe.prices.retrieve(priceId);
    if (price.unit_amount == null) return null;
    return { amount: price.unit_amount, currency: price.currency };
  } catch (err) {
    console.error(
      `[stripe/addon/prices] Failed to retrieve ${priceId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const stripe = getStripe();

  const [dataSetup, prioritySupportMonthly, prioritySupportAnnual] =
    await Promise.all([
      safeRetrieve(stripe, ADDON_PRICE_MAP.data_setup),
      safeRetrieve(stripe, ADDON_PRICE_MAP.priority_support_monthly),
      safeRetrieve(stripe, ADDON_PRICE_MAP.priority_support_annual),
    ]);

  return NextResponse.json(
    { dataSetup, prioritySupportMonthly, prioritySupportAnnual },
    {
      // Stripe price IDs are stable; cache for an hour at the edge so we
      // don't hammer the Stripe API on every settings page load. The
      // subscription tab also has its own SWR cache via TanStack Query.
      headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" },
    }
  );
}
