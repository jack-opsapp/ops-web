# Agent Queue → Sortable Table Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the queue's tall stacked cards with the house register table: compact sortable rows, click-to-expand detail, and a real workbar (search + derived type/priority filters + count) — so 56 proposals can be scanned and acted on in one screen instead of three.

**Architecture:** `/agent/queue` adopts the canonical list-surface stack already used by Clients/Books/Catalog — route registry `fullHeight: "bleed"` → `TableShell` (scroll-away metrics slot unused, sticky `Workbar`) → `RegisterTable inShell` (sticky `<thead>`). Two capabilities are added to the SHARED `RegisterTable` (they belong there, not in the page): **sortable column headers** and **expandable rows**. The queue's per-type detail bodies move out of `ActionCard`'s shell into a new `ActionDetail` component rendered inside the expanded row.

**Tech Stack:** Next.js 15 app router, React 19, TanStack Query, Tailwind tokens, Vitest + Testing Library.

**Design System:** `.interface-design/system.md` + `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`. Every value a token class. Table row anatomy comes from `register-table-cells` (`TablePrimary`, `TableMeta`, `TableMono`, `Tag`) — do not re-derive typography.

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `custom-skills:audit-design-system` (before any UI task is called done).

**Worktree:** `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/agent-queue-redesign` (reused; already checked out on) branch `feat/agent-queue-table`, cut from `origin/main` `a763f1a0`. Real `node_modules` (own `npm ci`). Tests `npx vitest run <path>`; types `npx tsc --noEmit` (slow — run once, in background, at the end; ignore the 8 pre-existing errors in `bug-report*element-picker*` test files, which are on main and do not block Vercel builds).

**Commit rules:** conventional commits, one logical change each, stage by explicit file name, **no AI attribution / Co-Authored-By lines**. Never push.

---

## Decisions already made (do not re-open)

1. **Surface:** registry `agent-queue` → `fullHeight: "bleed"`. Page root `flex h-full min-h-0 flex-col` (copy Clients). `TableShell` owns the scroll; `RegisterTable inShell`. No `metrics` strip (the pending count lives in the workbar `meta` slot and the segment label).
2. **Workbar grammar (fixed by the shared component — do not re-arrange):** `search` = `SearchInput` over summary + type label; `filters` = derived type `FilterChips` then derived priority `FilterChips` (each rendered only when ≥2 distinct values are present in the loaded rows); `meta` = `WorkbarCount` of visible rows; `tabStrip` = the `SegmentControl` NEEDS YOU / HISTORY (moves out of its current bespoke header).
3. **Columns** (in order). `sortable` marked ✓:

   | id | header | cell | align | notes |
   |----|--------|------|-------|-------|
   | `expand` | `""` | chevron (down/up), `text-text-3` | left | 28px, `w-[28px]`, not sortable |
   | `select` | select-all checkbox | per-row checkbox | left | 28px; pending + bulk-eligible rows only; excluded types render an empty cell |
   | `type` | `column.type` | icon 16 + `TablePrimary` label | left | ✓ sorts by localized label |
   | `summary` | `column.proposal` | `TableMeta` (truncate, `max-w-none w-full`) | left | not sortable; the elastic column |
   | `priority` | `column.priority` | `Tag` tan/rose for high/urgent, else `TableMono` `—` | left | ✓ urgent > high > normal > low |
   | `confidence` | `column.confidence` | `TableMono` `NN%` | right | ✓ numeric |
   | `age` | `column.age` | `TableMono` compact age from `createdAt` | right | ✓ numeric (ms) |
   | `status` | `column.status` | `Tag` via `STATUS_TAG` | left | ✓; **history view only** |
   | `actions` | `""` | `APPROVE` / `REJECT` (`Button size="sm"`, `default` / `ghost`) | right | pending only; `stopPropagation` |

