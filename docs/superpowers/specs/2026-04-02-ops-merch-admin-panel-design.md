# OPS Merch Store Admin Panel — System Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Platform:** OPS-Web (Next.js 14, TanStack Query, Supabase, Tailwind)
**Operator:** Single user (Jackson). Command-center consolidation play — no multi-user collaboration concerns.

---

## Overview

A store management panel inside the OPS-Web admin dashboard for managing the merch store that lives on ops-site. Server-component-first (matching existing admin patterns), with client components only for interactive elements (inline editing, drag-drop, image uploads, variant matrix). All data via `getAdminSupabase()` service role.

**Design philosophy:** Bloomberg Terminal density. Every row is actionable. Inline editing beats modals. Status badges at a glance. Keyboard shortcuts for repeat operations. Zero decorative elements.

---

## 1. Routing & Navigation

### 1.1 Routes

| Route | Purpose | Component Type |
|-------|---------|---------------|
| `/admin/shop` | Products list + inventory (default landing) | Server + Client table |
| `/admin/shop/products/new` | New product editor | Client component |
| `/admin/shop/products/[id]` | Edit product editor | Server shell + Client editor |
| `/admin/shop/orders` | Orders list | Server + Client table |
| `/admin/shop/orders/[id]` | Order detail + fulfillment | Server shell + Client detail |
| `/admin/shop/shipping` | Shipping methods CRUD | Server + Client inline edit |
| `/admin/shop/categories` | Categories CRUD + reorder | Server + Client drag-drop |

### 1.2 Sidebar Navigation

Add a "SHOP" group to the admin sidebar (`src/app/admin/_components/sidebar.tsx`). The sidebar currently uses a flat list — add a section divider + group:

```typescript
// New entries in NAV_ITEMS array
{ href: "/admin/shop", label: "SHOP: PRODUCTS" },
{ href: "/admin/shop/orders", label: "SHOP: ORDERS" },
{ href: "/admin/shop/shipping", label: "SHOP: SHIPPING" },
{ href: "/admin/shop/categories", label: "SHOP: CATEGORIES" },
```

Active state: `SidebarNavItem` already handles `pathname.startsWith(href)`, so `/admin/shop/products/abc` will highlight "SHOP: PRODUCTS".

### 1.3 Layout

`/admin/shop/layout.tsx` — no special layout needed beyond the existing admin layout (`/admin/layout.tsx`). Auth gating is inherited from the parent admin layout (Firebase JWT + `isAdminEmail()` check).

---

## 2. Products List (`/admin/shop`)

The default shop landing page. Dense table showing all products with inline stock visibility.

### 2.1 Server Component Shell

```
page.tsx (server):
  - Fetch all products via getAdminSupabase()
  - Join: shop_products → shop_categories (name)
  - Join: shop_products → shop_variants (count, sum stock_quantity, sum reserved_quantity)
  - Pass to <ProductsTable /> client component
```

### 2.2 Table Columns

| Column | Width | Content | Sortable |
|--------|-------|---------|----------|
| Checkbox | 40px | Bulk select | No |
| Image | 48px | First image from `images` JSONB, 40x40 rounded-sm thumbnail | No |
| Name | flex | Product name, clickable → `/admin/shop/products/[id]` | Yes |
| Category | 120px | Category name badge | Yes |
| Price | 100px | `price_cents` formatted as `$XX.XX` | Yes |
| Variants | 80px | Count of active variants | Yes |
| Stock | 120px | Total available (stock - reserved) across all variants. Color-coded: green `text-emerald-400` (>10), yellow `text-amber-400` (3-10), red `text-red-400` (<=3). Show `{available} / {total}` where total = stock_quantity sum | Yes |
| Featured | 80px | Toggle switch — inline save via server action or API route | No |
| Status | 100px | "Active" (accent badge) or "Archived" (muted badge) | Yes |

### 2.3 Toolbar

