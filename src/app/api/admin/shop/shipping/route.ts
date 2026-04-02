import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { name, description, priceCents, minOrderCents, isActive } = await req.json();
  const db = getAdminSupabase();

  const { data: maxOrder } = await db
    .from("shop_shipping_methods")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();

  const { data, error } = await db
    .from("shop_shipping_methods")
    .insert({
      name,
      description: description || null,
      price_cents: priceCents,
      min_order_cents: minOrderCents || null,
      is_active: isActive ?? true,
      sort_order: (maxOrder?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
});
