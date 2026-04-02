/**
 * POST /api/admin/shop/products
 *
 * Create a new product with options and variants.
 * Body: ShopProductPayload (see shop-types.ts)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { ShopProductPayload } from "@/lib/admin/shop-types";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const body = (await req.json()) as ShopProductPayload;
  const db = getAdminSupabase();

  // 1. Insert product
  const { data: product, error: pErr } = await db
    .from("shop_products")
    .insert({
      name: body.name,
      slug: body.slug,
      description: body.description || null,
      category_id: body.categoryId,
      price_cents: body.priceCents,
      images: body.images,
      is_featured: body.isFeatured,
      is_active: body.isActive,
      tax_code: body.taxCode,
    })
    .select("id")
    .single();

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const productId = product.id;

  // 2. Insert options + values, build ID maps for variant linking
  const optionValueIdMap: Record<string, Record<string, string>> = {};
  // Map: optionName → { valueName → valueId }

  for (const opt of body.options) {
    const { data: option, error: oErr } = await db
      .from("shop_product_options")
      .insert({ product_id: productId, name: opt.name, sort_order: body.options.indexOf(opt) })
      .select("id")
      .single();

    if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

    optionValueIdMap[opt.name] = {};

    for (let i = 0; i < opt.values.length; i++) {
      const val = opt.values[i];
      const { data: value, error: vErr } = await db
        .from("shop_product_option_values")
        .insert({ option_id: option.id, value: val.value, sort_order: i })
        .select("id")
        .single();

      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
      optionValueIdMap[opt.name][val.value] = value.id;
    }
  }

  // 3. Insert variants + link to option values
  for (let i = 0; i < body.variants.length; i++) {
    const v = body.variants[i];
    const { data: variant, error: vErr } = await db
      .from("shop_variants")
      .insert({
        product_id: productId,
        sku: v.sku,
        price_cents: v.priceCents,
        stock_quantity: v.stockQuantity,
        is_active: v.isActive,
        sort_order: i,
      })
      .select("id")
      .single();

    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

    // Link variant to option values
    const links = Object.entries(v.optionValues)
      .map(([optName, valName]) => ({
        variant_id: variant.id,
        option_value_id: optionValueIdMap[optName]?.[valName],
      }))
      .filter((l) => l.option_value_id);

    if (links.length) {
      const { error: lErr } = await db.from("shop_variant_option_values").insert(links);
      if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: productId });
});
