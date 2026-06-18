# WEB OVERHAUL — P4-2 · Catalog → shared primitives convergence

**Phase:** WEB OVERHAUL P4-2 (remediation of the 2026-06-13 cohesion audit §3 A1–A6 + §4 misuse, the P1 "Catalog re-derives the kit" cluster) + the B3 create-affordance ruling.
**Branch:** `feat/web-overhaul` · **Worktree:** `ops-web-overhaul-p2-shell` · sequential wave, no push.
**Source audit:** `docs/audits/2026-06-13-cross-surface-visual-cohesion.md` §3, §4. **Canonical references:** Books invoices/estimates + Clients roster (already on the shared primitives).
**Status:** spec + mock produced; **awaiting Jackson sign-off on the structural recomposition before table code is written** (master plan §6).

---

## 1 · Goal

Catalog is the lone outlier of the rebuilt set — it re-derived the design system instead of consuming it (forked segment control, three hand-rolled `<table>`s, forked Tag/FilterChips/DrillChip, accent-outline CTAs, raw `<select>`/rgba). This wave converges it onto the same primitives Books/Clients use, **with zero loss of any Catalog affordance** (the rows are interactive — inline edits, buy-run, bulk, drawer — not read-mostly like Books). Plus it standardizes the cross-surface create button per Jackson's 2026-06-13 ruling.

Already landed in the §5 primitive pass (do **not** redo): Catalog consumes `InstrumentStrip` (supply strip) + `RegisterEmpty`.

---

## 2 · Architecture decision — how the interactive rows meet RegisterTable

`RegisterTable` (P3-5) is a deliberately *presentational* extraction of the table-v2 row anatomy — glass shell, `// LABEL` thead grammar, row chrome (hover, focus ring, whole-row click), and a `columns[].cell(row) → ReactNode` config — **without** the heavy data-grid framework (saved views, virtualization, inline cell-edit). Catalog's rows are richer than Books': tri-coupled inline COST/PRICE edit, signed-delta QTY edit audited to `inventory_deductions`, a master-detail drawer, bulk select.

