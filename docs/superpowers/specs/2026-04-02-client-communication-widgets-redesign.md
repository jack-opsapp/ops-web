# Client & Communication Widgets Redesign

**Date:** 2026-04-02
**Scope:** 5 widget files + i18n dictionary. No changes to shared/, widget-tokens.ts, or dashboard/page.tsx.
**Shared library:** WidgetLineItem, WidgetMoreButton, WidgetHeroCollapse, WidgetEmptyState, WidgetInlineAction, WidgetStatusBadge, WidgetBackgroundChart, WidgetActionToast, WidgetPeriodPicker, widgetLineItemStyle, formatCompactCurrency.

---

## 1. Top Clients Widget (`top-clients-widget.tsx`)

### Data Layer
No new hooks. Same `rankedClients` useMemo (clients + invoices + projects). Replace local `formatCurrency` with `formatCompactCurrency` from `widget-utils.ts`.

### SM
Keep current layout (hero count + title + nav icon). Add revenue to the #1 client line:
```
  5                    [↗]
  TOP CLIENTS
  #1: Acme Roofing · $42.5K
```
The `· $42.5K` uses `formatCompactCurrency(topClient.revenue)`.

### MD (5 items) & LG (15 items)
Replace custom row markup with `WidgetLineItem`:
- `indicator`: `{ type: "bar", color: WT.accent }`
- `primary`: client name
- `secondary` (LG only, gated by `showActions(size)`): `"{projectCount} projects · Last active {days}d ago"`
- `metric`: `formatCompactCurrency(revenue)`

Retain proportional background bar behind each row. Wrap WidgetLineItem in a `relative` container, render the bar as an absolutely-positioned div at the bottom. Keep `barPct` calculation. Animate bar width with `WIDGET_EASE_CSS` (replace hardcoded cubic-bezier).

Staggered entrance uses `widgetLineItemStyle(index, isVisible, reducedMotion)` on the wrapper div.

Remove the standalone activity dot (md only) — recency info is in the LG secondary line, and the bar is the primary ranking signal.

Keep rank number prefix (mono, micro, tertiary) outside the WidgetLineItem, in the wrapper.

### Footer
Keep existing "View Clients" footer link gated by `showFooter(size)`.

### Animation
- Row entrance: `widgetLineItemStyle` (translateY + opacity stagger)
- Bar width: `WIDGET_EASE_CSS`, duration 500ms, stagger delay `index * 50 + 100ms`
- Reduced motion: opacity-only transitions via `widgetLineItemStyle` fallback

---

## 2. Client List Widget (`client-list-widget.tsx`)

### Data Layer
Add `useInvoices()` to compute per-client revenue for the "Revenue" sort option. Build `revenueMap: Record<string, number>` in useMemo — sum `amountPaid` for Paid invoices per clientId.

Add `useTeamMembers()` — not needed for display, but will be used for author context if we add activity-based "recent" sorting. Actually, for "recent" sort, compute `lastActivityAt` per client from the most recent invoice/project/estimate `updatedAt`. Build `lastActivityMap: Record<string, Date>` in useMemo.

### SM
No changes. Hero count + "Latest: {name}" is sufficient.

### MD & LG — Header
```
┌──────────────────────────────────────────────┐
│ CLIENTS  [Recent ▾] [Name] [Revenue]    [+]  │
└──────────────────────────────────────────────┘
```

**Sort controls:** Use `WidgetPeriodPicker` with options:
- `{ value: "recent", label: t("clientList.sortRecent") }` — sort by `lastActivityMap[clientId]` descending
- `{ value: "name", label: t("clientList.sortName") }` — alphabetical
- `{ value: "revenue", label: t("clientList.sortRevenue") }` — by `revenueMap[clientId]` descending

Default sort: `"recent"`.

**+ button:** `Plus` icon from lucide-react. `20x20` touch target, same styling as other widget header buttons. onClick: `onNavigate("/clients/new")`. Requires adding `onNavigate: (path: string) => void` to `ClientListWidgetProps`.

