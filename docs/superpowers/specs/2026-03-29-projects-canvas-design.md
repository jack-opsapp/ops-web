# Projects Canvas — Design Spec

**Date:** 2026-03-29
**Scope:** Replace `/projects` (list) and `/job-board` (kanban) with a unified `/projects` route using a spatial canvas view identical to the pipeline tab.

---

## 1. Route & Navigation

- **Route:** `/projects` (replaces both `/projects` and `/job-board`)
- **Nav item label:** "Projects"
- **Old routes removed:** `/job-board` route deleted, `/projects` route rewritten
- **Permissions:** `projects.view` required (same as current)

## 2. View Modes

Two view modes, toggled via a control in the toolbar:

1. **Canvas** (this spec — build first)
2. **Spreadsheet** (future spec — Excel-style with configurable columns)

## 3. Canvas Architecture

Identical scaffolding to the pipeline spatial canvas. Reuse the same patterns, not the same files — projects and pipeline are separate domains with different data models.

### 3.1 Layout Engine

- **Active stage columns (left to right):** RFQ → Estimated → Accepted → In Progress → Completed
- **Terminal region (right side):** Closed
- **Archive tray:** Bottom drawer for Archived projects (same as pipeline archive tray)
- **Card dimensions:** 200px wide (same as pipeline for layout engine compatibility)
- **Card height:** ~60px collapsed (two lines + progress bar)
- **Vertical gap:** 10px between cards
- **Horizontal gap:** 80px between columns
- **Canvas padding:** 200px
- **Stage colors:** Use `PROJECT_STATUS_COLORS` from `src/lib/types/models.ts`

### 3.2 Viewport & Interaction

All behaviors match pipeline exactly:

- **Pan:** Middle-click drag, clamped to keep content visible
- **Zoom:** Wheel (trackpad or mouse) toward cursor, range 0.3x–1.5x, default 0.8x
- **Marquee select:** Left-drag on empty canvas, AABB intersection
- **Bird's-eye mode:** Zoom < 0.5 renders cards as 8px colored pills
- **Dot grid background:** 24px spacing, 0.7px dots at `rgba(255,255,255,0.06)`
- **Auto-fit:** `fitAll()` on first load at 90% zoom
- **Keyboard:** Escape clears selection/context menu/marquee

### 3.3 Zustand Store

Mirror `spatial-canvas-store.ts` structure for projects:

```
viewportX, viewportY, zoom, canvasWidth, canvasHeight
sortBy, stageSortOverrides
selectedCardIds, expandedCardIds, hoveredCardId
isDragging, dragCardIds, dragOrigin
isMarqueeActive, marqueeStart, marqueeEnd
contextMenu
customPositions (free-form Finder-style drop)
isArchiveTrayOpen
firstDragConfirmed (boolean — tracks if user has seen the drag confirmation dialog)
```

## 4. Card Design

### 4.1 Collapsed State (~60px)

```
┌─[status-color-border]──────────────────────────┐
│ Project Title (or Address fallback)    $12.4k   │
│ Client Name                                     │
│ ████████████░░░░░░░░ (task progress bar, 2px)   │
└─────────────────────────────────────────────────┘
```

**Primary label (line 1 left):** `project.title ?? formatStreetAddress(project.address) ?? "Untitled Project"`
- `formatStreetAddress` extracts street number + name only (no city/state)

**Value (line 1 right):** Formatted currency from project invoices total
- Only shown if user has accounting permissions (`can("accounting.view")`)
- When hidden, title fills full width

**Subtitle (line 2):** Client name (dimmed `text-text-tertiary`)
- Falls back to empty if no client linked

**Progress bar (bottom):** 2px bar showing `completedTasks / totalTasks`
- Uses status color for fill
- Empty (0%) if no tasks exist
- Track color: `rgba(255,255,255,0.06)`

**Left border:** 3px solid status color (from `PROJECT_STATUS_COLORS`)

**Surface:** `rgba(13,13,13,0.6)` + `backdrop-blur(20px) saturate(1.2)` + `1px solid rgba(255,255,255,0.08)`

