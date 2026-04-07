# Expense Review & My Expenses Widgets — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build two expense dashboard widgets (expense-review for managers, my-expenses for team members) plus a shared Expense Batch Detail Popover.

**Architecture:** Zustand store for popover state, TanStack Query hooks for data (`useExpenseBatches`, `useAllExpenses`), permission-gated rendering via `requiredPermission` in the widget registry + `usePermissionStore` for popover mode switching.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Zustand, TanStack Query, Framer Motion, Radix (within shared widget components), Lucide icons

**Design System:** `.interface-design/system.md` — dark frosted glass, borders-only depth, Mohave/Kosugi/JetBrains Mono type stack

**Required Skills:** `interface-design`, `widget-builder`, `animation-studio:web-animations`, `animation-studio:data-visualization`

**Spec:** `docs/superpowers/specs/2026-04-04-expense-review-widgets-design.md`

---

## Task 1: Register Widget Types

**Files:**
- Modify: `src/lib/types/dashboard-widgets.ts`

**Step 1:** Add `"expense-review"` and `"my-expenses"` to the `WidgetTypeId` union type. Insert after `"payments-recent"` in the Money section for `my-expenses`, and add `expense-review` to the Alerts section after `"notifications"`:

```ts
// In WidgetTypeId union — Money section:
  | "my-expenses"

// In WidgetTypeId union — Alerts section, after "notifications":
  | "expense-review"
```

**Step 2:** Add both entries to `WIDGET_TYPE_REGISTRY`. Insert `"my-expenses"` after the `"expense-tracker"` entry:

```ts
  "my-expenses": {
    label: "My Expenses",
    description: "Your submitted expense batches and their status",
    dataSource: "Expense batches filtered to current user",
    category: "money",
    tags: ["essential", "finance"],
    icon: "Receipt",
    supportedSizes: ["xs", "sm", "md", "lg"] as WidgetSize[],
    defaultSize: "sm",
    configSchema: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "this-month", label: "This Month" },
          { value: "last-month", label: "Last Month" },
          { value: "ytd", label: "Year to Date" },
        ],
        defaultValue: "this-month",
      },
    ],
    allowMultiple: false,
    requiredPermission: "expenses.view",
  },
```

Insert `"expense-review"` after the `"notifications"` entry in the Alerts section:

```ts
  "expense-review": {
    label: "Expense Review",
    description: "Batches pending your approval",
    dataSource: "Expense batches with pending_review or submitted status",
    category: "alerts",
    tags: ["essential", "finance", "office"],
    icon: "ClipboardCheck",
    supportedSizes: ["xs", "sm", "md", "lg"] as WidgetSize[],
    defaultSize: "md",
    configSchema: [],
    allowMultiple: false,
    requiredPermission: "expenses.approve",
  },
```

**Step 3:** Commit.

```bash
git add src/lib/types/dashboard-widgets.ts
git commit -m "feat(widgets): register expense-review and my-expenses widget types"
```

---

## Task 2: Add i18n Keys

**Files:**
- Modify: `src/i18n/dictionaries/en/dashboard.json`
- Modify: `src/i18n/dictionaries/es/dashboard.json`

**Step 1:** Add to EN dashboard.json after the existing `expenseTracker.*` keys:

```json
  "expenseReview.title": "Expense Review",
  "expenseReview.pendingReview": "Pending Review",
  "expenseReview.batchesPending": "batches pending",
  "expenseReview.oldest": "oldest",
  "expenseReview.approve": "Approve",
  "expenseReview.approved": "Batch approved",
  "expenseReview.allCaughtUp": "All caught up",
  "expenseReview.noBatches": "No batches pending review",
  "expenseReview.viewAll": "View All",

  "myExpenses.title": "My Expenses",
  "myExpenses.noExpenses": "No expenses submitted",
  "myExpenses.noExpensesPeriod": "No expenses submitted this period",
  "myExpenses.needsRevision": "need revision",
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
  "batchPopover.viewInAccounting": "View in Accounting",
  "batchPopover.untitled": "Untitled",
```

**Step 2:** Add equivalent ES keys to `es/dashboard.json`:

