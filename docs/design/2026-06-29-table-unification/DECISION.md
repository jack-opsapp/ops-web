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
- 2026-06-29 — Jackson approved the **thin unified strip** (rich viz survives as per-cell mini-viz) and directed: *consistency across every table and screen is the bar; tokenize/templatize now, tweak later.* Build authorized.

## Execution log

- Foundation committed: `TableShell` + `TableWorkbar` (`ui/table-shell`), `MetricsStrip` + `StripViz` + `fromMetricColumns` adapter (`ui/metrics-strip`), `RegisterTable.inShell` (sticky thead). Sticky-header backing standardized to `bg-background` (#000) across register + grid for one identical treatment.
- **Clients** — migrated + LIVE-VERIFIED (dev bypass, 1280×900): pinned MetricsStrip ($38,174.88 A/R + meters), sticky header confirmed pinned on scroll at the pixel level (thead top == body top after scrollTop=600), 68 real rows, 0 console errors. A/R banner absorbed into the strip; `clients-ar-banner.tsx` deleted; route → fullHeight:padded; en/es `metrics.*` keys added.
- **Catalog** — migrated (agent, commit `2464d8cb`) + LIVE-VERIFIED: `// SUPPLY` MetricsStrip (STOCK HEALTH/ON-HAND/PRODUCTS), glass shell, sticky header bg `rgb(0,0,0)`, 20 product rows, **40 inline-edit cells** (COST+PRICE) + **20 ACTIONS** menus preserved; `cells.tsx` untouched; 0 console errors.
- **Projects** (grid) — migrated + LIVE-VERIFIED: spreadsheet renders inside TableShell with the unified MetricsStrip (`// ACTIVE`/`// TOTAL VALUE`/`// COMPLETION`/`// OVERDUE TASKS`/`// AVG DURATION`); saved-view tabs + density/zoom + bulk-select + frozen columns intact; sticky header pinned (header top == grid top after scroll); 0 errors. ProjectsTable's virtualizer/scroll/frozen/inline-edit byte-unchanged. Canvas/map HUD MetricsHeader left in place (different context).
- **Books** — migrated (agent, commit `157596ad`) + LIVE-VERIFIED: unified ledger MetricsStrip (`// NET` olive meter, `// CASH FLOW` sparkline, `// A/R` aging ramp in `--color-financial-*` tokens, `// JOBS`) + period pill, segment control (INVOICES/ESTIMATES/EXPENSES/SYNC) + LIST/AGING toggle + stat line, sticky header, 44 rows, 44 ACTIONS; 0 errors. Agent caught a real token bug — `--fin-*` is `.pmf-scope`-only; corrected to global `--color-financial-*`.
- **Pipeline** (grid) — migrated (agent, commit `ddd7de04`). Focused/kanban mode LIVE-VERIFIED (renders, MetricsHeader correctly kept only for non-table mode, 0 errors). Table-mode render is gated behind the off-by-default `pipeline_table_view` flag (unshipped WIP) so it can't be live-shot in this env; verified by diff (mirrors the live-verified Projects wrap exactly; `pipeline-table.tsx`/`-header.tsx` byte-unchanged → virtualizer/grouping/frozen/inline-edit intact) + tsc-clean.
- **Done-gates (all pass):** `tsc --noEmit` → 7 errors, ALL pre-existing/unrelated (`xlsx` not installed in worktree + the known `notification-service.test.ts`); **zero in any P6-2 file**. `eslint` → **0 errors**, 5 pre-existing warnings (none in new files). `audit-design-system` → **zero token violations** in new/migrated code; every `var(--token)` resolves globally; the only raw values in touched files are pre-existing + out-of-scope (canvas/map HUD, on-spec group-toggle border).
- **Pipeline gate removed + LIVE-VERIFIED (2026-06-29, Jackson directed):** the Pipeline table view was dark-launched behind the per-company `pipeline_table_view` flag (same mechanism as Projects' `projects_table_v2`, which is already on) and never switched on — that's why it couldn't be shot earlier. Jackson: "it should have no gate." Dropped the gate (`pipeline/page.tsx`: mode resolution + switcher no longer read the flag; dead hook `use-pipeline-table-flag.ts` removed). Verifying live then exposed a latent bug the gate had hidden: the page-HUD banners floated at the surface *top* in table mode, covering the TableShell's MetricsStrip — fixed by pinning them bottom-left on all desktop modes (the focused-mode treatment). Now LIVE-VERIFIED: table view renders the unified MetricsStrip (`// PIPELINE VALUE $99.5K`/`WIN RATE 86%`/`OPPORTUNITIES`/`AVG DEAL`/`VELOCITY`), saved views, GROUP/SHOW CLOSED, bulk-select, stage tags, grand-total footer, sticky header; banner clears the strip; 0 errors. So all 5 surfaces are now live-verified. (Note: `// VELOCITY 5116d` is a pre-existing demo-data quirk in the metrics calc, not from this work.)
- **NOT pushed** — awaiting Jackson's explicit go-ahead (merging ops-web main auto-deploys prod).

## REWORK — 2026-06-30 (Jackson live review of shipped P6-2)

P6-2 shipped to prod (`7b329c27`) and Jackson reviewed it live — **not happy with the look**. Five corrections (verbatim): (1) tables must be **full-bleed**, not in padded containers; (2) the metrics bar must **scroll up and out of view**, not be pinned; (3) the **toolbar** is awkwardly positioned; (4) Pipeline's focused/table toggle must move **into the toolbar**; (5) the metrics bar must be **decoupled from the table and consistent across all screens** — and "the metrics bar as it stands on the pipeline FOCUS view is how it's supposed to look" (i.e. the canonical `MetricsHeader variant="full"` 28px treatment, not the shrunken 20px in-shell strip).

### Corrected architecture
Worktree `ops-web-table-rework` off `origin/main`. One pattern for both archetypes — a shared **`TableChrome`** (`ui/table-shell/table-chrome.tsx`) renders the **scroll-away metrics bar** + a **sticky toolbar** inside the scroll region, and publishes the toolbar height as `--shell-header-top` so the table's column header sticks flush BELOW the toolbar.

- **`MetricsStrip`** retuned to the canonical look: value tier `text-data-lg` (20px) → **`text-display` (28px) `tracking-[-1px]`** (matches the focus-view `MetricColumn`). Anatomy (// label, count-up, mini-viz, trend, sub) unchanged → still consistent across all 5.
- **`TableShell`** is now FULL-BLEED — dropped `glass-surface` / `rounded-panel` / panel border. Register archetype: shell body scrolls, renders `TableChrome` + `RegisterTable inShell`. Grid archetype: `scroll={false}` → the grid owns its scroller; chrome injected via the grid's new **`aboveHeader`** slot so the metrics scroll away INSIDE the virtualized scroller.
- **Grid tables** (`projects-table.tsx`, `pipeline-table.tsx`): Jackson approved a **tiny additive `aboveHeader?: ReactNode` slot** (rendered as the first child inside the scroller, above the sticky header) — virtualizer / frozen columns / density-zoom / inline edit / stage grouping logic **untouched**. Headers (`*-table-header.tsx`) + `RegisterTable` thead: `top-0` → `top-[var(--shell-header-top,0px)]` (default 0 = legacy behavior for other consumers).
- **Pipeline mode switcher** moved from the floating page HUD into the table toolbar (`PipelineToolbar` gained a `leading` slot holding `<PipelineModeSwitcher/>`); the floating HUD switcher removed from `pipeline/page.tsx`. Focused mode keeps its own bottom-toolbar `MODE: TABLE` toggle.
- **Routing**: register routes + pipeline flipped `fullHeight: "padded"` → **`"bleed"`** (drops the `px-3 pb-3` route gutter); projects spreadsheet wrapper lost its `p-3`. Projects already `"bleed"`.

### Done-gates (all pass)
- `tsc --noEmit` → 7 errors, ALL pre-existing/unrelated (`xlsx` not installed in worktree + `notification-service.test.ts`); **zero in any reworked file**.
- `eslint` (all touched files) → **0 errors**, 5 pre-existing warnings (none from the rework).
- `audit-design-system` → **zero violations**; every color is a token, the only arbitrary values are runtime layout coordination (`--shell-header-top`) + micro-measurements matching the existing component convention.

### LIVE-VERIFIED — all 5 surfaces (dev bypass, webpack, 1280×900, 0 console errors)
- **Projects** (grid): full-bleed; scrolled the 30-row "All Active" view → **metrics scrolled away, toolbar + column header pinned** (`--shell-header-top` 98px); saved views / density / zoom / frozen NAME column intact.
- **Pipeline** (grid): full-bleed; **focused/table switcher now IN the toolbar** (leading segmented control); focused mode top is just the canonical metrics bar (no floating switcher); table mode shows saved views / GROUP / SHOW CLOSED / grand-total footer / banner clears the strip.
- **Clients** (register): full-bleed; scrolled 68 rows → **metrics bottom −128px (gone), thead pinned at 125px** = toolbar height.
- **Books** (register): canonical metrics + A/R aging-ramp viz + 30-day period pill, segment control, LIST/AGING, statline, status tags.
- **Catalog** (register): inline-edit COST/PRICE cells (dashed underline) + ACTIONS overflow preserved; STOCK HEALTH/ON-HAND/PRODUCTS metrics.

- **NOT pushed** — awaiting Jackson's explicit go-ahead.
