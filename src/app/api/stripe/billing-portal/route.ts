/**
 * POST /api/stripe/billing-portal
 *
 * Creates a Stripe Billing Portal session for the company's existing
 * Stripe customer. Used by the Priority Support card "Manage in billing
 * portal" link. Returns `{ url }` for client-side redirect.
 *
 * The portal lets users update payment methods, view invoices, and
 * cancel subscriptions (including the priority-support add-on). When a
 * user cancels there, our webhook handler (customer.subscription.updated /
 * .deleted) flips `companies.has_priority_support` back to false.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server-client";
import {
  getStripe,
  decodeFirebaseToken,
} from "@/lib/stripe/checkout-helpers";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = decodeFirebaseToken(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json(
      { code: "unauthorized", message: "Sign in to manage billing" },
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

  const supabase = getServiceRoleClient();
  const stripe = getStripe();

  const { data: company, error: fetchErr } = await supabase
    .from("companies")
    .select("id, stripe_customer_id")
    .eq("id", companyId)
    .single();

  if (fetchErr || !company) {
    return NextResponse.json(
      { code: "company_not_found", message: "Company not found" },
      { status: 404 }
    );
  }

  if (!company.stripe_customer_id) {
    return NextResponse.json(
      {
        code: "no_customer",
        message:
          "No Stripe customer on file — purchase a subscription first",
      },
      { status: 409 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opsapp.co";

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id as string,
      return_url: `${appUrl}/settings?tab=subscription`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create portal session";
    console.error("[stripe/billing-portal] Stripe error:", err);
    return NextResponse.json(
      { code: "stripe_error", message },
      { status: 400 }
    );
  }
}
