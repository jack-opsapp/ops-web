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

## REWORK 2 — 2026-06-30 (Pipeline chrome remounts on mode switch)

Jackson (verbatim): *"when I switch the view mode [focused ↔ table], the toolbar moves. Why is the whole toolbar and the whole metrics bar rerendering when I switch the view mode? Only the content below the toolbar is changing and the couple elements within the toolbar are changing. Why is anything else changing?"*

**Root cause.** `pipeline/page.tsx` rendered the two modes as two separate surfaces inside `<AnimatePresence mode="wait">`. Each surface owned its OWN `MetricsStrip` + `TableWorkbar` toolbar (table via `TableChrome`/`aboveHeader`; focused via a flex column). Switching modes unmounted the entire outgoing surface (metrics + toolbar + content) and mounted the incoming one, so the metrics bar + toolbar remounted (re-running the count-up) and shifted instead of staying put.

**Decision — hoist the shared chrome above the crossfade.** One persistent `MetricsStrip` + one persistent `TableWorkbar` now live in `pipeline/page.tsx` ABOVE the `<AnimatePresence>`; the crossfade wraps ONLY the content region (kanban board ↔ table grid). Shared, never-remounting: the metrics bar, the `[FOCUSED|TABLE]` mode switcher, and a single unified search input (feeds both surfaces). Mode-specific clusters swap: focused renders `PipelineFilterRow` (stage/assignee + NEW LEAD, `showSearch={false}`) + review-emails inline; the table surface (`PipelineTableShell`, mounted only in table mode) PORTALS its saved-view tabs + grid controls (`PipelineToolbar`: GROUP / SHOW CLOSED / count / save / density / view-settings) up into the persistent toolbar's two `display:contents` slots. Portals are gated on `usePipelineModeStore().mode === "table"` (read inside the shell, which stays subscribed during its AnimatePresence exit) so the outgoing table cluster clears instantly — no duplicate controls mid-crossfade. The tab strip is a table-only SECOND row below the controls row, so it never pushes the switcher/search.

**Scroll-away tradeoff — Jackson chose "pin it" (asked before building).** A single persistent metrics instance cannot also live inside the grid's own scroller, so on the pipeline TABLE view the metrics bar is now PINNED rather than scrolling up and out of view. Projects/Books/Catalog/Clients keep scroll-away (their metrics stay in-scroller); pipeline is the lone pinned table because its bar is shared across two modes. `PipelineTableShell` no longer injects chrome via the grid's `aboveHeader` slot (passes nothing → `--shell-header-top` unset → grid header sticks at `top-0`, flush under the persistent toolbar). `pipeline-table.tsx` / `projects-table.tsx` virtualizers byte-unchanged.

### Files
- `pipeline/page.tsx` — persistent `MetricsStrip` + `TableWorkbar` (mode switcher + shared search + focused cluster + two portal slots) above a content-only `<AnimatePresence>`; focused board wrapped in `relative h-full min-h-0`.
- `table/pipeline-table-shell.tsx` — drops its own metrics/`TableChrome`/`TableWorkbar`; builds `viewTabsNode` + `toolbarClusterNode` and `createPortal`s them into the page slots (gated on `tableActive`); renders just the grid + banner + footer + dialogs + bulk bar. New props: `tabsSlot`, `clusterSlot`, `search`, `searchInputRef`.
- `pipeline-filter-row.tsx` — `showSearch?: boolean` (focused cluster passes `false`; search is shared).
- `table/pipeline-toolbar.tsx` — search + `leading`/mode-switcher removed (both shared); renders the right-aligned (`ml-auto`) controls cluster only.

### Done-gates (all pass)
- `tsc --noEmit` → 7 errors, ALL pre-existing/unrelated (`xlsx` not installed + `notification-service.test.ts`); **zero in any touched file**.
- `eslint` (touched files) → **0 errors**, 4 warnings ALL pre-existing (verified against HEAD: `activeView?.sort` dep at shell:240; three unused-var warnings in page.tsx). The one new warning introduced (`searchInputRef` dep) was fixed.
- Design-system audit → **zero token violations** in touched files (no raw hex/rgb/hsl; new arbitrary sizes `w-[200px]`/`h-[28px]`/`h-[12px]` match the existing pipeline-toolbar arbitrary-px convention).

