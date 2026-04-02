import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const db = getAdminSupabase();

  const { data: order } = await db
    .from("shop_orders")
    .select("status, stripe_payment_intent_id, total_cents")
    .eq("id", orderId)
    .single();

  if (!order || !["paid", "shipped"].includes(order.status)) {
    return NextResponse.json({ error: `Cannot refund: order status is "${order?.status}"` }, { status: 409 });
  }

  const stripe = getStripe();
  await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });

  const { error } = await db.from("shop_orders").update({ status: "refunded" }).eq("id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