- **Search:** Text input filtering by product name (client-side filter)
- **Category filter:** Dropdown populated from `shop_categories`
- **Status filter:** All / Active / Archived
- **"Add Product" button:** Top-right, navigates to `/admin/shop/products/new`

### 2.4 Bulk Actions

When one or more checkboxes are selected, a sticky action bar appears above the table:

- **Archive** — set `archived_at = now()` on selected products
- **Activate** — set `archived_at = null, is_active = true`
- **Feature** — set `is_featured = true`
- **Unfeature** — set `is_featured = false`

After bulk action: `router.refresh()` to re-fetch server data.

### 2.5 Low Stock Alert Banner

If any variant has `stock_quantity - reserved_quantity <= 3`, show a compact alert banner above the table:

```
⚠ {count} variants low on stock
```

Muted amber text, clickable — scrolls to / highlights the affected rows.

### 2.6 Data Query

```sql
SELECT
  p.id, p.name, p.slug, p.price_cents, p.images, p.is_featured,
  p.is_active, p.archived_at, p.sort_order, p.created_at,
  c.name AS category_name,
  COUNT(v.id) FILTER (WHERE v.is_active) AS variant_count,
  COALESCE(SUM(v.stock_quantity) FILTER (WHERE v.is_active), 0) AS total_stock,
  COALESCE(SUM(v.reserved_quantity) FILTER (WHERE v.is_active), 0) AS total_reserved
FROM shop_products p
LEFT JOIN shop_categories c ON p.category_id = c.id
LEFT JOIN shop_variants v ON v.product_id = p.id
GROUP BY p.id, c.name
ORDER BY p.sort_order, p.created_at DESC
```

---

## 3. Product Editor (`/admin/shop/products/[id]` and `/admin/shop/products/new`)

Full-page editor for creating and editing products. This is the most complex page — a client component for interactivity, wrapped in a server component shell that fetches initial data.

### 3.1 Server Shell (edit mode only)

```
page.tsx (server):
  - Fetch product by ID with all relations:
    - shop_products row
    - shop_categories (for dropdown)
    - shop_product_options + shop_product_option_values (for option management)
    - shop_variants + shop_variant_option_values (for variant matrix)
  - Pass to <ProductEditor /> client component
```

For `/new`: server component passes `product={null}` and category list only.

### 3.2 Layout — Two Column

```
┌─────────────────────────────────────────────────────┐
│ ← Back to Products          [Save] [Archive] [Delete]│
├──────────────────────────┬──────────────────────────┤
│                          │                          │
│   PRODUCT DETAILS        │   IMAGES                 │
│   Name                   │   Drag-drop upload area   │
│   Slug (auto-gen)        │   Image grid with reorder │
│   Description            │   (drag-drop reorder)    │
│   Category (dropdown)    │                          │
│   Base Price             │   OPTIONS                │
│   Tax Code               │   + Add Option           │
│   Featured toggle        │   [Size] S, M, L, XL     │
│   Active toggle          │   [Color] Black, White    │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│                                                     │
│   VARIANT MATRIX                                    │
│   Auto-generated from option combinations           │
│   ┌──────┬───────┬──────┬───────┬────────┬────────┐│
│   │ SKU  │ Size  │Color │ Price │ Stock  │ Active ││
│   │ edit │       │      │ edit  │ edit   │ toggle ││
│   └──────┴───────┴──────┴───────┴────────┴────────┘│
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 3.3 Product Details Fields

| Field | Type | Notes |
|-------|------|-------|
| Name | Text input | Required. On change, auto-generates slug (kebab-case, debounced) |
| Slug | Text input | Auto-generated from name, editable. Validated unique on save. |
| Description | Textarea | Optional. Short product description. |
| Category | Select dropdown | Populated from `shop_categories`. Required. |
| Base Price | Number input | In dollars (converted to cents on save). Required. |
| Tax Code | Text input | Default: `txcd_99999999`. Stripe Tax product code. |
| Featured | Toggle | `is_featured` flag |
| Active | Toggle | `is_active` flag |

### 3.4 Image Management

**Upload area:**
- Drag-and-drop zone OR click-to-browse
- Accepts: JPEG, PNG, WebP. Max 10MB per image.
- Uploads to S3 via new API route `POST /api/admin/shop/upload`
- S3 key: `shop/{timestamp}-{random}.{ext}`
- Public URL: `https://ops-app-files-prod.s3.us-west-2.amazonaws.com/shop/{filename}`

