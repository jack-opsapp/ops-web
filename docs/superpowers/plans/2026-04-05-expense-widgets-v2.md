# Expense Widgets V2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite expense-review widget, my-expenses widget, and expense batch popover to use company expense settings (review cadence, receipt requirements), add urgency/overdue awareness, receipt compliance indicators, and inline quick-approve/reject actions.

**Architecture:** Three file rewrites (expense-review-widget, my-expenses-widget, expense-batch-popover) plus a new shared urgency helper, a new quick-reject service method, and i18n additions. All data comes from existing hooks: `useExpenseBatches()`, `useAllExpenses()`, `useExpenseSettings()`, `useTeamMembers()`. New helper `computeBatchUrgency()` derives urgency from `ExpenseBatch.periodEnd` and `ExpenseSettings.reviewFrequency`.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, TanStack Query, Zustand, Framer Motion, Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-05-expense-widgets-v2-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Create** | `src/lib/utils/expense-urgency.ts` | Shared urgency computation + compliance helpers |
| **Add method** | `src/lib/api/services/expense-approval-service.ts` | `quickRejectBatch()` — blanket reject with review notes |
| **Add hook** | `src/lib/hooks/use-expense-approval.ts` | `useQuickRejectBatch()` — TanStack mutation for quick reject |
| **Rewrite** | `src/components/dashboard/widgets/expense-review-widget.tsx` | V2 with urgency, compliance, inline approve/reject |
| **Rewrite** | `src/components/dashboard/widgets/my-expenses-widget.tsx` | V2 with submitter urgency, compliance self-check |
| **Rewrite** | `src/components/ops/expense-batch-popover.tsx` | V2 with urgency badge, receipt thumbnails, compliance bar |
| **Modify** | `src/components/dashboard/widget-preview.tsx` | Update preview cases |
| **Modify** | `src/app/(dashboard)/dashboard/page.tsx` | Pass settings data if needed |
| **Modify** | `src/i18n/dictionaries/en/dashboard.json` | New i18n keys |
| **Modify** | `src/i18n/dictionaries/es/dashboard.json` | Spanish translations |

---

## Verified Data Types Reference

### ExpenseBatch (from `src/lib/types/expense-approval.ts`)
```ts
interface ExpenseBatch {
  id: string;
  companyId: string;
  batchNumber: string;           // e.g. "EXP-2026-04-METCALF"
  periodStart: string | null;    // ISO date "2026-04-01"
  periodEnd: string | null;      // ISO date "2026-04-30"
  status: ExpenseBatchStatus;    // enum: pending_review | submitted | approved | partially_approved | rejected | auto_approved
  submittedBy: string | null;    // UUID, NO FK to users
  reviewedBy: string | null;
  reviewedAt: string | null;
  totalAmount: number | null;    // numeric from DB
  approvedAmount: number | null;
  parentBatchId: string | null;
  amendmentNumber: number;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt?: string;
  submitter?: ExpenseBatchUser | null;  // app-level join
}
```

### ExpenseLineItem (from `src/lib/types/expense-approval.ts`)
```ts
interface ExpenseLineItem {
  id: string;
  companyId: string;
  submittedBy: string;
  batchId: string | null;
  status: string | null;        // "draft" | "submitted" | "approved" | "rejected"
  categoryId: string | null;
  merchantName: string | null;
  description: string | null;
  amount: number;
  receiptImageUrl: string | null;     // S3/storage URL or null
  receiptThumbnailUrl: string | null;
  flagComment: string | null;
  flaggedBy: string | null;
  flaggedAt: string | null;
  expenseDate: string | null;   // ISO date
  categoryName?: string | null; // app-level join from expense_categories.name
  projectId?: string | null;    // app-level join from expense_project_allocations
  // ... other fields omitted for brevity
}
```

### ExpenseSettings (from `src/lib/api/services/expense-settings-service.ts`)
```ts
interface ExpenseSettings {
  companyId: string;
  reviewFrequency: "daily" | "weekly" | "biweekly" | "monthly";
  autoApproveThreshold: number | null;
  adminApprovalThreshold: number | null;
  requireReceiptPhoto: boolean;
  requireProjectAssignment: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Hook Return Types
- `useExpenseBatches()` → `UseQueryResult<ExpenseBatch[]>`
- `useAllExpenses()` → `UseQueryResult<ExpenseLineItem[]>`
- `useExpenseSettings()` → `UseQueryResult<ExpenseSettings>`
- `useBatchExpenses(batchId: string | null)` → `UseQueryResult<ExpenseLineItem[]>`
- `useTeamMembers()` → `UseQueryResult<{ users: User[]; remaining: number; count: number }>`
- `useApproveBatch()` → `UseMutationResult` with variables `{ batchId, reviewedBy, approvedAmount, expenseIds, submittedBy?, companyId?, batchNumber? }`
- `useFlagExpense()` → `UseMutationResult` with variables `{ expenseId, flaggedBy, comment }`
- `useUnflagExpense()` → `UseMutationResult` with variable `expenseId: string`

### Existing Helpers (from `src/lib/types/expense-approval.ts`)
- `isBatchNeedsReview(status: ExpenseBatchStatus): boolean` — pending_review or submitted
- `isBatchReviewable(batch: Pick<ExpenseBatch, "status">): boolean` — same logic, takes object
- `isBatchApproved(status: ExpenseBatchStatus): boolean` — approved, auto_approved, or partially_approved
- `formatPeriodDisplay(key: string): string` — "2026-03" → "MAR 2026"
- `periodKeyFromBatch(batch): string` — extracts "YYYY-MM" from periodStart
- `getBatchDisplayName(batch): string` — submitter name resolution

### Existing Components
- `WidgetLineItem` — indicator (bar/dot/icon/avatar), primary, secondary, metric, action, badge, onClick
- `WidgetInlineAction` — icon + label + onAction (single) or icon + actions[] (multi)
- `WidgetEmptyState` — icon + message + optional CTA
- `WidgetTrendContext` — variant: "trend" | "health" | "snapshot"
- `ScrollFade` — scrollable container with gradient fades
- `WidgetSkeleton` — variant: "stat" | "list" | "bar-chart" etc.
- `ReceiptLightbox` — `{ imageUrl: string; onClose: () => void }` — existing receipt viewer at `src/components/expenses/receipt-lightbox.tsx`
- `showWidgetActionToast({ label, onUndo, duration? })` — toast with undo button

### Widget Tokens (from `src/lib/widget-tokens.ts`)
- `WT.accent`, `WT.success`, `WT.warning`, `WT.error`, `WT.muted`, `WT.faint`
- `HERO_SIZE_CLASS.compact` ("text-data-lg"), `HERO_SIZE_CLASS.expanded` ("text-display")
- `isCompact(size)`, `showDetail(size)`, `showActions(size)`

---

## Task 1: Create Shared Urgency & Compliance Helpers

**Files:**
- Create: `src/lib/utils/expense-urgency.ts`

- [ ] **Step 1: Create the urgency helper file**

```ts
/**
 * Expense urgency computation and compliance helpers.
 * Used by expense-review widget, my-expenses widget, and batch popover.
 */

