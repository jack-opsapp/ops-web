# Projects Spreadsheet View — Design Spec

**Date:** 2026-03-29
**Scope:** Add a spreadsheet (table) view mode to the `/projects` route, toggled alongside the existing canvas view. Excel-style data table with inline editing, column visibility, sorting, row selection, and bulk actions.

---

## 1. Architecture: View Mode Toggle

### 1.1 State

`page.tsx` gains a `viewMode` state: `"canvas" | "spreadsheet"`, defaulting to `"canvas"`. Persisted to `localStorage` key `ops_projects_view_mode` so the user's preference survives reloads.

### 1.2 Conditional Rendering

The content area below the HUD (metrics header + toolbar) conditionally renders:
- **Canvas mode:** existing `<DndContext>` + all canvas components (unchanged)
- **Spreadsheet mode:** new `<ProjectSpreadsheet>` component

All data fetching, filtering, permissions, and lookup maps remain in `page.tsx` and are passed as props to whichever view is active. No duplication.

### 1.3 Toolbar Changes

Add a **view toggle** to `ProjectFloatingToolbar` — two icon buttons (grid icon / rows icon) after the "Archived" button, separated by a `|` divider. Active mode gets the `ops-accent` highlight.

**Per-mode toolbar adjustments:**
- **Canvas mode:** "Fit All" visible, "Sort" visible, "Archived" opens bottom tray (existing behavior)
- **Spreadsheet mode:** "Fit All" hidden, "Sort" hidden (sorting via column headers instead), "Archived" becomes a filter toggle — when active, archived projects appear as dimmed rows at the bottom of the table; when inactive, they're hidden

Search and Filter controls remain identical in both modes — they operate on the same `filteredProjects` array.

---

## 2. Table Layout

### 2.1 Container

Full-height scrollable container filling the content area below the HUD. Horizontal scroll for overflow when many columns are visible. Sticky header row that stays pinned during vertical scroll.