**Decision (the "decide + document" the task requires — mirrors P3-5's reasoning):**

> **B — compose Catalog's existing inline-edit cells *inside* RegisterTable's shell. Do NOT bake inline-edit into the shared cell atoms.**

Why:
- RegisterTable was scoped to *exclude* inline cell-edit on purpose; that machinery already exists, richer, in Projects/Pipeline's table-v2. Re-deriving a slice of it into the shared `register-table-cells` would import inventory-domain logic (parent-controlled edit state for spreadsheet "advance down the column," signed-delta parsing, the NO-COST rose nudge, cost/price/margin coupling) into a presentational primitive — the wrong layer.
- The `cell(row) → ReactNode` API is already the intended extension point: the existing, well-factored `InlineMoneyCell` / `InlineQtyCell` (`catalog/cells.tsx`) render *as* the cell content. The editing cell stops click propagation so it never triggers the row's open action — exactly how Books' ACTIONS cell already behaves.
- These cells stay Catalog-local but get **tokenized** in this wave (their raw rgba borders + `rounded-[3px]` are the only real violations — audit §4 calls the elements "legitimately bespoke").

**What I *do* extend in RegisterTable — both genuinely generic, presentational, reusable by Projects/Pipeline (not forks):**

1. `header: string` → `header: ReactNode`. Lets a column header carry a control — here the STOCK select-all `Checkbox`. Backward-compatible (strings are ReactNodes); all current consumers unaffected.
2. add optional `isRowActive?: (row) => boolean` → applies `bg-surface-active` to that `<tr>`. The master-detail "this row's drawer is open" tint STOCK needs today; a generic selected/active-row affordance Projects/Pipeline can reuse.

Both are documented in the primitive's header comment as shared improvements.

---

## 3 · Per-file conversion plan

### 3.1 `catalog/segment-toolbar.tsx` (A1, A5) — re-export shared, delete forks
Mirror `books/segment-toolbar.tsx` exactly: delete the forked `CatalogSegmentControl`, `FilterChips`, `DrillChip` bodies; re-export the shared primitives:
```ts
export { SegmentControl as CatalogSegmentControl, type SegmentControlOption as SegmentOption } from "@/components/ui/segment-control";
export { FilterChips, DismissChip as DrillChip } from "@/components/ui/filter-chip";
```
Keep the `SegmentOption`/`FilterChipOption` type names the segments import so call sites are untouched. (The shared `SegmentControl` option type already carries `count?` — parity.) The shared `FilterChips`/`DrillChip` take a `className` only where needed; the catalog call sites pass none.

### 3.2 `catalog/segments/products-segment.tsx` (A2, A3, A4, A6) — RegisterTable
- Replace the hand-rolled `<table>` with `RegisterTable<Product>` + columns. Row click → `router.push('/catalog/products/[id]')` (unchanged destination; preserves the old Sliders-icon target). `isRowInteractive` = always true (navigation is not permission-gated today; delete is).
- Columns: PRODUCT (custom cell: 32px thumbnail + favorite star + `TablePrimary` name + mono description sub-line), UNIT (`hidden sm`), TASK (`hidden lg`, color dot + name), **COST** (`InlineMoneyCell`, wrapped in a stop-propagation span, `dim` + `emptyTone="rose"`), **PRICE** (`InlineMoneyCell`, stop-prop), MARGIN (mono olive/mute), TAX (shared `Tag` — `olive` when taxable / `dim` when not, replacing the hand-rolled pill), CONFIG (`hidden lg`, mono counts), **ACTIONS** (one labelled overflow → `DELETE` rose; replaces the bare Sliders+Trash2 icon toolbar).
- The `th` const + `<thead>`/`<tbody>` markup deleted (RegisterTable owns it). Keep the loading skeleton + `RegisterEmpty` (already shipped).
- Quick-add (`ProductQuickAdd`) + ConfirmDialog unchanged.

### 3.3 `catalog/segments/stock-segment.tsx` (A2, A4, A6) — RegisterTable (flat) + bespoke grouped
- **Flat table** → `RegisterTable<CatalogStockRow>`. Row click → `onOpenDrawer(variantId)` (whole-row, an interactivity *gain*; the checkbox + QTY cells stop propagation). `isRowActive` = `r.variantId === activeDrawerId` (drawer tint).
- Columns built conditionally:
  - checkbox column (only when `!drilled && canManage`): header = select-all `Checkbox` (via the new ReactNode header), cell = per-row `Checkbox` (stop-prop). `className="w-[34px]"`.
  - ITEM: `TablePrimary` family name + mono variant-label sub-line.
  - QTY: `InlineQtyCell` (stop-prop), status-coloured, advance-down-column preserved.
  - THRESHOLD + SHORT: drilled-only mono columns (SHORT rose/tan by status).
  - SKU (`hidden sm`, mono), STATUS (shared `Tag`: critical→rose, low→tan, ok→neutral/dim, untracked→mute — replaces the hand-rolled `StatusTag`).
- `StatusTag` + `STATUS_TAG` map deleted; map `CatalogStatus` → `Tag` variant instead.
- The forked `GROUP::FAMILY` toggle button + the `DrillChip`/buy-run line stay (now using the shared `DrillChip`), tokenized.
- **`GroupedTable` stays bespoke** (a clustered family view — RegisterTable has no grouping model; forcing one in for a single low-traffic opt-in mode would bloat the shared primitive). Tokenize its `divide-[rgba(...)]` + align typography.
- Bulk bar, ConfirmDialog, AddStockDialog, StockDrawer unchanged (drawer rgba tokenized in 3.6).

### 3.4 `catalog/snapshots-view.tsx` (A2, A6) — anatomy-converged, expandable shell bespoke
The saved-counts table is an **expandable master-detail** (chevron row → nested item rows). RegisterTable has no expansion model. Per the P3-5 precedent (ExpenseReviewDashboard / ArAgingView were *not* forced onto RegisterTable because conversion = regression), the outer table **stays structurally bespoke** but converges its *anatomy*: shared thead grammar already matches; tokenize the `border-[rgba(...)]` row hairlines + the `bg-[rgba(255,255,255,0.02)]` detail panel; replace the hand-rolled "NO COUNTS SAVED" empty with `RegisterEmpty`; the "TAKE COUNT" accent-outline CTA → `Button variant="primary"` (A6).
> **Scope correction (documented, like P3-5):** snapshots' expandable structure is out of RegisterTable's presentational scope; its hand-rolled-`<table>` *anatomy* is what the audit flagged, and that converges onto the shared cell vocabulary + tokens.

### 3.5 Catalog modals — forked toggles + selects + CTAs
- `modals/product-quick-add.tsx` (A6 2nd clause): service/good segmented toggle → shared `SegmentControl`.
- `modals/manage-modal.tsx` (A6 2nd clause, C2): any segmented toggle → `SegmentControl`; rgba literals → tokens (`border-subtle`, focus border).
- `modals/add-stock-dialog.tsx` (C2): two raw `<select>` (unit, category) → shared Radix `Select`; rgba focus-border const → token.
- `product-editor.tsx` (C2): raw task-type `<select>` → shared `Select`; rgba border/bg literals → tokens.

### 3.6 Token hygiene (C2, C3) — raw rgba/radius → tokens
`cells.tsx` (`border-[rgba(255,255,255,0.20)]`, `border-[rgba(255,255,255,0.14)]`, `rounded-[3px]`), `stock-drawer.tsx` (184/194, + the `text-[13px]` Mohave → `text-[14px]` at :228), `products-/stock-segment` residual row hairlines → `border-border-subtle`. Map: `0.20`→`border-medium`/`line-hi`, `0.14`→`fill-neutral`, `0.05` hairline→`border-subtle`, `0.02` panel→`surface-input`/`surface-hover-subtle`. `rounded-[3px]`→nearest ladder token (`rounded-[4px]` chip / `rounded-[2px]` bar — pick per element; the inline-edit input box uses `rounded-[5px]` already).

### 3.7 Create-affordance (B3 ruling) — one accent CTA per register
- **Catalog** PRODUCTS + STOCK + snapshots: the existing accent-outline `Button variant="secondary"`+className → `Button variant="primary"` (filled-at-rest, the shipped primary). Same string ("+ ADD" → `<Plus/>` + "ADD" to match Clients' icon construction — see open question §6).
- **Books** invoices + estimates (the **reversal** of P3-5 §4): restore a single workbar create CTA — `Button variant="primary"` with `<Plus/>` + `t("invoices.newInvoice")` / `t("estimates.newEstimate")` (keys already exist in `pipeline.json`), gated on `can("invoices.create")` / `can("estimates.create")`, calling the in-component `gatedOpenCreate`. Placed in the right-hand workbar group, left of the invoices LIST|AGING toggle so the toggle keeps its P3-5 far-right pin. **Empty states stay `RegisterEmpty` (no CTA)** — only the workbar gets the button back.
- **Clients** "+ NEW CLIENT": already `Button variant="primary"` (B4, commit `44ca2516`) — no change; it's the reference.

---

## 4 · Capability parity checklist (non-negotiable — exercise each post-build)

PRODUCTS: ☐ inline COST edit (set) ☐ inline PRICE edit ☐ MARGIN re-derives live ☐ NO-COST rose `—` + worklist filter ☐ CONFIG counts ☐ favorite star ☐ row→editor ☐ ACTIONS→DELETE ☐ quick-add.
STOCK: ☐ inline QTY set ☐ inline QTY signed delta (+/-) ☐ advance-down-column on commit ☐ status colours ☐ checkbox select ☐ select-all ☐ bulk DELETE bar ☐ GROUP::FAMILY toggle + clustered view ☐ row→drawer ☐ drawer-active tint ☐ buy-run drill (THRESHOLD/SHORT) ☐ COPY LIST ☐ PRINT ☐ BUY-TO-THRESHOLD (uncosted-honest) ☐ category filter ☐ kebab.
SNAPSHOTS: ☐ list ☐ expand→items ☐ TAKE COUNT ☐ empty state ☐ back to STOCK.
SEGMENT: ☐ PRODUCTS↔STOCK switch + counts ☐ persisted ☐ Books↔Catalog read identical.

---

## 5 · Verify

`npx tsc --noEmit` + `eslint` clean. Live on the worktree (`overhaul-shell` launch.json, port 3017, `dev:webpack`; isolated throwaway server if 3017 is contended). Viewport ≥768px. Screenshots: Catalog PRODUCTS + STOCK before/after, Books with restored CTA, Books↔Catalog flip (segment + table identical). Exercise the §4 checklist. Done-gate: `custom-skills:audit-design-system` over every touched file → zero high findings, summary in the landing report. `ops-copywriter` only for the create-label decision (§6).

## 6 · Open question for Jackson
Catalog create label: keep **ADD** (the ruling's literal), or use the more specific **NEW PRODUCT** / **NEW ITEM** (dict keys already exist) to parallel NEW CLIENT / NEW INVOICE? Default: keep ADD unless told otherwise.

## 7 · Commits (atomic, by theme, staged by name, no push, no AI attribution)
1. `refactor(catalog): adopt shared SegmentControl + FilterChips/DrillChip` (3.1)
2. `feat(register-table): ReactNode headers + isRowActive for master-detail rows` (§2 extensions)
3. `refactor(catalog): rebuild Products + Stock tables on RegisterTable` (3.2, 3.3) — *gated on Jackson sign-off*
4. `refactor(catalog): shared Tag for status; converge snapshots anatomy` (3.4 + tags)
5. `refactor(catalog): shared Select + SegmentControl in modals/editor` (3.5)
6. `refactor(catalog): replace raw rgba/radius literals with tokens` (3.6)
7. `feat(catalog,books): one filled-primary create CTA per register; restore Books workbar create` (3.7)