import type { ExpenseBatch, ExpenseLineItem } from "@/lib/types/expense-approval";
import type { ExpenseSettings } from "@/lib/api/services/expense-settings-service";
import { isBatchNeedsReview } from "@/lib/types/expense-approval";

// ── Urgency ─────────────────────────────────────────────────────────

export type BatchUrgency = "fresh" | "due" | "overdue";

const CYCLE_DAYS: Record<ExpenseSettings["reviewFrequency"], number> = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/**
 * Compute reviewer urgency for a batch based on review cadence.
 *
 * Timeline from periodEnd:
 *   fresh:   < 1 cycle  (crew still submitting)
 *   due:     1–2 cycles (review window — act now)
 *   overdue: >= 2 cycles (past review window)
 *
 * Returns "fresh" if periodEnd is null or batch doesn't need review.
 */
export function computeBatchUrgency(
  batch: Pick<ExpenseBatch, "periodEnd" | "status">,
  reviewFrequency: ExpenseSettings["reviewFrequency"],
): BatchUrgency {
  if (!isBatchNeedsReview(batch.status)) return "fresh";
  if (!batch.periodEnd) return "fresh";

  const cycleDays = CYCLE_DAYS[reviewFrequency];
  const periodEnd = new Date(batch.periodEnd);
  const now = new Date();
  const daysPast = Math.floor((now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));

  if (daysPast < cycleDays) return "fresh";
  if (daysPast < cycleDays * 2) return "due";
  return "overdue";
}

/**
 * Compute submitter urgency — has the manager missed the review window?
 * Only applicable to pending batches. Returns null for non-pending.
 */
export function computeSubmitterUrgency(
  batch: Pick<ExpenseBatch, "periodEnd" | "status">,
  reviewFrequency: ExpenseSettings["reviewFrequency"],
): "overdue-review" | null {
  if (!isBatchNeedsReview(batch.status)) return null;
  if (!batch.periodEnd) return null;

  const cycleDays = CYCLE_DAYS[reviewFrequency];
  const periodEnd = new Date(batch.periodEnd);
  const now = new Date();
  const daysPast = Math.floor((now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));

  // Past the expected review window (2 cycles from periodEnd)
  if (daysPast >= cycleDays * 2) return "overdue-review";
  return null;
}

// ── Compliance ──────────────────────────────────────────────────────

export interface BatchCompliance {
  receiptsMissing: number;
  receiptsTotal: number;
  projectsMissing: number;
  projectsTotal: number;
}

/**
 * Compute receipt and project compliance for a batch's expenses.
 */
export function computeBatchCompliance(
  expenses: ExpenseLineItem[],
): BatchCompliance {
  let receiptsMissing = 0;
  let projectsMissing = 0;
  const total = expenses.length;

  for (const e of expenses) {
    if (!e.receiptImageUrl) receiptsMissing++;
    if (!e.projectId) projectsMissing++;
  }

  return {
    receiptsMissing,
    receiptsTotal: total,
    projectsMissing,
    projectsTotal: total,
  };
}

/**
 * Group expenses by batchId and compute compliance for each batch.
 * Returns a Map<batchId, BatchCompliance>.
 */
export function computeAllBatchCompliance(
  allExpenses: ExpenseLineItem[],
): Map<string, BatchCompliance> {
  const byBatch = new Map<string, ExpenseLineItem[]>();
  for (const e of allExpenses) {
    if (!e.batchId) continue;
    const list = byBatch.get(e.batchId) ?? [];
    list.push(e);
    byBatch.set(e.batchId, list);
  }

  const result = new Map<string, BatchCompliance>();
  for (const [batchId, expenses] of byBatch) {
    result.set(batchId, computeBatchCompliance(expenses));
  }
  return result;
}

// ── Display helpers ─────────────────────────────────────────────────

/**
 * Format a batch's period range for display.
 * "2026-04-01" / "2026-04-30" → "APR 1–30, 2026"
 * "2026-03-01" / "2026-03-31" → "MAR 1–31, 2026"
 */
