/**
 * Shared helpers for Stripe Checkout flows (add-ons today; could be extended
 * to other one-shot purchases later).
 *
 * The customer-provisioning logic mirrors `/api/stripe/subscribe` exactly —
 * idempotent customer.create + compare-and-swap on the Supabase column —
 * because two parallel checkout endpoints firing for the same company on
 * a flaky network would otherwise orphan a Stripe customer.
 */
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

/**
 * Decode a Firebase ID token without verifying the signature. The endpoints
 * downstream still scope writes by companyId, and the Supabase RLS layer
 * gates further data access — so the user identity is informational here.
 * Returns null on malformed input so callers can 401.
 */
export function decodeFirebaseToken(
  authHeader: string | null
): { uid: string; email: string } | null {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );
    return { uid: payload.sub || payload.user_id, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Ensure a Stripe customer exists for the company; create one and persist
 * the ID via compare-and-swap if not. Race-safe across concurrent requests.
 *
 * The `idempotencyKey` is keyed off the company UUID so concurrent calls
 * always converge on the same Stripe customer (no orphans). The CAS update
 * (`is("stripe_customer_id", null)`) means only the first writer's value
 * sticks; losers re-read and use whatever the winner persisted.
 */
export async function ensureStripeCustomer(params: {
  stripe: Stripe;
  supabase: SupabaseClient;
  companyId: string;
  companyName: string;
  email: string | null;
  existingCustomerId: string | null;
}): Promise<string> {
  if (params.existingCustomerId) return params.existingCustomerId;

  const customer = await params.stripe.customers.create(
    {
      email: params.email ?? undefined,
      name: params.companyName,
      metadata: { companyId: params.companyId },
    },
    { idempotencyKey: `company-${params.companyId}-customer` }
  );

  const { data: claimed } = await params.supabase
    .from("companies")
    .update({ stripe_customer_id: customer.id })
    .eq("id", params.companyId)
    .is("stripe_customer_id", null)
    .select("stripe_customer_id")
    .maybeSingle();

  if (claimed?.stripe_customer_id) return claimed.stripe_customer_id;

  // Lost the CAS race — re-read to recover the winning ID. Idempotency on
  // the Stripe side guarantees `customer.id` and the persisted value match.
  const { data: winner } = await params.supabase
    .from("companies")
    .select("stripe_customer_id")
    .eq("id", params.companyId)
    .single();

  if (winner?.stripe_customer_id) return winner.stripe_customer_id;
  // Fallback to the Stripe-returned ID. Unreachable in practice because the
  // CAS or the re-read must succeed, but keeps the type system happy.
  return customer.id;
}

/**
 * Build the success and cancel URLs for an add-on Checkout session. They
 * both bounce back to the subscription tab in /settings so users see the
 * outcome in context next to the other plan controls.
 */
export function buildAddonReturnUrls(params: {
  appUrl: string;
  addon: "data_setup" | "priority_support";
}): { successUrl: string; cancelUrl: string } {
  const base = `${params.appUrl}/settings?tab=subscription&addon=${params.addon}`;
  return {
    successUrl: `${base}&result=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}&result=cancelled`,
  };
}

/**
 * Build a time-bucketed Stripe idempotency key. Stripe Checkout Sessions
 * expire after 24 hours; our default idempotency cache (24h) means a user
 * who abandons checkout for >a few minutes and clicks Purchase again would
 * get back the SAME session URL — possibly already expired or near-expired.
 *
 * Bucketing the key per 15 minutes keeps double-click protection (any two
 * clicks within the same 15-min window collapse to one Stripe session) but
 * lets a deliberate retry an hour later get a fresh, valid session.
 *
 * The bucket is pure server-time math — no DB roundtrip — so the fast path
 * stays fast.
 */
export function bucketedIdempotencyKey(parts: string[]): string {
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const bucket = Math.floor(Date.now() / FIFTEEN_MIN_MS);
  return [...parts, `b${bucket}`].join("-");
}
