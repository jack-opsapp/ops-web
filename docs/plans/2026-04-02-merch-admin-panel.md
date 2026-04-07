# OPS Merch Store Admin Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a store management panel inside the OPS-Web admin dashboard for managing products, inventory, orders, shipping, and categories for the ops-site merch store.

**Architecture:** Server-component-first (matching existing admin patterns). Server pages fetch via `getAdminSupabase()`. Client components only for interactive elements (tables, editors, drag-drop). API routes under `/api/admin/shop/` for mutations, all gated by `requireAdmin()`. S3 for image uploads. Stripe for refunds.

**Tech Stack:** Next.js 14 (App Router), Supabase (service role), Stripe SDK, AWS S3, dnd-kit, Tailwind CSS, Lucide icons

**Design doc:** `docs/superpowers/specs/2026-04-02-ops-merch-admin-panel-design.md`

**Design system:** No `.interface-design/system.md` exists. Design tokens come from `OPS-Web/CLAUDE.md`: frosted glass surfaces `rgba(10,10,10,0.70)` + `backdrop-blur(20px)`, accent `#597794` (sparingly), Mohave body/headings, Kosugi labels/captions, 2-4px radius, borders-only depth (`border-white/[0.08]`), `EASE_SMOOTH = [0.22, 1, 0.36, 1]` easing, no spring/bounce, left-aligned text only.

**Required Skills:** `interface-design`, `frontend-design`

**Existing patterns to follow:**
- Admin page shell: `src/app/admin/companies/page.tsx` — `AdminPageHeader` + data fetch + client table
- Admin queries: `src/lib/admin/blog-queries.ts` — `const db = () => getAdminSupabase()`, typed return
- Admin API auth: `src/lib/admin/api-auth.ts` — `requireAdmin(req)` + `withAdmin(handler)` wrapper
- S3 upload: `src/app/api/documents/generate-pdf/route.ts:89-97` — `S3Client` + `PutObjectCommand`
- Stripe init: `src/app/api/stripe/subscribe/route.ts:14-16` — `new Stripe(process.env.STRIPE_SECRET_KEY!)`
- Blog editor: `src/app/admin/blog/[id]/edit/page.tsx` — server shell + client editor pattern
- dnd-kit sortable: `src/app/admin/feature-releases/_components/whats-new/category-group.tsx`
- Safe utility: `src/lib/utils/safe.ts` — wraps promises with fallback

---

## Phase 1: Foundation (Sidebar + Queries + S3 Upload)

---

### Task 1: Add Shop Navigation to Admin Sidebar

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx`

**Step 1: Add shop nav items to the NAV_ITEMS array**

Add these entries after the `"OPS LEARN"` item:

```typescript
const NAV_ITEMS = [
  // ... existing items ...
  { href: "/admin/learn", label: "OPS LEARN" },
  // ── Shop ───────────────────────────────
  { href: "/admin/shop", label: "SHOP: PRODUCTS" },
  { href: "/admin/shop/orders", label: "SHOP: ORDERS" },
  { href: "/admin/shop/shipping", label: "SHOP: SHIPPING" },
  { href: "/admin/shop/categories", label: "SHOP: CATEGORIES" },
];
```

**Step 2: Verify active state works**

The existing `SidebarNavItem` uses `pathname.startsWith(href)` for non-root items, which means `/admin/shop/products/abc` will highlight "SHOP: PRODUCTS" since it starts with `/admin/shop`. But `/admin/shop/orders` also starts with `/admin/shop`, so both "PRODUCTS" and "ORDERS" would highlight when on orders.

Fix: update the `isActive` logic in `src/app/admin/_components/sidebar-nav-item.tsx` to use exact match or a more specific prefix:

```typescript
// Current logic — already correct for most items
const isActive = pathname === href || (href !== "/admin" && pathname.startsWith(href));
```

This actually works correctly because:
- `/admin/shop/orders/123` starts with `/admin/shop/orders` → highlights ORDERS
- `/admin/shop/orders/123` starts with `/admin/shop` → also highlights PRODUCTS ← problem

Fix by making the shop root exact-match only. Update `sidebar-nav-item.tsx`:

```typescript
const isActive =
  pathname === href ||
  (href !== "/admin" && href !== "/admin/shop" && pathname.startsWith(href)) ||
  (href === "/admin/shop" && (pathname === "/admin/shop" || pathname.startsWith("/admin/shop/products")));
```

**Step 3: Commit**

```bash
git add src/app/admin/_components/sidebar.tsx src/app/admin/_components/sidebar-nav-item.tsx
git commit -m "feat(admin): add shop navigation to admin sidebar"
```

---

### Task 2: Create Shop Admin Queries Module

**Files:**
- Create: `src/lib/admin/shop-queries.ts`
- Create: `src/lib/admin/shop-types.ts`

**Step 1: Create type definitions**

Create `src/lib/admin/shop-types.ts`:

```typescript
/**
 * OPS Admin — Shop Type Definitions
 *
 * Matches the shop_* Supabase tables. All IDs are UUIDs (strings).
 */

export interface ShopCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
}

export interface ShopProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  images: string[];
  isFeatured: boolean;
  isActive: boolean;
  archivedAt: string | null;
  taxCode: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Product with joined data for the products list table */
export interface ShopProductListItem extends ShopProduct {
  categoryName: string;
  variantCount: number;
  totalStock: number;
  totalReserved: number;
}

export interface ShopProductOption {
  id: string;
  productId: string;
  name: string;
  sortOrder: number;
  values: ShopProductOptionValue[];
}

export interface ShopProductOptionValue {
  id: string;
  optionId: string;
  value: string;
  sortOrder: number;
}

export interface ShopVariant {
  id: string;
  productId: string;
  sku: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  isActive: boolean;
  sortOrder: number;
  optionValues: Record<string, string>; // e.g., { "Size": "M", "Color": "Black" }
}

export interface ShopShippingMethod {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  minOrderCents: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ShopOrder {
  id: string;
  orderNumber: string;
  email: string;
  shippingAddress: {
    firstName: string;
    lastName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  shippingMethodId: string | null;
  shippingMethodName?: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  stripePaymentIntentId: string;
  stripeTaxCalculationId: string | null;
  status: "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";
  paidAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShopOrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantLabel: string;
  sku: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  optionValues: Record<string, string> | null;
}

export interface ShopOrderWithItems extends ShopOrder {
  items: ShopOrderItem[];
}

/** Payload for creating/updating a product */
export interface ShopProductPayload {
  name: string;
  slug: string;
  description?: string;
  categoryId: string;
  priceCents: number;
  images: string[];
  isFeatured: boolean;
  isActive: boolean;
  taxCode: string;
  options: {
    id?: string; // existing option ID, omit for new
    name: string;
    values: { id?: string; value: string }[];
  }[];
  variants: {
    id?: string; // existing variant ID, omit for new
    sku: string;
    priceCents: number;
    stockQuantity: number;
    isActive: boolean;
    optionValues: Record<string, string>;
  }[];
}
```

**Step 2: Create shop queries module**

Create `src/lib/admin/shop-queries.ts`:

```typescript
/**
 * OPS Admin — Shop Supabase Queries
 *
 * SERVER ONLY. All functions use getAdminSupabase() (service role, bypasses RLS).
 */
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import type {
  ShopCategory,
  ShopProduct,
  ShopProductListItem,
  ShopProductOption,
  ShopProductOptionValue,
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

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
  const { data: links, error: lErr } = await db()
    .from("shop_variant_option_values")
    .select("variant_id, option_value_id")
    .in("variant_id", variantIds);
  if (lErr) throw lErr;

  // Fetch option values to get the actual value text and option name
  const valueIds = (links ?? []).map((l) => l.option_value_id);
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
  // Variants where available stock (stock - reserved) <= 3
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
```

**Step 3: Commit**

```bash
git add src/lib/admin/shop-types.ts src/lib/admin/shop-queries.ts
git commit -m "feat(admin): add shop types and server-side query module"
```

---

### Task 3: Create S3 Image Upload API Route

**Files:**
- Create: `src/app/api/admin/shop/upload/route.ts`

**Step 1: Create the upload route**

```typescript
/**
 * POST /api/admin/shop/upload
 *
 * Upload a product image to S3 (ops-app-files-prod/shop/ prefix).
 * Admin-only. Returns { url: string } with the public S3 URL.
 */
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";

const BUCKET = "ops-app-files-prod";
const REGION = "us-west-2";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function getS3(): S3Client {
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });
}

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Invalid file type: ${file.type}. Allowed: JPEG, PNG, WebP` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  const key = `shop/${timestamp}-${random}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  await getS3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: file.type,
    })
  );

  const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  return NextResponse.json({ url });
});
```

**Step 2: Commit**

```bash
git add src/app/api/admin/shop/upload/route.ts
git commit -m "feat(admin): add S3 image upload API route for shop"
```

---

## Phase 2: Products List Page

---

### Task 4: Create Products List Server Page

**Files:**
- Create: `src/app/admin/shop/page.tsx`

**Step 1: Create the server page**

```typescript
import { AdminPageHeader } from "../_components/admin-page-header";
import { getShopProducts, getLowStockVariantCount, getShopCategories } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { ProductsTable } from "./_components/products-table";