export function formatPeriodRange(
  periodStart: string | null,
  periodEnd: string | null,
): string {
  if (!periodStart) return "—";
  const start = new Date(periodStart + "T00:00:00");
  const end = periodEnd ? new Date(periodEnd + "T00:00:00") : null;

  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const month = MONTHS[start.getMonth()];
  const year = start.getFullYear();
  const startDay = start.getDate();

  if (!end || start.getMonth() === end.getMonth()) {
    const endDay = end ? end.getDate() : startDay;
    return `${month} ${startDay}–${endDay}, ${year}`;
  }

  // Different months
  const endMonth = MONTHS[end.getMonth()];
  return `${month} ${startDay} – ${endMonth} ${end.getDate()}, ${year}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/utils/expense-urgency.ts
git commit -m "feat: add shared expense urgency and compliance helpers"
```

---

## Task 2: Add Quick-Reject Service Method & Hook

**Files:**
- Modify: `src/lib/api/services/expense-approval-service.ts`
- Modify: `src/lib/hooks/use-expense-approval.ts`

The widget's quick-reject is a blanket batch rejection with a single review note — simpler than `rejectWithRevisions` which does per-expense flagging and amendment batch creation.

- [ ] **Step 1: Add `quickRejectBatch` to the service**

Add this method to `ExpenseApprovalService` after the existing `rejectWithRevisions` method (after line ~441 in `expense-approval-service.ts`):

```ts
  /**
   * Quick-reject a batch with a blanket review note.
   * Sets status to rejected, records reviewer and note.
   * Does NOT create amendment batches or flag individual expenses.
   * Used by the dashboard widget for fast "return with a note" flow.
   */
  async quickRejectBatch(
    batchId: string,
    reviewedBy: string,
    reviewNotes: string,
  ): Promise<void> {
    const supabase = requireSupabase();

    const { error } = await supabase
      .from("expense_batches")
      .update({
        status: ExpenseBatchStatus.Rejected,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
      })
      .eq("id", batchId);

    if (error) throw new Error(`Failed to reject batch: ${error.message}`);
  },
```

- [ ] **Step 2: Add `useQuickRejectBatch` hook**

Add after the `useRejectWithRevisions` hook in `use-expense-approval.ts`:

```ts
export function useQuickRejectBatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      batchId,
      reviewedBy,
      reviewNotes,
    }: {
      batchId: string;
      reviewedBy: string;
      reviewNotes: string;
    }) => ExpenseApprovalService.quickRejectBatch(batchId, reviewedBy, reviewNotes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenseBatches.all });
    },
  });
}
```

- [ ] **Step 3: Export from hooks barrel**

In `src/lib/hooks/index.ts`, find the existing expense-approval re-exports and add `useQuickRejectBatch`:

```ts
// In the existing export block from "./use-expense-approval":
  useQuickRejectBatch,
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/services/expense-approval-service.ts src/lib/hooks/use-expense-approval.ts src/lib/hooks/index.ts
git commit -m "feat: add quickRejectBatch service method and hook"
```

---

## Task 3: Add New i18n Keys

**Files:**
- Modify: `src/i18n/dictionaries/en/dashboard.json`
- Modify: `src/i18n/dictionaries/es/dashboard.json`

- [ ] **Step 1: Add EN keys after existing `expenseReview.*` block**

Find the existing `"expenseReview.viewAll": "View All"` line and add these new keys after it (before `"myExpenses.title"`):

```json
  "expenseReview.overdue": "overdue",
  "expenseReview.due": "due",
  "expenseReview.returnedForRevision": "Returned for revision",
  "expenseReview.missingReceipts": "missing receipts",
  "expenseReview.receiptsComplete": "receipts complete",
  "expenseReview.unassigned": "unassigned",
  "expenseReview.rejectNote": "What needs fixing?",
```

Find `"myExpenses.viewAll": "View All"` and add after it (before `"batchPopover.expenses"`):

```json
  "myExpenses.overdueReview": "overdue review",
```

Find `"batchPopover.untitled": "Untitled"` and add after it:

```json
  "batchPopover.haveReceipts": "have receipts",
  "batchPopover.missingReceipts": "missing receipts",
  "batchPopover.due": "DUE",
  "batchPopover.overdue": "OVERDUE",
```

- [ ] **Step 2: Add equivalent ES keys**

After existing `"expenseReview.viewAll": "Ver Todos"`:

```json
  "expenseReview.overdue": "vencido",
  "expenseReview.due": "pendiente",
  "expenseReview.returnedForRevision": "Devuelto para revisión",
  "expenseReview.missingReceipts": "recibos faltantes",
  "expenseReview.receiptsComplete": "recibos completos",
  "expenseReview.unassigned": "sin asignar",
  "expenseReview.rejectNote": "¿Qué necesita corrección?",
```

After `"myExpenses.viewAll": "Ver Todos"`:

```json
  "myExpenses.overdueReview": "revisión vencida",
```

After `"batchPopover.untitled": "Sin título"`:

```json
  "batchPopover.haveReceipts": "tienen recibos",
  "batchPopover.missingReceipts": "recibos faltantes",
  "batchPopover.due": "PENDIENTE",
  "batchPopover.overdue": "VENCIDO",
```

- [ ] **Step 3: Commit**

```bash
git add src/i18n/dictionaries/en/dashboard.json src/i18n/dictionaries/es/dashboard.json
git commit -m "feat(i18n): add expense widget v2 keys (en + es)"
```

---

## Task 4: Rewrite expense-review-widget.tsx

**Files:**
- Rewrite: `src/components/dashboard/widgets/expense-review-widget.tsx`

**Skills:** `interface-design`, `widget-builder`

This is the full rewrite. The widget uses internal hooks — no props changes needed from the dashboard page.

- [ ] **Step 1: Rewrite the file**

Replace entire contents of `src/components/dashboard/widgets/expense-review-widget.tsx` with:

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, X, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetInlineAction } from "./shared/widget-inline-action";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { showWidgetActionToast } from "./shared/widget-action-toast";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import {
  useExpenseBatches,
  useApproveBatch,
  useAllExpenses,
  useQuickRejectBatch,
} from "@/lib/hooks/use-expense-approval";
import { useExpenseSettings } from "@/lib/hooks/use-expense-settings";
import { useTeamMembers } from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { useExpenseBatchPopoverStore } from "@/stores/expense-batch-popover-store";
import { isBatchNeedsReview, type ExpenseBatch } from "@/lib/types/expense-approval";
import {
  computeBatchUrgency,
  computeAllBatchCompliance,
  type BatchUrgency,
  type BatchCompliance,
} from "@/lib/utils/expense-urgency";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ── Urgency color helpers ──
function urgencyDotColor(urgency: BatchUrgency): string | null {
  if (urgency === "due") return WT.warning;
  if (urgency === "overdue") return WT.error;
  return null;
}