```json
  "expenseReview.title": "Revisión de gastos",
  "expenseReview.pendingReview": "Pendiente",
  "expenseReview.batchesPending": "lotes pendientes",
  "expenseReview.oldest": "más antiguo",
  "expenseReview.approve": "Aprobar",
  "expenseReview.approved": "Lote aprobado",
  "expenseReview.allCaughtUp": "Todo al día",
  "expenseReview.noBatches": "Sin lotes pendientes",
  "expenseReview.viewAll": "Ver Todos",

  "myExpenses.title": "Mis Gastos",
  "myExpenses.noExpenses": "Sin gastos enviados",
  "myExpenses.noExpensesPeriod": "Sin gastos en este periodo",
  "myExpenses.needsRevision": "necesitan revisión",
  "myExpenses.approved": "aprobados",
  "myExpenses.pending": "pendientes",
  "myExpenses.viewAll": "Ver Todos",

  "batchPopover.expenses": "Gastos",
  "batchPopover.summary": "Resumen",
  "batchPopover.approveAll": "Aprobar Todo",
  "batchPopover.sendRevisions": "Enviar Revisiones",
  "batchPopover.flagExpense": "Marcar para revisión",
  "batchPopover.unflag": "Quitar marca",
  "batchPopover.flagComment": "¿Qué necesita corrección?",
  "batchPopover.noExpenses": "Sin gastos en el lote",
  "batchPopover.receiptCoverage": "Cobertura de recibos",
  "batchPopover.viewInAccounting": "Ver en Contabilidad",
  "batchPopover.untitled": "Sin título",
```

**Step 3:** Commit.

```bash
git add src/i18n/dictionaries/en/dashboard.json src/i18n/dictionaries/es/dashboard.json
git commit -m "feat(i18n): add expense-review and my-expenses widget keys (en + es)"
```

---

## Task 3: Create Expense Batch Popover Store

**Files:**
- Create: `src/stores/expense-batch-popover-store.ts`

**Step 1:** Create the store following the exact invoice-detail-popover-store pattern. Copy the full structure from `src/stores/invoice-detail-popover-store.ts` and adapt:

- Rename all `Invoice` → `ExpenseBatch`
- Tab type: `"expenses" | "summary"`
- Default tab: `"expenses"`
- Default width: `440`, default height: `520`
- All standard operations: open, close, focus, minimize, restore, updatePosition, updateSize, setActiveTab
- Same `clampPosition` and `findNonOverlappingPosition` utilities
- Export: `useExpenseBatchPopoverStore`

The store state interface:

```ts
export type ExpenseBatchPopoverTab = "expenses" | "summary";

export interface ExpenseBatchPopoverState {
  id: string;          // batchId
  title: string;       // batch number (e.g. "EXP-2026-03-SMITH")
  color: string;       // status color
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  isMinimized: boolean;
  activeTab: ExpenseBatchPopoverTab;
}
```

**Step 2:** Commit.

```bash
git add src/stores/expense-batch-popover-store.ts
git commit -m "feat: add expense batch popover store (zustand)"
```

---

## Task 4: Create Expense Batch Popover Component

**Skills:** `interface-design`, `widget-builder`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/ops/expense-batch-popover.tsx`

This is the largest task. The component follows the `invoice-detail-popover.tsx` pattern exactly (read it as reference). Key structure:

**Data hooks inside the instance component:**
```ts
const { data: batchesData } = useExpenseBatches();
const batch = batchesData?.find((b) => b.id === state.id);
const { data: batchExpenses } = useBatchExpenses(state.id);
const { data: teamData } = useTeamMembers();
const canApprove = usePermissionStore((s) => s.can("expenses.approve"));
```

**Imports needed:**
- `useExpenseBatches`, `useBatchExpenses`, `useApproveBatch`, `useRejectWithRevisions`, `useFlagExpense`, `useUnflagExpense` from `@/lib/hooks/use-expense-approval`
- `useTeamMembers` from `@/lib/hooks`
- `usePermissionStore` from `@/lib/store/permissions-store`
- `isBatchNeedsReview`, `BATCH_STATUS_COLOR`, `BATCH_STATUS_DISPLAY` from `@/lib/types/expense-approval`
- `formatCompactCurrency` from widget-utils
- `showWidgetActionToast` from `./shared/widget-action-toast` (relative path won't work here — use the store import from widgets shared or inline toast via `toast` from sonner)
- `useDictionary` from `@/i18n/client`
- Framer Motion: `motion`, `AnimatePresence`, `useReducedMotion`
- Lucide: `Minus`, `X`, `Flag`, `Check`, `ArrowUpRight`, `Send`
- Standard popover chrome: drag handling, resize handling (copy from invoice-detail-popover)

**Component structure:**

```
ExpenseBatchPopoverInstance (memo)
├── Title bar (draggable) — batch number + status dot + minimize/close
├── Info strip — submitter name, status badge, period, item count + total
├── Tab bar — "Expenses" | "Summary"
├── Tab content (flex-1, overflow-y-auto scrollbar-hide)
│   ├── Expenses tab: expense line items list
│   │   ├── Each row: merchant/description, category · date, amount
│   │   ├── If canApprove: flag icon toggle per row
│   │   └── If flagged: flag comment preview (warning color)
│   └── Summary tab: category breakdown bars + receipt coverage stat
├── Footer actions (reviewer mode only, when batch isReviewable)
│   ├── "Approve All" button — calls useApproveBatch
│   └── "Send Revisions" button — enabled when flaggedCount > 0
└── Resize handle (bottom-right)