### MD & LG — Search Box
Below header, above list:
```html
<input
  type="text"
  placeholder={t("clientList.search")}
  className="w-full bg-background-input border border-border-input font-mohave text-caption-sm
             placeholder:text-text-placeholder rounded-sm px-2 py-1 outline-none
             focus:border-ops-accent/50 transition-colors"
/>
```
Local state `searchQuery`. Filter: `client.name.toLowerCase().includes(searchQuery.toLowerCase())`. No debounce (local array filter).

### MD & LG — Client Rows
Replace `ClientRow` component with `WidgetLineItem`:
- `indicator`: `{ type: "avatar", initials: client.name[0].toUpperCase(), color: WT.accent }`
- `primary`: client name
- `secondary`: `client.email ?? client.phoneNumber ?? null`
- `metric`: existing project count badge (render as ReactNode, keep current badge styling)
- `action`: `WidgetInlineAction` multi-mode:
  - `icon`: `Plus` from lucide
  - `actions`: [
    - `{ icon: FolderPlus, label: t("clientList.createProject"), onAction: () => onNavigate("/projects/new?clientId=" + client.id) }`
    - `{ icon: Receipt, label: t("clientList.createInvoice"), onAction: () => onNavigate("/invoices/new?clientId=" + client.id) }`
    - `{ icon: FileText, label: t("clientList.createEstimate"), onAction: () => onNavigate("/estimates/new?clientId=" + client.id) }`
    - `{ icon: ClipboardList, label: t("clientList.createTask"), onAction: () => onNavigate("/tasks/new?clientId=" + client.id) }`
  ]
- `onClick`: `() => onNavigate("/clients/" + client.id)`
- Entrance animation: `index`, `isVisible`, `reducedMotion` props

Remove `maxItems` cap — use `ScrollFade` with `overflow-y-auto scrollbar-hide` for full list. Keep `WidgetMoreButton` only if list exceeds 50 items (performance guard).

### LG Only — Metrics Header
`WidgetHeroCollapse` at top of content area (below header, above search):
```
  24 total    8 active this month    3 new this month
```
Three inline metrics, each: `font-mono text-data-lg font-bold text-text-primary` for the number, `font-kosugi text-micro text-text-tertiary uppercase` for the label below.

Computations:
- **Total:** `clients.length`
- **Active this month:** clients with any invoice, project, or estimate `updatedAt` in current calendar month
- **New this month:** clients where `createdAt` is in current calendar month

Collapse trigger: track `scrollTop` on the ScrollFade container's inner div via `onScroll`. Set `collapsed={scrollTop > 20}`.

### Props Changes
Add `onNavigate: (path: string) => void` to `ClientListWidgetProps`.

---

## 3. Client Attention Widget (`client-attention-widget.tsx`) — Complete Redesign

### Data Layer
Expand from 3 hooks to 6:
```typescript
const { data: clientsData } = useClients();
const { data: invoices } = useInvoices();
const { data: estimates } = useEstimates();
const { data: tasksData } = useTasks();
const { data: opportunities } = useOpportunities();
const { data: projectsData } = useProjects();
```

### AttentionReason Type
```typescript
type AttentionReason =
  | "unassigned-tasks"
  | "unscheduled-tasks"
  | "stale-quoting"
  | "estimate-no-response"
  | "past-due-invoice"
  | "estimate-expiring";
```

### AttentionItem Interface
```typescript
interface AttentionItem {
  clientId: string;
  clientName: string;
  reason: AttentionReason;
  /** Human-readable detail, e.g. "2 unassigned tasks" or "Invoice #1042 past due" */
  detail: string;
  /** Entity ID for the inline action navigation */
  entityId: string;
  /** Secondary entity ID if needed (e.g., opportunityId for stale-quoting) */
  secondaryEntityId?: string;
}
```

Note: Each reason produces its own `AttentionItem`. A client with 2 reasons gets 2 items (not 1 item with an array of reasons). This makes the list scannable — each row = one actionable thing.

### Detection Logic (single useMemo)

Build intermediate lookups first:
- `clientNameMap: Record<string, string>` from clients
- `projectClientMap: Record<string, string>` — projectId → clientId from projects
- `opportunityEstimateMap: Record<string, boolean>` — opportunityId → has any estimate with `sentAt` set

Then detect:

1. **Unassigned tasks:** Active tasks (`status !== Completed && !== Cancelled && !deletedAt`) where `teamMemberIds.length === 0`. Group by client (via `projectClientMap[task.projectId]`). Produce one item per client: detail = `"{count} unassigned tasks"`, entityId = first task's projectId (navigate to project to assign).