// ── Props ──
interface ExpenseReviewWidgetProps {
  size: WidgetSize;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ── Component ──
export function ExpenseReviewWidget({
  size,
  isLoading,
  onNavigate,
}: ExpenseReviewWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const compact = isCompact(size);

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: teamData } = useTeamMembers();
  const { data: allExpensesData } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
  const approveBatch = useApproveBatch();
  const quickReject = useQuickRejectBatch();
  const { currentUser, company } = useAuthStore();

  // Reject UI state — only one open at a time
  const [rejectingBatchId, setRejectingBatchId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Filter to pending batches with urgency
  const pendingBatches = useMemo(() => {
    if (!batchesData) return [];
    return batchesData
      .filter((b) => isBatchNeedsReview(b.status))
      .map((b) => ({
        ...b,
        urgency: computeBatchUrgency(b, reviewFrequency),
      }))
      .sort((a, b) => {
        // overdue first, then due, then fresh — oldest first within each
        const urgencyOrder: Record<BatchUrgency, number> = { overdue: 0, due: 1, fresh: 2 };
        const diff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (diff !== 0) return diff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [batchesData, reviewFrequency]);

  // Compliance map
  const complianceMap = useMemo(() => {
    if (!allExpensesData) return new Map<string, BatchCompliance>();
    return computeAllBatchCompliance(allExpensesData);
  }, [allExpensesData]);

  // Resolve submitter names
  const userNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (teamData?.users) {
      for (const u of teamData.users) {
        map.set(u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id);
      }
    }
    return map;
  }, [teamData]);

  // Totals
  const totalPending = useMemo(
    () => pendingBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0),
    [pendingBatches],
  );
  const overdueCount = useMemo(
    () => pendingBatches.filter((b) => b.urgency === "overdue").length,
    [pendingBatches],
  );

  // ── Actions ──
  const handleInlineApprove = async (batch: ExpenseBatch) => {
    if (!allExpensesData) return;
    const expenseIds = allExpensesData
      .filter((e) => e.batchId === batch.id)
      .map((e) => e.id);

    await approveBatch.mutateAsync({
      batchId: batch.id,
      reviewedBy: currentUser?.id ?? "",
      approvedAmount: batch.totalAmount ?? 0,
      expenseIds,
      submittedBy: batch.submittedBy,
      companyId: batch.companyId ?? company?.id,
      batchNumber: batch.batchNumber,
    });

    showWidgetActionToast({
      label: t("expenseReview.approved") ?? "Batch approved",
      onUndo: () => {},
    });
  };

  const handleQuickReject = async (batchId: string) => {
    if (!rejectNote.trim()) return;
    await quickReject.mutateAsync({
      batchId,
      reviewedBy: currentUser?.id ?? "",
      reviewNotes: rejectNote.trim(),
    });
    showWidgetActionToast({
      label: t("expenseReview.returnedForRevision") ?? "Returned for revision",
      onUndo: () => {},
    });
    setRejectingBatchId(null);
    setRejectNote("");
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <Card className={compact ? (size === "xs" ? "h-full" : "h-full p-0") : "h-full p-0"}>
        <div className={compact ? (size === "xs" ? "p-2" : "p-3") : "p-3"}>
          <WidgetSkeleton variant="list" />
        </div>
      </Card>
    );
  }

  const count = pendingBatches.length;