ExpenseBatchPopover (root renderer)
└── AnimatePresence → map over popovers.values()
```

**Reviewer vs Submitter mode:**
- Single boolean: `const canApprove = usePermissionStore((s) => s.can("expenses.approve"))`
- `canApprove && isBatchNeedsReview(batch.status)` → show flag toggles + footer action buttons
- `!canApprove` → show flag comments/rejection reasons as read-only, no action buttons

**Approve action:**
```ts
const approveBatch = useApproveBatch();

const handleApprove = async () => {
  if (!batch || !batchExpenses) return;
  const expenseIds = batchExpenses.map((e) => e.id);
  await approveBatch.mutateAsync({
    batchId: state.id,
    reviewedBy: currentUser?.id ?? "",
    approvedAmount: batch.totalAmount ?? 0,
    expenseIds,
  });
  toast.success(t("expenseReview.approved") ?? "Batch approved");
  closePopover(state.id);
};
```

**Flag toggle:**
```ts
const flagExpense = useFlagExpense();
const unflagExpense = useUnflagExpense();

// Per expense row — controlled via local state for optimistic flag editing
const handleFlag = (expenseId: string, comment: string) => {
  flagExpense.mutate({ expenseId, flaggedBy: currentUser?.id ?? "", comment });
};
const handleUnflag = (expenseId: string) => {
  unflagExpense.mutate({ expenseId });
};
```

**Styling:** Match invoice-detail-popover exactly:
- `bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] saturate-[1.2]`
- `border border-[rgba(255,255,255,0.08)] rounded-[4px]`
- Title bar: `cursor-grab`, `border-b border-[rgba(255,255,255,0.06)]`
- Tab bar: `font-mohave text-[11px] uppercase tracking-[0.5px]`, active tab has `h-[2px] bg-ops-accent` underline
- Expense rows: `font-mohave text-body-sm` for merchant, `font-kosugi text-[10px]` for category/date, `font-mono text-[12px]` for amount
- Flag icon: `Flag` from lucide, 14x14, warning color when flagged, text-disabled when not

**Motion:** Entry/exit matches invoice popover:
```ts
initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
```

**Step 2:** Commit.

```bash
git add src/components/ops/expense-batch-popover.tsx
git commit -m "feat: add expense batch detail popover (reviewer + submitter modes)"
```

---

## Task 5: Register Popover in Dashboard Layout

**Files:**
- Modify: `src/components/layouts/dashboard-layout.tsx`

**Step 1:** Add import after the existing popover imports (line ~30):

```ts
import { ExpenseBatchPopover } from "@/components/ops/expense-batch-popover";
```

**Step 2:** Add `<ExpenseBatchPopover />` after `<MemberExpensesPopover />` (line ~201):

```tsx
      <MemberExpensesPopover />
      <ExpenseBatchPopover />
```

**Step 3:** Commit.

```bash
git add src/components/layouts/dashboard-layout.tsx
git commit -m "feat: register ExpenseBatchPopover in dashboard layout"
```

---

## Task 6: Build `expense-review-widget.tsx`

**Skills:** `interface-design`, `widget-builder`, `animation-studio:web-animations`

**Files:**
- Create: `src/components/dashboard/widgets/expense-review-widget.tsx`

**Data flow:**
```ts
const { data: batchesData, isLoading } = useExpenseBatches();
const { data: teamData } = useTeamMembers();
const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
const approveBatch = useApproveBatch();
```

Filter to pending batches:
```ts
const pendingBatches = useMemo(() => {
  if (!batchesData) return [];
  return batchesData
    .filter((b) => isBatchNeedsReview(b.status))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}, [batchesData]);