### LIVE-VERIFIED — dev bypass, webpack, 1280×900, **0 console errors** (all warnings pre-existing/environmental)
Instrumented the shared nodes (stamped `data-persist-check` + stored live object refs on `window`) and diffed across switches:
- **focused → table:** metrics / mode switcher / search / toolbar container are the **SAME DOM objects** (`===` true, stamps survived) at **identical** rects (metrics `{72,56,1208,120}`, switcher `{96,186,185,28}`, search `{338,192,142,17}`) → **no remount, no movement**. Toolbar top-left unchanged; height grew 49→138 only as the table's tab strip appeared BELOW the controls row. Mode-specific swap confirmed: ALL STAGES → GROUP + SHOW CLOSED + saved-view tabs + grid; the table clusters live INSIDE the persistent workbar (`groupInWorkbar`/`viewTabsInWorkbar` true — portals landed correctly).
- **table → focused (round-trip):** the SAME nodes still carry the original stamps at the original rects → never remounted across **two** switches. Focused controls back, table controls + grid gone, 8-column board re-rendered.
- **Preserved behaviors exercised:** portaled GROUP toggles the grid into stage groups (`NEW LEAD //4`, `QUOTED //2`, `NEGOTIATION //1`, collapse chevrons) → portaled controls are wired, not just rendered; frozen DEAL column, stage tags, density control, saved-view tab strip, grand-total footer (`[TOTAL VALUE] $99,500 [WEIGHTED] $19,100`), focused kanban board all intact.

- Committed `57be4424` on `feat/web-overhaul-table-rework`. **NOT pushed** — awaiting Jackson's explicit go-ahead (merging ops-web main auto-deploys prod).

### Design-skill audit (`audit-design-system` + `animation-architect`) — 2 fixes, commit `3471ae61`
Ran the OPS design skills over the new chrome against `.interface-design/system.md` (+ token map in `tailwind.config.ts`) and `.claude/animation-studio.local.md`. Everything traced to tokens (zero raw hex/rgb; `rounded`=5px, `border`=0.10, `surface-input`, `text-3`, `line-hi`=0.18 all confirmed) EXCEPT two treatments — both corrected:
- **Input focus.** The shared search inherited the old table search's `focus-within:ring-ops-accent` (accent ring). Inputs spec §340 = "Focus: border brightens to rgba(255,255,255,0.20) — **no accent**." → `focus-within:border-line-hi` + `transition-colors`. Live-verified: on focus the label border goes 0.10 → **0.18**, `boxShadow: none`, no steel-blue ring.
- **Reduced-motion crossfade.** `modeCrossfadeTransition` collapsed to `duration: 0` (instant cut) under reduced motion. OPS motion config §reduced_motion = "fallback is opacity-only at **150ms** … equivalence, not compromise." → `reducedMotion ? 0.15 : 0.2`. (Normal 200ms ≤ the 250ms state-change ceiling; easing already the mandated `EASE_SMOOTH` = `cubic-bezier(0.22,1,0.36,1)`; opacity-only.)
- **animation-architect verdict:** the hoist is a net motion improvement — a **Transition beat** where the persistent metrics+toolbar are now the spatial anchor (continuity: "camera move, not a cut"), opacity-only (compositor-safe, no layout thrash), and the whole-surface remount is eliminated. The `mode="wait"` vs overlapping-crossfade tradeoff (a ~200ms focused→table cluster gap) was surfaced to Jackson, not decided unilaterally.
- Gates re-run: `tsc` 7 pre-existing only; `eslint` 0 errors. Committed `3471ae61`. **Still NOT pushed.**

## REWORK 3 — 2026-06-30 (Catalog + Clients toolbars "not done" → toolbar CTA unification)

Jackson: *"catalog and client toolbars are not done."* Diagnosed live: the Catalog (ADD) and Clients (NEW CLIENT) create CTAs used the heavy `<Button variant="primary" size="sm">` primitive. **Root cause:** this project's Tailwind spacing scale makes `h-8` = **64px** (not 32px), so the primitive's `sm` size rendered a 64px slab that dwarfed the 24–31px dense toolbar controls. The "done" surfaces (Projects, Pipeline) sidestep this with compact **arbitrary-px** chips (`h-[28px]`).

