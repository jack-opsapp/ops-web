# Expense Review & My Expenses Widgets — Design Spec

Two complementary dashboard widgets for the expense approval workflow:

1. **`expense-review`** — Manager/owner sees batches pending their review, can approve inline
2. **`my-expenses`** — Team member sees the status of their own submitted expense batches

Both share a new **Expense Batch Detail Popover** (windowed, draggable, resizable) that renders in reviewer or submitter mode based on permissions.

---

## Data Sources

### expense-review widget
- **Hook:** `useExpenseBatches()` — already cached (staleTime 2min)
- **Filter:** `isBatchNeedsReview(batch.status)` (pending_review or submitted)
- **User names:** `useTeamMembers()` to resolve `submittedBy` → display name
- **Permission gate:** `expenses.approve` in registry `requiredPermission`

### my-expenses widget
- **Hook:** `useExpenseBatches()` — same cached data
- **Filter:** `batch.submittedBy === currentUserId` from `useAuthStore()`
- **Permission gate:** `expenses.view` in registry `requiredPermission`

No new API endpoints or queries needed — both derive from existing data.

---

## Widget: `expense-review`

### Registry Entry
```ts
"expense-review": {
  label: "Expense Review",
  description: "Batches pending your approval",
  dataSource: "Expense batches with pending_review or submitted status",
  category: "alerts",
  tags: ["essential", "finance", "office"],
  icon: "ClipboardCheck",
  supportedSizes: ["xs", "sm", "md", "lg"],
  defaultSize: "md",
  configSchema: [],
  allowMultiple: false,
  requiredPermission: "expenses.approve",
}
```

### Size Tiers

**XS (1 col, 1 row — 140px)**
- Hero-first layout
- Hero: batch count needing review (font-mono text-display font-bold)
- Title below: "Pending Review" (font-kosugi text-micro uppercase)
- WidgetTrendContext: "X batches · $Y total" as comparison text
- Entire widget taps → `/accounting` (expense review tab)

**SM (2 col, 1 row — 140px)**
- Hero-first layout
- Hero: total $ pending review (formatCompactCurrency)
- ArrowUpRight icon button → `/accounting`
- Title below: "Expense Review"
- Supporting: "{N} batches pending" (font-mohave text-caption-sm text-text-secondary)
- Oldest batch age indicator: "oldest: 3d" (font-mono text-micro-sm text-text-disabled)

**MD (6 col, 2 rows — 288px)**
- Standard zone layout (header → hero → detail → footer)
- Header: "Expense Review" (kosugi uppercase)
- Hero: total $ pending + batch count
- Detail zone: scrollable list of pending batches via ScrollFade
  - Each row: WidgetLineItem with
    - indicator: avatar (submitter initials)
    - primary: submitter name
    - secondary: batch number · "3d ago"
    - metric: formatCompactCurrency(totalAmount)
  - Click row → opens Expense Batch Detail Popover (reviewer mode)
  - Max 5 rows visible, ScrollFade handles overflow
- Footer: "View All" → `/accounting`

**LG (6 col, 4 rows — 584px)**
- Same as MD plus:
- Detail zone: 10+ rows visible
- Action zone: each batch row includes an inline approve button via WidgetInlineAction
  - Icon: Check
  - Label: "Approve"
  - Triggers `useApproveBatch()` mutation directly
  - Shows WidgetActionToast on success ("Batch approved")
- Empty state: "No batches pending review" with check icon

### Empty State
- XS: "0" hero, "Pending Review" label
- SM: "$0" hero, "No batches pending"
- MD/LG: Hero shows $0, detail zone shows WidgetEmptyState with "All caught up" message

### Loading State
- WidgetSkeleton variant="list" at all sizes

---

## Widget: `my-expenses`

### Registry Entry
```ts
"my-expenses": {
  label: "My Expenses",
  description: "Your submitted expense batches and their status",
  dataSource: "Expense batches filtered to current user",
  category: "money",
  tags: ["essential", "finance"],
  icon: "Receipt",
  supportedSizes: ["xs", "sm", "md", "lg"],
  defaultSize: "sm",
  configSchema: [{
    key: "period",
    label: "Period",
    type: "select",
    options: [
      { value: "this-month", label: "This Month" },
      { value: "last-month", label: "Last Month" },
      { value: "ytd", label: "Year to Date" },
    ],
    defaultValue: "this-month",
  }],
  allowMultiple: false,
  requiredPermission: "expenses.view",
}
```

### Size Tiers

