import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("shipping") + 1];
  const body = await req.json();
  const db = getAdminSupabase();

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.priceCents !== undefined) update.price_cents = body.priceCents;
  if (body.minOrderCents !== undefined) update.min_order_cents = body.minOrderCents;
  if (body.isActive !== undefined) update.is_active = body.isActive;

  const { error } = await db.from("shop_shipping_methods").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("shipping") + 1];
  const db = getAdminSupabase();

  const { count } = await db.from("shop_orders").select("*", { count: "exact", head: true }).eq("shipping_method_id", id);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete: ${count} orders use this shipping method` }, { status: 409 });
  }

  const { error } = await db.from("shop_shipping_methods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
