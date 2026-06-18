# Catalog Direction D — "Workbench" (flow-led design rationale)

**Wave:** WEB OVERHAUL P3.2 · **Status:** awaiting Jackson's approval
**Mockup:** `direction-d-workbench.html` / `catalog-direction-d.png`
**Inputs:** 5-agent research workflow (operator reality via forum/review evidence · inventory-UX patterns · iOS parity · data feasibility) + synthesis, adversarially critiqued by a 3-lens panel before review. Directions A/B/C were scored against the ranked flows; D is "A's skeleton, B's pivot behavior, C's voice and variant honesty."

---

## 1. Who is here, and why (ranked by value × frequency)

| # | Intent | Trigger | Frequency | The loop the design must serve |
|---|--------|---------|-----------|--------------------------------|
| 1 | **Buy-run triage** — "what's short before I drive to the supply house?" | Friday/Monday restock ritual; threshold notification; tech texts "we're out" | Weekly + ad-hoc. A stockout costs a ~45-min supply run; ~$1,000/mo at 3 runs/week | Land → tile already names the damage → 1 click pivots the table to below-threshold, critical-first, with SHORT (= qty to buy) → COPY LIST / PRINT for the counter. 3 clicks, zero typing, < 60 s |
| 2 | **Price-book upkeep** — "supplier moved the price" | Supplier invoice/sheet; quarterly sweep; a job that lost money | Weekly–monthly per item | `/` → search → click COST cell → type → MARGIN recomputes live → Enter. ~10–15 s per item; a 10-line sheet in under 3 min |
| 3 | **Count / receive true-up** | Back from the run; weekly shop walk; year-end COGS count | Weekly small-set; annual full walk | Click QTY cell → type the count (set-to) → Enter commits + advances down the column. ~2–3 s per SKU; 30-item walk ≈ 90 s. Year-end exits via ON-HAND tile → snapshot |
| 4 | **Fast authoring** (clone/create) | Estimate needs a line that doesn't exist; new truck staple | Weekly clone-tweak; rare net-new | + ADD split (kind-tailored), duplicate-row path |
| 5 | **Deep product configuration** (options/modifiers/recipe) | New configurable offering; iOS "VIEW ON WEB →" | Monthly, focused sessions | Product row click → `/catalog/products/[id]` full editor |
| 6 | **Valuation glance + snapshot** | Year-end taxes; insurance | 1–4×/year | ON-HAND tile → snapshots → CREATE. ~30 s |

Evidence base (selected): truck-stocking guides quantify supply-run waste and prescribe the weekly restock ritual; Mike Holt threads show small shops reject transaction-grade inventory ("the time you take entering and tracking will cost you more than the material is worth") — so counts are tolerance-friendly set-to entries, never ledger ceremony; ServiceTitan's inventory is rejected as "way too complicated… if you have a full-time inventory person"; price-book setup is the most feared cost in the category (US$5–15k consultants), making the book a crown-jewel asset the page must protect.

## 2. What the page leads with — and what got cut

