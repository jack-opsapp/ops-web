/**
 * GET /api/stripe/payment-methods?companyId=xxx
 *
 * Lists payment methods for a company's Stripe customer.
 * Returns: { methods: { id, brand, last4, expMonth, expYear, isDefault }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getServiceRoleClient } from "@/lib/supabase/server-client";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  try {
    const supabase = getServiceRoleClient();
    const stripe = getStripe();

    const { data: company, error } = await supabase
      .from("companies")
      .select("stripe_customer_id")
      .eq("id", companyId)
      .single();

    if (error || !company?.stripe_customer_id) {
      return NextResponse.json({ methods: [] });
    }

    const customerId = company.stripe_customer_id;

    // Fetch payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    // Fetch customer to determine default payment method
    const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
    const defaultPmId =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : (customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null)?.id ?? null;

    const methods = paymentMethods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "unknown",
      last4: pm.card?.last4 ?? "****",
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
      isDefault: pm.id === defaultPmId,
    }));

    return NextResponse.json({ methods });
  } catch (err) {
    console.error("[stripe/payment-methods] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch payment methods" },
      { status: 500 }
    );
  }
}