2. **Unscheduled tasks:** Active tasks where `startDate === null`. Same grouping. Detail = `"{count} unscheduled tasks"`, entityId = first task's projectId.

3. **Stale quoting:** Opportunities where `stage === OpportunityStage.Quoting` and `(now - stageEnteredAt) > 2 days` and `clientId !== null` and no estimate exists with `sentAt` for that opportunityId. Detail = `"In Quoting {days}d — no estimate sent"`, entityId = opportunityId.

4. **Estimate no response:** Estimates where `(status === "sent" || status === "viewed")` and `sentAt` exists and `(now - sentAt) > 3 days`. Skip estimates that are approved/declined/converted/expired/superseded. Detail = `"Estimate {estimateNumber} — {status} {days}d, no response"`, entityId = estimateId, secondaryEntityId = opportunityId.

5. **Past-due invoice:** Invoices where `status === InvoiceStatus.PastDue && !deletedAt`. Detail = `"Invoice past due"`, entityId = invoiceId. Group by client, one item per client.

6. **Expiring estimate:** Estimates where status is active (not approved/declined/converted/expired/superseded), `expirationDate` within 7 days. Detail = `"Estimate expires in {days}d"`, entityId = estimateId.

### Priority Sort
```typescript
const REASON_PRIORITY: Record<AttentionReason, number> = {
  "past-due-invoice": 0,
  "unassigned-tasks": 1,
  "unscheduled-tasks": 2,
  "stale-quoting": 3,
  "estimate-no-response": 4,
  "estimate-expiring": 5,
};
```
Sort by priority, then alphabetically by clientName within same priority.

### Reason Colors
```typescript
const REASON_COLORS: Record<AttentionReason, string> = {
  "past-due-invoice": WT.error,
  "unassigned-tasks": WT.warning,
  "unscheduled-tasks": WT.warning,
  "stale-quoting": WT.accent,
  "estimate-no-response": WT.accent,
  "estimate-expiring": WT.warning,
};
```

### Inline Actions

| Reason | Icon | Label | Action |
|--------|------|-------|--------|
| unassigned-tasks | `Users` | t("clientAttention.assignCrew") | `onNavigate("/projects/{entityId}")` |
| unscheduled-tasks | `CalendarDays` | t("clientAttention.schedule") | `onNavigate("/projects/{entityId}")` |
| stale-quoting | `FileText` | t("clientAttention.createEstimate") | `onNavigate("/estimates/new?opportunityId={entityId}")` |
| estimate-no-response | `Send` | t("clientAttention.sendFollowUp") | Queue via `useWidgetActionQueue.queueAction(...)` with 5-min delay. The `executeFn` creates a follow-up activity. The toast shows "Follow-up queued — sending in 5m" with Undo. |
| past-due-invoice | `ExternalLink` | t("clientAttention.viewInvoice") | `onNavigate("/invoices/{entityId}")` |
| estimate-expiring | `ExternalLink` | t("clientAttention.viewEstimate") | `onNavigate("/estimates/{entityId}")` |

All inline actions use `WidgetInlineAction` single-mode.

### SM Layout
```
┌─────────────────────────┐
│  3          [ring chart] │
│  NEEDS ATTENTION         │
│  ● 1 overdue ● 2 tasks  │
└─────────────────────────┘
```

Use `WidgetBackgroundChart` with an SVG ring/donut chart as the ambient background. The ring shows segments colored by `REASON_COLORS`, sized proportionally to count per reason category. Group into max 4 segments:
- Red: past-due-invoice count
- Amber: unassigned + unscheduled + expiring count
- Accent: stale-quoting + estimate-no-response count
- (Skip segments with 0 count)

The ring is rendered as a simple SVG with `stroke-dasharray` segments. No animation library needed — use CSS transition on `stroke-dashoffset` with `WIDGET_EASE_CSS`.

Hero number: `font-mono text-data-lg font-bold`, colored red if > 0, green if 0.
Bottom line: condensed legend `"● {n} overdue · ● {n} tasks"` using colored dots.

