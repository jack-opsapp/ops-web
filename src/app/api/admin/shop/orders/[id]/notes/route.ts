import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const { notes } = await req.json();

  const { error } = await getAdminSupabase()
    .from("shop_orders")
    .update({ notes })
    .eq("id", orderId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
