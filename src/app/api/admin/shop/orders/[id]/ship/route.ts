import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const { trackingNumber, trackingUrl } = await req.json();

  if (!trackingNumber) {
    return NextResponse.json({ error: "Tracking number is required" }, { status: 400 });
  }

  const db = getAdminSupabase();

  // Verify order is in "paid" status
  const { data: order } = await db.from("shop_orders").select("status").eq("id", orderId).single();
  if (!order || order.status !== "paid") {
    return NextResponse.json({ error: `Cannot ship: order status is "${order?.status}"` }, { status: 409 });
  }

  const { error } = await db
    .from("shop_orders")
    .update({
      status: "shipped",
      shipped_at: new Date().toISOString(),
      tracking_number: trackingNumber,
      tracking_url: trackingUrl || null,
    })
    .eq("id", orderId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
