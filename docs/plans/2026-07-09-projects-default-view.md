# Projects — Default View + Chip Deselect Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Landing on Projects shows ALL projects. Clicking the active view chip deselects it (back to ALL). The user can pick any saved view as their personal default.

**Verified architecture:** view chips are DB-backed saved views (`project_views` table; `ProjectTableViewDefinition`); active view = URL `?view` → localStorage `ops_projects_table_v2_view_id` → `findDefaultView()` ("My Active Work" → company `isDefault` → first) — there is NO null state (`use-project-view-url-state.ts:25-32,66-69`); `setActiveViewId` never clears (:95-104). `useProjectsTableData` short-circuits null view to EMPTY (`use-projects-table-data.ts:33-35,48`) — but the query layer already treats `filters: {}` as company-wide ALL (`project-table-service.ts:184-236`). Per-user preference persistence pattern: `usePreferencesStore` (zustand persist, `preferences-store.ts:105-439`, version 15, additive fields need a version bump).

**Design decision (locked):** "ALL" is a real, visible state — a pinned `ALL` chip at the head of the strip, active when no saved view is selected. Deselect = clicking the active chip OR clicking ALL. The user's default is device-local via `usePreferencesStore` (matches how view selection already persists; no schema change, no prod migration). `is_default` (company-scoped seed) remains only a fallback ordering hint, superseded by: user default → ALL.