4. **Sort:** client-side over loaded rows. State `{ columnId, direction }`. Defaults per view: NEEDS YOU → `priority` desc; HISTORY → `age` desc (newest decided first — `reviewedAt ?? updatedAt`). Clicking a sortable header sets it / toggles direction. `aria-sort` on the `<th>` (`ascending` / `descending` / `none`), matching `pipeline-table-header.tsx`.
5. **Expansion:** row click toggles expansion (there is no other row action). Multiple rows may be open. Checkbox and action-button clicks must NOT toggle (`stopPropagation`). The expanded `<tr>` renders `<td colSpan>` containing `<ActionDetail>`.
6. **`ActionDetail`:** `src/components/agent/action-detail.tsx` — the existing per-type detail bodies + editable state + edit-aware approve, WITHOUT the card shell (no glass wrapper, no header row, no priority/status/meta line, no expand toggle). Props: `{ action, onApprove, onReject, t, teamMembers? }`. `onApprove(id, editedData?)` — the detail's own APPROVE passes edits; the table row's APPROVE passes none. `action-card.tsx` is DELETED once nothing imports it.
7. **Copy (final, en → es):** `column.type` Type/Tipo · `column.proposal` Proposal/Propuesta · `column.priority` Priority/Prioridad · `column.confidence` Conf./Conf. · `column.age` Age/Edad · `column.status` Status/Estado · `search.placeholder` "Search proposals"/"Buscar propuestas" · `filter.allPriorities` All/Todas · `count.rows` "{{count}} rows"/"{{count}} filas" · `count.rowsOne` "1 row"/"1 fila".
8. Everything else about the queue (the `agent.review` gates, the `statuses` history filter, the error/empty states, the in-panel batch bar, toasts) is SHIPPED and stays as-is. Do not touch the API routes, hooks, service, or permission catalog.

---

### Task 1: `RegisterTable` — sortable headers (shared primitive)

**Files:** modify `src/components/ui/register-table/register-table.tsx`, `src/components/ui/register-table/index.ts`; create `src/components/ui/register-table/__tests__/register-table-sort.test.tsx`.

**Step 1 — failing test.** Render a `RegisterTable` with two columns, one `sortable`, and assert: the sortable `<th>` carries `aria-sort="none"` when unsorted, `"ascending"` when `sort={{columnId, direction:"asc"}}`, the non-sortable `<th>` has no `aria-sort`, clicking a sortable header calls `onSortChange("<id>")`, and clicking a non-sortable header does not.

**Step 2 — run** → FAIL.

**Step 3 — implement.** Add to `RegisterTableColumn<Row>`: `sortable?: boolean`. Add to `RegisterTableProps<Row>`:

```ts
/** Active sort. `null` = unsorted. Sorting itself is the caller's job — this renders the affordance. */
sort?: { columnId: string; direction: "asc" | "desc" } | null;
/** Fired when a sortable header is activated. Caller decides toggle semantics. */
onSortChange?: (columnId: string) => void;
```

A sortable header renders its label inside a `<button type="button">` (full-cell, `inline-flex items-center gap-1`, `hover:text-text-2`, focus ring `focus-visible:ring-1 focus-visible:ring-ops-accent`) with a 12px `ChevronUp`/`ChevronDown` from `lucide-react` shown only when that column is the active sort. `aria-sort` on the `<th>` exactly as in decision 4. Header typography is unchanged (`font-mono text-micro uppercase tracking-[0.16em] text-text-3`; active sort brightens to `text-text-2`).

**Step 4 — run** → PASS. **Step 5 — commit** `feat(register-table): sortable column headers`.

---

### Task 2: `RegisterTable` — expandable rows (shared primitive)

**Files:** same table file + `src/components/ui/register-table/__tests__/register-table-expand.test.tsx`.

**Step 1 — failing test.** With `renderExpanded` + `expandedRowIds` containing one row id: that row is followed by a `<tr>` whose single `<td>` has `colSpan={columns.length}` and contains the rendered node; a collapsed row has no such `<tr>`; `onRowClick` still fires on the data row.

**Step 2 — run** → FAIL.

**Step 3 — implement.** Add props:

```ts
/** Detail renderer for an expanded row. Omit for a non-expandable table. */
renderExpanded?: (row: Row) => ReactNode;
/** Ids currently expanded. */
expandedRowIds?: ReadonlySet<string>;
```