**XS (1 col, 1 row — 140px)**
- Hero-first layout
- Hero: count of batches pending review (the user's pending submissions)
- Title: "My Expenses"
- If any batch needs revision: WidgetTrendContext with warning color "N need revision"
- Tap → `/accounting`

**SM (2 col, 1 row — 140px)**
- Hero-first layout
- Hero: total $ submitted this period
- ArrowUpRight icon → `/accounting`
- Title: "My Expenses"
- Supporting: status summary — e.g. "2 approved · 1 pending"
- If revision needed: warning-colored text "1 needs revision" replaces summary

**MD (6 col, 2 rows — 288px)**
- Standard zone layout
- Header: "My Expenses"
- Hero: total $ submitted + batch count for period
- Detail zone: scrollable list via ScrollFade
  - Each row: WidgetLineItem with
    - indicator: bar (color by status — success for approved, accent for pending, warning for needs revision, muted for auto-approved)
    - primary: batch number (e.g. "EXP-2026-03")
    - secondary: period display · expense count
    - badge: status badge (Approved, Pending, Revision, Auto-Approved)
    - metric: formatCompactCurrency(totalAmount)
  - Click row → opens Expense Batch Detail Popover (submitter mode, read-only)
  - Batches needing revision sorted to top
- Footer: "View All" → `/accounting`

**LG (6 col, 4 rows — 584px)**
- Same as MD plus:
- Detail zone: 10+ rows visible
- Revision-needed batches highlighted with warning bar indicator and expanded secondary text showing flag comment preview
- Action zone: summary strip showing approved/pending/revision counts as inline stat badges

### Status Color Mapping (bar indicators + badges)
| Status | Bar Color | Badge |
|--------|-----------|-------|
| Pending / Submitted | `WT.accent` | `text-ops-accent bg-ops-accent/15 border-ops-accent/30` "PENDING" |
| Approved | `WT.success` | `text-status-success bg-status-success/15 border-status-success/30` "APPROVED" |
| Partially Approved / Needs Revision | `WT.warning` | `text-ops-amber bg-ops-amber/15 border-ops-amber/30` "REVISION" |
| Rejected | `WT.error` | `text-ops-error bg-ops-error/15 border-ops-error/30` "REJECTED" |
| Auto-Approved | `WT.success` | `text-status-success bg-status-success/15 border-status-success/30` "AUTO" |

### Empty State
- XS: "0" hero, "My Expenses" label
- SM: "$0" hero, "No expenses submitted"
- MD/LG: WidgetEmptyState "No expenses submitted this period"

---

## Expense Batch Detail Popover (Shared)

### Store: `expense-batch-popover-store.ts`
Follows the exact invoice-detail-popover-store pattern:
- `POPOVER_DEFAULT_WIDTH: 440`
- `POPOVER_DEFAULT_HEIGHT: 520`
- State: id, title, color, position, size, zIndex, isMinimized, activeTab
- Tabs: `"expenses" | "summary"`
- Standard operations: open, close, focus, minimize, restore, updatePosition, updateSize, setActiveTab

### Component: `expense-batch-popover.tsx`
Windowed popover (draggable title bar, resize handle, minimize/close). Renders at dashboard layout level.

**Data:** `useBatchExpenses(state.id)` for the line items + `useExpenseBatches()` to get batch metadata.

**Title bar:**
- Color indicator dot (status color)
- Batch number (e.g. "EXP-2026-03-SMITH")
- Minimize + Close buttons

**Info strip:**
- Row 1: Submitter name (resolved from useTeamMembers)
- Row 2: Status badge + period display + "5 items · $1,234"

**Tab: Expenses (default)**
Scrollable list of individual expense line items:

| Field | Typography | Source |
|-------|-----------|--------|
| Merchant / description | font-mohave text-body-sm text-primary | `merchantName ?? description ?? "Untitled"` |
| Category · date | font-kosugi text-[10px] text-disabled | `categoryName` + formatted expenseDate |
| Amount | font-mono text-[12px] text-primary | formatCompactCurrency |
| Flag indicator | warning dot + flag comment preview | Only if `flaggedBy` is set |

**Reviewer mode** (user has `expenses.approve`):
- Flag toggle button on each expense row (flag icon, click to add/remove flag + comment)
- Flag comment input: text field that appears when flagging
- Footer actions:
  - "Approve All" button — calls `useApproveBatch()`, closes popover on success
  - "Send Revisions" button — enabled only when >= 1 expense is flagged, calls `useRejectWithRevisions()`
- Both actions show a confirmation toast via showWidgetActionToast

**Submitter mode** (no `expenses.approve`):
- No flag/approve/reject actions
- Flagged expenses show the flag comment and rejection reason as read-only text (warning-colored)
- No footer action buttons — just "View in Accounting →" link

### Permission detection
```ts
const canApprove = usePermissionStore((s) => s.hasPermission("expenses.approve"));
```
This single boolean toggles between reviewer and submitter mode. No separate components needed.

**Tab: Summary**
- Total amount breakdown by category (horizontal bars, same pattern as expense-tracker category bars)
- Payment method distribution (if data available)
- Receipt coverage: "4/5 have receipts" with progress indicator

---

## Animation Decisions

**Emotional beats served:**
- Entry/Arrival: widget content fades in with stagger (existing widgetLineItemStyle)
- Discovery: hover on batch rows highlights with subtle bg shift (rgba(255,255,255,0.04))
- Commitment: approve action — brief scale pulse on the row (0.98 → 1.0 over 200ms) + WidgetActionToast
- Achievement: batch approved — row fades out with scale-down (300ms, EASE_SMOOTH)

**Framework:** CSS transitions + existing Framer Motion variants from `motion.ts`. No new libraries.

**Reduced motion:** All animations use existing `useReducedMotion()` hook. Reduced motion fallback: opacity-only transitions, no transforms.

**Performance:** No bundle impact — uses existing widget shared components and motion utilities.

---

## Animation: Approve Row Removal (expense-review LG)

When a batch is approved inline (LG action button), the row should exit gracefully:

1. Row scales to 0.98 + opacity drops to 0.5 (150ms, EASE_SMOOTH)
2. WidgetActionToast fires: "Batch approved"
3. After mutation success, row animates out: height collapses to 0 + opacity to 0 (250ms)
4. Remaining rows shift up via layout animation (existing Framer Motion layout)

Use AnimatePresence wrapping the batch list items with exit variants. This is a State-driven, 2D flat, Single element animation — pure Framer Motion, no additional framework needed.

Reduced motion: skip scale/height collapse, use opacity-only fade (200ms).

---

## Data Analysis: What the Widgets Surface

### expense-review — Manager's decision support
- **Primary metric:** Total $ pending (how much money is waiting on you)
- **Urgency signal:** Oldest batch age (batches sitting > 7 days should feel urgent)
- **Actionability:** Each batch is one tap to approve (LG) or one click to review (MD)
- **Cognitive load:** Minimal — sorted by submission date, newest first. Name + amount + age is enough to decide

### my-expenses — Team member's status awareness
- **Primary metric:** Total $ submitted (how much you've spent this period)
- **Action signal:** Revision-needed batches surface at top with warning color. This is the only state requiring user action
- **Context:** Status badges give instant scan of where things stand
- **Anxiety reduction:** Seeing "Approved" badges confirms the system is working

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/stores/expense-batch-popover-store.ts` | Windowed popover state (Zustand) |
| `src/components/ops/expense-batch-popover.tsx` | Shared popover — reviewer + submitter modes |
| `src/components/dashboard/widgets/expense-review-widget.tsx` | Manager pending review widget |
| `src/components/dashboard/widgets/my-expenses-widget.tsx` | Team member submissions widget |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/types/dashboard-widgets.ts` | Add `"expense-review"` and `"my-expenses"` to WidgetTypeId union + WIDGET_TYPE_REGISTRY |
| `src/app/(dashboard)/dashboard/page.tsx` | Add cases in `renderWidgetContent()` switch |
| `src/components/layouts/dashboard-layout.tsx` | Register `<ExpenseBatchPopover />` |
| `src/i18n/dictionaries/en/dashboard.json` | Add i18n keys for both widgets |
| `src/i18n/dictionaries/es/dashboard.json` | Spanish translations |

### i18n Keys (EN)
```json
"expenseReview.title": "Expense Review",
"expenseReview.pendingReview": "Pending Review",
"expenseReview.batchesPending": "{count} batches pending",
"expenseReview.oldest": "oldest",
"expenseReview.approve": "Approve",
"expenseReview.approved": "Batch approved",
"expenseReview.allCaughtUp": "All caught up",
"expenseReview.noBatches": "No batches pending review",
"expenseReview.viewAll": "View All",

"myExpenses.title": "My Expenses",
"myExpenses.noExpenses": "No expenses submitted",
"myExpenses.noExpensesPeriod": "No expenses submitted this period",
"myExpenses.needsRevision": "{count} need revision",
"myExpenses.approved": "approved",
"myExpenses.pending": "pending",
"myExpenses.viewAll": "View All",

"batchPopover.expenses": "Expenses",
"batchPopover.summary": "Summary",
"batchPopover.approveAll": "Approve All",
"batchPopover.sendRevisions": "Send Revisions",
"batchPopover.flagExpense": "Flag for revision",
"batchPopover.unflag": "Remove flag",
"batchPopover.flagComment": "What needs fixing?",
"batchPopover.noExpenses": "No expenses in batch",
"batchPopover.receiptCoverage": "Receipt coverage",
"batchPopover.viewInAccounting": "View in Accounting"
```

---

## Audit Checklist Pre-Verification

Both widgets will pass the 10-point widget audit:

1. **Colors** — All from WT.* tokens and Tailwind semantic classes
2. **Typography** — Per widget type scale (kosugi headers, mono heroes, mohave body)
3. **Anatomy** — Zone system followed per tier (hero-first at XS/SM, standard zones at MD+)
4. **Content budget** — XS/SM are 2-second glanceable (count or $ only)
5. **Overflow** — ScrollFade wraps detail zone at MD+
6. **Tooltips** — WidgetTooltip with anchorRef if any hover details needed
7. **Navigation** — XS/SM tap → /accounting, ArrowUpRight icon at SM, text footer at MD+
8. **Loading** — WidgetSkeleton at every size
9. **Empty state** — Per-size empty states with appropriate messaging
10. **Reduced motion** — useReducedMotion() applied to all transitions