```

Resolve submitter names:
```ts
const userNameMap = useMemo(() => {
  const map = new Map<string, string>();
  if (teamData?.users) {
    for (const u of teamData.users) {
      map.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id);
    }
  }
  return map;
}, [teamData]);
```

**Props interface:**
```ts
interface ExpenseReviewWidgetProps {
  size: WidgetSize;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}
```

**XS tier:** Hero-first. Hero = `pendingBatches.length`. Title = "Pending Review". If count > 0, WidgetTrendContext showing total $ amount. Tap → `/accounting`.

**SM tier:** Hero-first. Hero = `formatCompactCurrency(totalPending)`. ArrowUpRight icon. Title = "Expense Review". Supporting = `"{N} batches pending"`. Secondary = oldest batch age `"oldest: Xd"`.

**MD tier:** Standard zones. Header + hero + ScrollFade detail zone with WidgetLineItem rows. Each batch row:
- `indicator: { type: "avatar", color: WT.accent, initials: submitterName.slice(0, 2) }`
- `primary: submitterName`
- `secondary: batchNumber · "Xd ago"`
- `metric: formatCompactCurrency(batch.totalAmount)`
- `onClick: (e) => openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, WT.accent)`

Footer: "View All" → `/accounting`.

**LG tier:** Same as MD plus:
- Each row includes `action` slot with WidgetInlineAction:
  ```tsx
  action={
    <WidgetInlineAction
      icon={Check}
      label={t("expenseReview.approve") ?? "Approve"}
      onAction={() => handleInlineApprove(batch)}
    />
  }
  ```
- `handleInlineApprove` calls `useApproveBatch()` + `useAllExpenses` data to get expense IDs for the batch, then shows toast on success.
- 10+ rows visible.

**Empty state:** Per-size. XS/SM: "0" hero. MD/LG: WidgetEmptyState or centered kosugi text "All caught up".

**Loading:** WidgetSkeleton at each size.

**Batch age helper:**
```ts
function getBatchAge(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  return `${days}d`;
}
```

**Step 2:** Commit.

```bash
git add src/components/dashboard/widgets/expense-review-widget.tsx
git commit -m "feat: add expense-review widget (xs/sm/md/lg with inline approve)"
```

---

## Task 7: Build `my-expenses-widget.tsx`

**Skills:** `interface-design`, `widget-builder`

**Files:**
- Create: `src/components/dashboard/widgets/my-expenses-widget.tsx`

**Data flow:**
```ts
const { data: batchesData, isLoading } = useExpenseBatches();
const { currentUser } = useAuthStore();
const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
```

Filter to current user's batches within period:
```ts
const myBatches = useMemo(() => {
  if (!batchesData || !currentUser) return [];
  return batchesData
    .filter((b) => b.submittedBy === currentUser.id)
    .filter((b) => { /* period filter using config.period */ })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}, [batchesData, currentUser, /* period deps */]);
```

Compute summary stats:
```ts
const stats = useMemo(() => {
  const total = myBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
  const approved = myBatches.filter((b) => isBatchApproved(b.status)).length;
  const pending = myBatches.filter((b) => isBatchNeedsReview(b.status)).length;
  const revision = myBatches.filter((b) => b.status === ExpenseBatchStatus.Rejected || b.status === ExpenseBatchStatus.PartiallyApproved).length;
  return { total, approved, pending, revision };
}, [myBatches]);
```

**Props interface:**
```ts
interface MyExpensesWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}
```

**XS tier:** Hero-first. Hero = pending count. Title = "My Expenses". If revision > 0, WidgetTrendContext with warning color showing `"{N} need revision"`.

**SM tier:** Hero-first. Hero = `formatCompactCurrency(stats.total)`. ArrowUpRight icon. Title = "My Expenses". Supporting = `"{approved} approved · {pending} pending"`. If revision > 0, warning text replaces supporting.

**MD tier:** Standard zones. Header + hero + ScrollFade list. Each batch row:
- `indicator: { type: "bar", color: statusColor }` where statusColor maps batch status → WT token
- `primary: batch.batchNumber`
- `secondary: periodDisplay · "{N} items"`
- `badge: { status: statusLabel, entity: "project" as const }` — reuse WidgetStatusBadge with appropriate status mapping
- `metric: formatCompactCurrency(batch.totalAmount)`
- `onClick: (e) => openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, statusColor)`
- Revision-needed batches sorted to top.

Footer: "View All" → `/accounting`.

**LG tier:** Same as MD plus:
- 10+ rows visible
- Revision batches show expanded secondary with flag comment preview
- Action zone: summary strip with inline stat badges showing approved/pending/revision counts

**Status color mapping function:**
```ts
function getBatchStatusColor(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved:
    case ExpenseBatchStatus.AutoApproved:
      return WT.success;
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted:
      return WT.accent;
    case ExpenseBatchStatus.PartiallyApproved:
      return WT.warning;
    case ExpenseBatchStatus.Rejected:
      return WT.error;
    default:
      return WT.muted;
  }
}

