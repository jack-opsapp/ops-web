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
    .select("status, stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (!order || !["pending", "paid"].includes(order.status)) {
    return NextResponse.json({ error: `Cannot cancel: order status is "${order?.status}"` }, { status: 409 });
  }

  // Release inventory reservations
  const { data: reservations } = await db
    .from("shop_inventory_reservations")
    .select("variant_id, quantity")
    .eq("stripe_payment_intent_id", order.stripe_payment_intent_id);

  for (const res of reservations ?? []) {
    // Decrement reserved_quantity on variant
    const { data: variant } = await db
      .from("shop_variants")
      .select("reserved_quantity")
      .eq("id", res.variant_id)
      .single();

    if (variant) {
      const newReserved = Math.max(0, (variant.reserved_quantity ?? 0) - res.quantity);
      await db.from("shop_variants").update({ reserved_quantity: newReserved }).eq("id", res.variant_id);
    }
  }

  // Delete reservations
  await db
    .from("shop_inventory_reservations")
    .delete()
    .eq("stripe_payment_intent_id", order.stripe_payment_intent_id);

  // If paid, issue refund
  if (order.status === "paid") {
    const stripe = getStripe();
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });
  }

  const { error } = await db.from("shop_orders").update({ status: "cancelled" }).eq("id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
