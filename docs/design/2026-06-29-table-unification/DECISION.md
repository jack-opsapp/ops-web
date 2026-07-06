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

## REWORK 4 — 2026-07-02 (Cross-tab toolbar consistency, brainstormed + approved)

Jackson: "the toolbar generally is not consistent enough across tabs. Anything used consistently across tabs must be in the same place — filters one spot, search one spot + consistent width, create one spot." Ran `brainstorming` (canonical grammar presented; **approved: segment/mode → row-2 tab strip**) + `interface-design` (project has `.interface-design/system.md` → apply the system; build a shared component, not five hand-arranged toolbars).

**One shared `Workbar` slot component now OWNS the grammar** (`ui/table-shell`), so positions can't drift per-tab:
```
Row 1:  [ search ] [ filters ] ──(ml-auto)── [ tools ] [ create ]
Row 2:  [ tabStrip ]   — segment/mode + saved-view tabs
```
Slots: `search` (leftmost) · `filters` · `tools` · `create` (rightmost) · `tabStrip` (row 2) · `children` (extra rows, e.g. stock's bulk bar). Empty slots collapse; row 1 is skipped entirely when all its slots are empty (Books expenses/sync).

**All five surfaces migrated to it.** Consistency delivered:
- **Search** — one component (`SearchInput`) at ONE width (240px), always leftmost, on every tab. Retired two hand-rolled searches (Pipeline + Projects, which used an off-spec `focus-within:ring-ops-accent` — now the spec border-brighten). Was 3 widths (200/220/240) + 2 components before.
- **Filters** — always immediately right of search.
- **Create** — always rightmost, the shared `WorkbarButton` (NEW LEAD / ADD / New Invoice / New Client). Projects has none (FAB-created) — fine, "consistent where it exists."
- **Segment/mode + saved-view tabs → the row-2 tab strip** on every tab: Catalog PRODUCTS/STOCK, Books INVOICES/…/SYNC, Pipeline FOCUSED/TABLE (moved down from row 1), Projects + Pipeline saved views.
- **Pipeline table density fix** — the tab slot is flex-1 so many saved views scroll on one line (no wrap); the redundant `// N deals` toolbar readout dropped (the grand-total footer already shows it) so row 1 fits one line. Pipeline table is now 2 clean lines like every other tab; metrics/toolbar still never remount across focused↔table.

**Gates:** `tsc` 7 pre-existing only; `eslint` 0 errors (4 pre-existing warnings); zero raw colors in touched files (all tokens). **LIVE-VERIFIED** (0 console errors) — search at x=96/240px identical on Projects/Pipeline/Catalog/Clients; create rightmost; segment/tabs on row 2; Catalog + Projects + Pipeline (both modes) screenshot-confirmed. Commits `f008ac65` (Workbar + Clients/Catalog), `4eda226c` (Books), `6560ec3f` (Pipeline + Projects). **NOT pushed.**

## REWORK 5 — 2026-07-02 (Post-merge QA: Workbar 3-row wrap, search focus loss, search breadth, dead pipeline-table clicks)

Jackson, testing prod (PR #107 live): (1) Catalog toolbar renders THREE rows at ~1040px; (2) typing in search unfocuses whenever you pause; (3) projects search "only indexes titles"; (4) the pipeline table is "basically read only." Branched `claude/amazing-raman-14024d` off origin/main (post-#107). All four reproduced live before fixing.

**1 — Workbar right cluster orphaned onto its own row (`0ab11bc1`).** Row 1 was a wrapping flex row, so once search+chips+count exceeded the width, the `ml-auto` tools+create cluster line-broke onto a lone right-aligned line → 3 toolbar rows (measured at 1040: search y212 / ADD y262 / segment y313). Flex can't express the intended yield order (auto tracks steal sub-pixel shrink from an exact-fit cluster → phantom wrap; the sum-below-1 shrink rule under-distributes → 128px overflow on pipeline-table). **Row 1 is now a grid** — `auto · minmax(min-content,1fr) · auto` — the middle `filters` cell reflows its chips onto extra lines INSIDE the cell down to its widest unwrappable child; only past that floor does the right cluster compress, by wrapping internally right-aligned. Reflow-not-scroll is deliberate: filter slots host non-portaled dropdowns (Pipeline stage/assignee) an `overflow-x` rail would clip. Below sm the phone flex-wrap fallback returns. Pipeline table's GROUP/CLOSED labels moved lg→xl to match the density segments, so the portaled cluster compresses to icons together and holds one line through 1024–1280. Live-verified at 1040/1280/1440 on all five surfaces + stock drilled: cluster single-line + right-pinned everywhere, 2 toolbar bands on Catalog, zero row overflow, persistent pipeline chrome still never remounts.

**2 — Search input dropped focus when a fetch settled (`53f61314`).** Projects keys its server query on the search string; the moment a query resolved to ZERO rows the shell swapped the whole grid for a placeholder — remounting the aboveHeader chrome (and the SearchInput inside it) → `document.activeElement` fell to `<body>` (reproduced: type "zzqx", pause, focus gone). Deleting back to a match swapped the tree again → dropped focus twice per mistype. Row-level states (loading/error/no-matches) now render INSIDE the mounted grid via a new `ProjectsTable emptyOverlay` slot (sticky-left, viewport-width stripe under the pinned header) — the grid + chrome never remount; only view-level states keep the placeholder frame. The query also now keys on a debounced value (new shared `useDebouncedValue`, trailing 250ms, immediate on clear) instead of one Supabase request per keystroke. Live-verified both directions: 0-match settle and recovery both keep focus.

**3 — Search was contiguous-substring + missing half the fields (`25a9262d`).** The projects ilike DID cover client_name/address (single-token client search worked live) — the real gaps: a multi-word query spanning fields ("miramar housing") matched NOTHING (one contiguous ilike), and email/phone/trade/notes/next_task weren't searched. Now: whitespace-tokenized, every token must match ≥1 field — server-side one `ilike_any` per token (PostgREST ANDs the `.or()`s) over title/client_name/client_email/client_phone/address/trade/notes/next_task (status stays excluded: stored slugs ≠ display labels; views/chips own it). Client-side surfaces (pipeline table + board, Clients, Catalog products + stock) adopt the same grammar via shared `matchesAllTokens` (`lib/utils/search`). Live-verified: "miramar housing" → 2 rows; "@" (only matchable via client_email) → 3 rows against the live prod view. 18/18 unit tests.

**4 — Pipeline table rows wrote to a store nobody rendered (`42c641cd`, `3adfd196`).** Row click → `openDetailPanel(id)` → nothing: the only consumer (`PipelineFocusedDetailWindow`) mounts inside the focused shell, which the mode crossfade unmounts in table mode — dead since PR #73 removed the spatial-mode panel render (clicks "worked" only if they landed inside the 250ms crossfade exit window). Inline cell editing + the stage menu were always wired (verified live) — but with the dominant interaction dead the table read as inert. `pipeline/page.tsx` now owns a `PipelineFocusedDetailWindow` instance while table mode is active (same shared window, portaled, same handlers); `detailPanelOpportunity` resolves from the PRE-filter set so table-only matches (assignee/source, closed deals) don't self-close; `focusOrigin` gains a table fallback (`data-pipeline-table-row-id`, double-rAF so portal teardown can't reset the restore). The dead `PipelineDetailPanel` drawer (~700 lines incl. suite) excised — the file keeps only what the window composes (body, action menu, handler types); the window suite gains the table-mode focus-restore case. Live-verified at steady state: row click → window opens with the right deal; Escape closes; focus lands back on the row. Focused mode re-verified intact (card Actions → Details).

**Gates:** `tsc` — 7 pre-existing only (xlsx + notification-service); `eslint` — 0 errors, 3 pre-existing warnings; vitest — 101/101 across pipeline-table + projects-table suites, 8/8 on the window + body suites; zero raw colors (grid template via inline style is layout, not styling). Commits `0ab11bc1`, `53f61314`, `25a9262d`, `42c641cd`, `3adfd196` on `claude/amazing-raman-14024d`. **NOT pushed** — awaiting Jackson's go-ahead (merging main auto-deploys prod).

## REWORK 6 — 2026-07-02 (Client picker: "WAY too big, ugly and cumbersome" → Picker-kit correction + unification)

Jackson, on the project-details client picker: too big for a desktop popover, awkward, cumbersome — and asked whether the new pipeline client cell used it. Diagnosis found THREE client-picker implementations: (1) the workspace identity tab's hand-rolled dropdown — full field width (~665px), 64px trigger + 64px search rows (the complaint); (2) the projects table cell on the canonical `EntityPicker`; (3) the new pipeline cell mirroring the pipeline assignee cell's hand-rolled popover idiom (which the Picker kit docstring explicitly forbids). Root cause under all of it (`b2389fb9`): **the Picker kit was authored in default-Tailwind units** ("rows are compact ~32px") **but the OPS spacing scale is doubled** (h-8 = 64px) — so every kit-built popover shipped with 64px search rows, 64px min-height items, and 32px icons since the kit landed. Projects table pickers included.

- **Kit corrected to its authored contract** in real px (repo arbitrary-px convention): 32px search row + item min-height, 16px icons, 4/6/8px pads, group headings tightened. Fixes every existing + future picker at the source.
- **All client/assignee pickers unified on `EntityPicker`:** the workspace identity tab keeps its form-input trigger but opens the compact 256px canonical panel — portaled at `z-modal` (3000) so it clears the floating window (windows z 2000+ sit above the default `z-dropdown` 1000; new `contentClassName` prop is the sanctioned override). Pipeline client + assignee cells dropped the hand-rolled popover for the same controlled EntityPicker wiring the projects table uses. Search-clear labels wired to the `picker` dictionary (en/es).
- **Live-verified:** workspace picker 256×322 panel, 32px search, 33px rows, z3000 over window z2001, Remove-client row, correct collision flip (screenshot); pipeline client 256px/33px rows incl. token-search → select → `// CHANGE SAVED` undo toast; pipeline assignee 256px/33px rows. (Note for future live QA: the preview browser pauses rAF when occluded, freezing framer `AnimatePresence mode="wait"` swaps — force frames via screenshots; not an app bug.)
- **Gates:** tsc pre-existing-only; eslint 0; 94/94 across entity-picker + identity-tab (27/27 UNCHANGED — testids preserved) + pipeline-table + detail-window suites. **NOT pushed.**

## PRODUCTION PASS — REWORK 7 — 2026-07-02 (defect fixes + Jackson's 5 taste calls + picker-doctrine debt + audit/e2e)

Took the branch from "gates green" (REWORK 5+6) to prod-ready: fixed the three real defects a planning pass found, executed Jackson's five approved taste calls, retired the remaining hand-rolled pickers on the touched surfaces, and ran the formal audit + e2e. Sixteen atomic commits (`831e3a5a`…`d65224fa`) on `claude/amazing-raman-14024d`.

**P0 — correctness (no approval):**
- **Route-parity test** (`831e3a5a`): the parity spec still expected `/pipeline` fullHeight `padded`; REWORK 1 shipped `bleed` to prod (PR #107). It failed on origin/main too — nobody saw it because prior sessions ran targeted suites and main CI is perpetually red on unrelated lint. `padded → bleed`, 40/40.
- **Weather duplicate-key** (`7ac4a275`): the fresh-fetch forecast rows ship `id: ""` (the DB assigns on upsert), so the sidebar's `<WeatherRow key={f.id}>` rendered five `key=""` siblings → the 4–8 "same key" console errors on every project-window open. Keyed on `f.forecastDate`. Live: window open → 0 errors (baseline 4–8).
- **Lint debt** (`6224d89e`, `3e93f37c`): orphaned `previousOpportunityStage` import (drawer excision leftover), the two `activeViewSortKey` effect deps (documented eslint-disable — the key IS the stable-encoded sort), and a stray `CalendarDays` import. All touched files 0/0.

**Jackson's five decisions (all approved 2026-07-02):**
1. **Form density → yes.** The workspace `TextInput`/`Select`/`Segmented` atoms + the client-form crosshair were authored in default-Tailwind units — `h-8` = **64px** on the doubled scale, where `DESIGN.md` § Inputs specs a **36px** floor. Same authoring-bug class the Picker kit had (REWORK 6). Fixed to `min-h-[36px]`; live-measured every edit-form body field at 36px (project name/status/schedule dates + visibility segmented; client name/email/phone/address + crosshair 36×36). Footer buttons (a separate 56px bar) left alone — not what was flagged. Two atom tests that pinned `h-8` (mislabeled "32px") updated. (`a735adbc`)
2. **Books statline → the metrics bar (invoices only).** At 1040 the invoices workbar stacked ~5–6 lines; A/R + OVERDUE duplicated the ledger strip's A/R cell. The three unique invoice stats (collected / collection rate / avg days to pay) fold UP into that A/R cell's sub via a new invoices-only `arExtra` on `LedgerStrip` — company-wide, all-invoices figures, a semantic match for the always-all-open A/R cell (the top-chase hint yields, still in the aging view). Result: one clean band. **Estimates keeps its statline** — its 5 stats (pending/approval/convert/sent/avg-estimate) are estimate-pipeline metrics with **no home in the shared ledger strip**, so removing them would lose data; only its count moved to `meta`. (`26962ee3`) *(Open follow-up for Jackson: this leaves invoices statline-less and estimates with one — an intentional asymmetry to avoid silent data loss; decide later whether estimate-pipeline metrics deserve their own strip.)*
3. **Counts → one home.** New `meta` slot in the `Workbar` grammar (a fourth grid track between filters and the tools cluster: `auto · 1fr · auto · auto`, collapsing when empty) + shared `WorkbarCount` so every surface's row count reads identically. Migrated Projects (`9/9 ROWS` out of the tools cluster), Catalog products/stock, Clients, Books invoices/estimates. Pipeline table keeps none (footer owns its count — REWORK 4). Live-verified in the meta position on Projects/Catalog/Clients/Books at 1040. (`50264ca0`)
4. **Clients placeholder** (`1bc2ac3b`): "Search clients, companies, contacts…" clipped at the 240px field → "Search clients…" (mirrors Catalog); live `textClipped: false`.
5. **"+ New client" everywhere.** The board card's create-and-link now works from every client picker via a shared `useClientCreateAction` hook (query-seeded label + create-by-name, gated on `clients.create`): the project-form ClientPicker, the legacy `/projects/new` select, and both table client cells. Built on a backwards-compatible `EntityPicker.createAction` extension — `onCreate(query)` + `label(query)` (`abdbfd61`). Live-verified end-to-end on the pipeline table cell (create → linked → undo toast); demo client created + cleaned up through the app. (`d65224fa`)

**Picker-doctrine debt (no approval — doctrine):**
- **Pipeline stage + assignee filters** (`0834c42d`): the two hand-rolled non-portaled `absolute z-50` listboxes (no search, no keyboard nav — the exact idiom the kit docstring forbids) rebuilt on `EntityPicker` single-select, the `"all"` sentinel mapped through `noneOption`; assignee gained typed search. The kit now stamps `data-keyboard-scope` on every (portaled) panel and redirects open-focus to the cmdk root when a picker has no search input, so searchless pickers keep arrow/Enter nav. Live-verified both modes + keyboard at 1040.
- **create-lead + `/projects/new` client selects** (`ffa95a12`, `aa6121ba`): hand-rolled absolute dropdowns → `EntityPicker`. Excised the consumer-less `CreateLeadModal` Dialog wrapper; made the `/projects/new?clientId=` deep link actually preselect (silently broken since it shipped — the page never read the param). Route kept (live-linked from widgets + onboarding emails).
- **Board `ClientLinkControl`** (`0517578e`): the last bespoke client picker — manual portal/anchor/keyboard machinery — replaced by `EntityPicker` (`getDescription` + `getKeywords` added so no row detail or search breadth is lost). Radix owns collision, cmdk owns nav; the current client is the chosen row, the query-seeded footer preserves create-and-link; an exact-name-match links the existing client instead of duplicating. Live: link/relink/create-and-link/Escape-restores-focus; testids + card `stopPropagation` preserved.

**Audit + e2e:**
- **`audit-design-system` over the full branch diff — zero high-severity.** REWORK 7 introduced **zero** raw colors (the 5 hits in touched files are pre-existing toggle/divider states that already match spec values), no deprecated fonts, and the only two accent tokens added are `focus-visible` rings on buttons (sanctioned). Known findings pre-fixed (`2242348e`): picker-search inherited the retired accent focus ring → §340 border-brighten (`focus-within:border-line-hi`); dead `stock.newItem` catalog keys deleted.
- **E2E (6 target suites, webpack on 3041):** 14 passed. 3 failures (`pipeline-table:837` Won dialog, `projects-table-v2-phase4:1163` team assign, `phase5:994` "+ New view") are **PRE-EXISTING — proven identical at base `bd01705a`** in a throwaway worktree; they exercise flows REWORK 7 never touched (stage-action menu — deliberately not a picker — team cell, Won dialog) and are stale test selectors ("+ New view" vs the shipped "New view"). `projects.spec.ts` failures are `networkidle` dev-server flakiness. **Zero e2e regressions from this pass.**

**Gates:** `tsc` — 7 pre-existing only (xlsx + notification-service); `eslint` — 0 errors on all touched files; `vitest` — full unit run 3121 pass / 0 fail (only the 2 xlsx collect casualties; route-registry now green), 716/716 across the reworked pipeline/projects/workspace/picker suites (two e2e-adjacent test mocks gained the `useCreateClient` export the new hook reaches for). **NOT pushed** — Task 16 is the hard gate; merging `ops-web` main auto-deploys prod.

## ROUTE CONSOLIDATION — follow-up #2 — 2026-07-05: /tasks/new (client-widget Create Task)

The client-list widget's row "+" menu shipped a **Create Task** action navigating to `/tasks/new?clientId=` — a route that has **never existed in the repo's entire git history** (no `src/app/(dashboard)/tasks/` ever, no middleware/next.config redirect). Born dead in the 2026-04-02 client-communication-widgets redesign; 404'd for every user since. Sole live reference was the widget line (re-verified on base `e665f233`); **no external URL contract** — zero references in emails/marketing (unlike `/projects/new`) — so no hand-off route is owed.

**Jackson's call (2026-07-04): REMOVE.** Tasks are project-scoped in OPS — the create-task floating window + form hard-require a project; task creation stays at its canonical entry points (FAB "task" action, Projects "Add Task"). Client rows keep the four client-scoped actions. Client-aware seeding of the task form was considered and explicitly rejected.

**What changed (`c3b24637` on `fix/tasks-create-entry`, off origin/main `e665f233`):** the action entry deleted from the `WidgetInlineAction` array in `client-list-widget.tsx`; the now-orphaned `ClipboardList` lucide import dropped; consumerless `clientList.createTask` keys removed from en/es `dashboard.json`. Nothing else touched — the adjacent Create Project line left byte-identical on purpose (see merge notes).

**Gates:** `tsc` — 7 pre-existing only (xlsx + notification-service); `eslint` — 0 errors on the widget (1 pre-existing `useScrollFadeScroll` warning, present on origin/main); both dicts `JSON.parse` clean; `git grep 'tasks/new' -- src/` — **empty**; vitest 41/41 (tests/unit/dashboard incl. `use-widget-entity-open` + route-registry). **LIVE-VERIFIED 2026-07-06** (dev bypass, 1440×900, lg client-list widget on the ALL deck): row "+" menu = exactly Create Project / Create Invoice / Create Estimate / Delete Client — no Create Task; Create Project dispatches to `/projects/new?clientId=…` (NEW PROJECT loads — pre-consolidation base); Create Invoice dispatches to `/books?segment=invoices&action=new&clientId=…` (NEW INVOICE composer opens); 0 console errors; evidence at `docs/artifacts/2026-07-06-client-list-plus-menu-no-create-task.png` (untracked). **NOT pushed.**

**Expected merges:** (a) this DECISION.md section will both-added-conflict with unmerged `feat/projects-new-consolidation` and `claude/wizardly-shannon-dc59fe` appends — resolve keep-all; (b) the consolidation branch edits the ADJACENT Create Project line in the same widget actions array (repointing it to `openProjectWindow({ initialClientId })`) — a same-hunk textual conflict is expected and trivial: keep BOTH (their Create Project repoint + this Create Task deletion).

**Filed follow-ups, not addressed here:** `/clients/new` (Cmd+Shift+C) still deserves the same consolidation question (per the consolidation's own follow-ups note); the create-task modal's i18n drift is being handled in a separate task.
