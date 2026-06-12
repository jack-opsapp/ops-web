# Catalog — Capability Inventory (WEB OVERHAUL P3.2)

**Scope:** every capability of the retired surfaces `/products` (+ `/products/[id]/options`) and `/inventory`, read top-to-bottom per master plan §4. The `/catalog` build must reach 100% parity with this list or carry an explicit descope sign-off.

**Sources read:**
- `src/app/(dashboard)/products/page.tsx` (1,036 lines)
- `src/app/(dashboard)/products/[id]/options/page.tsx` (528 lines)
- `src/app/(dashboard)/inventory/page.tsx` (116 lines) + `src/components/inventory/**` (12 components + 4 import-wizard steps, ≈4,300 lines)
- Hooks/services/types: `use-inventory.ts`, `inventory-service.ts`, `use-metrics.ts`, `metrics-service.ts`, `product-options.ts`, `inventory.ts`
- DB ground truth: `ops-software-bible/migrations/2026-05-06-0{1,2}-catalog-schema/views-triggers.sql`, bible 03 § Catalog & Variant Model

---

## 0. Data-layer ground truth (drives the build decisions)

- **Phase 13 (2026-05-06) renamed every `inventory_*` table to `catalog_*`** and replaced the legacy names with **compatibility VIEWS + INSTEAD OF triggers** (`2026-05-06-02-catalog-views-triggers.sql`). The entire web Inventory surface and `fetchInventoryMetrics` ride these views today.
- The `inventory_items` view flattens `catalog_variants ⨝ catalog_items`: **`name`/`description`/`image_url`/`notes` come from the FAMILY** (`catalog_items`), quantity/SKU/unit/thresholds from the variant. Consequences in the old UI:
  - Two variants of one family render as **identical names** (only SKU differs) — variant-blind.
  - "Renaming an item" **renames the whole family** (every sibling variant) via the update trigger.
  - Creating an item with an existing family name **attaches a new variant to that family** silently.
  - Tags are family-level (`catalog_item_tags`); tagging one "item" tags every sibling variant.
- Threshold semantics (web): view exposes `COALESCE(variant, family default)`; client then **max-combines with legacy tag thresholds** (`getEffectiveThresholds`). iOS canonical chain is variant → family → category and **no longer surfaces tag thresholds**. Drift documented; the rebuild adopts the iOS chain (category default read from `catalog_categories`), keeping tag-threshold columns untouched in storage.
- **Build decision:** the STOCK segment reads `catalog_items` / `catalog_variants` / `catalog_options` / `catalog_option_values` / `catalog_variant_option_values` / `catalog_units` / `catalog_tags` / `catalog_item_tags` / `catalog_snapshots` / `catalog_snapshot_items` **directly** (same company-isolation RLS the views resolve to). The compat views stay in place untouched for iOS-era consumers; new code does not extend them.

## 1. PRODUCTS page (`/products`)

| # | Capability | Notes |
|---|-----------|-------|
| P1 | Page title via `usePageTitle("Products")` | registry-driven in the new shell |
| P2 | Inline metrics header (compact, tabId `products`): total · active · avg margin % | `fetchProductMetrics` |
| P3 | NEW ITEM action — `products.manage` | |
| P4 | Search across name / description / category | |
| P5 | Table: 40px thumbnail (Package fallback) · name + favorite star + description · unit · category · task type (color dot, from `useTaskTypes`) · price (mono) · cost (mono, `—`) · taxable tag · actions; responsive column hiding | |
| P6 | Row actions (`products.manage`): options editor link · edit modal · delete (confirm) | old delete used native `confirm()` — rebuild uses `ConfirmDialog` |
| P7 | Product form modal — full field set: name*, description, default price*, unit cost, **UnitPicker** (FK + legacy-text reconciliation backfill + inline create), **CategoryPicker** (same + inline create), task type select + help, toggles (taxable / active / favorite / show-BOM-on-estimate), live margin readout, **Advanced** disclosure (kind segmented `service\|good`, line-item type `LABOR\|MATERIAL\|OTHER`, SKU auto-uppercase, minimum charge, minimum quantity + validation), thumbnail preview (display-only; upload is iOS), **ProductBomEditor** (recipe rows, saved products only), options-editor link (saved products only), inline create-category / create-unit dialogs | iOS DTO parity constraints (kind/type NOT NULL) preserved |
| P8 | Loading / empty / empty-search states with CTA | |
| P9 | i18n: `dashboard` namespace `products.*` (en + es) — already compliant | strings migrate to the new `catalog` namespace |

