# Recurring Reimbursements — OPS-Web Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Let an approver see, add, change, skip, end and delete recurring reimbursements (a fixed monthly amount paid to a crew member with their expenses) from the Books expense console and from Settings → Expenses.

**Architecture:** The database vertical is live (migration `20260917030000_expense_recurring_reimbursements.sql`, ledger `20260917023953`). Lines are ordinary `expenses` rows carrying `recurring_reimbursement_id` + `recurring_period`; setups live in `expense_recurring_reimbursements` (RLS read: office all, crew own). Every write goes through six SECURITY DEFINER RPCs (`create_/update_/end_/delete_expense_recurring_reimbursement`, `skip_/restore_expense_recurring_reimbursement_line`). The web adds a thin service + TanStack hooks, pure presentation helpers (unit-tested), recurring-aware line rendering inside the existing batch detail panel, one editor dialog, and a Settings list. No new routes.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind tokens, TanStack Query, Supabase JS (untyped client), Radix Dialog/Select, lucide-react, vitest.

**Design System:** `.interface-design/system.md` (web), `ops-design-system/project/DESIGN.md` (canonical).

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system` (before done). Motion is limited to the existing dialog enter/exit (150ms, EASE_SMOOTH, reduced-motion fallback) — no new animation.

---

## Presentation decisions (reasoned from the operator's situation)

- **Where the thing lives.** The operator thinks about a recurring amount while looking at a person's money — the batch detail panel. Setup is rare; it never owns prime space. So: the line itself carries the signal, the verbs live behind the line (expanded record), and the only permanent entry point is one quiet text action at the foot of the line table. Settings → Expenses holds the one place to see every arrangement at once (rare use, full overview).
- **The line row (scan surface).** Identical grid to receipts. The receipt cell shows a neutral repeat glyph (not tan — nothing is wrong, nothing is missing). No new pill: the status column still says APPROVED / PAID, which is the truth the operator scans for.
- **The expanded record.** Replaces the tan NO RECEIPT block with a neutral `RECURRING` block: `{amount} every month · since {MON YYYY}` (+ `last month {MON YYYY}` when ended). Approver verbs: `EDIT` (dialog) and `SKIP {MON}` (only while unpaid; toast carries UNDO → restore). Flag, flag comment and CLEAR are never shown on a recurring line (the database refuses them anyway).
- **Create defaults.** Opened from a batch: person fixed to that batch's submitter, first month = the batch's period month (Jackson's exact case: from August's batch it starts in August). Opened from Settings: person picker, first month = this month.
- **Tell the truth before commit.** The create dialog states exactly what will happen now: which months get filed immediately, and which of those were already paid out and therefore land on the next batch. Edit states: unpaid months follow the change; paid months stay as paid.
- **State-aware destructive actions.** `DELETE` appears only when no month has been paid (a setup made in error). Otherwise `END` with a last-month picker whose floor is the latest filed month; `REMOVE END` when an end is set. Delete requires an explicit second confirmation in the dialog footer (`DESTRUCTIVE. NO UNDO.` register).
- **Money** renders en-US with the setup's ISO code (`CA$350.00`) per the Money Rendering Canon; mono, tabular, slashed zero.

## Tasks

### Task 1: Pure helpers (TDD)

**Files:** Create `src/lib/utils/expense-recurring.ts`, test `tests/unit/expenses/expense-recurring.test.ts`.

Functions:
- `monthStart(iso: string): string` → `YYYY-MM-01`.
- `addMonths(period: string, n: number): string`.
- `monthsBetween(first: string, last: string): string[]` (inclusive).
- `monthOptions(current: string, back = 12, ahead = 12): string[]`.
- `formatRecurringMonth(period: string): string` → `AUG 2026` (fixed English uppercase abbreviations, locale-independent like `formatPeriodDisplay`).
- `formatRecurringMoney(amount: number, currency: string): string` → `Intl.NumberFormat("en-US", { style: "currency", currency })`.
- `placementPreview({ firstPeriod, currentMonth, personBatches })` → `{ filedNow: string[]; paidOut: string[]; startsLater: boolean }`. A month is paid out when a scope-null, amendment-0 batch of that person covers the month's first day, is approved/partially/auto and has `paidAt`, and no unpaid/open/review batch covers it.
- `recurringErrorKey(message: string | undefined): string` — maps server messages to dictionary keys (`duplicate`, `changed`, `busy`, `permission`, `self`, `paid`, `endBefore`, `invalid`, fallback `failed`).
- `canDeleteRecurring(lines)` / `latestFiledPeriod(lines)` over the RPC `lines` payload.

Steps: write failing tests (every function, boundary months across year ends, paid vs. owed placement, message mapping) → run `npx vitest run tests/unit/expenses/expense-recurring.test.ts` (FAIL) → implement → PASS → commit `feat(expenses): recurring reimbursement presentation helpers`.

### Task 2: Types, service, query keys, hooks, realtime

**Files:**
- Modify `src/lib/types/expense-approval.ts`: `ExpenseLineItem.recurringReimbursementId: string | null`, `recurringPeriod: string | null`; new `ExpenseRecurringReimbursement` (+ `lines: RecurringLineSummary[]` optional) and `isRecurringLine`.
- Modify `src/lib/api/services/expense-approval-service.ts` (`mapExpenseFromDb`).
- Create `src/lib/api/services/expense-recurring-reimbursement-service.ts`: `fetchCompany(companyId)` (live setups, newest first, plus their lines' period/status for delete/end guards, plus person names), `create`, `update`, `end`, `remove`, `skipLine`, `restoreLine` (RPC wrappers that throw `Error(message)` preserving the server message).
- Modify `src/lib/api/query-client.ts`: `expenseBatches.recurring(companyId)` under the `expenseBatches` namespace so every existing expense invalidation refreshes it.
- Create `src/lib/hooks/use-expense-recurring-reimbursements.ts`; export from `src/lib/hooks/index.ts`.
- Modify `src/lib/hooks/use-expense-realtime.ts`: also subscribe `expense_recurring_reimbursements` (filter `company_id=eq.{id}`).
- Test: `tests/unit/expenses/expense-recurring-service.test.ts` (row mapping + RPC argument shapes against a stub client).

Commit `feat(expenses): recurring reimbursement data layer`.

### Task 3: Copy (ops-copywriter)

**Files:** `src/i18n/dictionaries/{en,es}/books.json`, `src/i18n/dictionaries/{en,es}/settings.json`. Product register: terse, uppercase for authority (labels/buttons), sentence case for content, no exclamation points.

### Task 4: Editor dialog

**Files:** Create `src/components/expenses/recurring-reimbursement-dialog.tsx`.
**Design tokens:** `glass-dense`, `rounded-modal`, `border-glass-border`; inputs `bg-surface-input border-line rounded`, focus `border-border-medium`; labels `font-mono text-micro uppercase tracking-wider text-text-3`; money `font-mono` + tnum/zero; primary `ADD`/`SAVE` = outlined accent (the one accent element); `DELETE` destructive `rose-soft/rose/rose-line`; secondary ghost.
Behaviour per "Presentation decisions". Uses the existing `Dialog` primitive (portal, focus trap, Esc). Commit `feat(expenses): recurring reimbursement editor`.

### Task 5: Batch detail integration

**Files:** Modify `src/components/expenses/batch-line-table.tsx`, `src/components/expenses/batch-detail-panel.tsx`.
Recurring rows: repeat glyph in the receipt cell (`h-icon-16 w-icon-16`, `text-text-3`, `border-line`), neutral RECURRING block in the expanded record, EDIT / SKIP verbs for approvers, no flag/CLEAR. Panel: resolve setups via the hook, `+ RECURRING REIMBURSEMENT` quiet action under the table (approvers, batch not paid, submitter known), skip toast with UNDO → restore. Commit `feat(expenses): recurring lines in the batch console`.

### Task 6: Settings list

**Files:** Modify `src/components/settings/expense-settings-tab.tsx`; create `src/components/settings/recurring-reimbursements-card.tsx`.
Full-width card `// RECURRING REIMBURSEMENTS`: monthly total, one row per live setup (person · name · `CA$350.00 / MO` · `SINCE AUG 2026` · `ENDS …`), row click opens the dialog (approvers), `ADD` opens create with person picker. Commit `feat(settings): recurring reimbursements overview`.