export default async function ShopProductsPage() {
  const [products, lowStockCount, categories] = await Promise.all([
    safe(getShopProducts(), []),
    safe(getLowStockVariantCount(), 0),
    safe(getShopCategories(), []),
  ]);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Products"
        caption={`${products.length} products · ${lowStockCount > 0 ? `${lowStockCount} low stock` : "stock healthy"}`}
      />
      <div className="p-8">
        <ProductsTable
          products={products}
          categories={categories}
          lowStockCount={lowStockCount}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/admin/shop/page.tsx
git commit -m "feat(admin): add shop products list server page"
```

---

### Task 5: Create Product Bulk Actions API Route

**Files:**
- Create: `src/app/api/admin/shop/products/bulk/route.ts`

**Step 1: Create the bulk actions route**

```typescript
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
```

**Step 2: Create the featured toggle route (single product)**

Create `src/app/api/admin/shop/products/[id]/route.ts`:

```typescript
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

  const id = req.nextUrl.pathname.split("/").pop()!;
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

  const id = req.nextUrl.pathname.split("/").pop()!;
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
```

**Step 3: Commit**

```bash
git add src/app/api/admin/shop/products/bulk/route.ts src/app/api/admin/shop/products/\[id\]/route.ts
git commit -m "feat(admin): add product CRUD and bulk action API routes"
```

---

### Task 6: Build Products Table Client Component

**Files:**
- Create: `src/app/admin/shop/_components/products-table.tsx`
- Create: `src/app/admin/shop/_components/stock-badge.tsx`

**Step 1: Create the stock badge component**

Create `src/app/admin/shop/_components/stock-badge.tsx`:

```typescript
"use client";

interface StockBadgeProps {
  available: number;
  total: number;
}

export function StockBadge({ available, total }: StockBadgeProps) {
  const color =
    available > 10
      ? "text-emerald-400"
      : available > 3
        ? "text-amber-400"
        : "text-red-400";

  return (
    <span className={`font-mohave text-[13px] ${color}`}>
      {available} <span className="text-[#6B6B6B]">/ {total}</span>
    </span>
  );
}
```

**Step 2: Create the products table**

Create `src/app/admin/shop/_components/products-table.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Archive, Star, StarOff, Eye } from "lucide-react";
import { StockBadge } from "./stock-badge";
import type { ShopProductListItem, ShopCategory } from "@/lib/admin/shop-types";

type SortKey = "name" | "categoryName" | "priceCents" | "variantCount" | "totalStock" | "createdAt";
type SortDir = "asc" | "desc";

interface ProductsTableProps {
  products: ShopProductListItem[];
  categories: { id: string; name: string }[];
  lowStockCount: number;
}