## 2. Product OPTIONS editor (`/products/[id]/options`)

**Survival rule:** this is the estimate builder's read path (`product_options` + `product_option_values` + `product_pricing_modifiers` → `ProductConfigurationResolver`). The editor survives intact; only its route and chrome change.

| # | Capability | Notes |
|---|-----------|-------|
| O1 | `products.manage` gate with ACCESS DENIED state | |
| O2 | Loading / product-not-found states | |
| O3 | Header: back link, `// PRODUCT :: NAME`, `[OPTIONS & MODIFIERS]` | |
| O4 | Breadcrumb-store integration (entity name + parent crumbs) | parent crumb retargets to `/catalog?segment=products` |
| O5 | Options list: dnd-kit drag-reorder (persisted `sort_order`, optimistic local order), kind chip (SELECT/INTEGER/BOOLEAN), REQUIRED chip, PRICE / RECIPE flag chips, `[N VALUES]`, `[DEFAULT :: x]` | |
| O6 | `ProductOptionFormDialog` — create/edit incl. kind, affectsPrice, affectsRecipe, required, defaultValue, optionDefaultSource; nested values editor for `select` | survives as-is |
| O7 | Delete option with cascade warning (values + referencing modifiers) | |
| O8 | Pricing modifiers: humanized rule list (`formatModifierRule`), add (disabled until ≥1 option), edit, delete | `ProductPricingModifierFormDialog` survives as-is |
| O9 | Mutation hooks: reorder / delete option / delete modifier (+ dialogs' create/update) | |
| O10 | **Violation to fix:** page chrome is hardcoded English (no `useDictionary`) | rebuild i18n's the page chrome; dialog internals follow in P4 sweep if needed |

## 3. INVENTORY page (`/inventory`)

| # | Capability | Notes |
|---|-----------|-------|
| I1 | Metrics header (full, tabId `inventory`): Total Items · Low Stock · Critical · Reorder Needed | Low Stock vs Reorder Needed are near-duplicates (reorder = warning incl. critical) — consolidated in rebuild, see D2 |
| I2 | Tabs: OVERVIEW · ITEMS · TAGS & UNITS · SNAPSHOTS · IMPORT | becomes STOCK segment views |
| I3 | `?action=new` deep link → items tab + create dialog (FAB target) | new FAB target `/catalog?segment=stock&action=new` |
| I4 | OVERVIEW: 4 summary cards (total + delta vs last snapshot, low, critical w/ pulse badge, tag count); NEEDS ATTENTION table (critical-first, cap 10, "view all" affordance); BY TAG cards (ok/low/critical dots, click→filtered items); RECENT SNAPSHOTS (last 3, AUTO/MANUAL); quick-actions row | **Latent bug:** page.tsx passes none of OverviewTab's callbacks — quick actions, by-tag drill, and "view all" are dead buttons in prod. Rebuild wires equivalents (instrument strip + drills) for real. |
| I5 | ITEMS filters: search (name/SKU/description), tag filter, status filter (normal/warning/critical), sort (name / quantity / status / recently updated) | |
| I6 | Items table: multi-select (all + indeterminate), name + description, quantity + unit, status badge (OK / LOW / CRITICAL pulse), tag chips, SKU, row actions (edit / adjust / delete) | rebuild adds variant identity (family + option values) the old view could not show |
| I7 | Bulk bar: adjust quantity · apply tags (replace) · delete (confirm) | **Violation to fix:** gated by `selectIsAdminOrOwner` (role). Rebuild: `inventory.manage`. |
| I8 | `ItemFormDialog`: collapsible sections; name*, quantity, unit select, tag multi-select w/ inline tag creation; description, SKU, notes, image URL; warning/critical thresholds ("leave empty to use tag defaults"); delete-in-edit | rebuild maps to family+variant form (family picker/create, option values, variant overrides) |
| I9 | `QuantityAdjustDialog`: ±1/10/50/100 presets, cumulative custom delta, live new-quantity preview, floor 0 | |
| I10 | `BulkQuantityDialog`: same presets, per-item delta, floor 0 | |
| I11 | `BulkTagsDialog`: replace tag set across selection | family-level in the new model — confirmation copy must say so |
| I12 | TAGS & UNITS: tags table (name, warning/critical thresholds, item count, edit/delete) + units table (display, default-unit dot, sort order, delete non-default w/ usage-count warning) | tag thresholds are legacy (iOS no longer surfaces them) — see D3 |
| I13 | `TagFormDialog` (name*, thresholds) · `UnitFormDialog` (display name) | |
| I14 | SNAPSHOTS: newest-first table (date, created-by, item count, AUTO/MANUAL, notes), expandable row → lazy item sub-table (name/qty/unit/SKU/tags), create-snapshot dialog (notes, client-composed from current data) | |
| I15 | IMPORT: 4-step CSV wizard — upload (drag-drop, quote-aware parser) → map columns (header auto-suggest; name+quantity required) → preview (duplicate-name detection, row removal) → import (sequential create, tag resolve-or-create, unit resolve, progress bar, imported/skipped/errors result) | route gate today is `inventory.view` only; rebuild gates the import view on `inventory.import` |
| I16 | Threshold status: critical ≤ critical < warning ≤ warning; effective thresholds per §0 | rebuild adopts iOS chain (variant → family → category) |
| I17 | **Violation to fix:** zero i18n across all five tabs (hardcoded English) | rebuild: `catalog` namespace, en + es |

## 4. Cross-surface obligations

| # | Item |
|---|------|
| R1 | Registry swap: remove `products` + `inventory` entries, add `catalog` (order 9, before CLIENTS) — same commit as redirects |
| R2 | Redirects (308, params preserved): `/products` → `/catalog?segment=products` · `/inventory` → `/catalog?segment=stock` (incl. `?action=new`) · `/products/[id]/options` → `/catalog/products/[id]/options` |
| R3 | FAB: `inventory-item` action retargets `/inventory?action=new` → `/catalog?segment=stock&action=new` |
| R4 | `breadcrumb-store` parent crumb + any in-app `/products` links (`ProductFormModal` options link) retarget |
| R5 | Notification `action_url`s and command-palette keywords keep resolving (palette: `catalog`, `pricing`, `stock`, `items`, `materials` fold into the CATALOG entry) |
| R6 | Per-segment permission gating: route = anyOf(`products.view`, `inventory.view`); PRODUCTS segment `products.view` (mutations `products.manage`); STOCK segment `inventory.view` (mutations `inventory.manage`, import view `inventory.import`) |
| R7 | Old page directories deleted only after live verification confirms parity |

## 5. Descopes (require Jackson's sign-off)

| # | Item | Rationale |
|---|------|-----------|
| D1 | OverviewTab as a separate tab | Its information (counts, needs-attention, by-tag, recent snapshots) folds into the Catalog instrument strip + threshold drill, matching the Books pattern and the iOS threshold banner. No data is lost; the dead-callback quick actions are replaced by live ones. |
| D2 | "Reorder Needed" metric tile | Duplicate of Low Stock ∪ Critical under the old math; the strip shows LOW and CRITICAL distinctly. |
| D3 | Tag-threshold editing (TagFormDialog threshold fields) | Legacy columns iOS no longer reads; effective-threshold chain is variant → family → category. Tag rename/delete/apply stays. Existing stored tag thresholds stop influencing web status (matching iOS). |
| D4 | Image URL free-text field on stock items | Family `image_url` is iOS-managed (photo upload); a raw URL input is not OPS-grade. Family images still display when present. |

Everything else: 100% parity, plus the variant-awareness upgrade (§0) the old surface structurally could not deliver.

## 6. Scope additions beyond parity (Direction D, critique-driven)

Adopted after the flow research + 3-lens critique panel (owner realism · design system · overpromise, which audited live tenant data: Canpro 0/75 costed SKUs, 0 snapshots, 0 recipes, 25/75 unthresholded variants). The build is accountable for these, not just the parity list:

| # | Addition | Why |
|---|----------|-----|
| S1 | **Audit writes on every web quantity mutation** — inline edit, drawer pills, set/delta field, bulk adjust, import deltas each insert an `inventory_deductions` row (`reason: manual_adjustment`, `catalog_variant_id` + legacy `inventory_item_id`, previous/new qty, actor); drawer ledger queries COALESCE both id columns so iOS + web rows interleave | Without it the drawer ledger never shows web edits ("EVERY CHANGE LOGGED" would be false) |
| S2 | **Signed receiving input** — QTY cell and drawer field accept `+40` / `−12` deltas as well as set-to counts; delta commits labeled DELIVERY/MANUAL in the ledger | Receiving is delta-shaped; set-only forces tailgate math |
| S3 | **Buy-run exit** — COPY LIST (plain text: item · variant · qty short · unit, grouped by category, confirmation toast) + PRINT stylesheet on the threshold pivot | The #1 flow otherwise dead-ends at a filtered table |
| S4 | **UNTRACKED health bucket** — variants with no effective threshold at any cascade level are never counted OK; tile shows the 4th bucket and its zero state CTAs ([SET THRESHOLDS →]) | "OK" on unmeasured stock is a lie (25/75 at Canpro) |
| S5 | **SKU cost path** — UNIT COST field in the stock drawer (writes `unit_cost_override` / family `default_unit_cost`), NO COST awareness in stock; ON-HAND tile renders `—` + [ADD COSTS →] when coverage is 0 | The $ hero is unreachable otherwise (0/75 costed at Canpro) |
| S6 | **Coverage-honest dollar figures** — BUY TO THRESHOLD computed over costed rows only, with `N ITEMS UNCOSTED` flag; avg-margin hero `—` when nothing is costed (also fix `fetchProductMetrics` emitting `0%`) | Silently partial sums are worse than none |
| S7 | **GROUP :: FAMILY opt-in toggle** (persisted); any filter/sort forces flat | C's variant honesty without breaking critical-first triage |
| S8 | **Kebab manage modals** — categories, tags, units, threshold defaults (category-level), each gated `inventory.manage`; Import CSV gated `inventory.import`; snapshots labeled "Saved counts" in UI copy | Old web had tags/units only; categories + threshold defaults are the cascade's admin surface |
| S9 | **Designed zero states everywhere** — no fake zeroes: `—` heroes with action CTAs; ledger empty state; USED IN hidden when empty; chips render nothing without categories | First-run truth at sparse tenants |
| S10 | **Per-row inline editing** — stock QTY; product COST/PRICE/MARGIN tri-coupled cells with multi-select SET MARGIN | The #2 and #3 flows live in these cells |
| S11 | **`/catalog/products/[id]` full product editor** — base fields + options/modifiers/recipe authoring inline (reusing the surviving editor components); also fixes the iOS "VIEW ON WEB →" deep link to `/products/{id}` which 404s today (`ProductDetailView.swift:1054`); redirect added for `/products/[id]` as well as `/products/[id]/options` | One authoring home; live broken deep link |

**Explicitly deferred (documented, not promised in pixels):** supplier price-sheet upload/parse reprice flow (own initiative); per-row count-staleness ages + stalest-first sort (meaningless until S1 has accumulated data); threshold auto-suggestions from usage history (needs populated deduction history).