```
┌──────────────────────────────────────────────────────────────────────┐
│  [Metrics Header]                                                    │
│  [Toolbar: Search | Sort | Filter | Archived | ··· | Canvas | Table] │
├──────────────────────────────────────────────────────────────────────┤
│  ⋯ │ Status │ Title          │ Client    │ Address     │ Start  │ … │  ← sticky header
├──────────────────────────────────────────────────────────────────────┤
│  ⋯ │ ●      │ Smith Reno     │ J. Smith  │ 123 Oak St  │ Mar 15 │ … │
│  ⋯ │ ●      │ Deck Build     │ M. Jones  │ 456 Elm     │ Apr 01 │ … │
│  ⋯ │ ●      │ Roof Repair    │ T. Brown  │ 789 Pine    │ —      │ … │
│  …                                                                    │
├──────────────────────────────────────────────────────────────────────┤
│  Showing 47 of 52 projects                                           │  ← footer
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 Styling

- **Header row:** `bg-background-panel`, `font-kosugi text-caption-sm uppercase tracking-widest text-text-tertiary`, `border-b border-border-medium`
- **Body rows:** `border-b border-border-subtle`, `hover:bg-background-elevated/50`, `transition-colors duration-100`
- **Status color indicator:** 3px left border on each row using `PROJECT_STATUS_COLORS[project.status]`, matching the canvas card pattern
- **Selected row:** `bg-ops-accent-muted` — the left border remains status-colored (not overridden to accent). Selection is indicated by background only.
- **Archived rows (when shown):** `opacity-50` applied to the entire row
- **Cells:** `px-1.5 py-1.5`, `font-mohave text-body-sm text-text-primary`
- **Mono cells (values, dates, counts):** `font-mono text-data-sm`
- **Table border:** `rounded border border-border` on the outer container
- **Row height:** ~40px (compact enough for density, tall enough for comfortable click targets)

---

## 3. Columns

### 3.1 Full Column Definitions

| # | Column ID | Header | Source | Width | Sortable | Editable | Default Visible | Permission |
|---|-----------|--------|--------|-------|----------|----------|-----------------|------------|
| 0 | `actions` | — | — | 40px | No | No | Yes | — |
| 1 | `status` | Status | `project.status` | 120px | Yes | Yes (dropdown) | Yes | — |
| 2 | `title` | Title | `project.title` | 200px min | Yes | Yes (text) | Yes | — |
| 3 | `client` | Client | `clients.name` via `clientId` | 150px | Yes | No | Yes | — |
| 4 | `address` | Address | `project.address` | 180px | Yes | Yes (text) | Yes | — |
| 5 | `startDate` | Start | `project.startDate` | 100px | Yes | Yes (date) | Yes | — |
| 6 | `endDate` | End | `project.endDate` | 100px | Yes | Yes (date) | Yes | — |
| 7 | `progress` | Progress | computed tasks | 120px | Yes | No | Yes | — |
| 8 | `estimateTotal` | Est. Total | sum `estimates.total` | 100px | Yes | No | Yes | `accounting.view` |
| 9 | `invoiceTotal` | Inv. Total | sum `invoices.total` | 100px | Yes | No | No | `accounting.view` |
| 10 | `duration` | Duration | `project.duration` | 80px | Yes | Yes (number) | No | — |
| 11 | `team` | Team | computed from task assignments | 140px | No | No | No | — |
| 12 | `clientEmail` | Client Email | `clients.email` | 160px | No | No | No | — |
| 13 | `clientPhone` | Client Phone | `clients.phone_number` | 120px | No | No | No | — |
| 14 | `photos` | Photos | count of `project_images` | 70px | Yes | No | No | — |
| 15 | `notes` | Notes | `project.notes` | 200px | No | Yes (textarea) | No | — |
| 16 | `description` | Description | `project.description` | 200px | No | Yes (textarea) | No | — |
| 17 | `pipeline` | Pipeline | `opportunityId` presence | 80px | No | No | No | — |
| 18 | `daysInStatus` | Days in Status | computed from `updatedAt` | 90px | Yes | No | No | — |
| 19 | `created` | Created | `project.createdAt` | 100px | Yes | No | No | — |

### 3.2 Column Visibility

- Column visibility toggled via a dropdown menu (Columns icon button) in the table toolbar area, reusing the existing `DataTable` pattern with `DropdownMenuCheckboxItem` per column
- Visibility state persisted to `localStorage` key `ops_projects_spreadsheet_columns`
- Permission-gated columns (`estimateTotal`, `invoiceTotal`) only appear in the toggle if the user has `accounting.view`

### 3.3 Column Ordering

Default order is as listed above. No drag-to-reorder in v1 — order is fixed. Column reordering is a future enhancement.

---

## 4. Actions Column

The first column (`actions`) contains a `...` (MoreHorizontal) icon button per row.

### 4.1 Menu Items

| Action | Permission | Behavior |
|--------|-----------|----------|
| Open Details | — | Opens `ProjectDetailPopover` at a fixed position (top-right quadrant, not tethered to row) |
| View Full Page | — | Navigates to `/projects/[id]` |
| Change Status → | `projects.edit` | Submenu with all `ProjectStatus` values |
| Add Task | `tasks.create` | Opens task creation (existing window system) |
| Record Payment | `accounting.edit` | Opens payment form |
| Archive | `projects.edit` | Sets status to Archived |
| Delete | `projects.delete` | Soft delete with confirmation dialog |

### 4.2 Bulk Actions

When one or more rows are selected, a **bulk action bar** appears above the table header:

```
┌──────────────────────────────────────────────────────────────────┐
│  3 selected    [Change Status ▾]  [Archive]  [Delete]  [Clear]  │
└──────────────────────────────────────────────────────────────────┘
```

- "Change Status" opens a dropdown with all status options
- "Archive" sets all selected to Archived
- "Delete" shows confirmation dialog, then soft-deletes all selected
- Permission checks apply per action — buttons only visible if user has permission
- "Clear" deselects all

---

## 5. Row Selection

### 5.1 Selection Model

- **Single click** on a row (non-editable cell) selects/deselects that row
- **Shift+click** selects a range from the last-selected row
- **Ctrl/Cmd+click** toggles individual row selection (additive)
- **Checkbox column:** Not used. Selection is click-based to keep the table clean. Selected state indicated by row background + left accent border.
- **Header click:** No select-all via header. Use bulk action bar's implicit "all matching" behavior if needed in the future.

### 5.2 Selection State

Managed via a `Set<string>` of project IDs in the spreadsheet component's local state. Not in the canvas Zustand store — the two views maintain independent selection state.

---

## 6. Inline Editing

### 6.1 Interaction Model

- Click on an editable cell → cell enters edit mode
- The cell renders an appropriate input (text, dropdown, date picker, number, textarea)
- **Commit:** Press Enter, Tab (moves to next editable cell in same row), or click outside
- **Cancel:** Press Escape — reverts to original value
- **Optimistic update:** Value updates immediately in the UI; mutation fires in background; reverts on error with toast

### 6.2 Editable Cell Types

**Text cell** (`title`, `address`):
- Click → `<input type="text">` replaces the cell content
- Auto-selects all text on entry
- Styled to match cell dimensions — no layout shift
- Commits on Enter/blur, cancels on Escape

**Status dropdown** (`status`):
- Click → dropdown appears below cell showing all `ProjectStatus` options
- Each option shows status color dot + label
- Selecting an option commits immediately
- Uses the `useUpdateProjectStatus` mutation (same as canvas drag)

**Date picker** (`startDate`, `endDate`):
- Click → native `<input type="date">` or a minimal date picker popover
- Formatted display: `MMM DD` (e.g., "Mar 15") or "—" if null
- Commits on selection

**Number input** (`duration`):
- Click → `<input type="number" min="0">`
- Display suffix: "d" (e.g., "14d")
- Commits on Enter/blur

**Textarea** (`notes`, `description`):
- Click → cell expands vertically to show a `<textarea>` with 3 rows
- Commits on blur (Enter inserts newline)
- Truncated display with ellipsis when not editing

### 6.3 Permission Gate

All editable cells require `projects.edit` permission. If the user lacks permission, editable cells render as read-only (no cursor change, no click handler). No visual indicator of "locked" — they simply behave like read-only cells.

### 6.4 Mutations

| Field | Mutation | Endpoint |
|-------|----------|----------|
| `status` | `useUpdateProjectStatus` | Existing — reuse |
| `title`, `address`, `notes`, `description`, `duration`, `startDate`, `endDate` | `useUpdateProject` | Needs new hook — PATCH to `projects` table |

The `useUpdateProject` hook does not exist yet. It should follow the same pattern as `useUpdateProjectStatus`:
- Accepts `{ id: string, [field]: value }`
- Optimistic update in the TanStack Query cache
- Reverts on error
- Invalidates `projects` query key on success

---

## 7. Sorting

### 7.1 Column Header Sort

Click a sortable column header to cycle: unsorted → ascending → descending → unsorted.

Sort indicator: `ArrowUp` / `ArrowDown` / `ArrowUpDown` icon in ops-accent, matching the existing `DataTable` pattern.

### 7.2 Sort Implementation

Client-side sort on the `filteredProjects` array. The spreadsheet maintains its own sort state (`sortColumn: string | null`, `sortDirection: "asc" | "desc" | null`) separate from the canvas store's `sortBy`. The toolbar's sort dropdown is **hidden in spreadsheet mode** — sorting is done exclusively via column headers. When switching back to canvas, the canvas store's `sortBy` is unchanged.

Sort comparators:
- `title`: `localeCompare` A→Z / Z→A
- `client`: client name `localeCompare`
- `address`: `localeCompare`
- `startDate` / `endDate` / `created`: date comparison, nulls last
- `status`: `PROJECT_STATUS_SORT_ORDER` map
- `progress`: completed/total ratio
- `estimateTotal` / `invoiceTotal`: numeric
- `duration` / `photos` / `daysInStatus`: numeric

---

## 8. Cell Rendering

### 8.1 Status Cell

```
● In Progress
```
- 8px circle filled with `PROJECT_STATUS_COLORS[status]`
- Status display name next to it
- Hover cursor indicates editable (if permitted)

### 8.2 Title Cell

Plain text, `font-mohave text-body-sm`. Truncated with ellipsis if overflowing column width.

### 8.3 Client Cell

Plain text from `clientNameMap`. Falls back to "—" if no client linked.

### 8.4 Address Cell

Street address only — strip city/state/zip for density. Same `formatStreetAddress` helper used by canvas cards. Falls back to "—".

### 8.5 Date Cells

`font-mono text-data-sm`. Format: `MMM DD` (e.g., "Mar 15"). Full year shown only if not current year: `Mar 15 '25`. Null displays "—".

