/**
 * PUT /api/admin/shop/products/[id]/full
 *
 * Full product update including options and variants sync.
 * Used by the product editor form. Simpler field-only updates use the parent [id] route.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type { ShopProductPayload } from "@/lib/admin/shop-types";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const productId = segments[segments.indexOf("products") + 1];
  const body = (await req.json()) as ShopProductPayload;
  const db = getAdminSupabase();

  // 1. Update product fields
  const { error: pErr } = await db
    .from("shop_products")
    .update({
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
    .eq("id", productId);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // 2. Sync options
  const { data: existingOptions } = await db
    .from("shop_product_options")
    .select("id, name")
    .eq("product_id", productId);

  const existingOptIds = new Set((existingOptions ?? []).map((o) => o.id));
  const incomingOptIds = new Set(body.options.filter((o) => o.id).map((o) => o.id!));

  // Delete removed options (cascade: values deleted, variant_option_values orphaned)
  const removedOptIds = [...existingOptIds].filter((id) => !incomingOptIds.has(id));
  if (removedOptIds.length) {
    await db.from("shop_product_option_values").delete().in("option_id", removedOptIds);
    await db.from("shop_product_options").delete().in("id", removedOptIds);
  }

  // Upsert options + values, build ID map
  const optionValueIdMap: Record<string, Record<string, string>> = {};

  for (let oi = 0; oi < body.options.length; oi++) {
    const opt = body.options[oi];
    let optionId: string;

    if (opt.id && existingOptIds.has(opt.id)) {
      await db.from("shop_product_options").update({ name: opt.name, sort_order: oi }).eq("id", opt.id);
      optionId = opt.id;
    } else {
      const { data, error } = await db
        .from("shop_product_options")
        .insert({ product_id: productId, name: opt.name, sort_order: oi })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      optionId = data.id;
    }

    // Sync values for this option
    const { data: existingValues } = await db
      .from("shop_product_option_values")
      .select("id, value")
      .eq("option_id", optionId);

    const existingValIds = new Set((existingValues ?? []).map((v) => v.id));
    const incomingValIds = new Set(opt.values.filter((v) => v.id).map((v) => v.id!));

    // Delete removed values
    const removedValIds = [...existingValIds].filter((id) => !incomingValIds.has(id));
    if (removedValIds.length) {
      await db.from("shop_variant_option_values").delete().in("option_value_id", removedValIds);
      await db.from("shop_product_option_values").delete().in("id", removedValIds);
    }

    optionValueIdMap[opt.name] = {};

    for (let vi = 0; vi < opt.values.length; vi++) {
      const val = opt.values[vi];
      let valueId: string;

      if (val.id && existingValIds.has(val.id)) {
        await db.from("shop_product_option_values").update({ value: val.value, sort_order: vi }).eq("id", val.id);
        valueId = val.id;
      } else {
        const { data, error } = await db
          .from("shop_product_option_values")
          .insert({ option_id: optionId, value: val.value, sort_order: vi })
          .select("id")
          .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        valueId = data.id;
      }

      optionValueIdMap[opt.name][val.value] = valueId;
    }
  }

  // 3. Sync variants
  const { data: existingVariants } = await db
    .from("shop_variants")
    .select("id")
    .eq("product_id", productId);

  const existingVarIds = new Set((existingVariants ?? []).map((v) => v.id));
  const incomingVarIds = new Set(body.variants.filter((v) => v.id).map((v) => v.id!));

  // Deactivate removed variants (don't hard delete — order history)
  const removedVarIds = [...existingVarIds].filter((id) => !incomingVarIds.has(id));
  if (removedVarIds.length) {
    await db.from("shop_variants").update({ is_active: false }).in("id", removedVarIds);
  }

  for (let vi = 0; vi < body.variants.length; vi++) {
    const v = body.variants[vi];
    let variantId: string;

    if (v.id && existingVarIds.has(v.id)) {
      await db
        .from("shop_variants")
        .update({
          sku: v.sku,
          price_cents: v.priceCents,
          stock_quantity: v.stockQuantity,
          is_active: v.isActive,
          sort_order: vi,
        })
        .eq("id", v.id);
      variantId = v.id;

      // Re-link option values
      await db.from("shop_variant_option_values").delete().eq("variant_id", variantId);
    } else {
      const { data, error } = await db
        .from("shop_variants")
        .insert({
          product_id: productId,
          sku: v.sku,
          price_cents: v.priceCents,
          stock_quantity: v.stockQuantity,
          is_active: v.isActive,
          sort_order: vi,
        })
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      variantId = data.id;
    }

    // Link variant to option values
    const links = Object.entries(v.optionValues)
      .map(([optName, valName]) => ({
        variant_id: variantId,
        option_value_id: optionValueIdMap[optName]?.[valName],
      }))
      .filter((l) => l.option_value_id);

    if (links.length) {
      await db.from("shop_variant_option_values").insert(links);
    }
  }

  return NextResponse.json({ ok: true });
});
