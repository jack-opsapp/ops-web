# Table System Unification — WEB OVERHAUL P6-2

**Date:** 2026-06-29 · **Branch:** `feat/web-overhaul-table-unify` (worktree `ops-web-table-unify`, off `origin/main`) · **Status:** mock built, awaiting Jackson's approval before code.

Jackson flagged 2026-06-24: Projects/Pipeline have a sticky header + metrics bar; Books/Catalog/Clients don't — "terrible, unpredictable UI." This pays the debt P3-5 deliberately deferred (unifying the two table systems).

## The problem (verified by reading every surface top-to-bottom on origin/main)

Two table systems, and the metrics treatment is a zoo of **five** presentations:

| Surface | Table | Scroll model | Header | Metrics |
|---|---|---|---|---|
| Projects | `table-v2` div-grid (virtualized, frozen cols, saved views, density/zoom, inline edit) | fixed-viewport, **internal** `overflow-auto` | **sticky** `top-0 z-20` | `MetricsHeader variant="compact"` |
| Pipeline | `table-v2` sibling (+ stage grouping) | fixed-viewport, **internal** scroll | **sticky** `top-0 z-20` | `MetricsHeader variant="full"` + `slashLabels` |
| Books | `RegisterTable` (semantic `<table>`) | document-flow `space-y-3`, **page** scroll | **not sticky** | `LedgerStrip` (InstrumentStrip glance tiles) **+** `SegmentStatLine` (inline mono row) |
| Catalog | `RegisterTable` + inline cost/price/qty edit | document-flow `space-y-4`, **page** scroll | **not sticky** | `SupplyStrip` (InstrumentStrip glance tiles) |
| Clients | `RegisterTable` | document-flow `space-y-3`, **page** scroll | **not sticky** | `ClientsArBanner` (rose banner) — no strip |

Root divergences: (1) **sticky header** — grid pins, register doesn't; (2) **scroll model** — grid scrolls an internal container (metrics+header pinned, rows scroll under); register scrolls the whole route (everything scrolls away); (3) **metrics** — five different components, and even the two grid surfaces disagree (compact vs full).

`RegisterTable` is shared well beyond the 5 list surfaces (Settings tabs, Expenses, Inventory) — blast radius to respect.

## Decision (architecture — Claude owns this)

**Extract a new shared `TableShell` foundation + a single unified `MetricsStrip`. Do NOT make RegisterTable the foundation; do NOT fork a third table.**

Why not "RegisterTable becomes the foundation, table-v2 composes it": RegisterTable renders a semantic `<table>` from a column config; table-v2 is a virtualized div-grid. table-v2 cannot render rows through RegisterTable's `<tbody>`, so RegisterTable can't be the base table-v2 composes *at the row level*. The genuinely shared layer is the **outer frame** — identical whether a `<table>` or a div-grid renders inside it.

### `src/components/ui/table-shell/` — `TableShell`
A fixed-viewport instrument frame both archetypes consume:
- `flex h-full min-h-0 flex-col` wrapper (so the page never scrolls; the body does).
- **`metrics` slot** — pinned, non-scrolling (renders `MetricsStrip`).
- **`workbar` slot** — pinned (segment control + search + CTA + density + filter chips + count + stat line).
- **`viewTabs` slot** — optional, grid-only (saved views).
- **scroll body** — `min-h-0 flex-1 overflow-auto`, the single sticky-header positioning context + bottom-fade.
- empty-state placement (`RegisterEmpty`).

`RegisterTable` renders its `<table>` inside the body and its `<thead>` becomes `sticky top-0 z-20` with an **opaque glass-dense backing** (today it has no own bg inside a translucent glass-surface → rows would bleed through). The register **surfaces** (Books/Catalog/Clients) adopt the fixed-viewport layout so the internal scroll container exists.

`table-v2` (projects + pipeline) swaps its inline `overflow-auto` scroll div for `TableShell`'s body, keeping **all** power features (virtualization, frozen sticky-left cols, saved views, density/zoom, inline cell edit, bulk bar, keyboard nav, stage grouping) layered on top.

Row-anatomy atoms (`register-table-cells`: TableNumber/Primary/Meta/Mono + Tag) stay shared as-is; the grid keeps its own cell renderers (same typographic grammar). No third table.

### `src/components/ui/metrics-strip/` — `MetricsStrip` (unify the five)
One thin glass strip of hairline-divided metric cells: `// LABEL` (mono 11px) + mono value (tabular, tone-aware) + optional trend + optional per-cell mini-viz (sparkline / aging-ramp / health-bar / margin-meter / coverage). Count-up 800ms (brand curve), reduced-motion instant. Evolves `MetricsHeader` (drops its hardcoded hex: `#6B6B6B`/`#A5B368`/`#93321A`/`#EDEDED`/`rgba(10,10,10,.5)` → tokens; `slashLabels` becomes default). Books/Catalog's glance-tile richness survives as **per-cell mini-viz**, not tall tiles. Clients gains a real strip (A/R banner → lead cell). InstrumentStrip/GlanceTile stays available for non-table contexts (dashboard widgets, settings) but the five list surfaces all render `MetricsStrip`.

## Feature parity (non-negotiable — no silent loss)

- **Grid keeps:** saved-view tabs, density/zoom, inline cell edit, virtualization, frozen sticky-left columns, bulk bar, keyboard nav, pipeline stage grouping, column registry.
- **Register keeps:** row anatomy, ACTIONS overflow dropdown, inline edits (Catalog cost/price/margin + qty via `catalog/cells.tsx`), stock drawer (`isRowActive` tint), RegisterEmpty, segment workbars, each segment's metrics.

## Build phasing (after approval)

1. `TableShell` + `MetricsStrip` primitives (+ unit/visual checks).
2. Register surfaces onto TableShell w/ sticky thead: Clients → Books → Catalog (one commit each).
3. Grid surfaces onto TableShell's body: Projects → Pipeline (preserve all power features).
4. Map each surface's metrics into `MetricsStrip`; retire MetricsHeader compact/full split, LedgerStrip/SupplyStrip-in-table, SegmentStatLine, ClientsArBanner.
5. `audit-design-system` gate over every touched file (zero high). tsc + eslint clean.
6. Verify: dev bypass, ≥768px, scroll all five — header pins identically; metrics read consistently; exercise every preserved behavior. Append outcome here + to the master-plan decision log.

## Jackson decision log

- 2026-06-29 — mock built (`unified-table-mock.html`, rendered inline). Awaiting: metrics-strip treatment + go-ahead.
