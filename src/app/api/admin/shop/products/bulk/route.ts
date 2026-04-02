/**
 * POST /api/admin/shop/products/bulk
 *
 * Bulk operations on products: archive, activate, feature, unfeature.
 * Body: { action: string, productIds: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

type BulkAction = "archive" | "activate" | "feature" | "unfeature";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const { action, productIds } = (await req.json()) as {
    action: BulkAction;
    productIds: string[];
  };

  if (!action || !productIds?.length) {
    return NextResponse.json({ error: "Missing action or productIds" }, { status: 400 });
  }

  const db = getAdminSupabase();
  let updateFields: Record<string, unknown>;

  switch (action) {
    case "archive":
      updateFields = { archived_at: new Date().toISOString(), is_active: false };
      break;
    case "activate":
      updateFields = { archived_at: null, is_active: true };
      break;
    case "feature":
      updateFields = { is_featured: true };
      break;
    case "unfeature":
      updateFields = { is_featured: false };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { error } = await db
    .from("shop_products")
    .update(updateFields)
    .in("id", productIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: productIds.length });
});