function getBatchStatusLabel(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved: return "APPROVED";
    case ExpenseBatchStatus.AutoApproved: return "AUTO";
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted: return "PENDING";
    case ExpenseBatchStatus.PartiallyApproved: return "REVISION";
    case ExpenseBatchStatus.Rejected: return "REJECTED";
    default: return status;
  }
}
```

**Step 2:** Commit.

```bash
git add src/components/dashboard/widgets/my-expenses-widget.tsx
git commit -m "feat: add my-expenses widget (xs/sm/md/lg with status tracking)"
```

---

## Task 8: Wire Up Widgets in Dashboard Page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

**Step 1:** Add imports after existing widget imports (line ~95):

```ts
import { ExpenseReviewWidget } from "@/components/dashboard/widgets/expense-review-widget";
import { MyExpensesWidget } from "@/components/dashboard/widgets/my-expenses-widget";
```

**Step 2:** Add `useExpenseBatches` to the data hooks section. It's already exported from `@/lib/hooks` but NOT currently imported in the dashboard page. Add to the import block (line ~41):

```ts
// In the existing import from "@/lib/hooks":
  useExpenseBatches,
```

And add the hook call after `expensesData` (line ~230):

```ts
const { data: batchesData, isLoading: batchesLoading } = useExpenseBatches();
```

**Step 3:** Add cases in `renderWidgetContent()` switch. After the `"expense-tracker"` case (line ~573):

```ts
      case "my-expenses":
        return <MyExpensesWidget size={size} config={config} isLoading={batchesLoading} onNavigate={navigate} />;
```

After the `"notifications"` case in the Alerts section:

```ts
      case "expense-review":
        return <ExpenseReviewWidget size={size} isLoading={batchesLoading} onNavigate={navigate} />;
```

**Step 4:** Commit.

```bash
git add src/app/(dashboard)/dashboard/page.tsx
git commit -m "feat: wire expense-review and my-expenses widgets in dashboard page"
```

---

## Task 9: Verify & Type-Check

**Step 1:** Run TypeScript check:

```bash
cd OPS-Web && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors related to the new files.

**Step 2:** Run dev server and visually verify:

```bash
npm run dev
```

- Add both widgets via the widget tray (customize mode)
- Verify expense-review only appears for users with `expenses.approve` permission
- Verify my-expenses appears for all users with `expenses.view`
- Test all size tiers (xs → lg) via the size pills in customize mode
- Click a batch row — verify windowed popover opens at click position
- Test approve action in popover (reviewer mode)
- Verify popover is read-only for non-approve users

**Step 3:** Commit any fixes.

```bash
git add -A
git commit -m "fix: address type-check and visual polish for expense widgets"
```

---

## Task 10: Final Audit

Run the 10-point widget audit checklist from the widget-builder skill against BOTH widgets:

1. **Colors** — Zero hardcoded hex. All WT.* tokens or Tailwind classes.
2. **Typography** — kosugi headers, mono heroes, mohave body per spec.
3. **Anatomy** — Hero-first at XS/SM, standard zones at MD+.
4. **Content budget** — XS/SM are 2-second glanceable.
5. **Overflow** — ScrollFade wraps detail zone.
6. **Tooltips** — WidgetTooltip with anchorRef if applicable.
7. **Navigation** — XS/SM tap → /accounting, icon at SM, text footer at MD+.
8. **Loading** — WidgetSkeleton at every size.
9. **Empty state** — Per-size empty states.
10. **Reduced motion** — useReducedMotion() on all transitions.

Fix any violations found. Commit.

```bash
git add -A
git commit -m "audit: pass 10-point widget checklist for expense-review and my-expenses"
```