In `<tbody>`, map each row to a fragment (`<Fragment key={id}>`): the existing `<tr>`, plus — when `renderExpanded && expandedRowIds?.has(id)` — a second `<tr>` (`border-b border-border-subtle bg-surface-hover/`… use `bg-fill-neutral-dim` for the detail ground so it reads as a nested surface) containing one `<td colSpan={columns.length} className="p-0">` wrapping the node. The expanded row is NOT interactive (no click handler, no hover). Keep the data row's `aria-expanded={expandedRowIds ? isExpanded : undefined}` for a11y.

**Step 4 — run** → PASS. **Step 5 — commit** `feat(register-table): expandable detail rows`.

---

### Task 3: `ActionDetail` — the card's detail body without the shell

**Files:** create `src/components/agent/action-detail.tsx` (+ `__tests__/action-detail.test.tsx`); delete `src/components/agent/action-card.tsx` and its `__tests__/action-card-shell.test.tsx` only after Task 5 removes the last import (do the delete in Task 5's commit if it is still imported).

**How:** copy `action-card.tsx` → `action-detail.tsx`, then:
- Rename the export `ActionCard` → `ActionDetail`; keep `TeamMemberOption`.
- Props drop `selected` and `onSelect`; keep `{ action, onApprove, onReject, t, teamMembers? }`.
- Delete the outer `motion.div` shell, the whole header row (checkbox / type icon / summary / priority / meta / expand toggle / approve-reject cluster / status tag) — everything between the shell open and the `{/* ── Expanded Details ── */}` marker — and the `expanded` state, `AnimatePresence`, and its `motion.div`.
- The root becomes the former inner `<div className="border-t border-border-subtle px-4 pb-4">` → change to `<div className="px-3 pb-3 pt-3">` (no top border: the table row above already provides the boundary).
- Keep every per-type detail block, every editable state hook, `handleApproveWithEdits`, and the reviewNotes/error blocks.
- The detail keeps ONE action pair at its end: `APPROVE` (`Button variant="primary" size="sm"` — this is the edit-aware commit) and `REJECT` (`Button variant="ghost" size="sm"`), shown only when `action.status === "pending"`. Label overrides for day-closeout / collections / financial-insight stay exactly as they are.
- Remove now-unused imports (`Check`, `ChevronDown`, `ChevronUp`, `Gauge`, `Clock`, `ExternalLink`, `Tag`, `PRIORITY_TAG`, `STATUS_TAG`, `getSourceUrl`, `timeAgo`, …) — but ONLY if genuinely unused; `PRIORITY_TAG`/`STATUS_TAG`/`timeAgo`/`getSourceUrl` are needed by Task 4, so **move them to `src/components/agent/queue-row.ts`** (a new shared module) and import from there in both places. Also move `ACTION_TYPE_ICONS` there.

**Test:** render `ActionDetail` for a `reassign_task` proposal and assert the detail body renders (e.g. the assignment reason / suggested member) and an APPROVE button exists; for a non-pending action, no APPROVE.

**Commit** `refactor(agent-queue): extract ActionDetail from the card shell`.

---

### Task 4: Rebuild the page as a table

**Files:** rewrite `src/app/(dashboard)/agent/queue/page.tsx`; update `src/app/(dashboard)/agent/queue/__tests__/agent-queue-page.test.tsx`; modify `src/lib/navigation/route-registry.ts` (`padded` → `bleed`) + its test; create `src/components/agent/queue-row.ts` if Task 3 has not.

**Registry test first:** update `route-registry-agent-queue.test.ts` to expect `"bleed"`, watch it fail, change the registry, watch it pass.

**Page structure** (mirror `clients/page.tsx`):

```tsx
<div className="flex h-full min-h-0 flex-col">
  <TableShell
    toolbar={
      <Workbar
        search={<SearchInput value={search} onChange={…} placeholder={t("search.placeholder")} wrapperClassName="w-[240px] max-w-full" aria-label={t("search.placeholder")} />}
        filters={<>{typeOptions.length > 1 && <FilterChips … />}{priorityOptions.length > 1 && <FilterChips … />}</>}
        meta={<WorkbarCount>{visible.length === 1 ? t("count.rowsOne") : interpolate(t("count.rows"), { count: visible.length })}</WorkbarCount>}
        tabStrip={<SegmentControl<View> options={[needsYou (count), history]} value={view} onChange={handleViewChange} />}
      />
    }
    isEmpty={isLoading || isError || visible.length === 0}
    emptyState={isLoading ? <QueueSkeleton/> : isError ? <QueueError …/> : <RegisterEmpty …/>}
  >
    <RegisterTable columns={columns} rows={visible} getRowId={r => r.id} inShell minWidth={900}
      sort={sort} onSortChange={handleSortChange}
      onRowClick={toggleExpanded} expandedRowIds={expandedIds}
      renderExpanded={(row) => <ActionDetail action={row} onApprove={handleApprove} onReject={setRejectTarget} t={t} teamMembers={row.actionType === "create_task" ? teamMemberOptions : undefined} />}
      ariaLabel={t("title")} />
  </TableShell>
  {selectedCount > 0 && <footer …batch bar unchanged… />}
  <RejectDialog … /> <RejectDialog … />
</div>
```

Keep from the shipped page verbatim: the two `useApprovalQueue` filters (`PENDING_FILTER` / `HISTORY_FILTER` via `HISTORY_STATUSES`), `isPending`→skeleton, `QueueError` + retry, `BULK_EXCLUDED`, all four mutation handlers + toasts, both `RejectDialog`s, and the batch-bar markup (it sits below the shell, still inside the page root, `border-t border-border px-3 py-2`).

Add: `search` state (case-insensitive match on `contextSummary` + localized type label), `priorityFilter` state, `sort` state with the per-view defaults, `expandedIds: Set<string>`, and a `useEffect` that clears a filter/sort/expansion that no longer applies after a refetch (same guard as the existing type-filter reset).

Sorting comparator (client-side, stable): `type` → localized label `localeCompare`; `priority` → rank `{urgent:0,high:1,normal:2,low:3}`; `confidence` → number; `age` → `createdAt` ms in NEEDS YOU, `(reviewedAt ?? updatedAt)` ms in HISTORY; `status` → localized label. Direction flips the comparator; ties fall back to newest-first.

**Tests to write** (extend the existing page test file; keep its mocks, add a `RegisterTable`-real render — do NOT mock the table): error state + retry; pending empty state; skeleton while `isPending`; type chips derived and filtering; search narrows rows; clicking the AGE header calls sort and reorders rows; clicking a row renders `ActionDetail` (mock `@/components/agent/action-detail` to a `data-testid="detail"` stub) and clicking again collapses it; switching to HISTORY requests `statuses` and shows the status column.

**Commit** `feat(agent-queue): sortable table with expandable rows and a real workbar`.

---

### Task 5: Dictionary, deletion, verification

- `src/i18n/dictionaries/{en,es}/agent-queue.json`: add the keys from decision 7. Remove `action.expand`/`action.collapse` only if nothing references them after the rewrite (grep first).
- Delete `src/components/agent/action-card.tsx` + `src/components/agent/__tests__/action-card-shell.test.tsx` once `grep -rn "action-card" src` is empty.
- `npx vitest run "src/app/(dashboard)/agent" src/components/agent src/components/ui/register-table src/lib/navigation` → green.
- `npx next lint --file …` on every touched file → clean.
- `npx tsc --noEmit` (background) → no NEW errors beyond the 8 pre-existing element-picker ones.
- Run `custom-skills:audit-design-system` on the page + `action-detail.tsx` + the table changes: zero new hex/rgba literals; report (do not fix) the pre-existing literals inherited by `action-detail.tsx` from the old card.

**Commit** `feat(agent-queue): table dictionary + retire the card shell`.

---

### Task 6 (orchestrator, not a subagent): live proof

Run the worktree on port 3456 with the dev bypass patched to the Canpro owner, drive headless Chrome as owner, and capture: NEEDS YOU table at 1440×780 (row density, ~15+ rows visible), one row expanded, a sort applied (AGE asc), a search + type filter narrowing the list, the batch bar with a selection, and HISTORY with the status column. Screenshots to the session scratchpad only. Revert the bypass patch before any merge.