**Tech Stack:** Zustand persist, Next router/searchParams, TanStack Query, vitest (this plan is the most logic-heavy — TDD the hook).

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system`.

---

### Task 1: Null-able view state in the URL/localStorage hook (TDD)

**Files:**
- Modify: `src/lib/hooks/projects-table/use-project-view-url-state.ts`
- Modify: `src/stores/preferences-store.ts`
- Test: `tests/` — find the existing tests for this hook (grep `use-project-view-url-state` under tests/; extend; if none, create per repo convention with `renderHook`)

**Semantics to implement:**
- URL: `?view=<id>` = that view; `?view=all` = explicit ALL; no param = resolve stored → user default → ALL.
- localStorage: stores `<id>` or the sentinel `"__all__"`.
- `activeView: ProjectTableViewDefinition | null` where `null` **means ALL** (never "nothing to show").
- `setActiveViewId(viewId: string | null)`: null → ALL (writes sentinel + `?view=all`); id → view (unchanged behavior).
- New: `defaultViewId` read from `usePreferencesStore` (`projectsDefaultViewId: string | null`); resolution order when no URL/stored value: preference view (if it still exists + unarchived) → ALL. **"My Active Work" is no longer auto-default** — `findDefaultView` collapses to: preference → null.
- `unavailableView` logic: URL id that doesn't resolve still reports unavailable + falls back (now to preference → ALL) — keep the effect's URL-repair behavior.

**Step 1 (failing tests):** cases — no param/no storage → activeView null (ALL); `?view=all` → null; stored sentinel → null; preference set → that view; preference set but archived → null; `setActiveViewId(null)` writes sentinel + pushes `?view=all`; clicking-path regression: `setActiveViewId(id)` unchanged.
**Step 2:** Implement. Preferences store: add `projectsDefaultViewId: string | null` (default null) + setter, bump `version` 15→16 with pass-through migration (follow the v6/v7 additive precedent at `preferences-store.ts:381-383`).
**Step 3:** Tests green; tsc clean except expected downstream (Tasks 2–3 worklist from tsc output).

### Task 2: ALL as a real view in the data layer

**Files:**
- Modify: `src/lib/hooks/projects-table/use-projects-table-data.ts` (:30-52)
- Modify: `src/lib/utils/project-view-defaults.ts` (export an ALL definition)
- Modify: `src/lib/hooks/projects-table/use-project-view.ts` (:140-173 — verify overrides layer tolerates the synthetic view)
- Modify: `src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx` (activeView consumers: :187, :313-319, :354-380 density/zoom persistence, view-settings menu)

**Step 1:** In `project-view-defaults.ts` export:
```ts
export const ALL_PROJECTS_VIEW_ID = "__all__";
export function buildAllProjectsView(): ProjectTableViewDefinition {
  return {
    id: ALL_PROJECTS_VIEW_ID, name: "All projects", icon: <existing default>,
    permissionKey: <same as seeded default — read the seed>,
    columns: PROJECT_TABLE_VIEW_DEFAULT_COLUMNS, filters: {}, sort: <default sort>,
    density: <default>, zoomLevel: <default>, isDefault: false, sortPosition: -1,
    updatedAt: <stable ISO constant — no Date.now() in module scope>,
  };
}
```
(Read the defaults file for exact member names/values; match the type exactly.)
**Step 2:** `useProjectsTableData`: when the hook receives the synthetic ALL view it just works (filters `{}` → zero instructions → company-scoped select — verified in `project-table-service.ts:205-221`). Replace the null-view empty short-circuit: callers now ALWAYS pass a view (real or `buildAllProjectsView()`) — decide the seam: prefer mapping in `use-project-view.ts` (activeView null → synthetic ALL) so the data hook stays dumb. Keep the `enabled` gate for the genuinely-loading case (views not yet fetched ≠ ALL selected; loading state must not flash the full company table before views resolve IF a stored/url view is pending — read the loading order carefully and preserve the no-flash guarantee described in the hook's comments).
**Step 3:** Table shell consumers with ALL active:
- Density/zoom changes (`updateViewDefinition` RPC :354-380): MUST NOT fire for the synthetic view (no DB row). Gate on `activeViewId !== ALL_PROJECTS_VIEW_ID`; density/zoom under ALL are session-local (component state) — acceptable; note in report.
- `ProjectsViewSettingsMenu` (rename/duplicate/share/reset/archive): hide the menu entirely when ALL is active (nothing to manage), EXCEPT "Set as default" which Task 4 adds — for ALL, defaulting is expressed by clearing the preference (see Task 4).
- Sort/filter URL overrides on top of ALL (`use-project-view.ts` layering) must still work: `?view=all&sort=…`.
**Step 4:** tsc clean; existing table tests green.
**Step 5:** Commit Tasks 1+2 together: `feat(projects): ALL-projects baseline state — null view resolves to unfiltered table`

### Task 3: Chips — pinned ALL + click-again deselect

**Files:**
- Modify: `src/app/(dashboard)/projects/_components/table-v2/projects-view-tabs.tsx` (:41-88)
- Modify: `src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx` (:313-319 handleViewChange)
- Modify: `src/i18n/dictionaries/{en,es}/projects.json` (ALL label)

**Step 1:** Prepend a pinned `ALL` chip (dictionary key, EN `ALL`, ES `TODOS`) before the saved-view chips, same chip anatomy (`rounded-chip font-mono text-[11px] uppercase`), active when `activeViewId` is null/ALL — active styling identical to other chips (`border-border bg-surface-active text-text` + Check icon per :46-51; no accent). No X button, not archivable, no settings.
**Step 2:** Click handling in `handleViewChange`/chip onClick: clicking a saved-view chip that is ALREADY active → `setActiveViewId(null)` (deselect to ALL); clicking ALL → `setActiveViewId(null)`; otherwise select. Keyboard: chips are buttons — behavior identical via Enter/Space for free.
**Step 3:** tsc; preview `/projects`: fresh visit (clear localStorage via `preview_eval`) lands on ALL with every project visible; click a view → filters apply; click it again → back to ALL; URL shows `?view=all` after deselect; reload preserves.
**Step 4:** Commit: `feat(projects): pinned ALL chip + click-again deselect`

### Task 4: "Set as default" per user

**Files:**
- Modify: `src/app/(dashboard)/projects/_components/table-v2/projects-view-settings-menu.tsx` (:256-328 menu items)
- Modify: `src/i18n/dictionaries/{en,es}/projects.json`

**Step 1:** Add a `MenuCommand` "SET AS DEFAULT" (dictionary EN/ES) to the per-view settings menu: writes `usePreferencesStore.setProjectsDefaultViewId(activeView.id)`. When the active view IS the current default, render as "DEFAULT VIEW ✓" (disabled state) with a second command "CLEAR DEFAULT" → `setProjectsDefaultViewId(null)` (landing reverts to ALL). Follow the menu's existing item anatomy exactly (icons, casing, destructive placement).
**Step 2:** Feedback: fire the standardized toast (`toast.success(t("views.defaultSet"), { description: view name })`) — import from `@/components/ui/toast`.
**Step 3:** tsc; preview: set a default → open `/projects` in a fresh tab (no `?view`) → lands on that view; clear default → lands on ALL. Screenshots → `docs/artifacts/web-polish-2026-07-09/projects-default-view/`.
**Step 4:** Commit: `feat(projects): user-selected default view via preferences`

### Task 5: Audit + evidence

`custom-skills:audit-design-system`; verify keyboard/focus on chips; evidence folder complete. Report: resolution-order table (URL → stored → preference → ALL), the density-under-ALL session-local caveat, and confirmation that the legacy `ProjectSpreadsheet` (feature-flag-off path) is untouched.