- **Three glance tiles, each an owner question with a working pivot.** STOCK HEALTH ("am I about to lose a day?") · ON-HAND ("what's my shelf worth?") · PRICE BOOK ("can I trust my next quote?"). Tiles that were stats-without-actions in direction A (CONFIGURED dot-grid, service/good split meter, decorative category bars) are **cut** — they read tech-demo and answer nothing.
- **One alarm, not two.** C's banner voice (naming the worst item) folds INTO the health tile sub-line. No separate threshold banner; no layout jump.
- **The tile IS the triage flow.** Clicking STOCK HEALTH pivots the stock table in place (filter, critical-first) — the live iOS threshold-banner behavior. (The bible's "opens orders sheet" description is drift; `catalog_orders` is consumed nowhere on web, so no order affordances — the buy-run exit is COPY LIST / PRINT.)
- **B's category rail rejected:** at real tenant scale (a handful of categories) a 216 px rail reads empty and fights the P2 fixed-rail shell. Categories are filter chips.
- **C's family clusters rejected as default** (kept as opt-in `GROUP :: FAMILY` toggle): clusters break the global critical-first sort that intent #1 depends on, and most real families have one variant. Variant honesty lives in every row instead: family name + mono option-value subtitle (`BLACK · TOPMOUNT`).
- **Default landing = last-used segment** (mirrors iOS @AppStorage); first-ever visit lands on PRODUCTS — the price book is the weekly desk touch; stock interrupts via the tile only when the shelf actually needs attention.

## 3. The working interactions (ranked)

1. **Inline QTY editing, type-over-first** — set-to semantics, Enter commits + advances down the column (spreadsheet walk), ↑/↓ ±1, hover preset pills (±1/10/50) for receiving deltas, optimistic with rollback, floor 0 (iOS parity), every commit writes an audit row.
2. **Tri-coupled COST / PRICE / MARGIN cells** on PRODUCTS — edit one, the others recompute live; missing cost renders `—` and visibly blanks margin (self-motivating worklist, fed by the PRICE BOOK tile drill + NO COST chip).
3. **Tile drill = filter pivot in place** — never navigation, never a modal; Esc restores.
4. **Search**: `/` focuses; spans family name + option values + SKU + description; exact SKU pins top, never typo-corrected.
5. **Row-click discipline**: STOCK row → right drawer (table stays visible: presets, set-exact, thresholds with cascade source labels, USED-IN reverse links, adjustments ledger). PRODUCTS row → `/catalog/products/[id]` full product editor — which also **fixes the iOS "VIEW ON WEB →" deep link (`/products/{id}`) that 404s in production today** (verified: `ProductDetailView.swift:1054`; web ships no `/products/[id]` page).
6. **Bulk selection** (desktop-native advantage): bulk adjust / bulk tags (family-level — copy must say so) / bulk delete; permission-gated, never role checks.
7. **Persisted prefs**: segment, group toggle, filters.
8. **Notification rail**: import/snapshot/bulk completions post notifications; threshold crossings deep-link to the pivoted state.
9. **Motion**: single `EASE_SMOOTH` curve; commit-flash in cells replaces iOS haptics; `prefers-reduced-motion` honored.

## 4. Honesty constraints baked into the pixels

- ON-HAND carries "VALUE OF N/M COSTED SKUS" — a partial-cost total without that line fails trust at the first real tenant.
- No "cost last verified" staleness claims (`updated_at` is edit-noise; no verified-at column exists).
- Adjustments ledger sources `inventory_deductions` (+ manual adjustments the web writes) — never `updated_at`.
- Threshold status = canonical 3-level cascade (variant → family → category) implemented against `catalog_*` directly; legacy tag-max thresholds stop influencing status (capability descope D3).
- Snapshot creation writes `catalog_snapshots`/`catalog_snapshot_items` directly — the legacy view path is read-only and would silently fail at the year-end moment.

## 4b. Critique panel outcome (rev 2)

Three adversarial lenses reviewed rev 1 — a skeptical trades owner, a design-system enforcer, an overpromise auditor (who checked live tenant data). All three returned **fix-then-ship**; rev 2 applies the fixes:

- **Owner blocker — unthresholded stock counted "OK":** added the UNTRACKED bucket (tile + bar) and zero-state CTAs. Threshold auto-suggestion from usage history deferred (no data to suggest from yet).
- **Owner major — receiving is delta-shaped:** signed input (`+40` / `−12`) in the QTY cell and drawer field, logged as DELIVERY/MANUAL.
- **Owner major — partial buy total lies:** `BUY TO THRESHOLD :: $1,118 · 2 ITEMS UNCOSTED`.
- **Owner major — naming split:** third tile renamed `// PRODUCTS` to match the tab; one name per concept. Tabs stay PRODUCTS/STOCK (master-plan/iOS parity).
- **Owner minors:** plain words (`3 OPTIONS · 4 MATERIALS`, `HAS OPTIONS`, `LAST FULL COUNT`, kebab "Saved counts"), stepper slimmed to ±1/±10 + one signed/set field, longer ledger, COPY LIST defined as textable plain text.
- **Design system:** 11px floor restored on all real UI text; informational text moved off `--text-mute` to `--text-3`; favorite star made monochrome; task dots tokenized; 36px control floor (no `.btn-sm`); radii to token (rail item 6, seg 6, bar segments 2); STATUS/TAX left-aligned; mono for uppercase micro-labels; `tnum`/slashed-zero everywhere digits appear; glass gradient on the menu. Verdict otherwise: "passes the quiet-authority test… genuinely operator-shaped."
- **Overpromise (live-data audit):** ON-HAND needs an input path → UNIT COST field added to the drawer + zero states; ledger now depicts MANUAL/DELIVERY as the norm (task attribution lights up only when recipes exist); WORST defined as lowest qty/critical ratio; snapshot/empty states designed; audit-row writes added to build scope (capability inventory §6).
- **Rejected with reasons:** tab renames (iOS/master-plan parity), supplier-sheet upload reprice (own initiative — PDF parsing), per-row staleness ages (would render `—` everywhere until audit data accumulates).

## 5. Build consequences (delta vs. the A/B/C parity plan)

- New route `/catalog/products/[id]` (full product editor: base fields + options/modifiers/recipe authoring inline, reusing the surviving editor components) replaces the old edit-modal + `/products/[id]/options` page pair; redirects cover `/products/[id]`, `/products/[id]/options`, `/products`, `/inventory`.
- STOCK data layer reads `catalog_*` tables directly (variant labels via option-value joins); the `inventory_*` compat views are abandoned by web, not extended.
- New micro-surfaces: triage pivot + copy/print list, inline cell editing, stock drawer, snapshots view, import wizard port, kebab manage modals (categories/tags/units/threshold defaults).