  // ── XS: Awareness signal ──
  if (size === "xs") {
    return (
      <Card className="h-full" ref={ref}>
        <div
          className="h-full flex flex-col pt-3 cursor-pointer"
          onClick={() => onNavigate("/accounting")}
        >
          <span className={`font-mono ${count.toString().length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
            {count}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseReview.pendingReview") ?? "Pending Review"}
          </span>
          {overdueCount > 0 && (
            <WidgetTrendContext
              variant="health"
              color={WT.error}
              label={`${overdueCount} ${t("expenseReview.overdue") ?? "overdue"}`}
            />
          )}
        </div>
      </Card>
    );
  }

  // ── SM: Awareness signal ──
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div
          className="h-full flex flex-col p-3 cursor-pointer"
          onClick={() => onNavigate("/accounting")}
        >
          <div className="flex items-baseline justify-between">
            <span className={`font-mono text-data-lg font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(totalPending)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/accounting"); }}
              className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("expenseReview.title") ?? "Expense Review"}
          </span>
          {count > 0 ? (
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              {count} {t("expenseReview.batchesPendingCount") ?? "batches"}
              {overdueCount > 0 && (
                <span style={{ color: WT.error }}> · {overdueCount} {t("expenseReview.overdue") ?? "overdue"}</span>
              )}
            </span>
          ) : (
            <span className="font-mohave text-caption-sm text-text-disabled mt-0.5 truncate">
              {t("expenseReview.noBatches") ?? "No batches pending"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG: Triage queue + quick actions ──
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("expenseReview.title") ?? "Expense Review"}
          </span>
        </div>

        {/* Hero */}
        <div className="mb-2">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-display font-bold leading-none ${count > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(totalPending)}
            </span>
            {count > 0 && (
              <span className="font-mono text-micro-sm text-text-disabled">
                {count} {t("expenseReview.batchesPendingCount") ?? "batches"}
              </span>
            )}
          </div>
        </div>

        {/* Detail zone */}
        {showDetail(size) && (
          count > 0 ? (
            <ScrollFade className="mt-1">
              {pendingBatches.map((batch, i) => {
                const submitterName = userNameMap.get(batch.submittedBy ?? "") ?? "";
                const dotColor = urgencyDotColor(batch.urgency);
                const compliance = complianceMap.get(batch.id);
                const missingReceipts = compliance?.receiptsMissing ?? 0;
                const totalExpenses = compliance?.receiptsTotal ?? 0;

                // Build secondary text
                let secondary = batch.batchNumber;
                if (requireReceipt && missingReceipts > 0) {
                  secondary += ` · ${missingReceipts}/${totalExpenses} ${t("expenseReview.missingReceipts") ?? "missing receipts"}`;
                }

                return (
                  <div key={batch.id}>
                    <WidgetLineItem
                      indicator={
                        dotColor
                          ? { type: "dot", color: dotColor }
                          : { type: "avatar", color: WT.accent, initials: submitterName.slice(0, 2).toUpperCase() }
                      }
                      primary={submitterName || batch.batchNumber}
                      secondary={secondary}
                      metric={formatCompactCurrency(batch.totalAmount ?? 0)}
                      onClick={(e) => {
                        if (e) {
                          openBatchPopover(
                            batch.id,
                            { x: e.clientX, y: e.clientY },
                            batch.batchNumber,
                            dotColor ?? WT.accent,
                          );
                        }
                      }}
                      action={
                        <div className="flex items-center gap-0.5">
                          <WidgetInlineAction
                            icon={Check}
                            label={t("expenseReview.approve") ?? "Approve"}
                            onAction={() => handleInlineApprove(batch)}
                          />
                          <WidgetInlineAction
                            icon={X}
                            label="Reject"
                            onAction={() => {
                              setRejectingBatchId(rejectingBatchId === batch.id ? null : batch.id);
                              setRejectNote("");
                            }}
                          />
                        </div>
                      }
                      index={i}
                      isVisible={isVisible}
                      reducedMotion={reducedMotion}
                    />

                    {/* Inline reject note input */}
                    {rejectingBatchId === batch.id && (
                      <div
                        className="flex items-center gap-1 px-1 py-1 ml-6"
                        style={{
                          animation: reducedMotion ? "none" : "slideDown 150ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      >
                        <input
                          type="text"
                          value={rejectNote}
                          onChange={(e) => setRejectNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && rejectNote.trim()) handleQuickReject(batch.id);
                            if (e.key === "Escape") { setRejectingBatchId(null); setRejectNote(""); }
                          }}
                          placeholder={t("expenseReview.rejectNote") ?? "What needs fixing?"}
                          className="flex-1 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-[2px] px-2 py-1 font-mohave text-[11px] text-text-primary placeholder:text-text-disabled outline-none focus:border-ops-accent transition-colors"
                          autoFocus
                        />
                        <button
                          onClick={() => handleQuickReject(batch.id)}
                          disabled={!rejectNote.trim() || quickReject.isPending}
                          className="w-5 h-5 flex items-center justify-center rounded-[2px] text-text-disabled hover:text-ops-accent disabled:opacity-30 transition-colors"
                        >
                          <Send className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </ScrollFade>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <WidgetEmptyState
                icon={Check}
                message={t("expenseReview.allCaughtUp") ?? "All caught up"}
              />
            </div>
          )
        )}

        {/* Footer */}
        <button
          onClick={() => onNavigate("/accounting")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("expenseReview.viewAll") ?? "View All"}
        </button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
cd OPS-Web && npx tsc --noEmit --pretty 2>&1 | grep "expense-review-widget" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/expense-review-widget.tsx
git commit -m "feat: rewrite expense-review widget v2 — urgency, compliance, inline approve/reject"
```

---

## Task 5: Rewrite my-expenses-widget.tsx

**Files:**
- Rewrite: `src/components/dashboard/widgets/my-expenses-widget.tsx`

- [ ] **Step 1: Rewrite the file**

Replace entire contents of `src/components/dashboard/widgets/my-expenses-widget.tsx` with:

```tsx
"use client";

import { useMemo, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { WidgetSkeleton } from "./shared/widget-skeleton";
import { WidgetLineItem } from "./shared/widget-line-item";
import { WidgetEmptyState } from "./shared/widget-empty-state";
import { WidgetTrendContext } from "./shared/widget-trend-context";
import { ScrollFade } from "./shared/scroll-fade";
import { useWidgetIntersection } from "./shared/use-widget-intersection";
import { useReducedMotion } from "./shared/use-reduced-motion";
import { formatCompactCurrency } from "./shared/widget-utils";
import { WT, HERO_SIZE_CLASS, isCompact, showDetail, showActions } from "@/lib/widget-tokens";
import { useExpenseBatches } from "@/lib/hooks/use-expense-approval";
import { useExpenseSettings } from "@/lib/hooks/use-expense-settings";
import { useAllExpenses } from "@/lib/hooks/use-expense-approval";
import { useAuthStore } from "@/lib/store/auth-store";
import { useExpenseBatchPopoverStore } from "@/stores/expense-batch-popover-store";
import {
  isBatchNeedsReview,
  isBatchApproved,
  ExpenseBatchStatus,
  formatPeriodDisplay,
  periodKeyFromBatch,
  type ExpenseBatch,
} from "@/lib/types/expense-approval";
import {
  computeSubmitterUrgency,
  computeAllBatchCompliance,
  type BatchCompliance,
} from "@/lib/utils/expense-urgency";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ── Status helpers ──
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

function getBadgeClasses(status: ExpenseBatchStatus): string {
  switch (status) {
    case ExpenseBatchStatus.Approved:
    case ExpenseBatchStatus.AutoApproved:
      return "text-status-success bg-status-success/15 border-status-success/30";
    case ExpenseBatchStatus.PendingReview:
    case ExpenseBatchStatus.Submitted:
      return "text-ops-accent bg-ops-accent/15 border-ops-accent/30";
    case ExpenseBatchStatus.PartiallyApproved:
      return "text-ops-amber bg-ops-amber/15 border-ops-amber/30";
    case ExpenseBatchStatus.Rejected:
      return "text-ops-error bg-ops-error/15 border-ops-error/30";
    default:
      return "text-text-disabled bg-text-disabled/15 border-text-disabled/30";
  }
}

// ── Period filter ──
function isInPeriod(batch: ExpenseBatch, period: string): boolean {
  const now = new Date();
  const created = new Date(batch.createdAt);
  switch (period) {
    case "last-month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return created >= start && created <= end;
    }
    case "ytd":
      return created >= new Date(now.getFullYear(), 0, 1) && created <= now;
    case "this-month":
    default:
      return created >= new Date(now.getFullYear(), now.getMonth(), 1) && created <= now;
  }
}

// ── Props ──
interface MyExpensesWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
  isLoading: boolean;
  onNavigate: (path: string) => void;
}

// ── Component ──
export function MyExpensesWidget({
  size,
  config,
  isLoading,
  onNavigate,
}: MyExpensesWidgetProps) {
  const { t } = useDictionary("dashboard");
  const ref = useRef<HTMLDivElement>(null);
  const isVisible = useWidgetIntersection(ref);
  const reducedMotion = useReducedMotion();
  const compact = isCompact(size);

  // Data
  const { data: batchesData } = useExpenseBatches();
  const { data: allExpensesData } = useAllExpenses();
  const { data: settings } = useExpenseSettings();
  const { currentUser } = useAuthStore();
  const openBatchPopover = useExpenseBatchPopoverStore((s) => s.openPopover);
  const period = (config.period as string) ?? "this-month";

  const reviewFrequency = settings?.reviewFrequency ?? "weekly";
  const requireReceipt = settings?.requireReceiptPhoto ?? false;

  // Compliance map
  const complianceMap = useMemo(() => {
    if (!allExpensesData) return new Map<string, BatchCompliance>();
    return computeAllBatchCompliance(allExpensesData);
  }, [allExpensesData]);

  // Filter to current user's batches within period
  const myBatches = useMemo(() => {
    if (!batchesData || !currentUser) return [];
    return batchesData
      .filter((b) => b.submittedBy === currentUser.id)
      .filter((b) => isInPeriod(b, period))
      .sort((a, b) => {
        // Revision-needed first, then pending, then approved
        const statusOrder = (s: ExpenseBatchStatus) => {
          if (s === ExpenseBatchStatus.Rejected || s === ExpenseBatchStatus.PartiallyApproved) return 0;
          if (isBatchNeedsReview(s)) return 1;
          return 2;
        };
        const diff = statusOrder(a.status) - statusOrder(b.status);
        if (diff !== 0) return diff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [batchesData, currentUser, period]);

  // Stats
  const stats = useMemo(() => {
    const total = myBatches.reduce((s, b) => s + (b.totalAmount ?? 0), 0);
    const approved = myBatches.filter((b) => isBatchApproved(b.status)).length;
    const pending = myBatches.filter((b) => isBatchNeedsReview(b.status)).length;
    const revision = myBatches.filter((b) =>
      b.status === ExpenseBatchStatus.Rejected || b.status === ExpenseBatchStatus.PartiallyApproved
    ).length;
    return { total, approved, pending, revision };
  }, [myBatches]);

  // ── Loading ──
  if (isLoading) {
    return (
      <Card className={compact ? (size === "xs" ? "h-full" : "h-full p-0") : "h-full p-0"}>
        <div className={compact ? (size === "xs" ? "p-2" : "p-3") : "p-3"}>
          <WidgetSkeleton variant="list" />
        </div>
      </Card>
    );
  }

  const batchCount = myBatches.length;

  // ── XS ──
  if (size === "xs") {
    const heroVal = stats.revision > 0 ? stats.revision : stats.pending;
    return (
      <Card className="h-full" ref={ref}>
        <div className="h-full flex flex-col pt-3 cursor-pointer" onClick={() => onNavigate("/accounting")}>
          <span className={`font-mono ${heroVal.toString().length > 4 ? "text-data-lg" : "text-display"} font-bold leading-none ${heroVal > 0 ? "text-text-primary" : "text-text-disabled"}`}>
            {heroVal}
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
          {stats.revision > 0 && (
            <WidgetTrendContext variant="health" color={WT.warning} label={`${stats.revision} ${t("myExpenses.needsRevision") ?? "need revision"}`} />
          )}
        </div>
      </Card>
    );
  }

  // ── SM ──
  if (size === "sm") {
    return (
      <Card className="h-full p-0" ref={ref}>
        <div className="h-full flex flex-col p-3 cursor-pointer" onClick={() => onNavigate("/accounting")}>
          <div className="flex items-baseline justify-between">
            <span className={`font-mono text-data-lg font-bold leading-none ${batchCount > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(stats.total)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate("/accounting"); }}
              className="p-0.5 rounded-sm text-text-disabled hover:text-text-secondary hover:bg-[rgba(255,255,255,0.08)] transition-colors"
            >
              <ArrowUpRight className="w-[14px] h-[14px]" />
            </button>
          </div>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
          {stats.revision > 0 ? (
            <span className="font-mohave text-caption-sm mt-0.5 truncate" style={{ color: WT.warning }}>
              {stats.revision} {t("myExpenses.needsRevision") ?? "need revision"}
            </span>
          ) : batchCount > 0 ? (
            <span className="font-mohave text-caption-sm text-text-secondary mt-0.5 truncate">
              {stats.approved} {t("myExpenses.approved") ?? "approved"} · {stats.pending} {t("myExpenses.pending") ?? "pending"}
            </span>
          ) : (
            <span className="font-mohave text-caption-sm text-text-disabled mt-0.5 truncate">
              {t("myExpenses.noExpenses") ?? "No expenses submitted"}
            </span>
          )}
        </div>
      </Card>
    );
  }

  // ── MD / LG ──
  return (
    <Card className="h-full p-0" ref={ref}>
      <div className="h-full flex flex-col p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">
            {t("myExpenses.title") ?? "My Expenses"}
          </span>
        </div>

        {/* Hero */}
        <div className="mb-2">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-display font-bold leading-none ${batchCount > 0 ? "text-text-primary" : "text-text-disabled"}`}>
              {formatCompactCurrency(stats.total)}
            </span>
            {batchCount > 0 && (
              <span className="font-mono text-micro-sm text-text-disabled">
                {batchCount} {batchCount === 1 ? "batch" : "batches"}
              </span>
            )}
          </div>
        </div>

        {/* Detail zone */}
        {showDetail(size) && (
          batchCount > 0 ? (
            <ScrollFade className="mt-1">
              {myBatches.map((batch, i) => {
                const statusColor = getBatchStatusColor(batch.status);
                const statusLabel = getBatchStatusLabel(batch.status);
                const badgeClasses = getBadgeClasses(batch.status);
                const periodDisplay = formatPeriodDisplay(periodKeyFromBatch(batch));
                const isRevision = batch.status === ExpenseBatchStatus.Rejected || batch.status === ExpenseBatchStatus.PartiallyApproved;
                const overdueReview = computeSubmitterUrgency(batch, reviewFrequency);
                const compliance = complianceMap.get(batch.id);
                const missingReceipts = compliance?.receiptsMissing ?? 0;
                const totalExpenses = compliance?.receiptsTotal ?? 0;

                // Build secondary text
                let secondary = periodDisplay;
                if (isRevision && showActions(size) && batch.reviewNotes) {
                  secondary += ` · ${batch.reviewNotes}`;
                } else if (requireReceipt && missingReceipts > 0) {
                  secondary += ` · ${missingReceipts}/${totalExpenses} ${t("expenseReview.missingReceipts") ?? "missing receipts"}`;
                }
                if (overdueReview) {
                  secondary += ` · ${t("myExpenses.overdueReview") ?? "overdue review"}`;
                }

                return (
                  <WidgetLineItem
                    key={batch.id}
                    indicator={{
                      type: "bar",
                      color: statusColor,
                      label: statusLabel,
                    }}
                    primary={batch.batchNumber}
                    secondary={secondary}
                    metric={
                      <span className="flex items-center gap-1">
                        <span
                          className={`font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap ${badgeClasses}`}
                          style={{ fontSize: "9px", lineHeight: "1.3" }}
                        >
                          {statusLabel}
                        </span>
                        <span className="font-mono text-micro-sm text-text-secondary">
                          {formatCompactCurrency(batch.totalAmount ?? 0)}
                        </span>
                      </span>
                    }
                    onClick={(e) => {
                      if (e) {
                        openBatchPopover(batch.id, { x: e.clientX, y: e.clientY }, batch.batchNumber, statusColor);
                      }
                    }}
                    index={i}
                    isVisible={isVisible}
                    reducedMotion={reducedMotion}
                  />
                );
              })}
            </ScrollFade>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <WidgetEmptyState message={t("myExpenses.noExpensesPeriod") ?? "No expenses submitted this period"} />
            </div>
          )
        )}

        {/* Action zone — LG summary strip */}
        {showActions(size) && batchCount > 0 && (
          <div className="mt-2 pt-2 border-t border-border-subtle shrink-0 flex items-center gap-2">
            <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-status-success bg-status-success/15 border-status-success/30" style={{ fontSize: "9px", lineHeight: "1.3" }}>
              {stats.approved} {t("myExpenses.approved") ?? "approved"}
            </span>
            <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-ops-accent bg-ops-accent/15 border-ops-accent/30" style={{ fontSize: "9px", lineHeight: "1.3" }}>
              {stats.pending} {t("myExpenses.pending") ?? "pending"}
            </span>
            {stats.revision > 0 && (
              <span className="font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap text-ops-amber bg-ops-amber/15 border-ops-amber/30" style={{ fontSize: "9px", lineHeight: "1.3" }}>
                {stats.revision} {t("myExpenses.needsRevision") ?? "need revision"}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <button
          onClick={() => onNavigate("/accounting")}
          className="mt-auto pt-2 font-kosugi text-micro text-text-tertiary uppercase tracking-wider hover:text-text-secondary transition-colors text-left"
        >
          {t("myExpenses.viewAll") ?? "View All"}
        </button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit --pretty 2>&1 | grep "my-expenses-widget" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/widgets/my-expenses-widget.tsx
git commit -m "feat: rewrite my-expenses widget v2 — submitter urgency, compliance self-check"
```

---

## Task 6: Rewrite expense-batch-popover.tsx

**Files:**
- Rewrite: `src/components/ops/expense-batch-popover.tsx`

This is the largest task. Adds urgency badge in title bar, receipt compliance bar in info strip, receipt thumbnails per expense row, and uses `ReceiptLightbox` for full-image viewing.

- [ ] **Step 1: Rewrite the file**

Replace entire contents of `src/components/ops/expense-batch-popover.tsx`. The full code is large — key changes from v1:

1. **New imports**: `useExpenseSettings`, `computeBatchUrgency`, `computeBatchCompliance`, `formatPeriodRange`, `ReceiptLightbox` from `@/components/expenses/receipt-lightbox`
2. **Title bar**: Add urgency badge (amber "DUE" or red "OVERDUE") next to batch number when `urgency !== "fresh"`
3. **Info strip row 3**: Receipt compliance bar — `4px` progress bar + `"3/5 have receipts"` label. Only shown when `settings?.requireReceiptPhoto` is true.
4. **Expense row**: Add 40×50px receipt thumbnail before text content. If `receiptImageUrl` exists, render `<img>` with `object-cover rounded-[2px]`. If missing and `requireReceiptPhoto`, render dashed border placeholder with warning-color camera icon. Click opens `ReceiptLightbox`.
5. **Period display in info strip**: Use `formatPeriodRange(batch.periodStart, batch.periodEnd)` instead of the old `formatPeriodDisplay(periodKeyFromBatch(batch))`.
6. **Lightbox state**: Add `const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)` and render `{lightboxUrl && <ReceiptLightbox imageUrl={lightboxUrl} onClose={() => setLightboxUrl(null)} />}` at the bottom of the instance component (inside the `motion.div`).

All other behavior (drag, resize, minimize, tabs, flag toggles, approve/reject actions) stays the same as v1.

The full implementation follows the exact same structure as v1 (`ExpenseRow`, `SummaryTab`, `ExpenseBatchPopoverInstance`, `ExpenseBatchPopover`) with these additions woven in. The engineer should read v1 as the baseline and apply the 6 changes above.

Key code for the urgency badge in title bar (after the batch number span):

```tsx
{urgency !== "fresh" && (
  <span
    className={`font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap ${
      urgency === "overdue"
        ? "text-ops-error bg-ops-error/15 border-ops-error/30"
        : "text-ops-amber bg-ops-amber/15 border-ops-amber/30"
    }`}
    style={{ fontSize: "9px", lineHeight: "1.3" }}
  >
    {urgency === "overdue"
      ? (t("batchPopover.overdue") ?? "OVERDUE")
      : (t("batchPopover.due") ?? "DUE")}
  </span>
)}
```

Key code for receipt thumbnail in ExpenseRow:

```tsx
{/* Receipt thumbnail — before text content */}
<div
  className="shrink-0 w-[40px] h-[50px] rounded-[2px] overflow-hidden cursor-pointer"
  onClick={(e) => {
    e.stopPropagation();
    if (expense.receiptImageUrl) onReceiptClick(expense.receiptImageUrl);
  }}
>
  {expense.receiptImageUrl ? (
    <img
      src={expense.receiptImageUrl}
      alt="Receipt"
      className="w-full h-full object-cover"
      loading="lazy"
    />
  ) : requireReceipt ? (
    <div
      className="w-full h-full flex items-center justify-center border border-dashed rounded-[2px]"
      style={{ borderColor: WT.warning }}
    >
      <Camera className="w-4 h-4" style={{ color: WT.warning }} />
    </div>
  ) : null}
</div>
```

Key code for receipt compliance bar in info strip:

```tsx
{/* Row 3: Receipt compliance — only when requireReceiptPhoto */}
{requireReceipt && compliance && (
  <div className="flex items-center gap-1.5">
    <div className="flex-1 h-[4px] rounded-sm" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
      <div
        className="h-full rounded-sm"
        style={{
          width: compliance.receiptsTotal > 0
            ? `${((compliance.receiptsTotal - compliance.receiptsMissing) / compliance.receiptsTotal) * 100}%`
            : "0%",
          backgroundColor: compliance.receiptsMissing > 0 ? WT.warning : WT.success,
          transition: "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
    <span
      className="font-kosugi text-[10px] shrink-0"
      style={{ color: compliance.receiptsMissing > 0 ? WT.warning : WT.success }}
    >
      {compliance.receiptsTotal - compliance.receiptsMissing}/{compliance.receiptsTotal} {t("batchPopover.haveReceipts") ?? "have receipts"}
    </span>
  </div>
)}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit --pretty 2>&1 | grep "expense-batch-popover" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ops/expense-batch-popover.tsx
git commit -m "feat: rewrite expense batch popover v2 — urgency badge, receipt thumbnails, compliance bar"
```

---

## Task 7: Update Widget Preview + Dashboard Wiring

**Files:**
- Modify: `src/components/dashboard/widget-preview.tsx`
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (if needed)

- [ ] **Step 1: Verify widget preview cases are correct**

The preview cases from v1 should still work since the props interfaces haven't changed. `ExpenseReviewWidget` still accepts `{ size, isLoading, onNavigate }` and `MyExpensesWidget` still accepts `{ size, config, isLoading, onNavigate }`. Verify no changes needed.

- [ ] **Step 2: Verify dashboard page wiring is correct**

The dashboard page's `renderWidgetContent()` cases from v1 should still work:
- `case "expense-review"`: passes `size`, `isLoading={batchesLoading}`, `onNavigate={navigate}` — still correct
- `case "my-expenses"`: passes `size`, `config`, `isLoading={batchesLoading}`, `onNavigate={navigate}` — still correct

Both widgets now call `useExpenseSettings()` internally, so no new props needed from the dashboard page.

- [ ] **Step 3: Run full type check**

```bash
npx tsc --noEmit --pretty 2>&1 | grep "error TS" | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit (only if changes were needed)**

```bash
git add -A && git commit -m "fix: update widget preview and dashboard wiring for expense widgets v2"
```

---

## Task 8: Final Type Check + Audit

- [ ] **Step 1: Run full type check**

```bash
cd OPS-Web && npx tsc --noEmit --pretty 2>&1 | tail -5
```

Expected: 3 pre-existing errors in shop admin, zero in new/modified files.

- [ ] **Step 2: Run 10-point widget audit on both widgets**

For both `expense-review-widget.tsx` and `my-expenses-widget.tsx`:

1. **Colors** — Zero hardcoded hex. All WT.* or Tailwind.
2. **Typography** — kosugi headers, mono heroes, mohave body.
3. **Anatomy** — Hero-first XS/SM, standard zones MD+.
4. **Content budget** — XS/SM glanceable in 2 seconds.
5. **Overflow** — ScrollFade wraps detail zone.
6. **Tooltips** — N/A (no hover data details).
7. **Navigation** — XS/SM tap → /accounting, icon at SM, text footer at MD+.
8. **Loading** — WidgetSkeleton at every size.
9. **Empty state** — Per-size empty states.
10. **Reduced motion** — useReducedMotion() on all transitions.

- [ ] **Step 3: Fix any violations found and commit**

```bash
git add -A && git commit -m "audit: pass 10-point widget checklist for expense widgets v2"
```