**Fix — one shared toolbar CTA.** Added `WorkbarButton` to `ui/table-shell` (exported alongside `TableShell`/`TableWorkbar`): the canonical **28px filled-accent chip** — `rounded-chip`, `bg-ops-accent`→`ops-accent-hover` on hover, accent focus ring w/ black offset, `text-micro` mono uppercase. Adopted it in **Catalog** (products + stock) and **Clients**, and — since Books carried the **identical** giant-`<Button>` CTA — extended it to **Books** (invoices + estimates) for full register-surface consistency. Now every register toolbar CTA matches Projects/Pipeline. `<Button>` import dropped where it became unused (kept in stock-segment, still used elsewhere).

- **Live-verified** (dev bypass, 1280×900, **0 console errors**): Catalog ADD **64px → 28px** (`rounded-chip` 4px, `bg rgb(65,115,148)`); Clients NEW CLIENT 64px → 28px; Books New Invoice 64px → 28px — each flush with its search + kebab, toolbar row tightened.
- **Gates:** `tsc` 7 pre-existing only; `eslint` **0 errors / 0 warnings** on all 7 touched files.
- Commits `939ec8f8` (WorkbarButton + Catalog/Clients — the flagged fix) and `d6224bea` (Books — same fix, extended for consistency). **NOT pushed.** *(Follow-up worth considering: adopt `WorkbarButton` in Pipeline NEW LEAD + Projects too, so all five surfaces share the one CTA primitive.)*
- **Clients `// CLIENTS` label removed** (`ba0b2597`, Jackson): the page header already names the surface, so the label just filled the toolbar's leftmost slot — the slot every other surface gives a functional control (segment / mode switcher). Clients has none, so it was wasted space. Removed; search now takes the leftmost slot (list-view natural, aligned with the CLIENT column + filter chips), CTA stays top-right, search 220→240px. Live-verified: label gone, 0 errors. *(Open: the placeholder "Search clients, companies, contacts…" still clips the field — either shorten the copy to the terse "Search clients…" (matches Catalog's "Search products…") or widen the field if the multi-field scope hint is intentional. Jackson's call — copy change would go through `ops-copywriter` + en/es dicts.)*

## REWORK 3 — 2026-07-01 (Pipeline focused/table review, brainstormed + approved)

Jackson, live review of the pipeline tab: (1) focused view needs edge padding; (2) no animation on the focused↔table switch; (3) no NEW LEAD on the table view; (4) toolbar tools should be "a lot more consistent" between the two views ("requires a little bit of thought"). Ran `brainstorming` (design presented + **approved: full shared core**) + `animation-architect`/`web-animations`. Commits `eba11217` (toolbar + crossfade) and `a57a9f08` (padding).

- **Shared toolbar core.** Both views now share an identical core — mode switcher · search · stage filter · assignee filter · review-emails · NEW LEAD. The table keeps only its genuinely grid-specific extras (GROUP · SHOW CLOSED · density · view-settings · saved-view tabs); the board can't use them (already stage-grouped, shows closed deals in the terminal stack). Previously only switcher + search were shared.
- **Stage + assignee filters wired into the table.** `usePipelineTableData` gained `stageFilter`/`assigneeFilter`, applied to the base scope (so `// N deals` tracks them) exactly like the board's `filteredOpportunities`. Live-verified: stage="New Lead" → table shows 4 rows, all New Lead, count `// 4 deals`.
- **NEW LEAD on both** via the shared `WorkbarButton` (unifies the CTA treatment with Catalog/Clients — the follow-up noted above, now partly done for pipeline). `PipelineFilterRow` gained `showNewLead={false}` so it contributes only the filters.
- **Overlapping crossfade.** The switch dropped `mode="wait"` (which faded to blank then popped → "no animation") for a true cross-dissolve at 250ms on `EASE_SMOOTH` (reduced-motion 150ms). Live-verified: at 90ms into the switch BOTH surfaces are present (cross-dissolving); by 320ms the outgoing one has unmounted.
- **Focused edge padding.** `px-3` (24px) on the board grid so its columns align with the toolbar + metrics content edge (all inset 24px → x=96), instead of full-bleed.
- **Regressions checked:** persistent metrics/toolbar still never remount across the switch (same DOM nodes + stamps survive); `tsc` 7 pre-existing only; `eslint` 0 errors (4 pre-existing warnings). 0 console errors. **NOT pushed.**