**Image grid:**
- Thumbnails of uploaded images
- Drag-and-drop reorder (first image = primary, shown in store hero and grid)
- Delete button (× overlay on hover) — removes from `images` JSONB array
- No variant-specific images (all images belong to the product)

**Upload API route (`/api/admin/shop/upload`):**
```typescript
// Pattern from existing generate-pdf/route.ts
// Uses S3Client + PutObjectCommand
// Auth: requireAdmin(req)
// Returns: { url: string } (public S3 URL)
```

### 3.5 Option Management

Options define the axes of the variant matrix (e.g., Size, Color).

**UI:**
- List of existing options, each showing: option name + value pills
- "+ Add Option" button — inline form: option name input + value input (comma-separated or enter-to-add)
- Each option: editable name, add/remove values, delete entire option
- Reorder options via drag handles

**Data flow:**
- Options are persisted to `shop_product_options` table
- Values are persisted to `shop_product_option_values` table
- Changing options triggers variant matrix regeneration

### 3.6 Variant Matrix

Auto-generated from the Cartesian product of all option values. E.g., Size (S, M, L) × Color (Black, White) = 6 variants.

**Table columns:**

| Column | Editable | Notes |
|--------|----------|-------|
| Option values | No | One column per option, showing the value (e.g., "M", "Black") |
| SKU | Yes (inline) | Auto-generated as `{slug}-{value1}-{value2}`, editable |
| Price | Yes (inline) | Defaults to product base price, override per variant. Dollar input → cents. |
| Stock | Yes (inline) | Integer. Physical inventory count. |
| Reserved | No | Read-only. From `reserved_quantity`. Shown as muted text. |
| Available | No | Computed: `stock - reserved`. Color-coded like products table. |
| Active | Yes (toggle) | Deactivate variants that shouldn't be purchasable |

