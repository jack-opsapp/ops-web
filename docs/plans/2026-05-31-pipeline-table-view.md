# Pipeline Table View — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Each task is a commit. Verify every gate before moving on.

**Goal:** Add a pipeline-optimized table view as the Pipeline tab's second mode (replacing the spatial canvas), modeled on Projects Table v2, with weighted forecasting, aging/triage signals, hybrid inline editing, and full saved-view parity.

**Architecture:** The Pipeline keeps `focused` mode and gains a new `table` mode (spatial removed). The table reuses Table v2's leaf primitives (cell renderers, density control, virtualizer) lifted to a shared location, but has its own shell, column config, and in-memory data adapter over `useOpportunities()`. Stage changes route through the existing Won/Lost dialogs; safe fields edit inline; saved views persist to a new `opportunity_views` table + 6 RPCs mirroring `project_views`.

**Tech Stack:** Next.js 14 (App Router), TypeScript, TanStack Table + TanStack Virtual, TanStack Query, Zustand, Supabase (Postgres + RLS), Framer Motion, `@carbon/icons-react`.

**Design System:** `.interface-design/system.md` (40KB — read before any UI task). Also enforce `OPS-Web/CLAUDE.md` and root `OPS LTD./CLAUDE.md` token rules. Spec: `docs/superpowers/specs/2026-05-31-pipeline-table-view-design.md`.

**Required Skills (load before relevant tasks):**
- `ops-design` — every UI task; read `ops-design-system/project/DESIGN.md`.
- `frontend-design` — all component implementation.
- `custom-skills:interface-design` — table layout/density/information-hierarchy decisions.
- `custom-skills:audit-design-system` — token-compliance pass on each UI phase.
- `animation-studio:animation-architect` then `animation-studio:web-animations` — the mode crossfade and any micro-interactions.
- `ops-copywriter` — all user-facing strings (column labels, tags, empty states, view names, bulk actions).

---

## Branch, sequencing & ground rules