**States:**
- Selected: `2px solid ${statusColor}` + glow
- Hovered: `1px solid ${statusColor}50`
- Expanded: Shows expanded content below (CSS grid height transition)
- Bird's-eye (zoom < 0.5): 8px pill with status color

### 4.2 Expanded State

Opens inline below collapsed card (same CSS grid transition as pipeline).

**Info rows:**
- Task summary: "3/8 tasks complete" or "No tasks"
- Team members: Avatar stack (up to 3 + "+N" overflow)
- Date range: start → end (or "No dates set")
- Days in status: "12d in Accepted"

**Quick actions:**
- **Open detail** — opens detail popover (pipeline pattern)
- **Add task** — permission-gated (`tasks.create`)
- **Record payment** — permission-gated (`accounting.edit`)
- **Archive** — moves to archived tray

### 4.3 Staleness

Dim cards that haven't had activity recently (same `calculateBatchStaleness` pattern as pipeline, adapted for project `lastSyncedAt` or task activity).

## 5. Stage Stack Headers

Each column header shows:
- **Status name** (e.g., "In Progress")
- **Card count** (e.g., "12")
- **Total value** (sum of project values in column — accounting permission only)

On hover, show additional metrics:
- Average days in status
- Oldest project in column

Bottom border animates left-to-right on hover (same as pipeline). Status color used for the header accent.

## 6. Drag & Drop

### 6.1 Status Change via Drag

Users can drag cards between status columns to manually override project status.

**First-time confirmation:**
- On the user's very first drag-to-new-column, show a confirmation dialog:
  > "Project statuses are usually updated automatically (e.g., when estimates are sent or tasks are completed). Are you sure you want to manually change this project's status?"
  > [Cancel] [Change Status]
  > ☐ Don't show this again
- Store `firstDragConfirmed` in the Zustand store (persisted to localStorage)
- After confirmation (or "Don't show again"), all subsequent drags are silent

**Optimistic updates:**
- Immediately move card to target column visually
- Fire `useUpdateProjectStatus` mutation
- Revert on error with toast

### 6.2 Free-form Positioning

Drop on empty canvas → save custom position (Finder-style). Custom positions take precedence over layout positions. Same pattern as pipeline.

### 6.3 Multi-select Drag

Shift/Meta click for multi-select. Drag all selected cards together. Batch count badge on drag overlay.

### 6.4 Archive Drop

Archive tray appears at bottom during drag. Drop on tray → set status to Archived.

## 7. Detail Popover

Follows the pipeline detail popover pattern exactly — tethered to the expanded card, with tabs.

**Tabs (adapted for projects):**
- **Overview** — project title, address, client info, status, dates, team, description, notes
- **Tasks** — task list grouped by status with progress
- **Financial** — estimates + invoices linked to project (permission-gated)
- **Photos** — project photos grid

**Actions in popover:**
- Edit project (opens edit form)
- Delete project (soft delete with confirmation)
- Get directions (opens maps link)
- Add task
- Record payment (permission-gated)

## 8. Metrics Header

Pipeline-style metrics header at top of page.

