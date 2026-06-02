# Pipeline Table View — Design Spec

**Date:** 2026-05-31
**Surface:** OPS-Web → Pipeline tab (`src/app/(dashboard)/pipeline/`)
**Status:** Approved design, pending spec review → implementation plan
**Author:** Pipeline initiative (brainstorm session 2026-05-30/31)

---

## 1. Summary

Add a **pipeline-optimized table view** to the Pipeline tab, modeled on the recently-shipped Projects Table v2 (`(dashboard)/projects/_components/table-v2/`), and **remove the spatial (canvas) mode**. After this work the Pipeline has two modes: **`focused`** (existing) and **`table`** (new). The table is a forecasting-and-triage instrument: it does the jobs a kanban/spatial board structurally cannot — scan many deals at once, roll up money (weighted forecast), surface stale/overdue deals before they die, and bulk-edit.

The table reuses Table v2's proven leaf primitives (cell renderers, density control, virtualizer, undo/conflict patterns) but has its own **shell, column config, and data adapter** tuned to opportunities — it is not a literal clone of the projects table.

### Locked product decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope | Pipeline-optimized (opportunity-native columns + semantics), not a projects clone |
| Editing | **Hybrid** — safe fields inline; stage changes route through existing Won/Lost dialogs |
| Saved views | **Full parity in v1** — new `opportunity_views` table + service + hooks + tabs + favorites + create/duplicate/share/archive |
| Money gating | **Show value + forecast to all `pipeline.view`** — no new financial permission |
| Grouping | **Toggle** — default flat sortable list; group-by-stage is a user toggle |
| Closed deals | **Active stages only by default**; toggle reveals won/lost/discarded |
| Spatial mode | **Removed** — modes reduce to `focused | table` |
| Aging signals | **Full set in v1** — days-in-stage, last-activity, per-stage rotting threshold, overdue-follow-up flag |
| Forecast model | **Weighted only** — value × win-probability + per-stage rollups + grand total (no Salesforce-style category matrix) |

### Engineering decisions (authority: this initiative)

- New gated feature flag **`pipeline_table_view`** (mirrors `projects_table_v2`).
- **IBM Carbon icons** (`@carbon/icons-react`), not lucide — OPS-Web standard. (Table v2 used lucide; new code follows the standard.)
- **Share Table v2 leaf primitives** by lifting low-churn pieces to a shared location; **do not** refactor the live, flagged projects table into a generic shared core now (blast radius on an actively-edited feature).
- Render rows from the **in-memory `useOpportunities()`** set (client-side filter/sort/group). Justified at trades-pipeline scale (hundreds of open deals). Includes an explicit scale ceiling and a documented migration path to server-side if volume grows.
- Convert-to-project reuses the shipped `convert_lead_to_project` RPC.

---

## 2. Non-goals (YAGNI)