### 8.6 Progress Cell

Mini progress bar (same 2px bar as canvas cards) with text label:

```
████████░░░░ 5/8
```

- Bar width proportional to completion
- Bar color: status color of the project
- Track: `rgba(255,255,255,0.06)`
- Text: `font-mono text-data-sm text-text-secondary`
- No tasks: "—"

### 8.7 Financial Cells (Estimate Total, Invoice Total)

`font-mono text-data-sm`. Formatted currency: `$12,400`. Zero shows as "—". Permission-gated — column doesn't render if user lacks `accounting.view`.

### 8.8 Team Cell

Avatar stack (up to 3 circles + "+N" overflow), same pattern as canvas expanded card. If no team members computed from tasks, shows "—".

### 8.9 Duration Cell

`font-mono text-data-sm`. Shows `14d` format. Null shows "—".

### 8.10 Photos Cell

`font-mono text-data-sm`. Shows count: `3`. Zero shows "—".

### 8.11 Pipeline Cell

Shows "Linked" badge (small pill) if `opportunityId` is set, otherwise "—".

### 8.12 Days in Status Cell

`font-mono text-data-sm`. Computed from `updatedAt` to now: `12d`. Color-coded: > 30 days gets `text-alert`, > 60 days gets `text-negative`.

### 8.13 Notes / Description Cells