**Behavior:**
- When options change, generate missing variants (don't delete existing ones — they may have order history)
- Variants with `0` stock that are inactive can be deleted manually
- Bulk set: "Set all prices to $XX" and "Set all stock to XX" quick actions above the matrix

### 3.7 Save Flow

Single "Save" button saves everything atomically:

1. Upsert `shop_products` row (name, slug, description, category_id, price_cents, images, is_featured, is_active, tax_code)
2. Sync `shop_product_options` + `shop_product_option_values` (insert new, delete removed)
3. Sync `shop_variants` + `shop_variant_option_values` (insert new variants, update existing prices/stock/SKU)

All in a single API route: `POST /api/admin/shop/products` (create) or `PUT /api/admin/shop/products/[id]` (update).

### 3.8 Archive & Delete

- **Archive:** Sets `archived_at = now()`. Product hidden from store but preserved with order history.
- **Delete:** Hard delete product + options + values + variants. Only allowed if product has zero orders. Confirmation dialog required.

---

## 4. Orders List (`/admin/shop/orders`)

### 4.1 Server Component Shell

```
page.tsx (server):
  - Fetch orders via getAdminSupabase()
  - Join: shop_orders → shop_order_items (item count, first item name for summary)
  - Join: shop_orders → shop_shipping_methods (method name)
  - Order by created_at DESC
  - Pass to <OrdersTable /> client component
```

### 4.2 Table Columns

| Column | Width | Content | Sortable |
|--------|-------|---------|----------|
| Order # | 120px | `order_number` (e.g., "OPS-2847"), clickable → detail | Yes |
| Date | 140px | `created_at`, formatted as "Mar 28, 2026 2:14 PM" | Yes |
| Customer | flex | `email` | Yes |
| Items | 200px | Summary: "{count} items — {first_item_name}..." truncated | No |
| Total | 100px | `total_cents` formatted as `$XX.XX` | Yes |
| Status | 120px | Badge with color: pending (muted), paid (accent), shipped (amber), delivered (emerald), cancelled (red/muted), refunded (red) | Yes |
| Tracking | 140px | Tracking number as link if present, "—" if not | No |

### 4.3 Toolbar

- **Search:** Text input filtering by `order_number` or `email` (server-side search via query param, or client-side if order count is small)
- **Status filter:** All / Pending / Paid / Shipped / Delivered / Cancelled / Refunded (pill buttons)
- **Date range:** Optional, probably overkill for initial launch. Add if needed.

### 4.4 Status Badges

| Status | Background | Text |
|--------|-----------|------|
| pending | `bg-white/[0.05]` | `text-[#6B6B6B]` |
| paid | `bg-[#6F94B0]/20` | `text-[#6F94B0]` |
| shipped | `bg-amber-500/20` | `text-amber-400` |
| delivered | `bg-emerald-500/20` | `text-emerald-400` |
| cancelled | `bg-red-500/10` | `text-[#6B6B6B]` + strikethrough |
| refunded | `bg-red-500/20` | `text-red-400` |

---

## 5. Order Detail (`/admin/shop/orders/[id]`)

Full order view with fulfillment actions.

### 5.1 Layout

```
┌─────────────────────────────────────────────────────┐
│ ← Back to Orders    OPS-2847    [STATUS BADGE]      │
├──────────────────────────┬──────────────────────────┤
│                          │                          │
│   ORDER ITEMS            │   CUSTOMER & SHIPPING    │
│   ┌────┬─────┬───┬────┐ │   Email: j@example.com   │
│   │Img │Name │Qty│ $  │ │   John Doe               │
│   │    │Size │   │    │ │   123 Main St             │
│   └────┴─────┴───┴────┘ │   Portland, OR 97201     │
│   ┌────┬─────┬───┬────┐ │   US                     │
│   │Img │Name │Qty│ $  │ │                          │
│   └────┴─────┴───┴────┘ │   SHIPPING METHOD        │
│                          │   Standard — $7.99       │
│   TOTALS                 │                          │
│   Subtotal    $XX.XX     │   PAYMENT                │
│   Shipping    $X.XX      │   Stripe PI: pi_xxx...   │
│   Tax         $X.XX      │   [View in Stripe ↗]     │
│   ─────────────────      │   Paid at: Mar 28, 2:14p │
│   Total       $XX.XX     │                          │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│                                                     │
│   ACTIONS                                           │
│   [Mark Shipped]  [Refund]  [Cancel]                │
│                                                     │
│   TRACKING (shown when status = shipped+)           │
│   Tracking #: [_______________]                     │
│   Tracking URL: [_______________]                   │
│   [Save Tracking]                                   │
│                                                     │
│   INTERNAL NOTES                                    │
│   [textarea, auto-saves on blur]                    │
│                                                     │
│   TIMELINE                                          │
│   • Mar 28 2:14 PM — Order placed                   │
│   • Mar 28 2:14 PM — Payment confirmed              │
│   • Mar 29 10:00 AM — Marked as shipped             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 5.2 Status Transitions

Valid transitions enforced by the API:

```
pending → paid       (automatic via Stripe webhook, not manual)
paid → shipped       (manual — requires tracking number)
paid → cancelled     (manual — releases inventory, triggers refund if paid)
paid → refunded      (manual — calls Stripe Refund API)
shipped → delivered  (manual)
shipped → refunded   (manual — calls Stripe Refund API)
```

**"Mark Shipped" flow:**
1. Click "Mark Shipped"
2. Inline form appears: tracking number (required) + tracking URL (optional)
3. On submit: API updates order status to `shipped`, sets `shipped_at`, `tracking_number`, `tracking_url`

**"Refund" flow:**
1. Click "Refund"
2. Confirmation dialog: "Refund $XX.XX to {email}? This will call Stripe to reverse the charge."
3. On confirm: API calls `stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id })`
4. Order status → `refunded`

**"Cancel" flow:**
1. Click "Cancel"
2. Confirmation dialog: "Cancel order OPS-2847? This will release reserved inventory."
3. On confirm: API releases inventory reservations (decrement `reserved_quantity` on variants), sets status → `cancelled`
4. If order was `paid`: also triggers Stripe refund

### 5.3 Stripe Link

Direct link to the payment in Stripe Dashboard:
```
https://dashboard.stripe.com/payments/{stripe_payment_intent_id}
```

### 5.4 Timeline

Derived from order timestamps:
- `created_at` → "Order placed"
- `paid_at` → "Payment confirmed"
- `shipped_at` → "Marked as shipped" + tracking info
- Status = `delivered` → "Marked as delivered"
- Status = `cancelled` → "Order cancelled"
- Status = `refunded` → "Refund issued"

No separate timeline table — timestamps on the order row are sufficient for a single-operator store.

### 5.5 API Routes for Order Actions

| Route | Method | Action |
|-------|--------|--------|
| `/api/admin/shop/orders/[id]/ship` | POST | Mark shipped + set tracking |
| `/api/admin/shop/orders/[id]/deliver` | POST | Mark delivered |
| `/api/admin/shop/orders/[id]/cancel` | POST | Cancel + release inventory |
| `/api/admin/shop/orders/[id]/refund` | POST | Stripe refund + update status |
| `/api/admin/shop/orders/[id]/notes` | PUT | Update internal notes |

All routes use `requireAdmin(req)` from `src/lib/admin/api-auth.ts`.

---

## 6. Shipping Methods (`/admin/shop/shipping`)

Simple CRUD page. Low-touch — set once, adjust occasionally.

### 6.1 Layout

Table with inline editing:

| Column | Editable | Notes |
|--------|----------|-------|
| Name | Yes (inline click) | e.g., "Standard Shipping" |
| Description | Yes (inline click) | e.g., "5-7 business days" |
| Price | Yes (inline click) | Dollar input → cents |
| Free Threshold | Yes (inline click) | Dollar amount. If set, method is free when subtotal >= this. NULL = never free. |
| Active | Yes (toggle) | Enable/disable |
| Actions | — | Delete button (only if no orders reference it) |

"+ Add Shipping Method" button at the bottom — inline new row or small form.

### 6.2 Data Flow

Direct Supabase calls via API routes:
- `GET` — server component fetches on page load
- `POST /api/admin/shop/shipping` — create
- `PUT /api/admin/shop/shipping/[id]` — update
- `DELETE /api/admin/shop/shipping/[id]` — delete (only if no orders use it)

---

## 7. Categories (`/admin/shop/categories`)

Simple CRUD with drag-and-drop reorder.

### 7.1 Layout

Vertical list with drag handles:

```
☰  Apparel       [slug: apparel]     [Edit] [Delete]
☰  Accessories   [slug: accessories] [Edit] [Delete]
☰  Drinkware     [slug: drinkware]   [Edit] [Delete]

