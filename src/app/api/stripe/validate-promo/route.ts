/**
 * POST /api/stripe/validate-promo
 *
 * Validates a Stripe promotion code.
 * Body: { promoCode: string }
 * Returns: { valid: boolean, discount_percentage?: number, discount_amount?: number,
 *            coupon_name?: string, max_redemptions?: number, times_redeemed?: number,
 *            error?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json(
      { error: "Missing Authorization header" },
      { status: 401 }
    );
  }

  try {
    const { promoCode } = await req.json();

    if (!promoCode || typeof promoCode !== "string") {
      return NextResponse.json(
        { valid: false, error: "Promo code is required" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // Search for active promotion codes matching the input
    const promotionCodes = await stripe.promotionCodes.list({
      code: promoCode.trim(),
      active: true,
      limit: 1,
    });

    if (promotionCodes.data.length === 0) {
      return NextResponse.json({ valid: false, error: "Invalid promo code" });
    }

    const promo = promotionCodes.data[0];
    const couponRef = promo.coupon;

    // coupon may be a string (unexpanded) or an object — we need the full object
    if (!couponRef || typeof couponRef === "string") {
      return NextResponse.json({
        valid: false,
        error: "Unable to resolve coupon for this promo code",
      });
    }

    const coupon = couponRef;

    // Check if coupon is still valid
    if (!coupon.valid) {
      return NextResponse.json({
        valid: false,
        error: "This promo code has expired",
      });
    }

    // Check max redemptions
    if (
      promo.max_redemptions !== null &&
      promo.times_redeemed >= promo.max_redemptions
    ) {
      return NextResponse.json({
        valid: false,
        error: "This code has reached its maximum redemptions",
      });
    }

    // Build response
    const result: Record<string, unknown> = {
      valid: true,
      coupon_name: coupon.name || promo.code,
    };

    if (coupon.percent_off !== null) {
      result.discount_percentage = coupon.percent_off;
    }

    if (coupon.amount_off !== null) {
      result.discount_amount = coupon.amount_off;
    }

    if (promo.max_redemptions !== null) {
      result.max_redemptions = promo.max_redemptions;
      result.times_redeemed = promo.times_redeemed;
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to validate promo code";
    console.error("[stripe/validate-promo] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