### Task 7: Notification registry

**Files:** `src/lib/api/services/notification-service.ts` (type union), `src/lib/notifications/notification-meta.ts` (`expense_recurring: { label: "RECURRING", icon: "repeat", tone: "ambient" }` + icon resolution). Test: existing notification meta tests. Commit `feat(notifications): recurring reimbursement notices in the rail`.

### Task 8: Company data manifest

**Files:** `src/lib/data/company-data-manifest.ts` (company-scoped entry, `deleteStrategy: "retain"` with reason, `export: true`; `UNTYPED_TABLE_ALLOWLIST`; `MANIFEST_VERSION` bump), `src/lib/data/company-data-scope-snapshot.ts` (`STAGED_IN_SCOPE_MIGRATION_TABLES`).
Run `npx vitest run tests/integration/company-data-manifest.test.ts`. Commit `fix(data): classify recurring reimbursements for export and account deletion`.

### Task 9: Verification

1. `npx vitest run tests/unit/expenses tests/integration/company-data-manifest.test.ts tests/unit/notifications` — all pass.
2. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — exit 0 (compare against main's baseline error count if non-zero).
3. `npx eslint` on every touched file; `node scripts/check-slash-opacity.mjs`.
4. `custom-skills:audit-design-system` over the new/changed components.
5. Live preview (worktree dev server, dev bypass) — screenshots of: recurring line row + expanded record, create dialog with placement preview, edit dialog (END / DELETE states), Settings card. Artifacts to `docs/artifacts/recurring-reimbursements/`.