### MD Layout
Header: title + count badge (red if > 0).
List: `WidgetLineItem` rows:
- `indicator`: `{ type: "dot", color: REASON_COLORS[reason] }`
- `primary`: clientName
- `secondary`: detail string
- `action`: `WidgetInlineAction` per reason table above

Max 5 items + `WidgetMoreButton`. Empty state: `WidgetEmptyState` with `CheckCircle` icon, message = `t("clientAttention.allGood")`.

### LG Layout
Same as MD but:
- No item cap — full scrollable list via `ScrollFade`
- `WidgetHeroCollapse` at top:
  ```
    5 need attention
    ● 2 overdue  ● 2 unassigned  ● 1 stale quote
  ```
  Hero number + categorized breakdown with colored dots.
  Collapse on scroll (`scrollTop > 20`).

### Props Changes
Add `onNavigate: (path: string) => void` to `ClientAttentionWidgetProps`.

---

## 4. Activity Feed Widget (`activity-feed-widget.tsx`)

### Data Layer
Keep existing `useRecentActivities` hook. Add `useTeamMembers()` to build author name lookup:
```typescript
const { data: teamData } = useTeamMembers();
const authorMap = useMemo(() => {
  const map: Record<string, string> = {};
  if (!teamData?.users) return map;
  for (const u of teamData.users) {
    map[u.id] = `${u.firstName} ${u.lastName}`.trim() || u.email || "Unknown";
  }
  return map;
}, [teamData]);
```

### Activity Type Icons
```typescript
const ACTIVITY_TYPE_ICONS: Record<ActivityType, LucideIcon> = {
  note: StickyNote,
  email: Mail,
  call: Phone,
  text_message: MessageSquare,
  meeting: Video,
  estimate_sent: Send,
  estimate_accepted: CheckCircle,
  estimate_declined: XCircle,
  invoice_sent: Receipt,
  payment_received: DollarSign,
  stage_change: ArrowRightLeft,
  created: PlusCircle,
  won: Trophy,
  lost: XOctagon,
  system: Settings,
  site_visit_scheduled: MapPin,
  site_visit: MapPin,
};
```

### Row Redesign (MD+)
Replace custom rows with `WidgetLineItem`:
- `indicator`: `{ type: "icon", icon: ACTIVITY_TYPE_ICONS[activity.type], color: activityColor(activity.type) }`
- `primary`: `activity.subject || activityTypeLabel(activity.type, t)`
- `secondary`: Build from author + content preview:
  ```typescript
  const author = activity.createdBy ? authorMap[activity.createdBy] : null;
  const preview = activity.content ? activity.content.slice(0, 40) + (activity.content.length > 40 ? "..." : "") : null;
  const secondary = [author, preview].filter(Boolean).join(" · ");
  ```
- `metric`: `timeAgo(activity.createdAt, t)`
- `onClick`: deep link using priority chain:
  ```typescript
  function getActivityPath(activity: Activity): string | null {
    if (activity.projectId) return `/projects/${activity.projectId}`;
    if (activity.opportunityId) return `/pipeline/${activity.opportunityId}`;
    if (activity.invoiceId) return `/invoices/${activity.invoiceId}`;
    if (activity.estimateId) return `/estimates/${activity.estimateId}`;
    if (activity.siteVisitId) return `/site-visits/${activity.siteVisitId}`;
    return null;
  }
  ```
- Entrance animation: `index`, `isVisible`, `reducedMotion`

### LG — Metrics Header
`WidgetHeroCollapse` at top:
```
  12 today    3 users    Roof Repair (most active)
```

Computations:
- **Today count:** activities where `createdAt` is today (midnight boundary)
- **Active users:** unique `createdBy` values from today's activities
- **Most active project:** projectId with highest activity count, resolve to project name via a `useProjects()` lookup (add hook). If no project activities, show most active opportunity title instead.

Collapse on scroll, same pattern.

### SM/XS
No changes to compact layout.

### Props Changes
No changes needed — `onNavigate` already exists on `ActivityWidgetProps`.

---

## 5. Notifications Widget (`notifications-widget.tsx`)

