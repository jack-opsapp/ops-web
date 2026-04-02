/**
 * OPS Admin — Shop Supabase Queries
 *
 * SERVER ONLY. All functions use getAdminSupabase() (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type {
  ShopCategory,
  ShopProductListItem,
  ShopProduct,
  ShopProductOption,
  ShopVariant,
  ShopShippingMethod,
  ShopOrder,
  ShopOrderItem,
  ShopOrderWithItems,
} from "./shop-types";

const db = () => getAdminSupabase();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Category Queries ─────────────────────────────────────────────────────────

export async function getShopCategories(): Promise<ShopCategory[]> {
  const { data, error } = await db()
    .from("shop_categories")
    .select("id, name, slug, sort_order, created_at")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }));
}

export async function createShopCategory(name: string, slug?: string): Promise<ShopCategory> {
  const { data: maxOrder } = await db()
    .from("shop_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  const nextOrder = (maxOrder?.sort_order ?? 0) + 1;
  const { data, error } = await db()
    .from("shop_categories")
    .insert({ name, slug: slug || slugify(name), sort_order: nextOrder })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, slug: data.slug, sortOrder: data.sort_order, createdAt: data.created_at };
}

export async function updateShopCategory(id: string, fields: { name?: string; slug?: string }): Promise<void> {
  const { error } = await db().from("shop_categories").update(fields).eq("id", id);
  if (error) throw error;
}

export async function reorderShopCategories(orderedIds: string[]): Promise<void> {
  const updates = orderedIds.map((id, i) => db().from("shop_categories").update({ sort_order: i }).eq("id", id));
  await Promise.all(updates);
}

export async function deleteShopCategory(id: string): Promise<void> {
  // Check for products in this category
  const { count } = await db()
    .from("shop_products")
    .select("*", { count: "exact", head: true })
    .eq("category_id", id);
  if (count && count > 0) {
    throw new Error(`Cannot delete: ${count} products are assigned to this category`);
  }
  const { error } = await db().from("shop_categories").delete().eq("id", id);
  if (error) throw error;
}

// ─── Product Queries ──────────────────────────────────────────────────────────

export async function getShopProducts(): Promise<ShopProductListItem[]> {
  // Fetch products with category join
  const { data: products, error: pErr } = await db()
    .from("shop_products")
    .select(`
      id, name, slug, description, price_cents, images,
      is_featured, is_active, archived_at, tax_code,
      sort_order, created_at, updated_at,
      category_id,
      shop_categories!inner ( name )
    `)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (pErr) throw pErr;

  // Fetch variant aggregates per product
  const { data: variants, error: vErr } = await db()
    .from("shop_variants")
    .select("product_id, is_active, stock_quantity, reserved_quantity");
  if (vErr) throw vErr;

  // Build per-product aggregates
  const aggMap: Record<string, { count: number; stock: number; reserved: number }> = {};
  for (const v of variants ?? []) {
    if (!v.is_active) continue;
    const pid = v.product_id;
    if (!aggMap[pid]) aggMap[pid] = { count: 0, stock: 0, reserved: 0 };
    aggMap[pid].count += 1;
    aggMap[pid].stock += v.stock_quantity ?? 0;
    aggMap[pid].reserved += v.reserved_quantity ?? 0;
  }

  return (products ?? []).map((r) => {
    const agg = aggMap[r.id] ?? { count: 0, stock: 0, reserved: 0 };
    const catData = r.shop_categories as unknown as { name: string } | null;
    return {
      id: r.id,
      categoryId: r.category_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      priceCents: r.price_cents,
      images: (r.images as string[]) ?? [],
      isFeatured: r.is_featured,
      isActive: r.is_active,
      archivedAt: r.archived_at,
      taxCode: r.tax_code,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      categoryName: catData?.name ?? "—",
      variantCount: agg.count,
      totalStock: agg.stock,
      totalReserved: agg.reserved,
    };
  });
}

export async function getShopProductById(id: string): Promise<ShopProduct | null> {
  const { data, error } = await db()
    .from("shop_products")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return {
    id: data.id,
    categoryId: data.category_id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    priceCents: data.price_cents,
    images: (data.images as string[]) ?? [],
    isFeatured: data.is_featured,
    isActive: data.is_active,
    archivedAt: data.archived_at,
    taxCode: data.tax_code,
    sortOrder: data.sort_order,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getShopProductOptions(productId: string): Promise<ShopProductOption[]> {
  const { data: options, error: oErr } = await db()
    .from("shop_product_options")
    .select("id, product_id, name, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (oErr) throw oErr;

  const { data: values, error: vErr } = await db()
    .from("shop_product_option_values")
    .select("id, option_id, value, sort_order")
    .in("option_id", (options ?? []).map((o) => o.id))
    .order("sort_order", { ascending: true });
  if (vErr) throw vErr;

  return (options ?? []).map((o) => ({
    id: o.id,
    productId: o.product_id,
    name: o.name,
    sortOrder: o.sort_order,
    values: (values ?? [])
      .filter((v) => v.option_id === o.id)
      .map((v) => ({ id: v.id, optionId: v.option_id, value: v.value, sortOrder: v.sort_order })),
  }));
}

export async function getShopVariants(productId: string): Promise<ShopVariant[]> {
  const { data: variants, error: vErr } = await db()
    .from("shop_variants")
    .select("id, product_id, sku, price_cents, stock_quantity, reserved_quantity, is_active, sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: true });
  if (vErr) throw vErr;

  // Fetch option value links for these variants
  const variantIds = (variants ?? []).map((v) => v.id);
  if (variantIds.length === 0) return [];

  const { data: links, error: lErr } = await db()
    .from("shop_variant_option_values")
    .select("variant_id, option_value_id")
    .in("variant_id", variantIds);
  if (lErr) throw lErr;

  // Fetch option values to get the actual value text and option name
  const valueIds = (links ?? []).map((l) => l.option_value_id);
  if (valueIds.length === 0) {
    return (variants ?? []).map((v) => ({
      id: v.id,
      productId: v.product_id,
      sku: v.sku,
      priceCents: v.price_cents,
      stockQuantity: v.stock_quantity,
      reservedQuantity: v.reserved_quantity,
      isActive: v.is_active,
      sortOrder: v.sort_order,
      optionValues: {},
    }));
  }

  const { data: optValues, error: ovErr } = await db()
    .from("shop_product_option_values")
    .select("id, option_id, value")
    .in("id", valueIds);
  if (ovErr) throw ovErr;

  // Fetch option names
  const optionIds = [...new Set((optValues ?? []).map((ov) => ov.option_id))];
  const { data: optNames, error: onErr } = await db()
    .from("shop_product_options")
    .select("id, name")
    .in("id", optionIds);
  if (onErr) throw onErr;

  const optNameMap: Record<string, string> = {};
  for (const o of optNames ?? []) optNameMap[o.id] = o.name;

  const optValueMap: Record<string, { optionName: string; value: string }> = {};
  for (const ov of optValues ?? []) {
    optValueMap[ov.id] = { optionName: optNameMap[ov.option_id] ?? "?", value: ov.value };
  }

  // Build variant → optionValues map
  const variantOptMap: Record<string, Record<string, string>> = {};
  for (const l of links ?? []) {
    if (!variantOptMap[l.variant_id]) variantOptMap[l.variant_id] = {};
    const ov = optValueMap[l.option_value_id];
    if (ov) variantOptMap[l.variant_id][ov.optionName] = ov.value;
  }

  return (variants ?? []).map((v) => ({
    id: v.id,
    productId: v.product_id,
    sku: v.sku,
    priceCents: v.price_cents,
    stockQuantity: v.stock_quantity,
    reservedQuantity: v.reserved_quantity,
    isActive: v.is_active,
    sortOrder: v.sort_order,
    optionValues: variantOptMap[v.id] ?? {},
  }));
}

export async function getLowStockVariantCount(): Promise<number> {
  const { data, error } = await db()
    .from("shop_variants")
    .select("id, stock_quantity, reserved_quantity")
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).filter((v) => (v.stock_quantity - v.reserved_quantity) <= 3).length;
}

// ─── Order Queries ────────────────────────────────────────────────────────────

export async function getShopOrders(): Promise<ShopOrder[]> {
  const { data, error } = await db()
    .from("shop_orders")
    .select(`
      *,
      shop_shipping_methods ( name )
    `)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((r) => {
    const sm = r.shop_shipping_methods as unknown as { name: string } | null;
    return mapOrder(r, sm?.name);
  });
}

export async function getShopOrderById(id: string): Promise<ShopOrderWithItems | null> {
  const { data: order, error: oErr } = await db()
    .from("shop_orders")
    .select(`
      *,
      shop_shipping_methods ( name )
    `)
    .eq("id", id)
    .single();
  if (oErr) return null;

  const { data: items, error: iErr } = await db()
    .from("shop_order_items")
    .select("*")
    .eq("order_id", id);
  if (iErr) throw iErr;

  const sm = order.shop_shipping_methods as unknown as { name: string } | null;
  return {
    ...mapOrder(order, sm?.name),
    items: (items ?? []).map(mapOrderItem),
  };
}

function mapOrder(r: Record<string, unknown>, shippingMethodName?: string): ShopOrder {
  return {
    id: r.id as string,
    orderNumber: r.order_number as string,
    email: r.email as string,
    shippingAddress: r.shipping_address as ShopOrder["shippingAddress"],
    shippingMethodId: r.shipping_method_id as string | null,
    shippingMethodName,
    subtotalCents: r.subtotal_cents as number,
    shippingCents: r.shipping_cents as number,
    taxCents: r.tax_cents as number,
    totalCents: r.total_cents as number,
    stripePaymentIntentId: r.stripe_payment_intent_id as string,
    stripeTaxCalculationId: r.stripe_tax_calculation_id as string | null,
    status: r.status as ShopOrder["status"],
    paidAt: r.paid_at as string | null,
    shippedAt: r.shipped_at as string | null,
    trackingNumber: r.tracking_number as string | null,
    trackingUrl: r.tracking_url as string | null,
    notes: r.notes as string | null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapOrderItem(r: Record<string, unknown>): ShopOrderItem {
  return {
    id: r.id as string,
    orderId: r.order_id as string,
    productId: r.product_id as string | null,
    variantId: r.variant_id as string | null,
    productName: r.product_name as string,
    variantLabel: r.variant_label as string,
    sku: r.sku as string,
    imageUrl: r.image_url as string | null,
    unitPriceCents: r.unit_price_cents as number,
    quantity: r.quantity as number,
    optionValues: r.option_values as Record<string, string> | null,
  };
}

// ─── Shipping Queries ─────────────────────────────────────────────────────────

export async function getShopShippingMethods(): Promise<ShopShippingMethod[]> {
  const { data, error } = await db()
    .from("shop_shipping_methods")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    priceCents: r.price_cents,
    minOrderCents: r.min_order_cents,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  }));
}
