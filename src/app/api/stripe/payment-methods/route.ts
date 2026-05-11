/**
 * GET /api/stripe/payment-methods?companyId=xxx
 * POST /api/stripe/payment-methods  { companyId, paymentMethodId, action: "set_default" }
 * DELETE /api/stripe/payment-methods  { paymentMethodId: string }
 *
 * Lists, detaches, or sets the default payment method for a company's
 * Stripe customer. The POST set_default action is critical for billing
 * recovery: subscribe / recover flows require a paymentMethodId or a
 * customer default — without this endpoint, a newly added card could
 * not be promoted to default and the customer would stay locked out.
 *
 * GET Returns: { methods: { id, brand, last4, expMonth, expYear, isDefault }[] }
 * POST Returns: { success: true, defaultPaymentMethodId }
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
    const body = await req.json();
    const { companyId, paymentMethodId, action } = body as {
      companyId?: string;
      paymentMethodId?: string;
      action?: string;
    };

    if (action !== "set_default") {
      return NextResponse.json(
        { error: "Unsupported action; expected 'set_default'" },
        { status: 400 },
      );
    }
    if (!companyId || !paymentMethodId) {
      return NextResponse.json(
        { error: "companyId and paymentMethodId are required" },
        { status: 400 },
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
        { status: 404 },
      );
    }

    const customerId = company.stripe_customer_id;

    // Attach if not already attached. Stripe.confirmCardSetup attaches
    // implicitly when the SetupIntent's customer is set, but the explicit
    // attach is idempotent and safe — Stripe returns the same object
    // when the payment_method is already attached to this customer and
    // throws if it's attached to a DIFFERENT customer. We swallow the
    // already-attached error so the happy path keeps working.
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });
    } catch (attachErr) {
      const msg =
        attachErr instanceof Error ? attachErr.message : String(attachErr);
      // Stripe code 'resource_already_exists' means it's already attached
      // to this customer — that's fine.
      if (!msg.toLowerCase().includes("already")) {
        // If it's attached to a different customer, surface the error.
        console.error("[stripe/payment-methods] attach error:", attachErr);
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Promote to default for invoices + future subscription charges.
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
          err instanceof Error ? err.message : "Failed to set default payment method",
      },
      { status: 500 },
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
