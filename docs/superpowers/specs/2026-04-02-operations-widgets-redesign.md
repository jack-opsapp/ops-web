# Operations Widgets Redesign — Design Spec

**Date**: 2026-04-02  
**Scope**: 5 widget files in `src/components/dashboard/widgets/`  
**Constraint**: Do NOT modify `dashboard/page.tsx`, `widget-tokens.ts`, or `shared/` files.

---

## 1. Task Pulse (`task-pulse-widget.tsx`)

### XS — No changes
Current implementation is correct.

### SM — Tooltip positioning fix
The `WidgetTooltip` `anchorRef` must point to the bar container `<div>` specifically. Ensure the ref is attached to the segmented bar wrapper, not the card root. No structural changes.

### MD — Hero collapse + overdue list with blocking intelligence

**Default view (collapsed list)**:
- Header: title + total count badge
- Segmented bar (existing) + segment legend
- Below legend: max 3 overdue tasks rendered as `WidgetLineItem`:
  - `indicator`: `{ type: "bar", color: taskColor }` (task type color)
  - `primary`: task title (`customTitle || taskType.display`)
  - `secondary`: `"{clientName} · {projectName}"` (from `task.project?.client?.name` and `task.project?.title`)
  - `metric`: `"Xd overdue"` + project value if available (e.g., `"3d · $12.5K"`)
  - `onClick`: `onNavigate(/projects/:projectId)`
- `WidgetMoreButton`: `"+N more overdue"` — toggles expanded state

**Expanded view (hero collapsed)**:
- `WidgetHeroCollapse collapsed={expanded}` wraps the segmented bar + legend
- Full scrollable list of ALL overdue tasks via `ScrollFade`
- Same `WidgetLineItem` structure as above

**Blocking intelligence**:
Tasks where the project has overdue tasks AND no future tasks scheduled (no task with `startDate > today`) get a `WT.error` indicator bar color regardless of task type color. These are blocking getting paid — the project is stalled.

**Project value derivation**:
- New optional prop: `estimates?: Estimate[]`
- Widget computes `projectValueMap: Map<string, number>` internally:
  ```
  for each estimate where status === 'approved' && !deletedAt:
    projectValueMap[estimate.projectId] += estimate.total
  ```
- If `estimates` prop not passed → value column omitted gracefully (show only days overdue)
- Formatted via `formatCompactCurrency` from shared utils

### Props changes
```typescript
interface TaskPulseWidgetProps {
  size: WidgetSize;
  tasks: ProjectTask[];
  estimates?: Estimate[];  // NEW — optional, for project value display
  isLoading: boolean;
  onNavigate: (path: string) => void;
}
```

---

## 2. Task List (`task-list-widget.tsx`)

### Intent change
Reoriented from "next 7 days" to "my tasks today." Shows tasks assigned to the current user for today.

### Permission toggle
- Check `usePermissionStore.can('tasks.view', 'all')` 
- If true: show segmented control with options `[{ value: "all", label: "ALL" }, { value: "mine", label: "MINE" }]`
- Styled identically to `WidgetPeriodPicker` inline pill group
- Default: "MINE"
- Current user ID from `useAuthStore.getState().user?.id`
- When "MINE": filter tasks to `task.teamMemberIds.includes(currentUserId)`
- When "ALL": show all tasks

### SM
- Hero count of tasks scheduled for today
- Title: "Task List"
- Next task name (first task today)

### MD
- Today's tasks in scrollable list
- Completed tasks: stay in list with `line-through` on title + `opacity-40` on entire row
- Below main list: overdue section header ("OVERDUE") + overdue tasks with `WT.error` bar indicator on `WidgetLineItem`
- Each task rendered as `WidgetLineItem`:
  - `indicator`: `{ type: "bar", color: taskColor }`
  - `primary`: task title
  - `secondary`: project name · client name
  - `metric`: time display
  - `action`: checkbox (existing complete behavior)

### LG
- Hero section at top with three metric boxes inside `WidgetHeroCollapse`:
  - **Unscheduled**: count of active tasks with no `startDate`
  - **Today**: count of tasks scheduled today
  - **Overdue**: count of overdue tasks (styled with `WT.error`)
- Each metric box: count + label, arranged horizontally
- `WidgetHeroCollapse collapsed={isScrolled}` — collapses when user scrolls list
- Below: same list structure as MD (completed + overdue sections)

### Props changes
None — uses `usePermissionStore` and `useAuthStore` hooks internally.

---

## 3. Backlog Depth (`backlog-depth-widget.tsx`)

