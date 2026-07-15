# Clients — Quick Actions + Window Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** From a client's window you can start the things you actually do with a client — new estimate, new project, new invoice — seeded with that client. The window's viewing experience gets a structural tighten.

**Verified state:** the client window (`client-workspace-container.tsx`, reusing `ProjectWorkspaceWindow` shell at :171) has ZERO creation affordances — viewing footer is EDIT only; tabs are CONTACT / PROJECTS / MONEY / ACTIVITY. Seeding already exists in the platform: `openProjectWindow({ projectId: null, mode: "creating", initialClientId })` (`window-store.ts:64-80,261-277`); `create-estimate` window reads `{ clientId }` seed metadata (`create-estimate-modal.tsx:286-305` `deriveCreateEstimateDefaults`); invoice creation is a route `/books?segment=invoices&action=new` (no client seed today). Established action homes in this shell: ModeFooter `secondary[]` + title-bar `headerAction` slot (project sidebar rule: NO floating quick-action clusters).

**Design judgment (the reasoning executors must preserve):** creation actions are *frequent* operations on a client — they earn footer placement (always visible, predictable), NOT a hidden overflow menu. Three actions max; permission-gated; each closes nothing (the client window stays open — the new window stacks).

**Tech Stack:** Zustand window store, Next router, TanStack Query.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `ops-copywriter` (labels), `custom-skills:audit-design-system`.

---

### Task 1: Quick actions in the client window footer

**Files:**
- Modify: `src/components/ops/clients/workspace/client-workspace-container.tsx` (:117-167 footer config)
- Read first: the `ModeFooterConfig` contract (`mode-footer` component under the project workspace dir), `fab-actions.ts:48-62`, `dispatch.ts:36-64`
- Modify: `src/i18n/dictionaries/{en,es}/clients.json` (labels)

**Step 1:** Read the ModeFooter component to learn `secondary[]` button anatomy (label/icon/handler/disabled) and how many secondaries the project window uses (visual budget). Read `usePermissionStore` gating idiom (`can("estimates.create")`, `can("projects.create")`, `can("invoices.create")` — verify exact permission keys in `src/lib/types/permissions.ts`; never guess, never role-gate).
**Step 2:** In `viewing` mode's footer config add three secondaries (order: ESTIMATE, PROJECT, INVOICE — pipeline-frequency order), each permission-gated (absent, not disabled, when denied):
- `NEW ESTIMATE` → `openWindow`/`openCreateEstimateWindow` equivalent with seed `{ clientId }` — read `window-store.ts` for the exact `create-estimate` opener + metadata key (`deriveCreateEstimateDefaults` consumes it; match its expected shape).
- `NEW PROJECT` → `openProjectWindow({ projectId: null, mode: "creating", initialClientId: clientId })`.
- `NEW INVOICE` → Task 2's seeded route.
Labels via dictionary (EN: `NEW ESTIMATE` / `NEW PROJECT` / `NEW INVOICE`; ES equivalents). Icons: existing lucide set used by FAB actions (`fab-actions.ts`) at 14–16px, monochrome.
**Step 3:** EDIT stays the footer `primary`. If four buttons crowd the 880px window footer (check at min window width — read the shell's min-size), move INVOICE+PROJECT+ESTIMATE into footer and verify truncation behavior; the ModeFooter has a `spacer`/layout contract — respect it rather than cramming.
**Step 4:** tsc; preview: open a client → three buttons render (as permitted), each opens its creation surface seeded with the client (estimate form shows the client preselected; project creation form shows client; verify visually). Client window remains open underneath. Screenshots each flow → `docs/artifacts/web-polish-2026-07-09/clients-quick-actions/`.
**Step 5:** Commit: `feat(clients): footer quick actions — seeded estimate/project/invoice creation`

### Task 2: Invoice creation accepts a client seed

**Files:**
- Modify: `src/components/books/segments/invoices-segment.tsx` (reads `openCreate`; find where the create form/window initializes)
- Modify: `src/components/books/books-page.tsx` (URL contract: add `client=<id>` param pass-through)
- Modify: whatever invoice-create surface consumes defaults — read the invoices segment to find it (`action=new` handling) before deciding the exact seam.

**Step 1:** Trace `/books?segment=invoices&action=new` end-to-end (books-page `openCreate` → `InvoicesSegment openCreate/onCreateHandled` → the create form). Add optional `client` param: `books-page.tsx` reads `searchParams.get("client")`, passes `createClientId` into `InvoicesSegment`, which seeds the form's client field the same way the estimate modal seeds (find the invoice form's client field state; preselect + leave editable). Param strips with `action` via the existing `handleCreateHandled`.
**Step 2:** Client footer's NEW INVOICE routes to `/books?segment=invoices&action=new&client={clientId}`. (Route navigation is correct here — invoices live in Books; a floating invoice composer doesn't exist yet. The client window stays open; user returns via back/nav.)
**Step 3:** tsc; preview: from client window → NEW INVOICE → Books opens with the create form, client preselected. Screenshot.
**Step 4:** Commit: `feat(books): invoice create accepts a client seed via URL`

### Task 3: Window viewing-body structural tighten ("windowed view needs work")

Scoped, verified structural defects only — no speculative redesign:

**Files:**
- Modify: `src/components/ops/clients/workspace/viewing/client-viewing-body.tsx` (root `<div>` at :42 — not a min-h-0 flex column; sticky tab strip at :48 relies on ancestor scroll behavior)
- Read + fix as found: `contact-tab.tsx`, `money-tab.tsx`, `projects-tab.tsx`, `activity-tab.tsx`

**Step 1:** Root becomes `flex h-full min-h-0 flex-col`; the tab strip a non-scrolling flex child; the tab content the single `min-h-0 flex-1 overflow-y-auto scrollbar-hide` scroller. Verify the sticky hack (:48) becomes unnecessary and remove it. Check each tab renders correctly under the new scroll ownership (MONEY's invoice list, ACTIVITY's timeline are the overflow candidates).
**Step 2:** Sweep the four tabs for hardcoded values + banned patterns (pills, hex) and fix in place — audit-design-system discipline; list every fix in the report.
**Step 3:** MONEY tab: with invoices now creatable from the footer, add the empty-state affordance only if absent data yields a blank pane (check `WidgetEmptyState`-style patterns; `—`-style tactical empty, no coaching copy).
**Step 4:** Preview all four tabs at default 880×620 AND resized small (verify shell min size) — no cut-off content, scroll works per tab. Screenshots per tab.
**Step 5:** Commit: `fix(clients): window body owns its scroll — tabs render full content at any size`

### Task 4: Audit + evidence

`custom-skills:audit-design-system` over touched files; evidence folder complete; report lists the permission keys used (for the client-catalog sync rule: if any permission key is new, it must exist in `src/lib/types/permissions.ts` — do NOT invent DB-side grants).