[+ Add Category]
```

### 7.2 Fields

| Field | Notes |
|-------|-------|
| Name | Required. e.g., "Apparel" |
| Slug | Auto-generated from name, editable. |
| Sort Order | Set by drag position |

### 7.3 Drag-and-Drop

Use `dnd-kit` (already in OPS-Web dependencies). On drop: batch-update `sort_order` for all categories.

### 7.4 Delete Behavior

Cannot delete a category that has products assigned to it. Show error: "Move or delete {count} products first."

---

## 8. Image Upload API

### 8.1 Route: `POST /api/admin/shop/upload`

**Auth:** `requireAdmin(req)`

**Request:** `multipart/form-data` with `file` field

**Flow:**
1. Validate file type (JPEG, PNG, WebP) and size (max 10MB)
2. Generate S3 key: `shop/{timestamp}-{random}.{ext}`
3. Upload to S3 via `PutObjectCommand` (same pattern as `generate-pdf/route.ts`)
4. Return `{ url: "https://ops-app-files-prod.s3.us-west-2.amazonaws.com/shop/{key}" }`

**S3 Config:**
- Bucket: `ops-app-files-prod`
- Region: `us-west-2`
- Credentials: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (already in Vercel env)

---

## 9. Product CRUD API

### 9.1 Route: `POST /api/admin/shop/products`

Create a new product with options and variants.

**Request body:**
```typescript
{
  name: string
  slug: string
  description?: string
  categoryId: string
  priceCents: number
  images: string[]           // Array of S3 URLs
  isFeatured: boolean
  isActive: boolean
  taxCode: string
  options: {
    name: string
    values: string[]
  }[]
  variants: {
    sku: string
    priceCents: number
    stockQuantity: number
    isActive: boolean
    optionValues: Record<string, string>  // e.g., { "Size": "M", "Color": "Black" }
  }[]
}
```

**Flow:**
1. Insert `shop_products` row
2. For each option: insert `shop_product_options` + `shop_product_option_values`
3. For each variant: insert `shop_variants` + `shop_variant_option_values` (linking to the option_value IDs created in step 2)

### 9.2 Route: `PUT /api/admin/shop/products/[id]`

Update existing product. Same body shape. Handles:
- Update product fields
- Diff options: add new, remove deleted (cascade deletes values)
- Diff variants: add new, update existing, deactivate removed (don't hard-delete — order history)

### 9.3 Route: `DELETE /api/admin/shop/products/[id]`

Hard delete only if zero orders reference this product. Otherwise return 409 Conflict.

---

## 10. Styling Reference

All UI follows existing OPS-Web admin patterns from `CLAUDE.md`:

| Element | Style |
|---------|-------|
| Page header | `AdminPageHeader` component — `border-b border-white/[0.08] px-8 py-6`, Mohave 2xl semibold uppercase |
| Table | `bg-transparent`, `border-b border-white/[0.06]` per row, hover `bg-white/[0.02]` |
| Table header | `font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B]` |
| Table cell | `font-mohave text-[13px] text-[#E5E5E5]` |
| Badges | Accent: `bg-[#6F94B0]/20 text-[#6F94B0]`. Muted: `bg-white/[0.05] text-[#6B6B6B]` |
| Buttons (primary) | `bg-[#6F94B0] text-white font-kosugi text-[11px] uppercase tracking-widest px-4 py-2 rounded-sm` |
| Buttons (ghost) | `border border-white/[0.12] text-[#6B6B6B] hover:text-[#E5E5E5]` same font |
| Buttons (danger) | `bg-red-500/20 text-red-400 hover:bg-red-500/30` |
| Inputs | `bg-white/[0.04] border border-white/[0.08] rounded-sm px-3 py-2 font-mohave text-[13px] text-[#E5E5E5] focus:border-[#6F94B0]` |
| Toggles | Small switch, accent color when on, `bg-white/[0.08]` when off |
| Card/section | `border border-white/[0.08] rounded-sm p-6` — no background fill, border only |
| Section label | `font-kosugi text-[11px] uppercase tracking-widest text-[#6B6B6B] mb-4` |

### 10.1 Accent Colors by Context

- Default accent: `#6F94B0`
- Stock green: `text-emerald-400`
- Stock yellow: `text-amber-400`
- Stock red / danger: `text-red-400`
- Muted/secondary text: `text-[#6B6B6B]`
- Primary text: `text-[#E5E5E5]`

---

## 11. File Structure

```
src/app/admin/shop/
├── layout.tsx                          # Optional — inherits from /admin/layout.tsx
├── page.tsx                            # Products list (server component)
├── _components/
│   ├── products-table.tsx              # Client component — sortable table with bulk actions
│   ├── stock-badge.tsx                 # Color-coded stock level badge
│   └── featured-toggle.tsx             # Inline featured toggle with API call
├── products/
│   ├── new/
│   │   └── page.tsx                    # New product (server shell)
│   ├── [id]/
│   │   └── page.tsx                    # Edit product (server shell)
│   └── _components/
│       ├── product-editor.tsx          # Client component — full product editor
│       ├── image-uploader.tsx          # Drag-drop image upload + reorder
│       ├── option-manager.tsx          # Add/edit/remove options and values
│       └── variant-matrix.tsx          # Auto-generated variant table with inline editing
├── orders/
│   ├── page.tsx                        # Orders list (server component)
│   ├── [id]/
│   │   └── page.tsx                    # Order detail (server component + client actions)
│   └── _components/
│       ├── orders-table.tsx            # Client component — sortable/filterable orders
│       ├── order-detail.tsx            # Client component — order view + actions
│       ├── order-timeline.tsx          # Timestamp-based activity timeline
│       └── order-status-badge.tsx      # Status badge with correct colors
├── shipping/
│   ├── page.tsx                        # Shipping methods (server component)
│   └── _components/
│       └── shipping-table.tsx          # Client component — inline editable table
├── categories/
│   ├── page.tsx                        # Categories (server component)
│   └── _components/
│       └── categories-list.tsx         # Client component — drag-and-drop reorderable list

src/app/api/admin/shop/
├── upload/
│   └── route.ts                        # S3 image upload
├── products/
│   ├── route.ts                        # POST: create product
│   └── [id]/
│       └── route.ts                    # PUT: update, DELETE: delete
├── products/bulk/
│   └── route.ts                        # POST: bulk archive/activate/feature
├── orders/
│   └── [id]/
│       ├── ship/route.ts               # POST: mark shipped
│       ├── deliver/route.ts            # POST: mark delivered
│       ├── cancel/route.ts             # POST: cancel order
│       ├── refund/route.ts             # POST: Stripe refund
│       └── notes/route.ts             # PUT: update notes
├── shipping/
│   ├── route.ts                        # POST: create shipping method
│   └── [id]/
│       └── route.ts                    # PUT: update, DELETE: delete
└── categories/
    ├── route.ts                        # POST: create, PUT: bulk reorder
    └── [id]/
        └── route.ts                    # PUT: update, DELETE: delete
```

---

## 12. Database Schema Reference

All 10 tables already exist in Supabase (created during ops-site store build). Full schema documented in the store spec at `ops-site/docs/superpowers/specs/2026-04-02-ops-merch-store-design.md`, Section 7.

Key tables used by admin:

| Table | Admin Operations |
|-------|-----------------|
| `shop_products` | Full CRUD, bulk status updates |
| `shop_categories` | CRUD, reorder |
| `shop_product_options` | CRUD (managed via product editor) |
| `shop_product_option_values` | CRUD (managed via product editor) |
| `shop_variants` | CRUD, inline stock/price editing |
| `shop_variant_option_values` | Managed automatically when variants sync |
| `shop_orders` | Read, status transitions, notes |
| `shop_order_items` | Read only (snapshot data) |
| `shop_shipping_methods` | CRUD, toggle active |
| `shop_inventory_reservations` | Read only (visibility into active checkouts) |

---

## 13. Dependencies

**Already in OPS-Web:**
- `@aws-sdk/client-s3` (used by generate-pdf route)
- `dnd-kit` (drag and drop)
- `stripe` (server-side Stripe SDK — verify present, add if not)
- TanStack Query, Zustand, Framer Motion, Lucide React

**No new dependencies needed.**

---

## 14. Out of Scope

- Analytics dashboard (revenue charts, top sellers, conversion) — future addition
- Customer email notifications on status change (ship/deliver) — future addition
- CSV export/import for products or orders
- Discount codes / promo management
- Multi-currency support
- Stock adjustment audit log (who changed what, when)
