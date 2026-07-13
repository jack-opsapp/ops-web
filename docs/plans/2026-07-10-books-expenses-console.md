# Books › Expenses Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute directly with full context) task-by-task.

**Goal:** Rebuild the Books › Expenses tab from a period-fragmented "invoice" list into a batch-first review console: lifecycle segments (TO REVIEW / TO PAY / PAID / WITH CREW), person-grouped queue, spend metrics header, bulk + per-batch actions, and a new mark-paid capability.

**Architecture:** Master-detail split retained. All list/metric derivation happens in pure modules (`batch-buckets.ts`, `expense-metrics.ts`) computed from the two existing queries (`useExpenseBatches`, `useAllExpenses`) so the metrics and the queue can never disagree. Paid-out is a new server capability: two nullable columns on `expense_batches` + two SECURITY DEFINER RPCs (mirror of `approve_expense_batch`), flipping lines `approved ↔ reimbursed` — iOS already renders `reimbursed` as "paid," so the change is additive and cross-release safe (iOS DTOs decode status as plain String; verified).

**Tech Stack:** Next.js 15 App Router, Tailwind (OPS tokens), TanStack Query, Supabase (Postgres + RPC + Realtime), framer-motion (existing variants only), vitest.

**Design System:** `.interface-design/system.md` (ops-web) + `ops-design-system/project/DESIGN.md`. Zero hardcoded hex in components — status colors move to a token-traceable map in the types layer consumed as Tailwind classes.

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design`, `ops-copywriter` (loaded), `custom-skills:audit-design-system` (final gate).

---

## Why (the two jobs)

1. **Macro spend awareness** — "how much are we spending on job expenses?" Today: one microline (period total). Ship: MetricsHeader (full variant, existing system) with SPEND · THIS MONTH (6-mo sparkline, MoM trend, jobs/overhead breakdown), TO REVIEW ($ + count), TO PAY ($ approved-unpaid incl. auto-approved), PAID · THIS MONTH.
2. **Batch review flow** — reviewer walks each team member's batches, sees lifecycle at a glance, approves in bulk or one line at a time, flags with comments, finds unsubmitted work without it cluttering the queue. Today: month pills fragment the queue (a pending May batch is invisible when June is selected — real defect), flat unsorted card pile, "invoice" terminology collision with AR invoices one tab over, no paid state, no bulk approve.

## Lifecycle buckets (complete, mutually exclusive)

| Segment | Contents | Row actions |
|---|---|---|
| TO REVIEW | `pending_review`, `submitted` (legacy) — cross-period | hover APPROVE (unflagged), open detail → APPROVE ALL / REJECT WITH REVISIONS |
| TO PAY | `approved`, `partially_approved`, `auto_approved` with `paid_at IS NULL` | hover MARK PAID; bulk PAY ALL |
| PAID | `paid_at IS NOT NULL` | none (reference; UNDO via detail) |
| WITH CREW | `open` (filling) + `rejected` with ≥1 remaining line | none (peek; early-clear per line in detail) |

Rejected batches drain as crew re-submits lines (lines re-file into open envelopes); an emptied rejected batch disappears. Amounts: TO PAY shows `approved_amount ?? total_amount`.

Grouping: TO REVIEW + TO PAY group by person (header: avatar, name, n batches · $total, hover group action). TO REVIEW people sort by oldest pending period; TO PAY people by owed desc. PAID: chronological by `paid_at` desc with month subheads. WITH CREW: FILLING section (auto-send date from `period_end + auto_submit_grace_days`), then RETURNED.

Terminology: user-facing noun is **batch**. "Invoice" is banned on this tab (collides with AR invoices on the sibling tab). `batch_number` stays as mono metadata.

## Task list

### Task 1 — Plan doc (this file) → commit
### Task 2 — Migration + RPCs (applied to prod via MCP; additive)
- `alter table expense_batches add column paid_at timestamptz, add column paid_by uuid;`
- `mark_expense_batch_paid(p_batch_id)` / `unmark_expense_batch_paid(p_batch_id)`: SECURITY DEFINER, `set search_path public, pg_temp`, caller = `private.get_current_user_id()`, gate `has_permission(uid,'expenses.approve','all')`; mark requires status ∈ (approved, partially_approved, auto_approved) and `paid_at is null` → stamp + lines `approved→reimbursed`; unmark reverses (`reimbursed→approved`, null stamps). Both recalc via existing `recalculate_expense_batch_total`.
- File: `supabase/migrations/20260710_expense_batch_paid.sql` + copy to `ops-software-bible/migrations/`.
- Verify: sentinel mark/unmark on a demo-company batch via SQL; assert line statuses flip and stamps set/cleared.
### Task 3 — Data layer
- `types/expense-approval.ts`: `paidAt/paidBy` on ExpenseBatch; `receiptMissingReason/projectMissingReason/projectName` on ExpenseLineItem; bucket enum + helpers (`batchBucket(batch, liveLineCount)`); status display/color maps keyed to Tailwind token classes (no hex in components).
- `expense-approval-service.ts`: map new columns; `markBatchPaid` / `unmarkBatchPaid` (RPC calls); `fetchBatchExpenses` merges project names (collect allocation ids → one `projects` id/title query).
- `use-expense-approval.ts`: `useMarkBatchPaid` / `useUnmarkBatchPaid` (invalidate namespace; dispatch `expense_paid` to submitter), keep all existing hooks.
- `notification-dispatch.ts`: `dispatchExpensePaid` (eventType `expense_paid` — iOS default-cases verified safe; actionUrl `/expenses`).
- New `use-expense-realtime.ts`: postgres_changes on `expense_batches` + `expenses` filtered by company → invalidate `expenseBatches` namespace (pattern: calendar page channel).
### Task 4 — Pure logic + tests (TDD)
- `src/lib/utils/expense-buckets.ts`: bucketing, person grouping, sorts, flag counts, line counts (from allExpenses), deep-link bucket resolution.
- `src/lib/utils/expense-metrics.ts`: 4 `MetricColumnConfig`s from (batches, expenses, now): month sums by `expense_date` (spend = submitted+approved+reimbursed), MoM trend (down = positive sentiment), 6-mo sparkline, jobs/overhead breakdown, TO REVIEW / TO PAY / PAID MTD from buckets + `paid_at`.
- `tests/unit/expenses/expense-buckets.test.ts`, `expense-metrics.test.ts` — write failing, implement, green: `npx vitest run tests/unit/expenses`.
### Task 5 — UI rebuild
- Rebuild `expense-review-dashboard.tsx` (orchestrator: metrics header, workbar segments + bulk CTA, split panel, keyboard nav, deep-link).
- New `batch-list.tsx` (grouped sections, person headers, compact rows, hover actions, empty states per segment), `batch-detail-panel.tsx` (identity header + lifecycle stamps, line table w/ expand: project name, receipt-missing reason, flag/comment, early-clear; footer state machine APPROVE ALL+REJECT / MARK PAID / PAID stamp+UNDO / filling auto-send note), `bulk-action-modal.tsx` (glass-dense; per-person summary; flagged batches skipped with notice; sequential mutations with progress; partial-failure report).
- Keep `receipt-lightbox.tsx`; keep `reject-confirmation-modal.tsx` with i18n + "batch" terminology pass. Delete `invoice-card.tsx`, `expense-filters.tsx`, `invoice-detail-panel.tsx`, `expense-line-item-table.tsx` (importers verified: only within this tab).
- i18n: replace/extend `expenses.*` in `src/i18n/dictionaries/{en,es}/accounting.json`; every string through `useDictionary("accounting")`.
- Workbar controls on the 28px compact tier (segments: mono 11px uppercase 0.12em). Motion: existing variants + 150ms hovers, `EASE_SMOOTH`, reduced-motion respected. Numbers mono tnum. Empty state per MD+ pattern.
### Task 6 — Verify in preview
- `npm run dev:webpack` in worktree via preview tools; DEV_BYPASS_AUTH demo login (approver); exercise: all four segments, person grouping, approve one batch, bulk modal, mark paid, undo, deep-link `?tab=expenses&batch=…`, empty states, es locale spot check. Screenshots → `docs/artifacts/books-expenses-console/`.
- `npx tsc --noEmit`, `npx vitest run`, targeted lint on touched files.
### Task 7 — Audit + docs + land
- `custom-skills:audit-design-system` pass (zero hardcoded values in new code).
- Bible: `09_FINANCIAL_SYSTEM.md` — replace OPS-Web review-hub paragraph, add paid lifecycle + RPC table rows; note new notification event.
- Atomic commits per task on `feat/books-expenses-console`; merge to local `main` (no push — Jackson's call).