**Metrics:**
- Active projects count (RFQ + Estimated + Accepted + InProgress)
- Total value (sum of invoice totals for active projects — accounting permission required)
- Completed count
- Overdue count (projects past `endDate` that aren't Completed/Closed)

## 9. Toolbar

Below metrics header. Contains:
- **Search input** — filters across title, client name, address
- **Team member filter** — dropdown to filter by assigned team member
- **Client filter** — dropdown to filter by client
- **Sort control** — title, client, date, value (permission-gated), progress
- **View toggle** — canvas / spreadsheet (spreadsheet disabled until built)

## 10. Sorting

**Global sort options:**
- Title (alphabetical A→Z)
- Client (alphabetical A→Z)
- Date (start date, newest first)
- Value (highest first — only available with accounting permission)
- Progress (% tasks complete, highest first)

**Per-column sort overrides:** Same as pipeline — right-click column header to set column-specific sort.

## 11. Filtering

All filters apply across all columns simultaneously. Cards that don't match are hidden (not dimmed).

- **Search:** Case-insensitive substring match on title, client name, and address
- **Team member:** Show only projects where `teamMemberIds` includes the selected user
- **Client:** Show only projects linked to the selected client

## 12. Context Menu

Right-click on card(s) shows context menu with:
- Open detail
- Change status → (submenu with all statuses)
- Add task
- Record payment (permission-gated)
- Archive
- Delete (permission-gated, with confirmation)

Multi-select context menu shows batch actions.

## 13. Data Fetching

**Hooks:**
- `useScopedProjects()` — existing hook, permission-aware project list
- `useClients()` — client name lookup
- `useTeamMembers()` — team member avatars
- `useProjectMetrics()` — metrics header data (adapt for new metrics)
- `useInvoices()` — project value calculation
- `useUpdateProjectStatus()` — drag-to-status mutation
- `useDeleteProject()` — soft delete

**Value calculation:**
- Group invoices by `projectId`
- Sum invoice totals per project
- Same pattern as existing job board `projectValueMap`

## 14. Route Cleanup

- Delete `/src/app/(dashboard)/job-board/` directory entirely
- Rewrite `/src/app/(dashboard)/projects/page.tsx` with canvas implementation
- Keep `/src/app/(dashboard)/projects/[id]/page.tsx` (detail page) — detail popover links to it for "full details"
- Keep `/src/app/(dashboard)/projects/new/page.tsx` (create form)
- Update sidebar navigation to remove "Job Board" entry and keep "Projects"

## 15. Permission Matrix

| Action | Permission Required |
|--------|-------------------|
| View canvas | `projects.view` |
| See all projects | `projects.view` scope "all" |
| See only assigned | `projects.view` scope "assigned" |
| Drag to change status | `projects.edit` |
| Add task from expanded card | `tasks.create` |
| Record payment | `accounting.edit` |
| See project value | `accounting.view` |
| Archive project | `projects.edit` |
| Delete project | `projects.delete` |
| Edit project (in popover) | `projects.edit` |

## 16. Files to Create

| File | Purpose |
|------|---------|
| `src/app/(dashboard)/projects/_components/project-canvas.tsx` | Viewport container (pan/zoom/marquee/grid) |
| `src/app/(dashboard)/projects/_components/project-canvas-store.ts` | Zustand store for canvas state |
| `src/app/(dashboard)/projects/_components/project-layout-engine.ts` | Layout calculator (columns + terminal) |
| `src/app/(dashboard)/projects/_components/project-card.tsx` | Card rendering (collapsed + bird's-eye) |
| `src/app/(dashboard)/projects/_components/project-card-expanded.tsx` | Expanded card info + actions |
| `src/app/(dashboard)/projects/_components/project-stage-stack.tsx` | Column rendering + droppable |
| `src/app/(dashboard)/projects/_components/project-terminal-region.tsx` | Closed region (grid layout) |
| `src/app/(dashboard)/projects/_components/project-drag-overlay.tsx` | Ghost card during drag |
| `src/app/(dashboard)/projects/_components/project-marquee-select.tsx` | Selection rectangle |
| `src/app/(dashboard)/projects/_components/project-context-menu.tsx` | Right-click menu |
| `src/app/(dashboard)/projects/_components/project-floating-toolbar.tsx` | Toolbar (search/filter/sort) |
| `src/app/(dashboard)/projects/_components/project-archive-tray.tsx` | Bottom drawer for archived |
| `src/app/(dashboard)/projects/_components/project-detail-popover.tsx` | Detail popover (tabbed) |
| `src/app/(dashboard)/projects/_components/project-detail-popover-store.ts` | Popover state |
| `src/app/(dashboard)/projects/_components/project-drag-confirmation.tsx` | First-time drag dialog |
| `src/app/(dashboard)/projects/_components/project-staleness.ts` | Staleness opacity calculator |

## 17. i18n

All user-facing strings go in `src/i18n/dictionaries/en/projects.json` (and `es/projects.json`). No hardcoded strings.