### XS / SM — No structural changes
Keep existing weeks-based hero + gauge. These are good high-level signals.

### MD — Three-metric breakdown

Replace the abstract gauge with three concrete, actionable metrics:

| Metric | Key | Definition | Color Thresholds |
|--------|-----|-----------|-----------------|
| **Signed, Not Started** | `signedNotStarted` | Projects with `status === Accepted` AND zero tasks with `status === InProgress \|\| Completed` | 0 = `WT.success`, 1-3 = `WT.warning`, 4+ = `WT.error` |
| **Unscheduled Tasks** | `unscheduledTasks` | Active tasks (not completed/cancelled/deleted) with `startDate === null` | 0-2 = `WT.success`, 3-5 = `WT.warning`, 6+ = `WT.error` |
| **Pending Estimates** | `pendingEstimates` | Estimates with `status === 'sent' \|\| status === 'viewed'` AND `!deletedAt` | 0-1 = `WT.success`, 2-3 = `WT.warning`, 4+ = `WT.error` |

**Layout (MD)**:
- Header: "Backlog" + project count
- Hero: weeks number + status label (existing)
- Three metric rows below, each:
  - Left: metric label (font-kosugi text-micro-sm uppercase)
  - Center: proportion bar (width = count / max, color by threshold)
  - Right: count (font-mono)
- Staggered entrance via `widgetLineItemStyle`

**Graceful degradation**:
- If `tasks` not passed → "Unscheduled Tasks" row hidden
- If `estimates` not passed → "Pending Estimates" row hidden
- If both missing → only "Signed, Not Started" shown (derived from `projects` alone)
- Companies with no estimates → "Pending Estimates" shows 0 with `WT.success` color

### Props changes
```typescript
interface BacklogDepthWidgetProps {
  size: WidgetSize;
  projects: Project[];
  tasks?: ProjectTask[];     // NEW — optional, for unscheduled count
  estimates?: Estimate[];    // NEW — optional, for pending estimate count
  isLoading: boolean;
  onNavigate: (path: string) => void;
}
```

---

## 4. Crew Board (`crew-board-widget.tsx`)

### XS / SM — No structural changes
Keep existing utilization % hero. Good high-level signal.

### MD — Per-member rows with today context

Replace abstract utilization bars with concrete per-member rows:

Each member rendered as `WidgetLineItem`:
- `indicator`: `{ type: "avatar", initials: "JS" }`
- `primary`: Full name
- `secondary`: Current task title if in-progress, or "Available" (text-status-success)
- `metric`: `"X tasks"` count for today
- Below name row: compact utilization bar (6px, same as current)

Sort: members with in-progress tasks first, then by task count descending, then idle.

Availability status:
- 0 tasks today → "Available" (success color)
- 1-4 tasks → shows current task name (neutral)
- 5+ tasks → "Overloaded" (error color)

### LG — Full rows with tasks + quick-assign

Each crew member as a section:
- Row 1: Avatar + name + utilization bar + task count + `WidgetInlineAction` (multi-action):
  - "Assign Task" → `onNavigate('/calendar')`
  - "View Schedule" → `onNavigate('/calendar')`
- Row 2+: Each assigned task for today as a sub-`WidgetLineItem`:
  - `indicator`: `{ type: "bar", color: taskColor }`
  - `primary`: task title
  - `secondary`: project name
  - `metric`: time

Show max 8 members, `WidgetMoreButton` for rest.

### Props changes
None — existing props sufficient.

---

## 5. Action Required (`action-required-widget.tsx`)

### All sizes — Remove footer
Remove the "VIEW ALL" footer button from every size variant.

### XS — Popover button
- Replace click-anywhere card with explicit button
- Button: hero count number rendered as a clickable element
- Click opens `Popover` with a list of up to 5 action items
- Each item: icon + description + age, clickable → `onNavigate`

### SM — Clickable category dots
- Remove `ArrowUpRight` nav button from top right
- Each category dot becomes a `Popover` trigger:
  - Click dot → dropdown showing items of that category type
  - Each item: description + age + amount, clickable → `onNavigate`
- Dot + count wrapped in a `<PopoverTrigger>`

### MD — Why-text + inline action buttons

Each item rendered as `WidgetLineItem`:
- `indicator`: `{ type: "icon", icon: TypeIcon, color: typeColor }`
- `primary`: item description
- `secondary`: WHY text explaining the reason:
  - Overdue task: `"Unscheduled, Xd overdue"` or `"Past start date, Xd overdue"`
  - Past due invoice: `"Unpaid, Xd past due"` or `"Partially paid, Xd past due"`
  - Expiring estimate: `"No response, expires in Xd"` or `"Viewed but unsigned, expires in Xd"`
  - Stale follow-up: `"Last contact Xw ago"` or `"No contact recorded"`