- **No Salesforce-style forecast categories** (Pipeline/Best Case/Commit/Closed overrides). Weighted forecast is the v1 model.
- **No date-bucketed forecast view** (Pipedrive's calendar columns) — that's a separate view, not this table.
- **No server-side data layer in v1** (no `opportunity_table_rows` DB view). In-memory only; revisit if scale demands.
- **No mobile/responsive table.** OPS-Web is the logged-in desktop product; the table is a desktop instrument. (iOS pipeline is a separate surface and out of scope.)
- **No new financial permission.** Money visible to all `pipeline.view`.
- **No heavy keyboard macro suite** (Close-style dialer queues). Spreadsheet-grade cell nav only (see §7).

---

## 3. Architecture

### 3.1 Mode model

`PipelineMode` changes from `"focused" | "spatial"` → `"focused" | "table"` in `pipeline-mode-types.ts`.

- `pipeline-mode-store.ts` (persisted key `opsPipeline:v3`): update default + `toggleMode`, and **migrate persisted state** so any saved `mode: "spatial"` resolves to `"focused"` on load (a `migrate`/merge step in the persist config, bumping to `opsPipeline:v4`).
- The mode switcher renders `focused | table`.
- The elaborate spatial↔focused **card-morph transition overlay** (`PipelineModeTransitionOverlay` + the rect-reading/cloning machinery in `page.tsx`) was built specifically for spatial. With spatial gone it is **deleted** and replaced with a simple crossfade between modes, honoring `prefers-reduced-motion`.

### 3.2 Spatial removal

Delete the spatial surface and its dependencies:
- All `_components/spatial-*.tsx` and `spatial-*.ts` (canvas, store, layout-engine, cards, marquee, context-menu, terminal-region, floating-toolbar, archive-tray, staleness, drag-overlay, hover-metrics, stage-stack, card-expanded).
- The `SpatialCanvasDesktop`, `SpatialCardWrapperComponent`, and mode-transition code blocks in `page.tsx`.
- Spatial-only branches in `pipeline-dnd-resolution.ts` / `pipeline-dnd-provider.tsx` (focused mode keeps its DnD).
- `__pipeline-transition-benchmark` / `pipeline-transition-benchmark` benchmark routes that exercised the spatial transition (verify nothing else imports them first).

`page.tsx` slims substantially (currently ~2386 lines). The `focused` mode and all shared data/handlers (opportunities query, mutations, client/team maps, filters) are preserved.

### 3.3 Component tree (new)

```
pipeline/_components/table/
  pipeline-table-shell.tsx        # orchestrator: search, sort, grouping toggle, saved-view state,
                                  #   density/zoom, selection, undo, conflict, closed-toggle
  pipeline-table.tsx              # TanStack Table + single TanStack Virtual instance;
                                  #   flattened render model (group headers interleaved when grouped)
  pipeline-table-header.tsx       # column header row (sort, select-all)
  pipeline-table-row.tsx          # data row; renders cells from column config
  pipeline-stage-group-header.tsx # group header row: stage name + count + Σ value + Σ weighted
  pipeline-table-toolbar.tsx      # search, row count, density, grouping toggle, closed toggle, view settings
  pipeline-view-tabs.tsx          # saved-view tabs + favorites + new-view
  pipeline-bulk-bar.tsx           # selection bulk actions
  pipeline-empty-state.tsx
  pipeline-undo-toast.tsx         # (shared primitive; see §3.5)
  pipeline-conflict-overlay.tsx   # (shared primitive; see §3.5)
  pipeline-view-create-dialog.tsx
  pipeline-view-settings-menu.tsx
  cells/  (pipeline-specific editable cells; read-only cells shared — see §3.5)
```

### 3.4 Data + state

- **Rows:** existing `useOpportunities()` → filter out `deletedAt`/`archivedAt` → adapter maps `Opportunity` → `PipelineTableRow`. Client-side search/sort/group/closed-filter over that set (memoized).
- **Scale ceiling:** the in-memory approach is correct for the trades audience (hundreds of open deals). Document a hard note: if a company exceeds ~1,500 active opportunities, move filter/sort/paginate server-side behind an `opportunity_table_rows` view (same pattern projects uses). Add a dev-only `log()`/telemetry breadcrumb when a company's row count crosses the ceiling so we see it coming. **Never** silently degrade.
- **Saved views:** new `opportunity_views` table + `opportunity-views-service.ts` + hooks (`use-opportunity-views-list`, `use-opportunity-view`, `use-opportunity-view-actions`) mirroring the projects equivalents. View = columns + filters + sort + density + grouping + closed-toggle, bundled.
- **Selection / scroll / expansion state:** preserved across background refetch by stable row id (`getRowId: row => row.id`). See §8 anti-patterns — this is load-bearing.

### 3.5 Shared primitives (lift, don't fork)

Move these low-churn pieces from `projects/_components/table-v2/` to a shared location (e.g. `src/components/data-table/`) and have **both** projects and pipeline consume them, with zero behavior change to the projects table (verified by its existing tests + a manual pass):

- Read-only cell renderers: `cell-currency`, `cell-date`, `cell-number`, `cell-percent`, `cell-text`, `cell-progress`, `cell-team`, `cell-relation`.
- Density/zoom control + `use-table-zoom`, `use-table-selection`, `use-table-keyboard-nav`.
- The TanStack Virtual row-virtualizer wrapper.
- `undo-toast`, `conflict-overlay` shells.

**Pipeline-specific (not shared):** column config (`pipeline-table.ts` types), the shell, the data adapter, editable cells whose semantics differ (stage cell, assignee cell, value cell, follow-up cell), the stage-group-header, and the bulk bar (different mutations).

If lifting a given primitive proves to entangle the live projects table, fall back to **duplicating that one primitive** into the shared dir seeded from the projects version, and leave projects untouched — but flag each such divergence explicitly in the PR description.

---

## 4. Column model (`pipeline-table.ts`)

All columns sortable unless noted. Money/numbers: **JetBrains Mono, tabular-lining, slashed zero, formatted** (`$12,400`, `64%`); empty = `—`. Numbers right-aligned; text left-aligned. Identity column frozen.

| Column | Kind | Source (`Opportunity`) | Editable | Notes |
|---|---|---|---|---|
| select | checkbox | — | — | frozen |
| deal / contact | text | `title` / `contactName` / client name | — (click → detail) | **frozen** identity column |
| stage | stage chip | `stage` | **via dialog** | chip uses `OPPORTUNITY_STAGE_COLORS`; never the steel-blue accent |
| client | relation | `clientId`→name | — | links to client |
| est. value | currency | `estimatedValue` | **inline** | |
| win % | percent | `winProbability` (int) | — | falls back to stage default (`PIPELINE_STAGES_DEFAULT`) when null, shown muted |
| weighted | currency (derived) | `estimatedValue × (winProbability/100)` | — | core forecast number |
| age in stage | number/signal | derived from `stageEnteredAt` | — | rotting border when over per-stage threshold (§5) |
| last activity | date/signal | `lastActivityAt` | — | |
| next follow-up | date/signal | `nextFollowUpAt` | **inline** | overdue (past + open) → rose/brick border + flag |
| expected close | date/signal | `expectedCloseDate` | **inline** | overdue (past + open) emphasized |
| assignee | team/avatar | `assignedTo` | **inline** | |
| source | text | `source` | — | |
| priority | chip | `priority` | — | low/med/high |
| correspondence | number | `correspondenceCount` | — | optional column, off by default |

Default visible set (lean, per anti-pattern #1 — avoid column overload): **deal · stage · client · est. value · weighted · age in stage · next follow-up · assignee**. Everything else is opt-in via column settings, persisted per user in the saved view.

---

## 5. Aging / triage signals (full set, v1)

The differentiator and the clearest expression of OPS's "invisible helpfulness" — surface the dying quote before the owner thinks to look. Earth-tone **borders only**, never loud fills; every color cue paired with a value/icon (accessibility + anti-pattern #10).

- **Days-in-stage** — derived from `stageEnteredAt`. Per-stage **rotting threshold** (Pipedrive model): an idle deal past its stage's threshold gets a **tan** (attention) left-border + days-idle value; well past → **rose/brick** (stale). Timer concept resets on any activity (the existing `lastActivityAt`/`stageEnteredAt` already move on touch). **v1 reads the company's real `pipeline_stage_configs.stale_threshold_days`** (integer, NOT NULL — verified per-stage in the DB), with a sensible constant fallback only if no config row matches. Threshold-*editing* UI stays out of scope, but reading the configured value is in v1.
- **Last activity** — `lastActivityAt`; sortable so "oldest contact" floats the call-list to the top.
- **Overdue follow-up** — `nextFollowUpAt < today` and deal open → rose/brick border + a `[OVERDUE]` bracket tag.
- **Overdue expected-close** — `expectedCloseDate < today` and deal open → emphasized (the most common "forecast lie").
- **Default sort** = aging-aware: deals needing attention (overdue follow-up, then oldest last-activity) surface at top, so the table opens as a triage queue.

---

## 6. Forecast (weighted, v1)

- **Per-row weighted** = `estimatedValue × (winProbability / 100)`. Fallback order (Pipedrive's correct rule — deal-level wins): deal `opportunities.win_probability` (integer, nullable) → the company's configured **`pipeline_stage_configs.default_win_probability`** (integer, NOT NULL — verified in the DB) for that stage → the `PIPELINE_STAGES_DEFAULT` constant as last resort. A fallback value renders muted to signal it's not deal-specific.
- **Per-stage rollup** (when grouped): each stage group header shows **count · Σ est. value · Σ weighted**.
- **Grand-total footer:** total count · Σ value · Σ weighted across the visible (filtered) set. Recomputes with filters. Mono, tabular, formatted.
- The footer/group numbers are the load-bearing numerics — they make the table a *pipeline* table, not a spreadsheet.

---

## 7. Interaction

### 7.1 Hybrid editing
- **Inline (safe fields):** est. value, next follow-up date, expected close date, assignee. Uses the Table v2 optimistic + per-cell save-state + **undo** pattern (`use-cell-edit` analog) via `useUpdateOpportunity`. Commit on **Enter and blur** (never drop a typed edit); Escape cancels; per-cell idle/saving/saved/error state; conflict overlay on concurrent-edit (`updated_at` guard).
- **Stage = action, not a field.** The stage cell opens a stage control that calls `useMoveOpportunityStage` → `OpportunityService.moveOpportunityStage` (resets `stage_entered_at`, records duration-in-stage). **Won/Lost route through the existing `StageTransitionDialog`** (captures close reason/actuals). Never a bare inline stage dropdown.
- **Row click** → opens the existing pipeline detail panel (`openDetailPanel` / detail window). Edit affordances are explicit (pencil/focus), so clicking a row body opens detail without triggering an accidental edit (anti-pattern #4/#10).
- **Do NOT re-sort/re-paginate a row on inline commit** (anti-pattern #3). Order holds stable until the next explicit refresh/filter/sort/nav.

### 7.2 Bulk actions (`pipeline-bulk-bar`)
Appears only when rows are selected. Actions: reassign owner, set next-follow-up date, change priority, **mark won/lost (via dialog)**, archive. Reuses existing mutations. Bulk stage moves to Won/Lost go through the dialog flow. **Select-all states the exact matched count** ("Select all N") — never an ambiguous page-vs-filtered select (anti-pattern #6). Selection clears after the action; every bulk action pushes an undo entry.

### 7.3 Convert to project
Won / late-stage rows expose a **convert-to-project** action (row overflow menu + bulk) reusing the shipped `convert_lead_to_project` RPC. (Confirm the web-side wrapper from the lead-lifecycle work before wiring.)

### 7.4 Keyboard
Roving-tabindex: one tab stop into the grid, arrows move the active cell, Enter/F2 edits a safe cell, Escape cancels, Tab exits the grid in one stop (no keyboard trap — anti-pattern #7). `⌘Z` undo, `⌘A` select-visible, `⌘F` focus search. Reuse `use-table-keyboard-nav`. Honor `prefers-reduced-motion` on programmatic scroll.

---

## 8. Performance & correctness guardrails (from anti-pattern research)

Building on TanStack Table + TanStack Virtual — the exact libraries with documented grouped+virtualized failure modes. Mandatory:

1. **Stable row identity + preserved interaction state.** `getRowId: row => row.id`. On background refetch, preserve scroll offset, selection (a `Set` of ids, never indices), and expanded-group state. This single choice neutralizes the majority of documented complaints.
2. **Grouped + virtualized = one flattened virtual stream.** Group-header rows are virtual items interleaved with data rows fed to a **single** virtualizer. Two-container sticky structure (outer fixed-height scroller + inner spacer sized to `getTotalSize()`); group/column headers sticky on the scroll container, not inside a `<table>`. Account for sticky offset in `scrollToIndex`.
3. **Fixed row heights** per density tier (deterministic virtualization; avoids jump/flicker). Only virtualize past ~50 rows; never toggle virtualization conditionally (Rules of Hooks).
4. **Memoize** `columns`, `data`, grouped model, and every cell callback (stable refs). Editing-cell input state stays local to the cell so a keystroke re-renders one cell, not the table.
5. **No re-sort on inline commit** (§7.1). Hold order until explicit refresh.
6. **Don't reset scroll on background refresh.** Anchor to a row id, not a pixel.
7. **In-memory filter/sort is bounded** (§3.4 scale ceiling). The 2,000-row Salesforce wall is the cautionary tale; we stay well under it and document the server-side escape hatch.
8. **Optimistic-update races:** cancel in-flight queries on mutate; tag mutations so only the latest commits/rolls back; don't invalidate after every keystroke.

---

## 9. Design system

Per root `CLAUDE.md` + `OPS-Web/CLAUDE.md` + `ops-design-system/project/DESIGN.md`:
- Borders-only, zero box-shadows; radii panel 10 / chip 4 / bar 2; left-aligned text; numbers right-aligned mono.
- Density tiers (reuse Table v2 control): compact ~40px / comfortable ~56px / spacious ~72px. **Default compact** (web, non-touch, dense-tactical). Persisted per user in the view.
- Stage chips use `OPPORTUNITY_STAGE_COLORS`. **Steel-blue accent `#6F94B0` reserved** for the single primary CTA/focus ring per screen — never on stage chips, tabs, or signals.
- Aging/overdue use earth-tone semantic borders (tan = attention, rose/brick = stale/overdue), one signal at a time, always paired with text/icon. No zebra striping (use 1px hairline dividers — the OPS glass+hairline idiom).
- Single easing `cubic-bezier(0.22, 1, 0.36, 1)`; no spring/bounce except drag-reorder; honor `prefers-reduced-motion`. Mode crossfade uses this curve.
- Icons: IBM Carbon, 16/20px, monochrome `currentColor`.
- Voice: terse/tactical, `//` section prefixes, `[brackets]` for metadata/flags, no emoji, no exclamation points; UPPERCASE (Cake Mono Light) for authority labels, sentence case for content.

---

## 10. Copy & i18n

All strings via `useDictionary("pipeline")`. Extend `src/i18n/dictionaries/en/pipeline.json` and the `es/` mirror (both exist). New keys: table column labels, toolbar, grouping/closed toggles, saved-view UI, bulk actions, aging/overdue tags, forecast labels, empty/loading/error states. Write copy with **ops-copywriter**; **flag all `es` strings for native-speaker review** (known open item) rather than treating machine translations as final.

Default saved-view names (OPS voice): `MY OPEN`, `CLOSING THIS MONTH`, `NO NEXT STEP`, `STALE`, `OVERDUE FOLLOW-UP`.

---

## 11. Permissions & notifications

- **Permissions (granular only, never role):** `pipeline.view` to see the table + money columns; `pipeline.manage` to edit cells, move stages, bulk-act, convert. Use `usePermissionStore.can(...)`.
- **Notifications:** user-facing events the table triggers (bulk stage moves, conversions) dispatch to the notification rail via existing helpers, consistent with the rest of the app.

---

## 12. Schema (verified via Supabase MCP against the `ops-app` project `ijeekuhbatykdomumfjx`, 2026-05-31)

- **`opportunities`** already has every needed field; nullable except `company_id`/`stage`/`title`/`stage_entered_at`/`updated_at`/`created_at`/`correspondence_count`/`inbound_count`/`outbound_count` (all `NOT NULL`): `stage_entered_at` (timestamptz, **NOT NULL** — good, always present for age-in-stage), `last_activity_at` (timestamptz, null), `next_follow_up_at` (timestamptz, null), `win_probability` (integer, null), `estimated_value` (numeric, null), `actual_value` (numeric, null), `expected_close_date` (date, null), `actual_close_date` (date, null), `source` (text, null), `priority` (text, null), `assigned_to` (uuid, null), `client_id` (uuid, null), `project_id` (uuid, null), `updated_at`, `deleted_at`, `archived_at`. **No migration for row data.**
- **`pipeline_stage_configs`** (the real table name — NOT `pipeline_stages`) carries real per-stage config, verified columns: **`default_win_probability` (integer, NOT NULL)**, **`stale_threshold_days` (integer, NOT NULL)**, `auto_follow_up_days` (int, null), `auto_follow_up_type` (text, null), `sort_order` (int), `color`, `slug`, `is_default`, `is_won_stage`, `is_lost_stage`, `deleted_at`. v1 **reads these** for the weighted-forecast fallback (§6) and rotting thresholds (§5) — better than hardcoding. `PIPELINE_STAGES_DEFAULT` is only the last-resort constant. (Note the type alias in `pipeline.ts` is `PipelineStageConfig` with `defaultWinProbability`/`staleThresholdDays`.)
- **`opportunity_views`** confirmed **absent** (`to_regclass` → null) → **one additive migration** mirroring the **verified** `project_views` schema **exactly**. Real `project_views` columns (do not deviate): `id` uuid default `gen_random_uuid()`; `company_id` uuid **NOT NULL**; `owner_type` text **NOT NULL** (no default); `owner_id` uuid **NOT NULL** (no default); `name` text NOT NULL; `icon` text null; **`description` text null**; `permission_key` text null; `is_default` bool NOT NULL default false; **`is_archived` bool NOT NULL default false** (load-bearing — the shell filters `view.isArchived !== true`); `sort_position` int NOT NULL default 0; `columns` jsonb **NOT NULL (no default)**; `filters` jsonb **NOT NULL (no default)**; `sort` jsonb **NOT NULL (no default)**; `density` text NOT NULL default `'comfortable'`; `zoom_level` numeric NOT NULL default `1.00`; `created_at`/`updated_at` timestamptz NOT NULL default `now()`; `created_by` uuid null. New table = iOS-safe (additive only; iOS ignores unknown tables). **RLS/grants follow the VERIFIED three-part `project_views` pattern** (read from migrations `20260514163406` + `20260513034650`, not assumed): (a) a **PUBLIC/role-agnostic SELECT policy** (`to public`, no role restriction) so the anon-executing app reads through it, scoped by `company_id = (select company_id from users where id = private.get_current_user_id())` + `owner_type`/`owner_id` + optional `permission_key`/`has_permission`; (b) write-backstop policies `to authenticated` (company-view branch gated by `has_permission(uid,'pipeline.manage_views','all')`, personal-view branch by `owner_id = uid`); (c) `grant select, insert, update, delete … to anon` (+ `authenticated`) — the app executes as the anon role, which is why reads work despite manage policies being `to authenticated`. All six writes are **SECURITY DEFINER RPCs** (`*_opportunity_table_view`) that re-check permissions internally (`projects.manage_views` → **`pipeline.manage_views`**, a new seeded permission) and are `grant execute … to anon, authenticated`, with two `private.*` sanitizer/clean-name helpers whose **column-id allowlist uses the pipeline column ids** (not the project ones). (My earlier "policies must target anon" was wrong — corrected against the live schema.) The `opportunity_views` types + service + hooks mirror `project_views`' (`ProjectTableViewDefinition`, `project-views-service.ts`, `use-project-views-list`) one-for-one, including `isArchived` handling and the definer-RPC write path.

---

## 13. Phased build (each phase = clean commit batch; branch `feat/pipeline-table-*`; nothing pushed until initiative complete)

1. **Spatial removal + mode reduction.** `focused | table`; delete spatial components + transition overlay; crossfade; persist migration `opsPipeline:v4`. Table mode renders an empty shell behind flag `pipeline_table_view`.
2. **Shared primitives extraction.** Lift Table v2 leaf primitives to `src/components/data-table/`; projects consumes them unchanged (verify no regression).
3. **Column model + data adapter + flat read-only table.** `pipeline-table.ts`, adapter, virtualized flat table, default columns, forecast/weighted column + grand-total footer.
4. **Hybrid editing.** Inline safe fields (optimistic + undo + conflict), stage-via-dialog, row→detail, keyboard nav.
5. **Aging/triage signals.** Days-in-stage, last-activity, rotting thresholds, overdue follow-up/close flags, aging-aware default sort.
6. **Grouping toggle + stage rollups.** Flattened single-virtualizer grouped render, sticky group headers with count/Σvalue/Σweighted, closed-deals toggle.
7. **Saved views (full parity).** `opportunity_views` migration + service + hooks + view tabs + favorites + create/duplicate/share/archive dialogs; seed default views.
8. **Bulk bar + convert-to-project + notifications + i18n + polish.** Bulk actions, convert RPC, notification dispatch, en/es copy (es flagged for review), final design-system pass.

---

## 14. Open items / risks

- **Convert-to-project wrapper:** confirm the web-side entry point from the lead-lifecycle work before phase 8 (RPC `convert_lead_to_project` exists; verify the hook/service).
- **Shared-primitive extraction risk:** if lifting a primitive entangles the live projects table, duplicate that one into the shared dir (seeded from projects) and flag it — don't destabilize projects.
- **⚠️ Live WIP on the extraction target (observed 2026-05-31):** the working tree has **uncommitted, not-mine changes** to the exact files Phase 2 extracts — `projects-density-control.tsx`, `projects-table-row.tsx`, `projects-table-shell.tsx`, `projects-view-tabs.tsx`, `use-table-zoom.ts`, the projects dictionaries, and two table-v2 test files. A sibling session is actively editing Projects Table v2. **Do not** stage/stash/modify those files; coordinate or wait for them to land before Phase 2 extraction, and re-baseline the primitives against the final committed version. This raises the bar for choosing the "duplicate, don't refactor" fallback in Phase 2.
- **Spanish copy:** machine-drafted, flagged for native review.
- **Scale ceiling:** in-memory is correct now; server-side escape hatch documented (§3.4, §8.7).
- **Hold push:** commit locally throughout; do not push until the full initiative lands (consistent with the standing lead-lifecycle push-hold posture for pipeline-adjacent work — confirm with user before any push).