- **Branch:** `feat/pipeline-table-view` (already created; spec committed there). All work lands here. **Do not push** until the whole initiative is done and the PM signs off (standing pipeline push-hold).
- **Commit by name, never `git add -A`/`.`** — stage only the files each task names. The working tree has unrelated sibling-session WIP (see below); bulk staging would commingle it.
- **⚠️ Sibling-session WIP on the extraction target.** As of 2026-05-31 the working tree has uncommitted, not-ours edits to `projects-density-control.tsx`, `projects-table-row.tsx`, `projects-table-shell.tsx`, `projects-view-tabs.tsx`, `use-table-zoom.ts`, `use-project-view-actions.test.tsx`, the two `projects-table-v2-phase{4,5}.test.tsx`, and `dictionaries/{en,es}/projects.json`. **Phase 2 (shared-primitive extraction) is BLOCKED until that WIP commits.** Before starting Phase 2, run `git status --porcelain` — if those files are still dirty, do Phases 3–6 first (they don't require extraction; they can import directly from `table-v2/` temporarily) or coordinate. Never stash/restore/modify those files.
- **TDD where it has teeth.** Pure logic (adapter, derivations, flattened virtual model, fallbacks) is test-first. Visual components are verified by Playwright/manual against tokens, not snapshot-tested into rigidity.
- **Test runner:** `npx vitest run <path>` (unit/integration), `npx playwright test <path>` (e2e). Type-check gate: `npx tsc --noEmit`. Lint: `npm run lint`.
- **Verification gate per phase:** `npx tsc --noEmit` clean + phase tests green + `npm run lint` clean before the phase's final commit. No phase is "done" until these pass — evidence before claiming completion (`superpowers:verification-before-completion`).
- **Icons: PM OVERRIDE (2026-05-31).** The plan originally said "Carbon only" (from CLAUDE.md), but **`@carbon/icons-react` is NOT installed** and the entire codebase (352 files incl. every Table v2 reference component) uses **`lucide-react`**. The `549ae29e "docs: adopt IBM Carbon"` commit was docs-only and never implemented. **Ruling: use `lucide-react` to match the actual codebase convention.** Do NOT add the Carbon dependency mid-initiative. Appendix B's Carbon mapping is VOID — use the lucide names directly (Search, Save, Pencil, Plus, X, Check, Star, ChevronDown/Right, Rows3/Minimize2/Maximize2, Loader2, Mail, LayoutGrid/Layers for grouping, ArrowUpRight for convert, AlertTriangle for overdue). The CLAUDE.md↔codebase contradiction is flagged for separate follow-up, not this build.
- **Numbers:** JetBrains Mono (`font-mono`), `tnum`+slashed-zero, formatted, empty = `—`. **No money/number is ever raw.**
- **Permissions:** `usePermissionStore.can("pipeline.view" | "pipeline.manage")` — never role checks.

---

## Phase 0 — Pre-flight (one task)

### Task 0.1: Confirm baseline & branch

**Files:** none (verification only).

**Steps:**
1. `git rev-parse --abbrev-ref HEAD` → expect `feat/pipeline-table-view`.
2. `git status --porcelain` → note the sibling WIP files (do not touch). Confirm the spec exists: `ls docs/superpowers/specs/2026-05-31-pipeline-table-view-design.md`.
3. `npx tsc --noEmit` → record current baseline (must be clean before we add anything; if the sibling WIP introduces errors, note them so we don't attribute them to our work).
4. No commit (read-only).

---

## Phase 1 — Spatial removal + mode reduction

> **Skills:** `animation-studio:animation-architect` + `animation-studio:web-animations` (crossfade), `ops-design`. **Goal:** Pipeline modes become `focused | table`; spatial surface and its bespoke transition overlay are deleted; persisted store migrates `spatial`→`focused`; an empty flagged `table` shell renders.

This phase is large but mechanical. Do it as a sequence of small commits. Build must stay green after each.

### Task 1.1: Add the feature flag

**Files:**
- Modify: `src/lib/feature-flags/feature-flag-definitions.ts` (the `FEATURE_FLAG_PERMISSIONS` map — add `pipeline_table_view: []`, mirroring the `projects_table_v2: []` entry on line 58).
- Create: `src/lib/hooks/pipeline-table/use-pipeline-table-flag.ts` (mirror `src/lib/hooks/projects-table/use-projects-table-v2-flag.ts` exactly; constant `PIPELINE_TABLE_VIEW_FLAG = "pipeline_table_view"`).

**Step 1:** Add the flag entry. **Step 2:** Write `use-pipeline-table-flag.ts`:
```ts
import { useFeatureFlagsStore } from "@/lib/store/feature-flags-store";

export const PIPELINE_TABLE_VIEW_FLAG = "pipeline_table_view";

export function usePipelineTableViewFlag(): boolean {
  const initialized = useFeatureFlagsStore((s) => s.initialized);
  const flag = useFeatureFlagsStore((s) => s.flags.get(PIPELINE_TABLE_VIEW_FLAG));
  if (!initialized) return false;
  return Boolean(flag?.enabled || flag?.hasOverride);
}
```
**Step 3:** `npx tsc --noEmit` clean. **Step 4:** Commit `feat(pipeline): add pipeline_table_view feature flag`.

### Task 1.2: Reduce the mode type & migrate the store

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-mode-types.ts` — `export type PipelineMode = "focused" | "table";`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-mode-store.ts` — default `mode: "focused"`; `toggleMode` flips `focused`↔`table`; bump persist `name` to `"opsPipeline:v4"`; add a `migrate(persisted, version)` that coerces any `mode: "spatial"` → `"focused"`.

**Step 1 (test-first):** Create `src/app/(dashboard)/pipeline/_components/__tests__/pipeline-mode-store.test.ts`:
```ts
import { describe, expect, it } from "vitest";
// import the migrate fn (export it) and assert:
// migrate({ mode: "spatial", focusedStage: "new_lead" }, 3).mode === "focused"
// migrate({ mode: "table" }, 4).mode === "table"
```
**Step 2:** Run → fails (migrate not exported). **Step 3:** Implement: export `migratePipelineModeState`, wire into persist `{ version: 4, migrate }`. **Step 4:** test green. **Step 5:** `npx tsc --noEmit` will now flag every `"spatial"` reference across the pipeline — that's the worklist for 1.3. Commit `refactor(pipeline): reduce modes to focused|table with store migration`.

### Task 1.3: Delete the spatial surface

**Files (delete):** every `src/app/(dashboard)/pipeline/_components/spatial-*.tsx` and `spatial-*.ts` (canvas, canvas-store, card, card-expanded, card-hover-metrics, context-menu, drag-overlay, floating-toolbar, layout-engine, marquee-select, stage-stack, staleness, terminal-region, archive-tray). Also delete `src/app/__pipeline-transition-benchmark/` and `src/app/pipeline-transition-benchmark/` and `src/app/transition-benchmark/` **only after** `grep -rn "transition-benchmark" src` confirms nothing else imports them.

**Files (modify):**
- `src/app/(dashboard)/pipeline/page.tsx` — remove `SpatialCanvasDesktop`, `SpatialCardWrapperComponent`, `PipelineModeTransitionOverlay`, all `modeTransition`/`pendingModeTransition`/`readModeTransitionRects`/`cloneModeSurface` machinery, the `MODE_TRANSITION_*` consts, and every `spatial` import/branch. Keep: opportunities query, all mutations, client/team maps, filters, focused-mode rendering, dialogs.
- `src/app/(dashboard)/pipeline/_components/pipeline-dnd-resolution.ts` + `pipeline-dnd-provider.tsx` — remove `spatial` branches; keep `focused`.

**Steps:** Delete files → fix every `tsc` error by removing the spatial code path → `npx tsc --noEmit` clean → `npm run lint` clean → run existing pipeline tests `npx vitest run src/app/\(dashboard\)/pipeline` → manually load `/pipeline`, confirm focused mode works. Commit `refactor(pipeline): remove spatial canvas mode`.

### Task 1.4: Mode switcher + crossfade + empty table shell

> **Skills:** `animation-studio:web-animations`. Crossfade only — single easing `cubic-bezier(0.22, 1, 0.36, 1)`, ~200ms, `prefers-reduced-motion` → instant. No card-morph.

**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/pipeline-mode-switcher.tsx` — two-segment control (`FOCUSED` / `TABLE`), `font-cakemono font-light` uppercase, `rounded-[5px]`, active = `bg-surface-active text-text`, inactive = `text-text-3`. Carbon icons (`Catalog` for focused/board, `Table` for table). Reads/sets `usePipelineModeStore`. **The `TABLE` segment is hidden unless `usePipelineTableViewFlag()` is true.**
- Create: `src/app/(dashboard)/pipeline/_components/table/pipeline-table-shell.tsx` — for now: `<div className="flex h-full items-center justify-center font-mono text-micro uppercase tracking-wider text-text-3">// pipeline table — coming online</div>`.
- Modify: `src/app/(dashboard)/pipeline/page.tsx` — render the switcher in the HUD; when `mode === "table" && flag`, render `<PipelineTableShell/>` inside a crossfade wrapper; else focused.

**Design tokens:** `bg-surface-active`, `text-text` (#EDEDED), `text-text-3` (#8A8A8A), `rounded-[5px]`, `font-cakemono font-light`, `border-border-subtle`. Accent reserved — switcher does **not** use `ops-accent`.

**Steps:** Build switcher → wire crossfade (Framer Motion `AnimatePresence`, `EASE_SMOOTH`, reduced-motion fallback) → flag off: only `FOCUSED` shows, no regression → flag on (toggle via admin or override): `TABLE` appears, switching crossfades to the placeholder → `tsc`+lint clean → commit `feat(pipeline): add focused|table mode switcher with crossfade`.

**Phase 1 gate:** `/pipeline` loads; focused unchanged; with flag on, table mode shows the placeholder; no `spatial` references remain (`grep -rn "spatial" src/app/\(dashboard\)/pipeline` → empty); `tsc`+lint+pipeline tests green.

---

## Phase 2 — Shared primitive extraction — SUPERSEDED (PM decision 2026-05-31)

> **DECISION: Phase 2 is cancelled as written; the pipeline table is SELF-CONTAINED instead.** The sibling-session WIP on `use-table-zoom.ts` + `projects-density-control.tsx` never cleared, and may not. Forensics showed the blocker is narrow: the read-only cells, `use-table-selection`, `use-table-keyboard-nav`, and `use-cell-edit` are all CLEAN (committed); only zoom + density-control are dirty.
>
> **New approach (zero coupling to the live projects table):**
> - **Direct-import** the clean, generic, valuable hooks: `@/lib/hooks/projects-table/use-table-selection` and `use-table-keyboard-nav` (DRY where safe).
> - **Pipeline OWNS** its own: cells (trivial presentational — `src/app/(dashboard)/pipeline/_components/table/cells/`), density/metrics constants (seed from the committed `use-table-zoom` values: rowHeight 44·zoom, presets compact 0.85 / comfortable 1 / spacious 1.25 — re-implement small, do NOT import the dirty file), column config, adapter, and the new opportunity cell-edit (Phase 4 already specified a new one).
> - **Do NOT** create `src/components/data-table/` or move/refactor any `table-v2/` file. No projects-table regression risk.
> - Revisit a real shared-core extraction only as a future cleanup if the sibling WIP lands and DRY value is clear. **Original Phase 2 extraction tasks (2.1–2.3) are void.**

> **Skills:** `frontend-design`, `audit-design-system`.

**Goal:** Move low-churn Table v2 leaf primitives to `src/components/data-table/` so both Projects and Pipeline consume one copy, with **zero behavior change to Projects** (its tests must stay green).

### Task 2.1: Create the shared module & move read-only cells

**Files:**
- Create dir `src/components/data-table/cells/`. Move (git mv) from `src/app/(dashboard)/projects/_components/table-v2/cells/`: `cell-currency.tsx`, `cell-date.tsx`, `cell-number.tsx`, `cell-percent.tsx`, `cell-text.tsx`, `cell-progress.tsx`. (Leave `cell-team`, `cell-relation`, `cell-status`, `cell-photos` and all `editable-cell-*` in Projects — they're domain-specific; Pipeline gets its own.)
- Update every import in `table-v2/` that referenced the moved cells.
- Swap any `lucide-react` imports in moved files to Carbon (Appendix B).

**Steps:** `git mv` each cell → update Projects imports → `tsc` clean → run `npx vitest run tests/integration/projects-table-v2-phase4.test.tsx tests/integration/projects-table-v2-phase5.test.tsx` → **must stay green** → commit `refactor(data-table): extract shared read-only cells`.

### Task 2.2: Move density control + zoom/selection/keyboard-nav hooks

**Files:**
- Move `use-table-zoom.ts`, `use-table-selection.ts`, `use-table-keyboard-nav.ts` from `src/lib/hooks/projects-table/` → `src/lib/hooks/data-table/`. These reference `ProjectTableDensity`/`ProjectTableColumnConfig` types — generalize the type params (introduce `src/lib/types/data-table.ts` with `TableDensity`, generic `TableColumnConfig`, `TableSort`) and have `project-table.ts` re-export/alias them so Projects is untouched at call sites.
- Move `projects-density-control.tsx` → `src/components/data-table/density-control.tsx`, props generalized (`density: TableDensity`), Carbon icons. Projects keeps a thin wrapper or imports directly.

**Steps:** Move → generalize types with aliases → update Projects imports → `tsc` clean → Projects table-v2 tests green → manual: Projects table density/zoom still works → commit `refactor(data-table): extract density control and table hooks`.

### Task 2.3: Move undo toast, conflict overlay, virtualizer wrapper

**Files:** Move `projects-undo-toast.tsx`→`data-table/undo-toast.tsx`, `projects-conflict-overlay.tsx`→`data-table/conflict-overlay.tsx` (generalize copy props so they're not projects-worded — pass title/labels in). The virtualizer is inline in `projects-table.tsx`; extract the two-container scroll+spacer structure into `src/components/data-table/virtual-rows.tsx` as a small helper if cleanly separable; if not, **leave it and document** that Pipeline implements its own (acceptable — flag in commit msg).

**Steps:** Move → generalize → Projects green → commit `refactor(data-table): extract undo toast and conflict overlay`.

**Phase 2 gate:** Projects table-v2 fully functional (manual pass: edit a cell, change density, trigger undo, trigger a conflict); all Projects tests green; `tsc`+lint clean.

---

## Phase 3 — Column model + data adapter + flat read-only table

> **Skills:** `frontend-design`, `interface-design`, `ops-copywriter` (column labels), `ops-design`.

### Task 3.1: Pipeline table types (test-first on the column registry)

**Files:**
- Create: `src/lib/types/pipeline-table.ts` — `PipelineTableColumnId` union, `PIPELINE_TABLE_COLUMN_IDS`, `PIPELINE_TABLE_EDITABLE_COLUMN_IDS` (`value | next_follow_up | expected_close | assignee`), `PipelineTableColumnConfig` (reuse generic `TableColumnConfig`), `PIPELINE_TABLE_COLUMNS` registry (per spec §4 — deal/stage/client/value/win%/weighted/age_in_stage/last_activity/next_follow_up/expected_close/assignee/source/priority/correspondence; `select` + `deal` frozen; money columns NOT permission-gated), `PipelineTableRow` interface, `PipelineTableSort`, default-visible set, `PipelineTableEditValue`.
- Test: `src/lib/types/__tests__/pipeline-table.test.ts`.

**Step 1 (test):** assert registry invariants — `select`+`deal` are `frozen`; every editable id is in the registry and marked `editable`; default-visible set is a subset of registry ids; no duplicate ids. **Step 2:** fail. **Step 3:** implement registry. **Step 4:** green. **Step 5:** commit `feat(pipeline): add pipeline table column model`.

### Task 3.2: Data adapter (test-first — this is load-bearing logic)

**Files:**
- Create: `src/lib/utils/pipeline-table-adapter.ts` — `mapOpportunityToTableRow(opp, { clientNameMap, stageConfigByStage })`, plus derivations:
  - `weightedValue(row)` = `estimatedValue * (winProbability ?? stageConfig.defaultWinProbability ?? PIPELINE_STAGES_DEFAULT[stage].winProbability) / 100` (deal-level wins; null estimatedValue → null weighted).
  - `ageInStageDays(row, now)` = floor days since `stageEnteredAt`.
  - `isRotting(row, stageConfig, now)` = `ageInStageDays >= stageConfig.staleThresholdDays`.
  - `isFollowUpOverdue(row, now)` / `isCloseOverdue(row, now)` = date past AND `isActiveStage(stage)`.
  - `winProbabilityIsFallback(row, stageConfig)` boolean (drives the muted render).
- Test: `src/lib/utils/__tests__/pipeline-table-adapter.test.ts` — pass a fixed `now` (never `Date.now()` in tests). Cover: deal-prob overrides stage default; stage default overrides constant; null value → null weighted; rotting boundary (exactly at threshold = rotting); overdue only when active stage (won/lost never overdue); fallback flag true/false.

**Steps:** test → fail → implement → green → `tsc` → commit `feat(pipeline): add opportunity→table-row adapter with forecast/aging derivations`.

### Task 3.3: Formatters

**Files:** Create `src/lib/utils/pipeline-table-formatters.ts` — `formatCurrency` (no decimals, `—` for null), `formatPercent`, `formatDate` (short), `formatRelativeDays`. Reuse/`re-export` from `project-table-formatters.ts` where identical (DRY). Test the `—`-for-null and slashed-zero formatting paths.

Commit `feat(pipeline): add pipeline table formatters`.

### Task 3.4: Read-only flat table (virtualized)

**Files:**
- Create: `src/lib/hooks/pipeline-table/use-pipeline-table-data.ts` — consumes `useOpportunities()`, filters `!deletedAt && !archivedAt`, fetches `useClients()`+`pipeline_stage_configs` (new tiny `usePipelineStageConfigs()` query hook reading the table), runs the adapter, applies client-side search/sort/closed-filter, memoized. Returns `{ rows, totalCount, isLoading, isError }`. **Scale-ceiling breadcrumb:** if `rows.length > 1500`, `console.warn` once (per spec §3.4/§8.7).
- Create: `pipeline-table.tsx`, `pipeline-table-header.tsx`, `pipeline-table-row.tsx` in `table/` — mirror the Projects equivalents' structure (TanStack Table + `useVirtualizer`, `getRowId: row => row.id`, fixed row height from density metrics, two-container sticky scroll), rendering read-only cells from the column registry. Frozen `deal` + `select` columns (sticky-left). Row click → `usePipelineModeStore.openDetailPanel(row.id)`.
- Modify: `pipeline-table-shell.tsx` — replace placeholder with toolbar (search + density + row count) above the table; empty/loading/error states.

**Design tokens:** rows `border-b border-r border-border`, hover `hover:bg-surface-hover`, selected `bg-surface-active`, header `font-mono text-micro uppercase tracking-wider text-text-3`, numbers right-aligned `font-mono`, frozen cols `sticky ... bg-background`. Stage chip uses `OPPORTUNITY_STAGE_COLORS`, never accent.

**Steps:** Build data hook (unit-test the sort + closed-filter purely) → build table components → render real opportunities read-only with the flag on → verify virtualization (hundreds of rows scroll smoothly), frozen column, sticky header, weighted column math matches a hand calc → `tsc`+lint → commit `feat(pipeline): render read-only virtualized pipeline table`.

**Phase 3 gate:** Table shows real deals with correct weighted/age/overdue values, sortable, searchable, active-only; numbers formatted+mono; row click opens detail; scroll is smooth; Projects untouched.

---

## Phase 4 — Hybrid editing

> **Skills:** `frontend-design`, `ops-design`. **Spec §7.1.** Inline = `value | next_follow_up | expected_close | assignee`. Stage = action via dialog. Commit-on-Enter-and-blur, Escape cancels, per-cell save-state, optimistic+undo+conflict, **no re-sort on commit**.

### Task 4.1: Cell-edit hook for opportunities

**Files:**
- Create: `src/lib/hooks/pipeline-table/use-opportunity-cell-edit.ts` — model on `use-cell-edit.ts` (now in `data-table/` or still in projects — import accordingly), but mutate via `useUpdateOpportunity()` for `value`/dates/`assignee`. Optimistic cache update on `queryKeys.opportunities.lists()` (cancel in-flight first — `useUpdateOpportunity` already snapshots; verify it cancels, add `cancelQueries` if missing). Save-state map keyed `rowId:columnId`. Undo stack + visible undo. **No conflict RPC for opportunities** (they lack the `updated_at`-guard RPC projects use) — instead do last-writer-wins with an undo entry; document this delta from Projects in the file header.
- Test: `src/lib/hooks/pipeline-table/__tests__/use-opportunity-cell-edit.test.tsx` — optimistic apply, rollback on error, undo restores prior value, save-state transitions.

**Steps:** test → implement → green → commit `feat(pipeline): add opportunity cell-edit hook`.

### Task 4.2: Editable cells

**Files:** Create in `table/cells/`: `editable-cell-currency.tsx` (value), `editable-cell-date.tsx` (next_follow_up, expected_close — can mirror projects' `editable-cell-date`), `editable-cell-assignee.tsx` (team-member picker over `useTeamMembers()`). Each: explicit edit affordance (pencil on hover/focus), commit on Enter+blur, Escape cancels, save-state styling (`saving` → opacity-70, `saved` → `bg-surface-active`, `error`/`conflict` → `border-rose`).

**Steps:** build → wire into `pipeline-table-row.tsx` `renderCell` → edit a value/date/assignee inline, confirm optimistic save + undo toast + **row does not jump** (sort held) → `tsc`+lint → commit `feat(pipeline): add inline editable cells (value, dates, assignee)`.

### Task 4.3: Stage cell → dialog (the critical correctness path)

**Files:**
- Create: `table/cells/cell-stage-action.tsx` — renders the stage chip; clicking opens a small stage menu. Selecting an **active** stage calls `useMoveOpportunityStage()` directly (optimistic, resets `stageEnteredAt`). Selecting **Won/Lost** opens the existing `StageTransitionDialog` (import from `_components/stage-transition-dialog.tsx`) — never a bare write. Wire the dialog's confirm to `handleMoveStage` semantics already in `page.tsx`; lift the shared handler or pass callbacks from the shell.
- Modify: `pipeline-table-shell.tsx` — own the `StageTransitionDialog` state (`transitionType`, `transitionOpportunity`, `pendingStageMove`) exactly as `page.tsx` does for focused mode; reuse the same handlers so behavior is identical across modes.

**Steps:** build → change a deal to an active stage inline (optimistic, age resets) → change one to Won → dialog appears, captures reason, persists → change to Lost → dialog → persists; bulk and focused unaffected → `tsc`+lint → commit `feat(pipeline): stage changes via existing Won/Lost dialogs from the table`.

### Task 4.4: Keyboard nav + undo/conflict wiring

**Files:** Wire `use-table-keyboard-nav` (shared) into `pipeline-table.tsx` (roving tabindex, arrows, Enter/F2 edit, Tab exits in one stop, Esc cancels; `⌘Z` undo, `⌘A` select-visible, `⌘F` focus search). Mount `undo-toast` + (if applicable) `conflict-overlay` from the shell.

**Steps:** verify no keyboard trap (tab in, tab out once), arrow nav moves active cell, Enter edits a safe cell, `⌘Z` undoes last edit → commit `feat(pipeline): keyboard navigation and undo for the table`.

**Phase 4 gate:** All four inline fields edit optimistically with undo; stage→Won/Lost always dialogs; no row-jump on commit; keyboard contract holds; Projects untouched.

---

## Phase 5 — Aging / triage signals

> **Skills:** `ops-design` (earth-tone semantics), `interface-design`, `ops-copywriter` (tags). **Spec §5.** Borders-only, paired with text/icon, never loud fills, never accent.

### Task 5.1: Signal rendering

**Files:**
- Modify: `pipeline-table-row.tsx` — apply a left-border semantic class from the adapter's derivations: rotting (attention) → `border-l-2 border-l-tan`; stale (well past, e.g. ≥2× threshold) or overdue follow-up → `border-l-2 border-l-rose`; (reserve `brick` for the most severe per `audit-design-system`). Age-in-stage cell shows the number; overdue follow-up/close cells show a `[OVERDUE]` bracket tag in `font-mono text-micro` + a Carbon `Warning` glyph.
- Modify: `use-pipeline-table-data.ts` default sort → aging-aware (overdue follow-up first, then oldest `lastActivityAt`), overridable by column sort.

**Design tokens:** `border-l-tan` (#C4A868), `border-l-rose` (#B58289), `border-l-brick` (#93321A) — border-only; tag text `text-text-3`/`text-rose`. No fills.

**Steps:** unit-extend the adapter tests for the ≥2× severe boundary → render: a deal idle past its stage threshold shows tan; an overdue follow-up shows rose + `[OVERDUE]`; won/lost never flagged → `audit-design-system` pass (confirm no hardcoded hex, all tokens) → `tsc`+lint → commit `feat(pipeline): add aging and overdue triage signals`.

**Phase 5 gate:** Signals render from real data, earth-tone borders only, paired with text, accent untouched; default sort surfaces deals needing attention; token audit clean.

---

## Phase 6 — Grouping toggle + stage rollups

> **Skills:** `frontend-design`, `interface-design`. **Spec §6, §8.2.** The trickiest phase: grouped + virtualized via ONE flattened stream.

### Task 6.1: Flattened render model (test-first)

**Files:**
- Create: `src/lib/utils/pipeline-table-grouping.ts` — `buildFlattenedRows(rows, { grouped, collapsedStageIds })` → `Array<{ kind: "group-header"; stage; count; sumValue; sumWeighted } | { kind: "data"; row }>`, group order = `OPPORTUNITY_STAGE_SORT_ORDER`, collapsed groups omit their data rows but keep the header. Also `stageRollup(rows)` → count/Σvalue/Σweighted per stage + grand total.
- Test: `__tests__/pipeline-table-grouping.test.ts` — grouped vs flat output; collapsed stage hides data rows, keeps header; rollup sums (incl. null-value handling); empty stage omitted or shown-zero (decide: show only non-empty stages).

**Steps:** test → implement → green → commit `feat(pipeline): add flattened grouping model with stage rollups`.

### Task 6.2: Render grouped stream + sticky group headers + grand total

**Files:**
- Modify: `pipeline-table.tsx` — feed the flattened array to the single `useVirtualizer`; render `kind === "group-header"` rows as `pipeline-stage-group-header.tsx` (new) showing stage name + count + Σvalue + Σweighted (mono), collapse/expand chevron (Carbon `ChevronDown`/`ChevronRight`); fixed header height in the size estimator (account for the two row "kinds" having distinct heights via `estimateSize` switching on the flattened item kind). Sticky group headers via the two-container structure (per §8.2), not CSS-sticky inside a table. Account for sticky offset in any `scrollToIndex`.
- Create: `pipeline-table-footer.tsx` — grand-total bar (count · Σvalue · Σweighted), sticky bottom.
- Modify: `pipeline-table-toolbar.tsx` — add the **grouping toggle** (Carbon `Categories`) and the **closed-deals toggle** (shows won/lost/discarded). Persist both into the active view (Phase 7) or local state until then.
- Modify: `use-table-selection` usage — collapsed-group data rows must not be selectable while hidden; group-header checkbox selects the stage's rows.

**Steps:** toggle grouping on → rows group by stage, headers show correct rollups, collapse/expand works, scroll stays smooth and headers stick, grand total correct → toggle closed-deals → won/lost/discarded appear as their own groups → `tsc`+lint → **performance check:** with a few hundred deals, scrolling grouped is jank-free (no jump on collapse, headers don't duplicate) → commit `feat(pipeline): grouped-by-stage view with rollups and grand total`.

**Phase 6 gate:** Grouping toggles cleanly; rollups + grand total correct (hand-verified); collapse/expand preserved across refetch (stable ids); no virtualization jank; closed-deals toggle works.

---

## Phase 7 — Saved views (full parity)

> **Skills:** `frontend-design`. **Spec §3.4, §12.** New `opportunity_views` table + 6 RPCs + RLS, mirroring `project_views` exactly. **Schema changes go through Supabase MCP `apply_migration` against project `ijeekuhbatykdomumfjx` (`ops-app`).**

### Task 7.0: Seed `pipeline.manage_views` permission

**Goal:** Add the new granular permission the company-view RPCs/policies gate on, mirroring how `projects.manage_views` is seeded.

**Reference (read first):** `supabase/migrations/20260512234121_projects_table_v2_phase1_foundation.sql` — find how `projects.manage_views` is inserted into the permission catalog and granted to roles (also `015_permissions_system.sql` for the catalog table shape). **Do not guess the catalog table/column names — read them.**

**Steps:**
1. Via MCP, inspect the permission catalog: `select * from <permissions_catalog_table> where key like 'projects.manage_views' or key like 'pipeline.%';` to learn the exact columns (key, description, category/group) and which roles get `projects.manage_views`.
2. `apply_migration` named `seed_pipeline_manage_views_permission`: insert `pipeline.manage_views` into the catalog (description e.g. "Manage shared pipeline table views"), and grant it to the **same roles** that hold `projects.manage_views` (typically owner/admin) via the same role-permission mechanism the reference migration uses. Idempotent (`on conflict do nothing`).
3. Add `pipeline.manage_views` to `FEATURE_FLAG_PERMISSIONS["pipeline"]` in `src/lib/feature-flags/feature-flag-definitions.ts` (alongside `pipeline.view`, `pipeline.manage`, `pipeline.configure_stages`).
4. Verify: `has_permission(<an_owner_user_id>, 'pipeline.manage_views', 'all')` → true for an admin; false for a basic role.
5. Commit `feat(pipeline): seed pipeline.manage_views permission`.

> **iOS-safety:** additive permission row + grants only — no existing-table changes. Safe.

### Task 7.1: Migration — table + RLS + RPCs

**Reference (read first via MCP, do not guess):** run `pg_get_functiondef` for each of `create_project_table_view`, `rename_project_table_view`, `archive_project_table_view`, `reset_project_table_view`, `share_project_table_view`, `update_project_table_view_definition`; and `pg_get_viewdef`/table DDL for `project_views`. Mirror them verbatim with `opportunity_views` / `*_opportunity_table_view` names.

**⚠️ Mirror the VERIFIED working architecture of `project_views` exactly (read from migration `20260514163406_projects_table_v2_phase5_saved_view_actions.sql` + `20260513034650_projects_table_v2_firebase_role_grants.sql`). It is a THREE-PART pattern — my earlier "RLS @ anon" shorthand was wrong:**

1. **Table:** `create table public.opportunity_views (...)` — **exact** column set verified in spec §12 (id uuid default gen_random_uuid(); company_id uuid NOT NULL; owner_type text NOT NULL; owner_id uuid NOT NULL; name text NOT NULL; icon text; description text; permission_key text; is_default bool NOT NULL default false; is_archived bool NOT NULL default false; sort_position int NOT NULL default 0; columns jsonb NOT NULL; filters jsonb NOT NULL; sort jsonb NOT NULL; density text NOT NULL default 'comfortable'; zoom_level numeric NOT NULL default 1.00; created_at/updated_at timestamptz NOT NULL default now(); created_by uuid).
2. `alter table public.opportunity_views enable row level security;`
3. **Reads — a role-agnostic (PUBLIC) SELECT policy** (NO `TO` clause, so the anon-executing app reads through it), mirroring `project_views`' "users read company and own views":
   ```sql
   create policy "read company and own opportunity views" on public.opportunity_views
   for select using (
     company_id = (select company_id from public.users where id = (select private.get_current_user_id()))
     and (owner_type = 'company'
          or (owner_type = 'user' and owner_id = (select private.get_current_user_id())))
     and (permission_key is null
          or has_permission((select private.get_current_user_id()), permission_key, 'all'))
   );
   ```
4. **Write backstop policies `TO authenticated`** (the definer RPCs bypass these, but mirror project_views for parity): "admins manage company opportunity views" (`owner_type='company'` AND `has_permission(uid,'pipeline.manage_views','all')`) and "users manage own opportunity views" (`owner_type='user'` AND `owner_id=uid`). **Permission decision (PM): seed a dedicated `pipeline.manage_views` permission** (parity with `projects.manage_views`) — see Task 7.0 below; do NOT conflate with `pipeline.manage`.
5. **Table GRANTs to anon** (the app executes as the anon/PostgREST role — this is why reads work despite the manage policies being `TO authenticated`): `GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_views TO anon;` (+ `authenticated`).
6. **Two `private.*` helper functions** (mirror `private.project_table_view_clean_name` + `private.project_table_view_sanitize_definition` from `20260514163406`), renamed `private.opportunity_table_view_*`. **CRITICAL:** the sanitizer hardcodes a column-id allowlist + a sort-field allowlist — **replace the project column ids with the pipeline `PIPELINE_TABLE_COLUMN_IDS`** (deal, stage, client, value, win_probability, weighted, age_in_stage, last_activity, next_follow_up, expected_close, assignee, source, priority, correspondence, select), and the sort-field allowlist with the sortable pipeline ids. Same `revoke execute … from public, anon, authenticated` on the `private.*` helpers as the source. (Reset's `default_definition` helper is optional — `reset` only matters for `is_default` views; since defaults are seeded by the service, a simpler reset that re-applies a hardcoded default per name is fine, OR omit `reset` from v1 if no default views are flagged `is_default=true`. PM call: include it for parity, keyed off view name.)
7. **The 6 SECURITY DEFINER RPCs**, bodies copied from the project versions, renamed `*_opportunity_table_view`, table refs → `opportunity_views`, helper refs → `private.opportunity_table_view_*`, permission string → **`pipeline.manage_views`**: `create_opportunity_table_view(p_name text, p_source_view_id uuid, p_definition jsonb)`, `rename_opportunity_table_view(p_view_id uuid, p_name text)`, `archive_opportunity_table_view(p_view_id uuid)`, `reset_opportunity_table_view(p_view_id uuid)`, `share_opportunity_table_view(p_view_id uuid)`, `update_opportunity_table_view_definition(p_view_id uuid, p_definition jsonb)`. Each: `security definer`, `set search_path = 'public','pg_temp'`, resolve `private.get_current_user_id()` + `private.get_user_company_id()` (raise 42501 if null), company-view branch checks `has_permission(v_user_id,'pipeline.manage_views','all')`, personal-view branch checks `owner_id = v_user_id`. Then `revoke execute … from public` and **`grant execute on function … to anon, authenticated;`** for all six (exact pattern from source lines 561–576).
8. **Defaults:** seed the 5 default views (`MY OPEN`, `CLOSING THIS MONTH`, `NO NEXT STEP`, `STALE`, `OVERDUE FOLLOW-UP`) lazily in the service (Task 7.4), not the migration — keep the migration schema-only.

**Steps:** read both source migrations + `pg_get_functiondef` for each project RPC via MCP → author migration mirroring the three-part pattern → `apply_migration` (name `pipeline_table_opportunity_views`) against `ijeekuhbatykdomumfjx` → **verify:** `to_regclass('public.opportunity_views')` non-null; the SELECT policy has `polroles = {0}` (PUBLIC, i.e. anon-reachable); table GRANTs include `anon`; all 6 functions exist with `EXECUTE` granted to `anon` (`has_function_privilege('anon', 'public.create_opportunity_table_view(text,uuid,jsonb)', 'EXECUTE')` → true) → regenerate types via MCP `generate_typescript_types`, update `src/lib/types/database.types.ts` → `tsc` clean → commit `feat(pipeline): add opportunity_views table, RLS, and view RPCs`.

> **iOS-safety note:** new table + new functions only — additive, no changes to existing tables/columns. Safe per the iOS sync constraint.

### Task 7.2: Types + service + formatter mapping

**Files:** Create `src/lib/types/opportunity-view.ts` (mirror the view-definition types from `project-table.ts` — `OpportunityViewDefinition`, inputs, error codes), `src/lib/api/services/opportunity-views-service.ts` (mirror `project-views-service.ts` 1:1, swapping table/RPC names; keep `isArchived` handling and the error normalization), and a `mapOpportunityView` formatter. Reuse the column-id sanitizer pattern.

**Steps:** mirror → `tsc` clean → commit `feat(pipeline): add opportunity views service and types`.

### Task 7.3: Hooks

**Files:** Create in `src/lib/hooks/pipeline-table/`: `use-opportunity-views-list.ts`, `use-opportunity-view.ts`, `use-opportunity-view-actions.ts` (mirror the projects-table view hooks). Add query keys to `query-client.ts`: `opportunities.tableViews(companyId, userId)`.

**Steps:** mirror → `tsc` → commit `feat(pipeline): add opportunity view hooks`.

### Task 7.4: View tabs, dialogs, favorites + default seed; wire into shell

**Files:**
- Create in `table/`: `pipeline-view-tabs.tsx`, `pipeline-view-create-dialog.tsx`, `pipeline-view-settings-menu.tsx` (mirror the projects equivalents; Carbon icons; `ops-copywriter` for all strings).
- Modify: `pipeline-table-shell.tsx` — adopt the full saved-view state machine from `projects-table-shell.tsx` (active view, pending definition, unsaved-changes save button, density persistence into the view, favorites in localStorage key `ops_pipeline_table_favorite_view_id`). The grouping toggle + closed-deals toggle from Phase 6 now persist into the view definition (`filters`).
- Default views: seed on first load if the company has none — service method `ensureDefaultViews(companyId)` creating the 5 named views with appropriate `filters`/`columns`/`sort`. Copy via `ops-copywriter`.

**Steps:** mirror UI → wire shell → create/rename/duplicate/share/archive/favorite a view; switch views changes columns/sort/grouping/closed-toggle; unsaved edits show the save affordance; defaults seed once → `tsc`+lint → commit `feat(pipeline): saved views with tabs, dialogs, favorites, and defaults`.

**Phase 7 gate:** Full saved-view parity — create/rename/duplicate/share/archive/favorite, per-view columns+sort+density+grouping persist, defaults seeded; RLS verified (a second company can't read another's views); `tsc`+lint green.

---

## Phase 8 — Bulk bar + convert-to-project + notifications + i18n + polish

> **Skills:** `ops-copywriter` (all copy + es), `ops-design`, `audit-design-system`, `frontend-design`.

### Task 8.1: Bulk action bar

**Files:** Create `table/pipeline-bulk-bar.tsx` (mirror `projects-bulk-bar.tsx`). Actions: reassign owner, set next-follow-up date, change priority, **mark won/lost (via `StageTransitionDialog`)**, archive. Reuse existing mutations (`useUpdateOpportunity`, `useMoveOpportunityStage`, `useArchiveOpportunity`). **Select-all states the exact matched count** ("Select all N"), selection clears after action, every action pushes an undo entry. Appears only when rows selected.

**Steps:** select rows → bar appears → reassign/owner/date/priority bulk-apply with undo → bulk Won routes through dialog → archive works → selection clears → `tsc`+lint → commit `feat(pipeline): bulk actions bar for the table`.

### Task 8.2: Convert-to-project

**Files:** First **verify the web-side wrapper** for `convert_lead_to_project` (grep services/hooks; if only the RPC exists, add a thin `OpportunityService.convertToProject(id)` + `useConvertOpportunityToProject()` mutation). Add a row-overflow action (Carbon `Migrate`/`Launch`) and a bulk action, shown for won/late-stage rows. Dispatch a notification on success (Task 8.3).

**Steps:** confirm RPC contract via MCP (`pg_get_function_arguments('convert_lead_to_project')`) → wire action → convert a won deal → project created, opportunity linked (`project_id` set) → `tsc`+lint → commit `feat(pipeline): convert won deals to projects from the table`.

### Task 8.3: Notifications

**Files:** On bulk stage moves and conversions, dispatch to the notification rail via existing helpers (`notification-dispatch.ts` / `NotificationService`). Standard (dismissible) for completed bulk ops; include `action_url` (`/pipeline` or the new project) + `action_label`.

**Steps:** trigger a bulk move + a conversion → notifications appear in the rail with working click-through → commit `feat(pipeline): dispatch notifications for bulk moves and conversions`.

### Task 8.4: i18n (en + es)

**Files:** Add all new keys to `src/i18n/dictionaries/en/pipeline.json` and the `es/` mirror — column labels, toolbar, grouping/closed toggles, view UI, bulk actions, aging/overdue tags, forecast labels, empty/loading/error, default view names. **All strings authored via `ops-copywriter`** (terse/tactical voice). **Flag every `es` string for native-speaker review** (add a `// REVIEW: es` tracking note in the PR/commit body — do not treat machine es as final).

**Steps:** add keys → confirm no hardcoded user-facing strings remain (`grep` the new components for literal text) → `tsc`+lint → commit `feat(pipeline): i18n for the table (en + es, es flagged for review)`.

### Task 8.5: Final polish + audit + e2e

**Files:** `audit-design-system` pass over every new component (zero hardcoded hex/spacing/radius; accent used at most once per screen and only on the primary CTA/focus ring; numbers mono+tabular; empty=`—`). Add a Playwright e2e `tests/e2e/pipeline-table.spec.ts` covering: flag-on renders table, switch modes, edit a value inline, change stage→Won dialog, group by stage, create+switch a saved view, bulk-archive. Honor `prefers-reduced-motion` verified.

**Steps:** audit → fix any token drift → write e2e → `npx playwright test tests/e2e/pipeline-table.spec.ts` green → full gate (`tsc`+lint+all pipeline tests) → commit `test(pipeline): e2e coverage and design-system audit fixes`.

**Phase 8 gate (production-ready):** bulk + convert + notifications work; full en/es i18n (es flagged); token audit clean; e2e green; `tsc`+lint+unit+integration+e2e all green; manual walkthrough matches the spec's "6am triage" test (open table, see overdue/stale, fix inline, read weighted total).

---

## Appendix A — Definition of Done (whole initiative)

- Pipeline modes: `focused | table` only; spatial fully gone; persisted store migrated.
- Table behind `pipeline_table_view`; flag-off = no change to today's pipeline.
- Pipeline-optimized columns; weighted forecast + per-stage rollups + grand total; full aging/overdue signals.
- Hybrid editing (value/dates/assignee inline; stage→Won/Lost dialogs); no row-jump; keyboard contract; undo.
- Grouping toggle + closed-deals toggle; single-virtualizer grouped render, no jank.
- Saved views full parity (table + 6 RPCs + RLS@anon; tabs/favorites/create/duplicate/share/archive; 5 seeded defaults).
- Bulk bar; convert-to-project; rail notifications; en/es i18n (es flagged); token audit clean; e2e green.
- Projects Table v2 unaffected throughout (its tests green at every phase).
- All commits on `feat/pipeline-table-view`, staged by name, no AI attribution; **nothing pushed** until PM sign-off.

## Appendix B — VOID (icon mapping superseded)

**This appendix is void.** Per the PM icon override (see ground rules), the build uses **`lucide-react`** to match the actual codebase (Carbon is not installed). Keep the lucide names the Table v2 components already use. No icon swaps during mirroring.

## Appendix C — Risks & live notes

- **Sibling WIP** on `table-v2/` gates Phase 2 — re-check before starting; Phases 3–6 can import from `table-v2/` directly if extraction must wait, then re-point imports.
- **No `updated_at`-guard RPC for opportunities** → cell edits are last-writer-wins + undo, not conflict-overlay (documented delta from Projects).
- **In-memory data** is correct at trades scale; scale-ceiling warn at >1,500 rows; server-side `opportunity_table_rows` view is the documented escape hatch if needed later.
- **Spanish** strings are machine-drafted; flagged for native review (open item, not a blocker for the flagged-off ship).