Truncated single-line with ellipsis. Full content visible in edit mode or in the detail popover.

### 8.14 Created Cell

Same format as date cells. Always read-only.

---

## 9. Footer

A simple status bar below the table:

```
Showing 47 of 52 projects
```

- `font-kosugi text-micro-sm text-text-disabled uppercase tracking-wider`
- "47" = filtered count, "52" = total non-deleted count
- If filters are active, show: `Showing 47 of 52 projects (filtered)`

No pagination — all projects render in a virtualized list. Typical project counts are low enough (< 500) that client-side rendering is fine. If performance becomes an issue, add `react-window` virtualization later.

---

## 10. Keyboard Navigation

### 10.1 Table-Level

- **Escape:** If editing a cell, cancel edit. If no cell is editing, clear row selection.
- **Arrow Down / Arrow Up:** Move selection to next/previous row (when not editing)
- **Enter:** On a selected row, open the `...` action menu

### 10.2 Edit-Level

- **Tab:** Commit current cell edit, move to next editable cell in the same row
- **Shift+Tab:** Commit and move to previous editable cell
- **Enter:** Commit edit (except textarea where Enter = newline)
- **Escape:** Cancel edit, restore original value

---

## 11. Detail Popover Integration

When "Open Details" is selected from the `...` menu, the existing `ProjectDetailPopover` opens at a fixed position (centered in the right half of the viewport), not tethered to a canvas card. The popover is the same component used in canvas mode — it receives the same `projects` map and `clientNames` map.

---

## 12. Archive Behavior in Spreadsheet Mode

- **"Archived" toggle ON:** Archived projects appear at the bottom of the table with `opacity-50` and a subtle "Archived" badge in the status cell
- **"Archived" toggle OFF:** Archived projects are filtered out (default)
- Archived rows are not editable — inline editing disabled for archived projects
- Right-click / `...` menu on archived rows shows: "Restore" (sets status to In Progress), "Delete Permanently"

---

## 13. Context Menu

Right-click on a row opens the same context menu as the `...` button (same items, same permissions). Right-click on empty table area does nothing.

Multi-select context menu: if multiple rows are selected and user right-clicks one of them, show bulk actions (Change Status, Archive, Delete).

---

## 14. Empty State

When no projects match filters:

```
No projects match your filters
[Clear Filters]
```

When no projects exist at all:

```
No projects yet
Create your first project to get started
```

Both use `font-mohave text-body-sm text-text-tertiary`, centered in the table body area.

---

## 15. Permission Matrix

| Action | Permission Required |
|--------|-------------------|
| View spreadsheet | `projects.view` |
| See all projects | `projects.view` scope "all" |
| See only assigned | `projects.view` scope "assigned" |
| Inline edit fields | `projects.edit` |
| Change status (inline or menu) | `projects.edit` |
| See financial columns | `accounting.view` |
| Add task (menu) | `tasks.create` |
| Record payment (menu) | `accounting.edit` |
| Archive (menu/bulk) | `projects.edit` |
| Delete (menu/bulk) | `projects.delete` |

---

