import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const db = getAdminSupabase();

  const { data: order } = await db.from("shop_orders").select("status").eq("id", orderId).single();
  if (!order || order.status !== "shipped") {
    return NextResponse.json({ error: `Cannot deliver: order status is "${order?.status}"` }, { status: 409 });
  }

  const { error } = await db.from("shop_orders").update({ status: "delivered" }).eq("id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