- `metric`: amount if applicable (`formatCompactCurrency`)
- `action`: `WidgetInlineAction` with multi-action popover:
  - Overdue task: `[{ "Open Scheduler", CalendarDays }, { "Mark Complete", Check }]`
  - Past due invoice: `[{ "Send Reminder", Mail }, { "View Invoice", FileText }]`
  - Expiring estimate: `[{ "Follow Up", Phone }, { "View Estimate", FileSpreadsheet }]`
  - Stale follow-up: `[{ "Follow Up", Phone }, { "View Lead", ArrowUpRight }]`

### LG — Hero counts + full list

- Hero section at top inside `WidgetHeroCollapse`:
  - 4 metric boxes (one per category): icon + count + label
  - Arranged in a 2x2 or 1x4 grid
  - Color-coded by category type color
- Below: full scrollable list of ALL items (same structure as MD)
- `WidgetHeroCollapse collapsed={isScrolled}` — collapses when user scrolls

### Props changes
None — existing props sufficient.

---

## i18n Keys

All new strings added to `src/i18n/dictionaries/en/dashboard.json` under clearly labeled sections:

### Task Pulse additions
- `taskPulse.moreOverdue`: "more overdue"
- `taskPulse.blocking`: "Blocking"
- `taskPulse.daysOverdue`: "d overdue"

### Task List additions
- `taskList.all`: "All"
- `taskList.mine`: "Mine"
- `taskList.overdue`: "Overdue"
- `taskList.unscheduled`: "Unscheduled"
- `taskList.todayCount`: "Today"
- `taskList.overdueCount`: "Overdue"
- `taskList.completed`: "completed"
- `taskList.available`: "Available"

### Backlog Depth additions
- `backlogDepth.signedNotStarted`: "Signed, Not Started"
- `backlogDepth.unscheduledTasks`: "Unscheduled Tasks"
- `backlogDepth.pendingEstimates`: "Pending Estimates"

### Crew Board additions
- `crewBoard.available`: "Available"
- `crewBoard.overloaded`: "Overloaded"
- `crewBoard.assignTask`: "Assign Task"
- `crewBoard.viewSchedule`: "View Schedule"
- `crewBoard.tasksToday`: "tasks today"
- `crewBoard.currentTask`: "Current"

### Action Required additions
- `actionRequired.openScheduler`: "Open Scheduler"
- `actionRequired.markComplete`: "Mark Complete"
- `actionRequired.sendReminder`: "Send Reminder"
- `actionRequired.viewInvoice`: "View Invoice"
- `actionRequired.followUp`: "Follow Up"
- `actionRequired.viewEstimate`: "View Estimate"
- `actionRequired.viewLead`: "View Lead"
- `actionRequired.unscheduled`: "Unscheduled"
- `actionRequired.pastStartDate`: "Past start date"
- `actionRequired.unpaid`: "Unpaid"
- `actionRequired.partiallyPaid`: "Partially paid"
- `actionRequired.noResponse`: "No response"
- `actionRequired.viewedUnsigned`: "Viewed but unsigned"
- `actionRequired.lastContact`: "Last contact"
- `actionRequired.noContact`: "No contact recorded"
- `actionRequired.pastDue`: "past due"
- `actionRequired.expiresIn`: "expires in"

---

## Animation Rules

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` only — via `WIDGET_EASE_CSS`
- No spring animations
- All animations respect `useReducedMotion()`
- List items use `widgetLineItemStyle` for staggered entrance
- Hero collapse uses `WidgetHeroCollapse` (300ms, same easing)
- Inline popovers use Radix Popover (no custom animation needed)

## Shared Components Used

| Component | Used In |
|-----------|---------|
| `WidgetLineItem` | All 5 widgets (MD/LG) |
| `WidgetMoreButton` | Task Pulse, Crew Board |
| `WidgetHeroCollapse` | Task Pulse MD, Task List LG, Action Required LG |
| `WidgetEmptyState` | All 5 widgets |
| `WidgetInlineAction` | Action Required MD, Crew Board LG |
| `WidgetPeriodPicker` (style) | Task List (permission toggle) |
| `WidgetTooltip` | Task Pulse SM |
| `widgetLineItemStyle` | All list animations |
| `formatCompactCurrency` | Task Pulse, Action Required |
| `ScrollFade` | All scrollable lists |