### Row Migration
Replace custom notification rows with `WidgetLineItem`:
- `indicator`: `{ type: "dot", color: getTypeColor(notification.type) }`
- `primary`: `notification.title`
- `secondary`: `notification.body` (WidgetLineItem already truncates)
- `metric`: `formatTimeAgo(notification.createdAt)`
- `action`: Dismiss button for non-persistent notifications:
  ```tsx
  action={!notification.persistent ? (
    <button
      onClick={(e) => { e.stopPropagation(); dismissMutation.mutate(notification.id); }}
      className="w-[20px] h-[20px] flex items-center justify-center rounded-sm
                 hover:bg-[rgba(255,255,255,0.08)] transition-colors
                 text-text-disabled hover:text-text-secondary"
    >
      <X className="w-3 h-3" />
    </button>
  ) : undefined}
  ```
- `onClick`: Deep link via `actionUrl`:
  ```typescript
  onClick={notification.actionUrl ? () => onNavigate(notification.actionUrl!) : undefined}
  ```

### Props Changes
Add `onNavigate: (path: string) => void` to `NotificationsWidgetProps`.

### No Other Changes
Sort logic, compact view, empty state, loading states remain unchanged.

---

## i18n Keys (Added to `en/dashboard.json`)

### Top Clients
```json
"topClients.revenue": "revenue"
```

### Client List
```json
"clientList.search": "Search clients...",
"clientList.sortRecent": "Recent",
"clientList.sortName": "Name",
"clientList.sortRevenue": "Revenue",
"clientList.activeMonth": "active this month",
"clientList.newMonth": "new this month",
"clientList.newClient": "New Client",
"clientList.createProject": "Create Project",
"clientList.createInvoice": "Create Invoice",
"clientList.createEstimate": "Create Estimate",
"clientList.createTask": "Create Task"
```

### Client Attention
```json
"clientAttention.unassignedTasks": "unassigned tasks",
"clientAttention.unscheduledTasks": "unscheduled tasks",
"clientAttention.staleQuoting": "In Quoting — no estimate sent",
"clientAttention.estimateNoResponse": "no response",
"clientAttention.assignCrew": "Assign crew",
"clientAttention.schedule": "Schedule",
"clientAttention.createEstimate": "Create estimate",
"clientAttention.sendFollowUp": "Send follow-up",
"clientAttention.viewInvoice": "View invoice",
"clientAttention.viewEstimate": "View estimate",
"clientAttention.followUpQueued": "Follow-up queued — sending in 5m",
"clientAttention.needAttention": "need attention",
"clientAttention.overdue": "overdue",
"clientAttention.tasks": "tasks",
"clientAttention.staleQuotes": "stale quotes"
```

### Activity Feed
```json
"activity.by": "By",
"activity.todayCount": "today",
"activity.activeUsers": "users",
"activity.mostActive": "most active"
```

---

## Animation Contract

All widgets use exclusively:
- **Easing:** `WIDGET_EASE_CSS` = `cubic-bezier(0.22, 1, 0.36, 1)` — no spring, no bounce
- **Entrance:** `widgetLineItemStyle(index, isVisible, reducedMotion)` for list items
- **Collapse:** `WidgetHeroCollapse` with `WIDGET_COLLAPSE_DURATION` (300ms)
- **Reduced motion:** All animations respect `useReducedMotion()`. Reduced = opacity-only, no transforms.
- **Ring chart (SM attention):** CSS `stroke-dashoffset` transition, 500ms, `WIDGET_EASE_CSS`

---

## Files Modified

| File | Change |
|------|--------|
| `src/components/dashboard/widgets/top-clients-widget.tsx` | Refactor to WidgetLineItem, add revenue to SM |
| `src/components/dashboard/widgets/client-list-widget.tsx` | Search, sort, quick actions, LG metrics, WidgetLineItem |
| `src/components/dashboard/widgets/client-attention-widget.tsx` | Complete rewrite — 6 triggers, inline actions, ring chart |
| `src/components/dashboard/widgets/activity-feed-widget.tsx` | WidgetLineItem, deep links, author names, LG metrics |
| `src/components/dashboard/widgets/notifications-widget.tsx` | WidgetLineItem, deep links via actionUrl |
| `src/i18n/dictionaries/en/dashboard.json` | New keys per section above |

**Not modified:** shared/, widget-tokens.ts, dashboard/page.tsx, tailwind.config.ts, widget-motion.ts.
