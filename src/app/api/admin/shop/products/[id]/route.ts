/**
 * PUT /api/admin/shop/products/[id]
 * DELETE /api/admin/shop/products/[id]
 *
 * Update or delete a single product.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("products") + 1];
  const body = await req.json();
  const db = getAdminSupabase();

  // Map camelCase to snake_case for direct field updates
  const fieldMap: Record<string, string> = {
    isFeatured: "is_featured",
    isActive: "is_active",
    archivedAt: "archived_at",
    name: "name",
    slug: "slug",
    description: "description",
    categoryId: "category_id",
    priceCents: "price_cents",
    images: "images",
    taxCode: "tax_code",
  };

  const update: Record<string, unknown> = {};
  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) update[snake] = body[camel];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.from("shop_products").update(update).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
});

export const DELETE = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const id = segments[segments.indexOf("products") + 1];
  const db = getAdminSupabase();

  // Check for orders referencing this product
  const { count } = await db
    .from("shop_order_items")
    .select("*", { count: "exact", head: true })
    .eq("product_id", id);

  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${count} order items reference this product. Archive it instead.` },
      { status: 409 }
    );
  }

  // Delete in order: variant_option_values → variants → option_values → options → product
  const { data: variants } = await db.from("shop_variants").select("id").eq("product_id", id);
  if (variants?.length) {
    await db.from("shop_variant_option_values").delete().in("variant_id", variants.map((v) => v.id));
    await db.from("shop_variants").delete().eq("product_id", id);
  }

  const { data: options } = await db.from("shop_product_options").select("id").eq("product_id", id);
  if (options?.length) {
    await db.from("shop_product_option_values").delete().in("option_id", options.map((o) => o.id));
    await db.from("shop_product_options").delete().eq("product_id", id);
  }

  const { error } = await db.from("shop_products").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
});