## 16. Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `projects/page.tsx` | Modify | Add `viewMode` state, view toggle prop to toolbar, conditional render |
| `projects/_components/project-floating-toolbar.tsx` | Modify | Add view toggle buttons (canvas/spreadsheet icons) |
| `projects/_components/project-spreadsheet.tsx` | Create | Main spreadsheet component — table rendering, row selection, sort |
| `projects/_components/spreadsheet/spreadsheet-header.tsx` | Create | Sticky header row with sortable columns + column visibility toggle |
| `projects/_components/spreadsheet/spreadsheet-row.tsx` | Create | Single project row — cell rendering, selection, context menu trigger |
| `projects/_components/spreadsheet/spreadsheet-cell-editable.tsx` | Create | Generic editable cell wrapper — handles edit mode toggle, commit/cancel |
| `projects/_components/spreadsheet/spreadsheet-status-cell.tsx` | Create | Status dropdown cell |
| `projects/_components/spreadsheet/spreadsheet-date-cell.tsx` | Create | Date picker cell |
| `projects/_components/spreadsheet/spreadsheet-bulk-bar.tsx` | Create | Bulk action bar above table when rows selected |
| `projects/_components/spreadsheet/spreadsheet-columns.ts` | Create | Column definitions array (ColumnDef config for all 20 columns) |
| `src/lib/hooks/use-update-project.ts` | Create | New mutation hook for PATCH updates to project fields |
| `src/i18n/dictionaries/en/projects-canvas.json` | Modify | Add spreadsheet-specific strings |
| `src/i18n/dictionaries/es/projects-canvas.json` | Modify | Spanish translations |

---

## 17. Data Flow

```
page.tsx
  ├── useScopedProjects()        → allProjects
  ├── useClients()               → clientNameMap
  ├── useTeamMembers()           → teamMemberMap
  ├── useInvoices()              → projectValueMap (invoice totals)
  ├── useEstimates()             → estimateTotalMap (NEW — estimate totals)
  ├── useTasks()                 → projectTaskCountMap
  ├── useProjectMetrics()        → metrics header
  ├── filtering logic            → filteredProjects
  │
  ├── viewMode === "canvas"
  │     └── <Canvas> (existing — receives filteredProjects + all maps)
  │
  └── viewMode === "spreadsheet"
        └── <ProjectSpreadsheet
              projects={filteredProjects}
              archivedProjects={archivedProjects}
              clientNameMap={clientNameMap}
              teamMemberMap={teamMemberMap}
              projectValueMap={projectValueMap}        // invoice totals
              estimateTotalMap={estimateTotalMap}       // estimate totals
              projectTaskCountMap={projectTaskCountMap}
              canManage={canManage}
              canViewAccounting={canViewAccounting}
              canCreateTasks={canCreateTasks}
              canRecordPayment={canRecordPayment}
              canDelete={canDelete}
              showArchived={showArchived}
              onOpenDetail={handleOpenDetail}
              onStatusChange={executeDrag}
              onDeleteProject={handleDeletePermanently}
            />
```

**New data requirement:** `useEstimates()` — the canvas doesn't currently fetch estimates. The spreadsheet needs estimate totals per project. Either add a new `useEstimates()` hook or extend the existing data fetching. Group by `projectId`, sum `total` where status is approved.

---

## 18. i18n Keys

Add to `projects-canvas.json`:

```json
{
  "spreadsheet.columns.status": "Status",
  "spreadsheet.columns.title": "Title",
  "spreadsheet.columns.client": "Client",
  "spreadsheet.columns.address": "Address",
  "spreadsheet.columns.startDate": "Start",
  "spreadsheet.columns.endDate": "End",
  "spreadsheet.columns.progress": "Progress",
  "spreadsheet.columns.estimateTotal": "Est. Total",
  "spreadsheet.columns.invoiceTotal": "Inv. Total",
  "spreadsheet.columns.duration": "Duration",
  "spreadsheet.columns.team": "Team",
  "spreadsheet.columns.clientEmail": "Client Email",
  "spreadsheet.columns.clientPhone": "Client Phone",
  "spreadsheet.columns.photos": "Photos",
  "spreadsheet.columns.notes": "Notes",
  "spreadsheet.columns.description": "Description",
  "spreadsheet.columns.pipeline": "Pipeline",
  "spreadsheet.columns.daysInStatus": "Days in Status",
  "spreadsheet.columns.created": "Created",
  "spreadsheet.empty.filtered": "No projects match your filters",
  "spreadsheet.empty.none": "No projects yet",
  "spreadsheet.empty.noneDesc": "Create your first project to get started",
  "spreadsheet.empty.clearFilters": "Clear Filters",
  "spreadsheet.footer.showing": "Showing {count} of {total} projects",
  "spreadsheet.footer.filtered": "(filtered)",
  "spreadsheet.bulk.selected": "{count} selected",
  "spreadsheet.bulk.changeStatus": "Change Status",
  "spreadsheet.bulk.archive": "Archive",
  "spreadsheet.bulk.delete": "Delete",
  "spreadsheet.bulk.clear": "Clear",
  "spreadsheet.view.canvas": "Canvas",
  "spreadsheet.view.spreadsheet": "Spreadsheet"
}
```
