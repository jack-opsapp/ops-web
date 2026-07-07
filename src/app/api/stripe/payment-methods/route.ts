/**
 * GET /api/stripe/payment-methods?companyId=xxx
 * POST /api/stripe/payment-methods  { companyId, paymentMethodId, action: "set_default" }
 * DELETE /api/stripe/payment-methods  { paymentMethodId: string }
 *
 * Lists, promotes-to-default, or detaches payment methods for a company's
 * Stripe customer.
 *
 * The POST set_default action is the linchpin of billing lockout recovery.
 * A locked or churned customer adds a card through a SetupIntent, which
 * attaches the card to the customer but never marks it as the customer
 * default. /api/stripe/subscribe falls back to
 * invoice_settings.default_payment_method when no explicit paymentMethodId is
 * passed — so without this action a re-subscribe stays blocked at 402 and the
 * customer can never pay to regain access.
 *
 * GET Returns:    { methods: { id, brand, last4, expMonth, expYear, isDefault }[] }
 * POST Returns:   { success: true, defaultPaymentMethodId: string }
 * DELETE Returns: { success: true }
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { companyId, paymentMethodId, action } = (await req.json()) as {
      companyId?: string;
      paymentMethodId?: string;
      action?: string;
    };

    if (action !== "set_default") {
      return NextResponse.json(
        { error: "Unsupported action; expected 'set_default'" },
        { status: 400 }
      );
    }
    if (!companyId || !paymentMethodId) {
      return NextResponse.json(
        { error: "companyId and paymentMethodId are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceRoleClient();
    const stripe = getStripe();

    const { data: company, error } = await supabase
      .from("companies")
      .select("stripe_customer_id")
      .eq("id", companyId)
      .single();

    if (error || !company?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer for company" },
        { status: 404 }
      );
    }

    const customerId = company.stripe_customer_id;

    // Idempotent attach. A card added through a SetupIntent is already attached
    // to this customer, so re-attaching is redundant — and attaching a card
    // owned by a DIFFERENT customer throws. Resolve that ambiguity off the
    // payment method's own `customer` field rather than pattern-matching Stripe
    // error strings (a "different customer" error also contains "already"):
    //   - already ours   -> nothing to do
    //   - unattached      -> attach to this customer
    //   - someone else's  -> refuse; never silently move a card between
    //                        customers, which would let one company charge
    //                        another company's card.
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const attachedTo =
      typeof pm.customer === "string" ? pm.customer : pm.customer?.id ?? null;

    if (attachedTo && attachedTo !== customerId) {
      return NextResponse.json(
        { error: "That card belongs to a different account." },
        { status: 409 }
      );
    }

    if (!attachedTo) {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    }

    // Promote to default for invoices + future subscription charges. This is
    // what unblocks the lockout-recovery flow described in the file header.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    return NextResponse.json({
      success: true,
      defaultPaymentMethodId: paymentMethodId,
    });
  } catch (err) {
    console.error("[stripe/payment-methods] POST Error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to set default payment method",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { paymentMethodId } = await req.json();
    if (!paymentMethodId) {
      return NextResponse.json({ error: "paymentMethodId is required" }, { status: 400 });
    }

    const stripe = getStripe();
    await stripe.paymentMethods.detach(paymentMethodId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[stripe/payment-methods] DELETE Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove payment method" },
      { status: 500 }
    );
  }
}