export function ProductsTable({ products, categories, lowStockCount }: ProductsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("active");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = products;

    // Status filter
    if (statusFilter === "active") list = list.filter((p) => !p.archivedAt && p.isActive);
    else if (statusFilter === "archived") list = list.filter((p) => !!p.archivedAt);

    // Category filter
    if (categoryFilter !== "ALL") list = list.filter((p) => p.categoryId === categoryFilter);

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    // Sort
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [products, search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleSelect(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  }

  async function bulkAction(action: "archive" | "activate" | "feature" | "unfeature") {
    const ids = Array.from(selected);
    if (!ids.length) return;
    await fetch("/api/admin/shop/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, productIds: ids }),
    });
    setSelected(new Set());
    router.refresh();
  }

  async function toggleFeatured(id: string, current: boolean) {
    await fetch(`/api/admin/shop/products/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFeatured: !current }),
    });
    router.refresh();
  }

  const SortHeader = ({ label, sortKeyName, width }: { label: string; sortKeyName: SortKey; width: string }) => (
    <th
      className={`${width} px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] cursor-pointer select-none hover:text-[#A0A0A0] transition-colors`}
      onClick={() => toggleSort(sortKeyName)}
    >
      {label} {sortKey === sortKeyName ? (sortDir === "asc" ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div>
      {/* Low stock alert */}
      {lowStockCount > 0 && (
        <div className="mb-4 px-4 py-2 border border-amber-500/20 rounded-sm bg-amber-500/5">
          <span className="font-mohave text-[13px] text-amber-400">
            {lowStockCount} variant{lowStockCount !== 1 ? "s" : ""} low on stock
          </span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
        >
          <option value="ALL">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <div className="flex items-center border border-white/[0.08] rounded-sm overflow-hidden">
          {(["active", "archived", "all"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 font-kosugi text-[11px] uppercase tracking-widest transition-colors ${
                statusFilter === s
                  ? "bg-white/[0.08] text-[#E5E5E5]"
                  : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Link
          href="/admin/shop/products/new"
          className="flex items-center gap-2 bg-[#597794] text-white font-kosugi text-[11px] uppercase tracking-widest px-4 py-2 rounded-sm hover:bg-[#597794]/80 transition-colors"
        >
          <Plus size={14} />
          Add Product
        </Link>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2 border border-[#597794]/30 rounded-sm bg-[#597794]/5">
          <span className="font-mohave text-[13px] text-[#E5E5E5]">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => bulkAction("feature")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#E5E5E5] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <Star size={12} /> Feature
          </button>
          <button onClick={() => bulkAction("unfeature")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <StarOff size={12} /> Unfeature
          </button>
          <button onClick={() => bulkAction("activate")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#E5E5E5] border border-white/[0.12] rounded-sm hover:bg-white/[0.04] transition-colors">
            <Eye size={12} /> Activate
          </button>
          <button onClick={() => bulkAction("archive")} className="flex items-center gap-1.5 px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-red-400 border border-red-500/20 rounded-sm hover:bg-red-500/5 transition-colors">
            <Archive size={12} /> Archive
          </button>
        </div>
      )}

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="w-[40px] px-4 py-3">
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={toggleAll}
                className="accent-[#597794]"
              />
            </th>
            <th className="w-[48px] px-2 py-3" />
            <SortHeader label="Name" sortKeyName="name" width="flex-1" />
            <SortHeader label="Category" sortKeyName="categoryName" width="w-[120px]" />
            <SortHeader label="Price" sortKeyName="priceCents" width="w-[100px]" />
            <SortHeader label="Variants" sortKeyName="variantCount" width="w-[80px]" />
            <SortHeader label="Stock" sortKeyName="totalStock" width="w-[120px]" />
            <th className="w-[80px] px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
              Featured
            </th>
            <th className="w-[100px] px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => {
            const available = p.totalStock - p.totalReserved;
            return (
              <tr
                key={p.id}
                className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    className="accent-[#597794]"
                  />
                </td>
                <td className="px-2 py-3">
                  {p.images[0] ? (
                    <img
                      src={p.images[0]}
                      alt=""
                      className="w-10 h-10 object-cover rounded-sm border border-white/[0.08]"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-sm bg-white/[0.04] border border-white/[0.08]" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/shop/products/${p.id}`}
                    className="font-mohave text-[13px] text-[#E5E5E5] hover:text-[#597794] transition-colors"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="px-2 py-0.5 bg-white/[0.05] rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                    {p.categoryName}
                  </span>
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  ${(p.priceCents / 100).toFixed(2)}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#6B6B6B]">
                  {p.variantCount}
                </td>
                <td className="px-4 py-3">
                  <StockBadge available={available} total={p.totalStock} />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleFeatured(p.id, p.isFeatured)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${
                      p.isFeatured ? "bg-[#597794]" : "bg-white/[0.08]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                        p.isFeatured ? "left-[18px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </td>
                <td className="px-4 py-3">
                  {p.archivedAt ? (
                    <span className="px-2 py-0.5 bg-white/[0.05] rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">
                      Archived
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-[#597794]/20 rounded-sm font-kosugi text-[10px] uppercase tracking-widest text-[#597794]">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No products found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/admin/shop/_components/products-table.tsx src/app/admin/shop/_components/stock-badge.tsx
git commit -m "feat(admin): add products table with filtering, sorting, bulk actions"
```

---

## Phase 3: Product Editor

---

### Task 7: Create Product Editor Server Shell Pages

**Files:**
- Create: `src/app/admin/shop/products/new/page.tsx`
- Create: `src/app/admin/shop/products/[id]/page.tsx`

**Step 1: Create new product page**

Create `src/app/admin/shop/products/new/page.tsx`:

```typescript
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { getShopCategories } from "@/lib/admin/shop-queries";
import { ProductEditor } from "../_components/product-editor";

export default async function NewProductPage() {
  const categories = await getShopCategories();

  return (
    <div>
      <AdminPageHeader title="New Product" caption="create product" />
      <div className="p-8">
        <ProductEditor product={null} categories={categories} options={[]} variants={[]} />
      </div>
    </div>
  );
}
```

**Step 2: Create edit product page**

Create `src/app/admin/shop/products/[id]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { AdminPageHeader } from "../../../../_components/admin-page-header";
import {
  getShopProductById,
  getShopCategories,
  getShopProductOptions,
  getShopVariants,
} from "@/lib/admin/shop-queries";
import { ProductEditor } from "../_components/product-editor";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: PageProps) {
  const { id } = await params;
  const [product, categories, options, variants] = await Promise.all([
    getShopProductById(id),
    getShopCategories(),
    getShopProductOptions(id),
    getShopVariants(id),
  ]);

  if (!product) notFound();

  return (
    <div>
      <AdminPageHeader title="Edit Product" caption={product.name} />
      <div className="p-8">
        <ProductEditor
          product={product}
          categories={categories}
          options={options}
          variants={variants}
        />
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/admin/shop/products/new/page.tsx src/app/admin/shop/products/\[id\]/page.tsx
git commit -m "feat(admin): add product editor server shell pages"
```

---

### Task 8: Create Product Save API Route

**Files:**
- Create: `src/app/api/admin/shop/products/route.ts`

**Step 1: Create the route**

```typescript
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
```

**Step 2: Add update logic to the existing `[id]/route.ts`**

The PUT handler in Task 5 already handles simple field updates. For full product saves with options/variants, we need to extend it. Replace the PUT handler in `src/app/api/admin/shop/products/[id]/route.ts` with a more complete version that handles the full `ShopProductPayload`:

Add a new route at `src/app/api/admin/shop/products/[id]/full/route.ts`:

```typescript
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
  // Fetch existing options
  const { data: existingOptions } = await db
    .from("shop_product_options")
    .select("id, name")
    .eq("product_id", productId);

  const existingOptIds = new Set((existingOptions ?? []).map((o) => o.id));
  const incomingOptIds = new Set(body.options.filter((o) => o.id).map((o) => o.id!));

  // Delete removed options (cascade: values deleted, variant_option_values orphaned)
  const removedOptIds = [...existingOptIds].filter((id) => !incomingOptIds.has(id));
  if (removedOptIds.length) {
    // Delete values for removed options
    await db.from("shop_product_option_values").delete().in("option_id", removedOptIds);
    await db.from("shop_product_options").delete().in("id", removedOptIds);
  }

  // Upsert options + values, build ID map
  const optionValueIdMap: Record<string, Record<string, string>> = {};

  for (let oi = 0; oi < body.options.length; oi++) {
    const opt = body.options[oi];
    let optionId: string;

    if (opt.id && existingOptIds.has(opt.id)) {
      // Update existing option
      await db.from("shop_product_options").update({ name: opt.name, sort_order: oi }).eq("id", opt.id);
      optionId = opt.id;
    } else {
      // Insert new option
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
      // Update existing variant
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
      // Insert new variant
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
```

**Step 3: Commit**

```bash
git add src/app/api/admin/shop/products/route.ts src/app/api/admin/shop/products/\[id\]/full/route.ts
git commit -m "feat(admin): add product create and full update API routes"
```

---

### Task 9: Build Image Uploader Component

**Files:**
- Create: `src/app/admin/shop/products/_components/image-uploader.tsx`

**Step 1: Create the image uploader with drag-drop upload and reorder**

```typescript
"use client";

import { useState, useCallback } from "react";
import { Upload, X, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface ImageUploaderProps {
  images: string[];
  onChange: (images: string[]) => void;
}

function SortableImage({
  url,
  index,
  onRemove,
}: {
  url: string;
  index: number;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: url,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group w-24 h-24 flex-shrink-0 rounded-sm border border-white/[0.08] overflow-hidden"
    >
      <img src={url} alt="" className="w-full h-full object-cover" />
      {index === 0 && (
        <span className="absolute top-1 left-1 px-1.5 py-0.5 bg-[#597794]/80 rounded-sm font-kosugi text-[8px] uppercase tracking-widest text-white">
          Primary
        </span>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="p-1 rounded-sm bg-white/20 hover:bg-white/30 transition-colors cursor-grab"
        >
          <GripVertical size={14} className="text-white" />
        </button>
        <button
          onClick={onRemove}
          className="p-1 rounded-sm bg-red-500/40 hover:bg-red-500/60 transition-colors"
        >
          <X size={14} className="text-white" />
        </button>
      </div>
    </div>
  );
}

export function ImageUploader({ images, onChange }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      const newUrls: string[] = [];

      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/api/admin/shop/upload", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.url) newUrls.push(data.url);
        } catch (err) {
          console.error("Upload failed:", err);
        }
      }

      onChange([...images, ...newUrls]);
      setUploading(false);
    },
    [images, onChange]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) handleUpload(e.dataTransfer.files);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = images.indexOf(active.id as string);
    const newIndex = images.indexOf(over.id as string);
    onChange(arrayMove(images, oldIndex, newIndex));
  }

  return (
    <div>
      <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Images
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-sm p-6 text-center mb-4 transition-colors ${
          dragOver ? "border-[#597794] bg-[#597794]/5" : "border-white/[0.08] bg-white/[0.02]"
        }`}
      >
        <Upload size={20} className="mx-auto mb-2 text-[#6B6B6B]" />
        <p className="font-mohave text-[13px] text-[#6B6B6B] mb-2">
          {uploading ? "Uploading..." : "Drop images here or click to browse"}
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
          className="hidden"
          id="shop-image-upload"
        />
        <label
          htmlFor="shop-image-upload"
          className="inline-block px-4 py-1.5 border border-white/[0.12] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] cursor-pointer transition-colors"
        >
          Browse
        </label>
      </div>

      {/* Image grid with reorder */}
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={images} strategy={horizontalListSortingStrategy}>
            <div className="flex gap-3 flex-wrap">
              {images.map((url, i) => (
                <SortableImage
                  key={url}
                  url={url}
                  index={i}
                  onRemove={() => onChange(images.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/admin/shop/products/_components/image-uploader.tsx
git commit -m "feat(admin): add image uploader with S3 upload and drag-drop reorder"
```

---

### Task 10: Build Option Manager Component

**Files:**
- Create: `src/app/admin/shop/products/_components/option-manager.tsx`

**Step 1: Create the option manager**

```typescript
"use client";

import { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";

export interface EditorOption {
  id?: string;
  name: string;
  values: { id?: string; value: string }[];
}

interface OptionManagerProps {
  options: EditorOption[];
  onChange: (options: EditorOption[]) => void;
}

export function OptionManager({ options, onChange }: OptionManagerProps) {
  const [addingOption, setAddingOption] = useState(false);
  const [newOptionName, setNewOptionName] = useState("");

  function addOption() {
    if (!newOptionName.trim()) return;
    onChange([...options, { name: newOptionName.trim(), values: [] }]);
    setNewOptionName("");
    setAddingOption(false);
  }

  function removeOption(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function updateOptionName(index: number, name: string) {
    const updated = [...options];
    updated[index] = { ...updated[index], name };
    onChange(updated);
  }

  function addValue(optionIndex: number, value: string) {
    if (!value.trim()) return;
    const updated = [...options];
    updated[optionIndex] = {
      ...updated[optionIndex],
      values: [...updated[optionIndex].values, { value: value.trim() }],
    };
    onChange(updated);
  }

  function removeValue(optionIndex: number, valueIndex: number) {
    const updated = [...options];
    updated[optionIndex] = {
      ...updated[optionIndex],
      values: updated[optionIndex].values.filter((_, i) => i !== valueIndex),
    };
    onChange(updated);
  }

  return (
    <div>
      <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
        Options
      </p>

      {options.map((opt, oi) => (
        <div key={oi} className="mb-4 border border-white/[0.08] rounded-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <GripVertical size={14} className="text-[#6B6B6B] cursor-grab" />
            <input
              type="text"
              value={opt.name}
              onChange={(e) => updateOptionName(oi, e.target.value)}
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              placeholder="Option name (e.g., Size)"
            />
            <button
              onClick={() => removeOption(oi)}
              className="p-1.5 rounded-sm text-[#6B6B6B] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 ml-7">
            {opt.values.map((val, vi) => (
              <span
                key={vi}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-sm font-mohave text-[12px] text-[#E5E5E5]"
              >
                {val.value}
                <button
                  onClick={() => removeValue(oi, vi)}
                  className="text-[#6B6B6B] hover:text-red-400 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <ValueInput onAdd={(v) => addValue(oi, v)} />
          </div>
        </div>
      ))}

      {addingOption ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newOptionName}
            onChange={(e) => setNewOptionName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOption()}
            placeholder="Option name..."
            autoFocus
            className="bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-1.5 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
          />
          <button
            onClick={addOption}
            className="px-3 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white"
          >
            Add
          </button>
          <button
            onClick={() => { setAddingOption(false); setNewOptionName(""); }}
            className="px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingOption(true)}
          className="flex items-center gap-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <Plus size={14} /> Add Option
        </button>
      )}
    </div>
  );
}

/** Inline value input that submits on Enter */
function ValueInput({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          onAdd(value.trim());
          setValue("");
        }
      }}
      placeholder="+ value"
      className="w-20 bg-transparent border-b border-white/[0.08] px-1 py-1 font-mohave text-[12px] text-[#6B6B6B] focus:text-[#E5E5E5] focus:border-[#597794] focus:outline-none placeholder:text-[#6B6B6B]/50"
    />
  );
}
```

**Step 2: Commit**

```bash
git add src/app/admin/shop/products/_components/option-manager.tsx
git commit -m "feat(admin): add option manager component for product editor"
```

---

### Task 11: Build Variant Matrix Component

**Files:**
- Create: `src/app/admin/shop/products/_components/variant-matrix.tsx`

**Step 1: Create the variant matrix**

```typescript
"use client";

import { useMemo } from "react";
import type { EditorOption } from "./option-manager";

export interface EditorVariant {
  id?: string;
  sku: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  isActive: boolean;
  optionValues: Record<string, string>;
}

interface VariantMatrixProps {
  options: EditorOption[];
  variants: EditorVariant[];
  productSlug: string;
  basePriceCents: number;
  onChange: (variants: EditorVariant[]) => void;
}

export function VariantMatrix({
  options,
  variants,
  productSlug,
  basePriceCents,
  onChange,
}: VariantMatrixProps) {
  // Generate all combinations from options
  const combinations = useMemo(() => {
    if (options.length === 0 || options.some((o) => o.values.length === 0)) return [];

    function cartesian(arrays: string[][]): string[][] {
      return arrays.reduce<string[][]>(
        (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
        [[]]
      );
    }

    const valueArrays = options.map((o) => o.values.map((v) => v.value));
    return cartesian(valueArrays).map((combo) => {
      const optionValues: Record<string, string> = {};
      options.forEach((o, i) => { optionValues[o.name] = combo[i]; });
      return optionValues;
    });
  }, [options]);

  // Match existing variants to combinations, create missing ones
  const mergedVariants = useMemo(() => {
    return combinations.map((combo) => {
      const key = Object.values(combo).join("-").toLowerCase();
      const existing = variants.find((v) => {
        const vKey = Object.values(v.optionValues).join("-").toLowerCase();
        return vKey === key;
      });

      if (existing) return existing;

      return {
        sku: `${productSlug}-${key}`.replace(/\s+/g, "-"),
        priceCents: basePriceCents,
        stockQuantity: 0,
        reservedQuantity: 0,
        isActive: true,
        optionValues: combo,
      };
    });
  }, [combinations, variants, productSlug, basePriceCents]);

  function updateVariant(index: number, field: keyof EditorVariant, value: unknown) {
    const updated = [...mergedVariants];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function setAllPrices(priceCents: number) {
    onChange(mergedVariants.map((v) => ({ ...v, priceCents })));
  }

  function setAllStock(stockQuantity: number) {
    onChange(mergedVariants.map((v) => ({ ...v, stockQuantity })));
  }

  if (mergedVariants.length === 0) {
    return (
      <div>
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Variants
        </p>
        <p className="font-mohave text-[13px] text-[#6B6B6B]">
          Add options above to generate variants.
        </p>
      </div>
    );
  }

  const optionNames = options.map((o) => o.name);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
          Variants ({mergedVariants.length})
        </p>
        <div className="flex items-center gap-2">
          <BulkSetButton label="Set all prices" onSet={(v) => setAllPrices(Math.round(v * 100))} />
          <BulkSetButton label="Set all stock" onSet={(v) => setAllStock(v)} isInteger />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.08]">
              {optionNames.map((name) => (
                <th
                  key={name}
                  className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
                >
                  {name}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]">
                SKU
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[100px]">
                Price
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[80px]">
                Stock
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[70px]">
                Reserved
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[80px]">
                Available
              </th>
              <th className="px-3 py-2 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] w-[60px]">
                Active
              </th>
            </tr>
          </thead>
          <tbody>
            {mergedVariants.map((v, i) => {
              const available = v.stockQuantity - v.reservedQuantity;
              const stockColor =
                available > 10 ? "text-emerald-400" : available > 3 ? "text-amber-400" : "text-red-400";

              return (
                <tr key={i} className="border-b border-white/[0.06] hover:bg-white/[0.02]">
                  {optionNames.map((name) => (
                    <td key={name} className="px-3 py-2 font-mohave text-[13px] text-[#E5E5E5]">
                      {v.optionValues[name]}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={v.sku}
                      onChange={(e) => updateVariant(i, "sku", e.target.value)}
                      className="w-full bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center">
                      <span className="font-mohave text-[12px] text-[#6B6B6B] mr-1">$</span>
                      <input
                        type="number"
                        step="0.01"
                        value={(v.priceCents / 100).toFixed(2)}
                        onChange={(e) => updateVariant(i, "priceCents", Math.round(parseFloat(e.target.value || "0") * 100))}
                        className="w-16 bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1 text-right"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={v.stockQuantity}
                      onChange={(e) => updateVariant(i, "stockQuantity", parseInt(e.target.value || "0"))}
                      className="w-14 bg-transparent border-b border-white/[0.06] font-mohave text-[12px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none py-1 text-right"
                    />
                  </td>
                  <td className="px-3 py-2 font-mohave text-[12px] text-[#6B6B6B] text-right">
                    {v.reservedQuantity}
                  </td>
                  <td className={`px-3 py-2 font-mohave text-[12px] text-right ${stockColor}`}>
                    {available}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => updateVariant(i, "isActive", !v.isActive)}
                      className={`w-8 h-4 rounded-full transition-colors relative ${
                        v.isActive ? "bg-[#597794]" : "bg-white/[0.08]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                          v.isActive ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BulkSetButton({
  label,
  onSet,
  isInteger,
}: {
  label: string;
  onSet: (value: number) => void;
  isInteger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return open ? (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step={isInteger ? "1" : "0.01"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value) {
            onSet(isInteger ? parseInt(value) : parseFloat(value));
            setOpen(false);
            setValue("");
          }
        }}
        autoFocus
        className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-sm px-2 py-1 font-mohave text-[11px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
      />
      <button
        onClick={() => {
          if (value) onSet(isInteger ? parseInt(value) : parseFloat(value));
          setOpen(false);
          setValue("");
        }}
        className="px-2 py-1 bg-[#597794] rounded-sm font-kosugi text-[9px] uppercase text-white"
      >
        Set
      </button>
    </div>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
    >
      {label}
    </button>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/admin/shop/products/_components/variant-matrix.tsx
git commit -m "feat(admin): add variant matrix with auto-generation and inline editing"
```

---

### Task 12: Build Product Editor Component

**Files:**
- Create: `src/app/admin/shop/products/_components/product-editor.tsx`

**Step 1: Create the full product editor**

```typescript
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Archive, Trash2 } from "lucide-react";
import Link from "next/link";
import { ImageUploader } from "./image-uploader";
import { OptionManager, type EditorOption } from "./option-manager";
import { VariantMatrix, type EditorVariant } from "./variant-matrix";
import type {
  ShopProduct,
  ShopCategory,
  ShopProductOption,
  ShopVariant,
} from "@/lib/admin/shop-types";

interface ProductEditorProps {
  product: ShopProduct | null;
  categories: ShopCategory[];
  options: ShopProductOption[];
  variants: ShopVariant[];
}

export function ProductEditor({ product, categories, options: initialOptions, variants: initialVariants }: ProductEditorProps) {
  const router = useRouter();
  const isNew = !product;

  // Form state
  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? (categories[0]?.id ?? ""));
  const [priceCents, setPriceCents] = useState(product?.priceCents ?? 0);
  const [taxCode, setTaxCode] = useState(product?.taxCode ?? "txcd_99999999");
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [images, setImages] = useState<string[]>(product?.images ?? []);

  const [editorOptions, setEditorOptions] = useState<EditorOption[]>(
    initialOptions.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({ id: v.id, value: v.value })),
    }))
  );

  const [editorVariants, setEditorVariants] = useState<EditorVariant[]>(
    initialVariants.map((v) => ({
      id: v.id,
      sku: v.sku,
      priceCents: v.priceCents,
      stockQuantity: v.stockQuantity,
      reservedQuantity: v.reservedQuantity,
      isActive: v.isActive,
      optionValues: v.optionValues,
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from name
  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (isNew || slug === slugify(product?.name ?? "")) {
      setSlug(slugify(value));
    }
  }, [isNew, slug, product?.name]);

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    const payload = {
      name,
      slug,
      description: description || undefined,
      categoryId,
      priceCents,
      images,
      isFeatured,
      isActive,
      taxCode,
      options: editorOptions.map((o) => ({
        id: o.id,
        name: o.name,
        values: o.values.map((v) => ({ id: v.id, value: v.value })),
      })),
      variants: editorVariants.map((v) => ({
        id: v.id,
        sku: v.sku,
        priceCents: v.priceCents,
        stockQuantity: v.stockQuantity,
        isActive: v.isActive,
        optionValues: v.optionValues,
      })),
    };

    try {
      const url = isNew
        ? "/api/admin/shop/products"
        : `/api/admin/shop/products/${product.id}/full`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }

      if (isNew && data.id) {
        router.push(`/admin/shop/products/${data.id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError("Network error");
    }

    setSaving(false);
  }

  async function handleArchive() {
    if (!product) return;
    await fetch(`/api/admin/shop/products/${product.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archivedAt: new Date().toISOString(), isActive: false }),
    });
    router.push("/admin/shop");
  }

  async function handleDelete() {
    if (!product) return;
    if (!confirm("Delete this product permanently? This cannot be undone.")) return;

    const res = await fetch(`/api/admin/shop/products/${product.id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Delete failed");
      return;
    }

    router.push("/admin/shop");
  }

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/admin/shop"
          className="flex items-center gap-2 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <ArrowLeft size={14} /> Back to Products
        </Link>
        <div className="flex items-center gap-2">
          {!isNew && (
            <>
              <button
                onClick={handleArchive}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.12] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
              >
                <Archive size={12} /> Archive
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/20 rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !name || !slug || !categoryId}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={12} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 border border-red-500/20 rounded-sm bg-red-500/5">
          <span className="font-mohave text-[13px] text-red-400">{error}</span>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Left column — Product details */}
        <div className="space-y-4">
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-1">
            Product Details
          </p>

          <div>
            <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
              Category
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Base Price ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={(priceCents / 100).toFixed(2)}
                onChange={(e) => setPriceCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tax Code
              </label>
              <input
                type="text"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => setIsFeatured(!isFeatured)}
                className={`w-8 h-4 rounded-full transition-colors relative ${
                  isFeatured ? "bg-[#597794]" : "bg-white/[0.08]"
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isFeatured ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">Featured</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => setIsActive(!isActive)}
                className={`w-8 h-4 rounded-full transition-colors relative ${
                  isActive ? "bg-[#597794]" : "bg-white/[0.08]"
                }`}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isActive ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <span className="font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B]">Active</span>
            </label>
          </div>
        </div>

        {/* Right column — Images + Options */}
        <div className="space-y-6">
          <ImageUploader images={images} onChange={setImages} />
          <OptionManager options={editorOptions} onChange={setEditorOptions} />
        </div>
      </div>

      {/* Full-width variant matrix */}
      <div className="border-t border-white/[0.08] pt-6">
        <VariantMatrix
          options={editorOptions}
          variants={editorVariants}
          productSlug={slug}
          basePriceCents={priceCents}
          onChange={setEditorVariants}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/app/admin/shop/products/_components/product-editor.tsx
git commit -m "feat(admin): add full product editor with images, options, and variants"
```

---

## Phase 4: Orders

---

### Task 13: Create Orders List Page

**Files:**
- Create: `src/app/admin/shop/orders/page.tsx`
- Create: `src/app/admin/shop/orders/_components/orders-table.tsx`
- Create: `src/app/admin/shop/orders/_components/order-status-badge.tsx`

**Step 1: Create order status badge**

Create `src/app/admin/shop/orders/_components/order-status-badge.tsx`:

```typescript
"use client";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-white/[0.05] text-[#6B6B6B]",
  paid: "bg-[#597794]/20 text-[#597794]",
  shipped: "bg-amber-500/20 text-amber-400",
  delivered: "bg-emerald-500/20 text-emerald-400",
  cancelled: "bg-red-500/10 text-[#6B6B6B] line-through",
  refunded: "bg-red-500/20 text-red-400",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-sm font-kosugi text-[10px] uppercase tracking-widest ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
    >
      {status}
    </span>
  );
}
```

**Step 2: Create orders table**

Create `src/app/admin/shop/orders/_components/orders-table.tsx`:

```typescript
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { OrderStatusBadge } from "./order-status-badge";
import type { ShopOrder } from "@/lib/admin/shop-types";

type SortKey = "orderNumber" | "createdAt" | "email" | "totalCents" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "pending" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";

interface OrdersTableProps {
  orders: ShopOrder[];
  orderItemCounts: Record<string, { count: number; firstItem: string }>;
}

export function OrdersTable({ orders, orderItemCounts }: OrdersTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    let list = orders;

    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.orderNumber.toLowerCase().includes(q) ||
          o.email.toLowerCase().includes(q)
      );
    }

    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? (av ?? "").localeCompare(bv as string ?? "") : ((av as number) ?? 0) - ((bv as number) ?? 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [orders, search, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const statuses: StatusFilter[] = ["all", "pending", "paid", "shipped", "delivered", "cancelled", "refunded"];

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search order # or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none"
        />
        <div className="flex items-center border border-white/[0.08] rounded-sm overflow-hidden">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-2 font-kosugi text-[10px] uppercase tracking-widest transition-colors ${
                statusFilter === s
                  ? "bg-white/[0.08] text-[#E5E5E5]"
                  : "text-[#6B6B6B] hover:text-[#A0A0A0]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/[0.08]">
            {([
              ["Order #", "orderNumber", "w-[120px]"],
              ["Date", "createdAt", "w-[140px]"],
              ["Customer", "email", ""],
              ["Items", "", "w-[200px]"],
              ["Total", "totalCents", "w-[100px]"],
              ["Status", "status", "w-[120px]"],
              ["Tracking", "", "w-[140px]"],
            ] as [string, SortKey | "", string][]).map(([label, key, width]) => (
              <th
                key={label}
                className={`${width} px-4 py-3 text-left font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] ${
                  key ? "cursor-pointer select-none hover:text-[#A0A0A0] transition-colors" : ""
                }`}
                onClick={() => key && toggleSort(key as SortKey)}
              >
                {label} {key && sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((o) => {
            const itemInfo = orderItemCounts[o.id];
            return (
              <tr key={o.id} className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/shop/orders/${o.id}`}
                    className="font-mohave text-[13px] text-[#597794] hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  {new Date(o.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">{o.email}</td>
                <td className="px-4 py-3 font-mohave text-[12px] text-[#6B6B6B] truncate max-w-[200px]">
                  {itemInfo ? `${itemInfo.count} item${itemInfo.count !== 1 ? "s" : ""} — ${itemInfo.firstItem}` : "—"}
                </td>
                <td className="px-4 py-3 font-mohave text-[13px] text-[#E5E5E5]">
                  ${(o.totalCents / 100).toFixed(2)}
                </td>
                <td className="px-4 py-3">
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className="px-4 py-3 font-mohave text-[12px]">
                  {o.trackingUrl ? (
                    <a
                      href={o.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#597794] hover:underline"
                    >
                      {o.trackingNumber}
                    </a>
                  ) : o.trackingNumber ? (
                    <span className="text-[#6B6B6B]">{o.trackingNumber}</span>
                  ) : (
                    <span className="text-[#6B6B6B]/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center font-mohave text-[13px] text-[#6B6B6B]">
                No orders found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

**Step 3: Create the server page**

Create `src/app/admin/shop/orders/page.tsx`:

```typescript
import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopOrders } from "@/lib/admin/shop-queries";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import { safe } from "@/lib/utils/safe";
import { OrdersTable } from "./_components/orders-table";

async function getOrderItemCounts(): Promise<Record<string, { count: number; firstItem: string }>> {
  const db = getAdminSupabase();
  const { data } = await db
    .from("shop_order_items")
    .select("order_id, product_name, quantity");

  const map: Record<string, { count: number; firstItem: string }> = {};
  for (const item of data ?? []) {
    if (!map[item.order_id]) {
      map[item.order_id] = { count: 0, firstItem: item.product_name };
    }
    map[item.order_id].count += item.quantity;
  }
  return map;
}

export default async function ShopOrdersPage() {
  const [orders, itemCounts] = await Promise.all([
    safe(getShopOrders(), []),
    safe(getOrderItemCounts(), {}),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const o of orders) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  }

  const caption = [
    `${orders.length} total`,
    statusCounts.paid ? `${statusCounts.paid} awaiting shipment` : null,
    statusCounts.shipped ? `${statusCounts.shipped} in transit` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <AdminPageHeader title="Shop: Orders" caption={caption} />
      <div className="p-8">
        <OrdersTable orders={orders} orderItemCounts={itemCounts} />
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/app/admin/shop/orders/page.tsx src/app/admin/shop/orders/_components/orders-table.tsx src/app/admin/shop/orders/_components/order-status-badge.tsx
git commit -m "feat(admin): add orders list page with filtering, sorting, and status badges"
```

---

### Task 14: Create Order Action API Routes

**Files:**
- Create: `src/app/api/admin/shop/orders/[id]/ship/route.ts`
- Create: `src/app/api/admin/shop/orders/[id]/deliver/route.ts`
- Create: `src/app/api/admin/shop/orders/[id]/cancel/route.ts`
- Create: `src/app/api/admin/shop/orders/[id]/refund/route.ts`
- Create: `src/app/api/admin/shop/orders/[id]/notes/route.ts`

**Step 1: Create all five route files**

`src/app/api/admin/shop/orders/[id]/ship/route.ts`:

```typescript
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
```

`src/app/api/admin/shop/orders/[id]/deliver/route.ts`:

```typescript
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
```

`src/app/api/admin/shop/orders/[id]/cancel/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const db = getAdminSupabase();

  const { data: order } = await db
    .from("shop_orders")
    .select("status, stripe_payment_intent_id")
    .eq("id", orderId)
    .single();

  if (!order || !["pending", "paid"].includes(order.status)) {
    return NextResponse.json({ error: `Cannot cancel: order status is "${order?.status}"` }, { status: 409 });
  }

  // Release inventory reservations
  const { data: reservations } = await db
    .from("shop_inventory_reservations")
    .select("variant_id, quantity")
    .eq("stripe_payment_intent_id", order.stripe_payment_intent_id);

  for (const res of reservations ?? []) {
    await db.rpc("decrement_reserved", { p_variant_id: res.variant_id, p_quantity: res.quantity }).catch(() => {
      // Fallback: direct update
      db.from("shop_variants")
        .update({ reserved_quantity: 0 }) // Will be corrected — just ensure non-negative
        .eq("id", res.variant_id);
    });
  }

  // Delete reservations
  await db
    .from("shop_inventory_reservations")
    .delete()
    .eq("stripe_payment_intent_id", order.stripe_payment_intent_id);

  // If paid, issue refund
  if (order.status === "paid") {
    const stripe = getStripe();
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });
  }

  const { error } = await db.from("shop_orders").update({ status: "cancelled" }).eq("id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
```

`src/app/api/admin/shop/orders/[id]/refund/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";
import Stripe from "stripe";

function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);

  const segments = req.nextUrl.pathname.split("/");
  const orderId = segments[segments.indexOf("orders") + 1];
  const db = getAdminSupabase();

  const { data: order } = await db
    .from("shop_orders")
    .select("status, stripe_payment_intent_id, total_cents")
    .eq("id", orderId)
    .single();

  if (!order || !["paid", "shipped"].includes(order.status)) {
    return NextResponse.json({ error: `Cannot refund: order status is "${order?.status}"` }, { status: 409 });
  }

  const stripe = getStripe();
  await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });

  const { error } = await db.from("shop_orders").update({ status: "refunded" }).eq("id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
```

`src/app/api/admin/shop/orders/[id]/notes/route.ts`:

```typescript
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
```

**Step 2: Commit**

```bash
git add src/app/api/admin/shop/orders/
git commit -m "feat(admin): add order action API routes (ship, deliver, cancel, refund, notes)"
```

---

### Task 15: Build Order Detail Page

**Files:**
- Create: `src/app/admin/shop/orders/[id]/page.tsx`
- Create: `src/app/admin/shop/orders/_components/order-detail.tsx`

**Step 1: Create the server page**

Create `src/app/admin/shop/orders/[id]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import { AdminPageHeader } from "../../../_components/admin-page-header";
import { getShopOrderById } from "@/lib/admin/shop-queries";
import { OrderDetail } from "../_components/order-detail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const order = await getShopOrderById(id);
  if (!order) notFound();

  return (
    <div>
      <AdminPageHeader title={order.orderNumber} caption={order.status} />
      <div className="p-8">
        <OrderDetail order={order} />
      </div>
    </div>
  );
}
```

**Step 2: Create the order detail client component**

Create `src/app/admin/shop/orders/_components/order-detail.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Truck, CheckCircle, XCircle, RotateCcw, ExternalLink } from "lucide-react";
import { OrderStatusBadge } from "./order-status-badge";
import type { ShopOrderWithItems } from "@/lib/admin/shop-types";

interface OrderDetailProps {
  order: ShopOrderWithItems;
}

export function OrderDetail({ order }: OrderDetailProps) {
  const router = useRouter();
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");
  const [notes, setNotes] = useState(order.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [showShipForm, setShowShipForm] = useState(false);

  async function action(endpoint: string, body?: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/admin/shop/orders/${order.id}/${endpoint}`, {
      method: endpoint === "notes" ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    setSaving(false);
    router.refresh();
  }

  async function handleShip() {
    if (!trackingNumber) return;
    await action("ship", { trackingNumber, trackingUrl });
    setShowShipForm(false);
  }

  async function handleRefund() {
    if (!confirm(`Refund $${(order.totalCents / 100).toFixed(2)} to ${order.email}? This will call Stripe to reverse the charge.`)) return;
    await action("refund");
  }

  async function handleCancel() {
    if (!confirm(`Cancel order ${order.orderNumber}? This will release reserved inventory.${order.status === "paid" ? " A refund will also be issued." : ""}`)) return;
    await action("cancel");
  }

  // Build timeline from timestamps
  const timeline: { time: string; label: string }[] = [];
  timeline.push({ time: order.createdAt, label: "Order placed" });
  if (order.paidAt) timeline.push({ time: order.paidAt, label: "Payment confirmed" });
  if (order.shippedAt) timeline.push({ time: order.shippedAt, label: `Shipped — ${order.trackingNumber ?? ""}` });
  if (order.status === "delivered") timeline.push({ time: order.updatedAt, label: "Delivered" });
  if (order.status === "cancelled") timeline.push({ time: order.updatedAt, label: "Cancelled" });
  if (order.status === "refunded") timeline.push({ time: order.updatedAt, label: "Refund issued" });

  const addr = order.shippingAddress;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/admin/shop/orders"
          className="flex items-center gap-2 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors"
        >
          <ArrowLeft size={14} /> Back to Orders
        </Link>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-8 mb-8">
        {/* Left — Items + Totals */}
        <div>
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            Items
          </p>
          <div className="space-y-3 mb-6">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 border border-white/[0.06] rounded-sm p-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="w-12 h-12 rounded-sm object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-sm bg-white/[0.04]" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-mohave text-[13px] text-[#E5E5E5]">{item.productName}</p>
                  <p className="font-mohave text-[11px] text-[#6B6B6B]">{item.variantLabel} · {item.sku}</p>
                </div>
                <p className="font-mohave text-[12px] text-[#6B6B6B]">×{item.quantity}</p>
                <p className="font-mohave text-[13px] text-[#E5E5E5]">
                  ${((item.unitPriceCents * item.quantity) / 100).toFixed(2)}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-1 border-t border-white/[0.08] pt-4">
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Subtotal</span>
              <span className="text-[#E5E5E5]">${(order.subtotalCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Shipping{order.shippingMethodName ? ` (${order.shippingMethodName})` : ""}</span>
              <span className="text-[#E5E5E5]">${(order.shippingCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[13px]">
              <span className="text-[#6B6B6B]">Tax</span>
              <span className="text-[#E5E5E5]">${(order.taxCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-mohave text-[15px] font-semibold border-t border-white/[0.08] pt-2 mt-2">
              <span className="text-[#E5E5E5]">Total</span>
              <span className="text-[#E5E5E5]">${(order.totalCents / 100).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Right — Customer + Payment */}
        <div className="space-y-6">
          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Customer
            </p>
            <p className="font-mohave text-[13px] text-[#E5E5E5]">{order.email}</p>
          </div>

          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Shipping Address
            </p>
            <div className="font-mohave text-[13px] text-[#E5E5E5] space-y-0.5">
              <p>{addr.firstName} {addr.lastName}</p>
              <p>{addr.line1}</p>
              {addr.line2 && <p>{addr.line2}</p>}
              <p>{addr.city}, {addr.state} {addr.zip}</p>
              <p>{addr.country}</p>
            </div>
          </div>

          <div>
            <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
              Payment
            </p>
            <a
              href={`https://dashboard.stripe.com/payments/${order.stripePaymentIntentId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mohave text-[13px] text-[#597794] hover:underline"
            >
              View in Stripe <ExternalLink size={12} />
            </a>
            {order.paidAt && (
              <p className="font-mohave text-[12px] text-[#6B6B6B] mt-1">
                Paid {new Date(order.paidAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-white/[0.08] pt-6 mb-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Actions
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {order.status === "paid" && (
            <button
              onClick={() => setShowShipForm(true)}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
            >
              <Truck size={12} /> Mark Shipped
            </button>
          )}
          {order.status === "shipped" && (
            <button
              onClick={() => action("deliver")}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-emerald-600/80 transition-colors disabled:opacity-50"
            >
              <CheckCircle size={12} /> Mark Delivered
            </button>
          )}
          {["paid", "shipped"].includes(order.status) && (
            <button
              onClick={handleRefund}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-red-500/20 rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              <RotateCcw size={12} /> Refund
            </button>
          )}
          {["pending", "paid"].includes(order.status) && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.12] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] hover:text-red-400 hover:border-red-500/20 transition-colors disabled:opacity-50"
            >
              <XCircle size={12} /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Ship form */}
      {showShipForm && (
        <div className="border border-[#597794]/30 rounded-sm p-4 mb-6 bg-[#597794]/5">
          <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
            Shipping Details
          </p>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tracking Number *
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-kosugi text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                Tracking URL
              </label>
              <input
                type="url"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#597794] focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleShip}
              disabled={!trackingNumber || saving}
              className="px-4 py-1.5 bg-[#597794] rounded-sm font-kosugi text-[11px] uppercase tracking-widest text-white hover:bg-[#597794]/80 transition-colors disabled:opacity-50"
            >
              Confirm Ship
            </button>
            <button
              onClick={() => setShowShipForm(false)}
              className="px-3 py-1.5 font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="border-t border-white/[0.08] pt-6 mb-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-2">
          Internal Notes
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => action("notes", { notes })}
          rows={3}
          placeholder="Add internal notes..."
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:border-[#597794] focus:outline-none resize-none"
        />
      </div>

      {/* Timeline */}
      <div className="border-t border-white/[0.08] pt-6">
        <p className="font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-3">
          Timeline
        </p>
        <div className="space-y-3">
          {timeline.map((t, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#597794] mt-1.5 flex-shrink-0" />
              <div>
                <p className="font-mohave text-[12px] text-[#6B6B6B]">
                  {new Date(t.time).toLocaleString()}
                </p>
                <p className="font-mohave text-[13px] text-[#E5E5E5]">{t.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/admin/shop/orders/\[id\]/page.tsx src/app/admin/shop/orders/_components/order-detail.tsx
git commit -m "feat(admin): add order detail page with actions, timeline, and notes"
```

---

## Phase 5: Shipping & Categories

---

### Task 16: Build Shipping Methods Page

**Files:**
- Create: `src/app/admin/shop/shipping/page.tsx`
- Create: `src/app/admin/shop/shipping/_components/shipping-table.tsx`
- Create: `src/app/api/admin/shop/shipping/route.ts`
- Create: `src/app/api/admin/shop/shipping/[id]/route.ts`

**Step 1: Create shipping API routes**

`src/app/api/admin/shop/shipping/route.ts`:

```typescript
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
```

`src/app/api/admin/shop/shipping/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { getAdminSupabase } from "@/lib/supabase/admin-client";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const id = req.nextUrl.pathname.split("/").pop()!;
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
  const id = req.nextUrl.pathname.split("/").pop()!;
  const db = getAdminSupabase();

  const { count } = await db.from("shop_orders").select("*", { count: "exact", head: true }).eq("shipping_method_id", id);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete: ${count} orders use this shipping method` }, { status: 409 });
  }

  const { error } = await db.from("shop_shipping_methods").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
});
```

**Step 2: Create the shipping table client component**

Create `src/app/admin/shop/shipping/_components/shipping-table.tsx`. This is an inline-editable table with toggle and add/delete. Build it following the same styling patterns as the products table (Mohave 13px text, Kosugi 11px headers, white/[0.08] borders, accent toggles). Include:
- Inline edit on click for name, description, price, and free threshold fields
- Active toggle (same pattern as featured toggle in products table)
- Delete button (ghost, danger color)
- "Add Shipping Method" inline form at the bottom
- `router.refresh()` after each mutation

**Step 3: Create the server page**

Create `src/app/admin/shop/shipping/page.tsx`:

```typescript
import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopShippingMethods } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { ShippingTable } from "./_components/shipping-table";

export default async function ShopShippingPage() {
  const methods = await safe(getShopShippingMethods(), []);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Shipping"
        caption={`${methods.length} method${methods.length !== 1 ? "s" : ""}`}
      />
      <div className="p-8">
        <ShippingTable methods={methods} />
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/app/admin/shop/shipping/ src/app/api/admin/shop/shipping/
git commit -m "feat(admin): add shipping methods page with inline editing"
```

---

### Task 17: Build Categories Page

**Files:**
- Create: `src/app/admin/shop/categories/page.tsx`
- Create: `src/app/admin/shop/categories/_components/categories-list.tsx`
- Create: `src/app/api/admin/shop/categories/route.ts`
- Create: `src/app/api/admin/shop/categories/[id]/route.ts`

**Step 1: Create category API routes**

`src/app/api/admin/shop/categories/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { createShopCategory, reorderShopCategories } from "@/lib/admin/shop-queries";

export const POST = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { name, slug } = await req.json();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  try {
    const category = await createShopCategory(name, slug);
    return NextResponse.json(category);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const { orderedIds } = await req.json();

  try {
    await reorderShopCategories(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});
```

`src/app/api/admin/shop/categories/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, withAdmin } from "@/lib/admin/api-auth";
import { updateShopCategory, deleteShopCategory } from "@/lib/admin/shop-queries";

export const PUT = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const id = req.nextUrl.pathname.split("/").pop()!;
  const body = await req.json();

  try {
    await updateShopCategory(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
});

export const DELETE = withAdmin(async (req: NextRequest) => {
  await requireAdmin(req);
  const id = req.nextUrl.pathname.split("/").pop()!;

  try {
    await deleteShopCategory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
});
```

**Step 2: Create the categories list client component**

Create `src/app/admin/shop/categories/_components/categories-list.tsx`. Build a dnd-kit sortable list following the pattern from `src/app/admin/feature-releases/_components/whats-new/category-group.tsx`:
- `DndContext` + `SortableContext` with `verticalListSortingStrategy`
- Each row: drag handle (`GripVertical`), name (inline editable), slug (inline editable, auto-gen from name), edit/delete buttons
- "Add Category" form at the bottom
- On drag end: call `PUT /api/admin/shop/categories` with `{ orderedIds: [...] }`
- `router.refresh()` after mutations

**Step 3: Create the server page**

Create `src/app/admin/shop/categories/page.tsx`:

```typescript
import { AdminPageHeader } from "../../_components/admin-page-header";
import { getShopCategories } from "@/lib/admin/shop-queries";
import { safe } from "@/lib/utils/safe";
import { CategoriesList } from "./_components/categories-list";

export default async function ShopCategoriesPage() {
  const categories = await safe(getShopCategories(), []);

  return (
    <div>
      <AdminPageHeader
        title="Shop: Categories"
        caption={`${categories.length} categor${categories.length !== 1 ? "ies" : "y"}`}
      />
      <div className="p-8">
        <CategoriesList categories={categories} />
      </div>
    </div>
  );
}
```

**Step 4: Commit**

```bash
git add src/app/admin/shop/categories/ src/app/api/admin/shop/categories/
git commit -m "feat(admin): add categories page with drag-and-drop reorder"
```

---

## Phase 6: Polish & Verify

---

### Task 18: Add Next.js Image Config for S3

**Files:**
- Modify: `next.config.ts` (or `next.config.mjs`)

**Step 1: Add S3 domain to remotePatterns**

Find the existing `images.remotePatterns` array and add:

```typescript
{
  protocol: "https",
  hostname: "ops-app-files-prod.s3.us-west-2.amazonaws.com",
  pathname: "/shop/**",
}
```

If using `<img>` tags instead of `<Image>`, this isn't strictly needed but is good practice for when you switch. Check the existing config to see which approach is used.

**Step 2: Commit**

```bash
git add next.config.*
git commit -m "chore: add S3 shop image domain to Next.js remote patterns"
```

---

### Task 19: Verify All Routes Compile and Load

**Step 1: Run the dev server**

```bash
cd /Users/jacksonsweet/Projects/OPS/OPS-Web && npm run dev
```

**Step 2: Verify each route loads**

Navigate to each of these routes and confirm no errors:
- `/admin/shop` — Products list loads
- `/admin/shop/products/new` — New product editor loads
- `/admin/shop/orders` — Orders list loads
- `/admin/shop/shipping` — Shipping methods loads
- `/admin/shop/categories` — Categories loads

**Step 3: Verify sidebar nav highlights correctly**

- On `/admin/shop` → "SHOP: PRODUCTS" is active
- On `/admin/shop/orders` → "SHOP: ORDERS" is active
- On `/admin/shop/shipping` → "SHOP: SHIPPING" is active
- On `/admin/shop/categories` → "SHOP: CATEGORIES" is active

**Step 4: Fix any compilation errors and commit**

```bash
git add -A && git commit -m "fix: resolve compilation errors in shop admin panel"
```

---

### Task 20: End-to-End Smoke Test

**Step 1: Test product creation flow**
- Navigate to `/admin/shop/products/new`
- Fill in name, description, category, price
- Upload an image (verify S3 upload works)
- Add options (e.g., Size with S, M, L)
- Verify variant matrix auto-generates
- Set variant prices and stock
- Click Save
- Verify redirect to edit page with data loaded

**Step 2: Test product list**
- Verify the new product appears in `/admin/shop`
- Toggle featured
- Use bulk select + archive
- Verify stock badge colors

**Step 3: Test order detail (if orders exist)**
- Navigate to an order
- Verify items, totals, address, Stripe link
- Test notes auto-save

**Step 4: Test shipping methods**
- Add a new shipping method
- Edit name inline
- Toggle active
- Delete

**Step 5: Test categories**
- Add a category
- Drag to reorder
- Delete (verify protection if products exist)

**Step 6: Final commit**

```bash
git add -A && git commit -m "feat(admin): complete OPS merch store admin panel — products, orders, shipping, categories"
```
