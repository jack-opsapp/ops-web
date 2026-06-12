# Books (P3.1) — Capability Inventory of Absorbed Surfaces

**Wave:** WEB OVERHAUL P3.1 (master plan §6) · **Date:** 2026-06-11
**Rule:** master plan §4 feature-parity — every capability below must exist in `/books` or be explicitly descoped with Jackson's sign-off.

Sources read top-to-bottom this session:
`src/app/(dashboard)/estimates/page.tsx` (772) · `src/app/(dashboard)/invoices/page.tsx` (842) · `src/app/(dashboard)/accounting/page.tsx` (739) · `src/app/(dashboard)/money/cashflow/page.tsx` (27) · `src/components/expenses/*` (1,748) · `src/components/accounting/qbo/quickbooks-import-tab.tsx` (403) · `src/lib/navigation/route-registry.ts` · `src/lib/constants/fab-actions.ts` · `src/lib/hooks/use-metrics.ts` + `metrics-service.ts` · `src/middleware.ts`.

---

## 1 · /estimates — capabilities

| # | Capability | Detail | Gate |
|---|-----------|--------|------|
| E1 | Metrics header | `useEstimateMetrics`: pending (sent) value, approval rate, sent this month, avg estimate (90d non-draft), estimate→invoice conversion rate, 30d trends | — |
| E2 | Count line | `N estimates` after filtering | — |
| E3 | Search | estimate number + client name | — |
| E4 | Status filter | SegmentedPicker: ALL / DRAFT / SENT / APPROVED / DECLINED | — |
| E5 | Table | NUMBER · CLIENT · PROJECT (md+) · DATE (sm+) · EXPIRY (lg+) · TOTAL · STATUS (colored dot pill) · ACTIONS; responsive col hiding; row hover | `estimates.view` (route) |
| E6 | Row click → edit modal | full detail fetch w/ line items; skeleton while detail loads (never flashes $0) | `estimates.edit` |
| E7 | Download PDF | POST `/api/documents/generate-pdf` `{documentType:"estimate"}` → open `pdfUrl`; per-row spinner; toast on failure | — |
| E8 | Send | Draft only → `SendEstimateFlow` modal | `estimates.send` |
| E9 | Convert to invoice | Sent/Approved → `useConvertEstimateToInvoice` (atomic RPC `convert_estimate_to_invoice`) | `estimates.convert` |
| E10 | Delete (soft) | per-row | `estimates.delete` |
| E11 | Create/edit form modal | client select, optional project select, issue date, expiration date, `LineItemEditor` (products catalog, qty, unit, unit price, discount %, taxable, optional/selected), client message, internal notes, terms; computes subtotal/tax/discount/total; new → Draft | `estimates.create` / `estimates.edit` |
| E12 | Setup gate | `useSetupGate` + `SetupInterceptionModal` intercepts create until company setup complete (`triggerAction: "estimates"`) | — |
| E13 | Loading/empty states | 6-row skeleton; empty (none vs. no-match) + NEW ESTIMATE CTA | `estimates.create` (CTA) |
| E14 | i18n | `pipeline` dictionary namespace, en+es | — |
| E15 | `ReviewTasksModal` | imported + rendered but its open-setter is never invoked — **dead on this page** (live call sites exist elsewhere). Not a parity obligation. | — |

## 2 · /invoices — capabilities

| # | Capability | Detail | Gate |
|---|-----------|--------|------|
| I1 | Metrics header | `useInvoiceMetrics`: revenue collected, past due, receivables, collection rate, avg days-to-pay (90d), 30d trends | — |
| I2 | Count line / search / status filter | search number+client; ALL / DRAFT / SENT / PARTIALLY PAID / PAID / PAST DUE | — |
| I3 | Table | NUMBER · CLIENT · PROJECT · DATE · DUE (rose when past due) · TOTAL · PAID (olive) · BALANCE · STATUS · ACTIONS | `invoices.view` (route) |
| I4 | Row click → edit modal | detail fetch w/ line items + skeleton | `invoices.edit` |
| I5 | Download PDF | same endpoint, `documentType:"invoice"` | — |
| I6 | Send | Draft only | `invoices.send` |
| I7 | Record payment | not Paid/Void → modal: invoice summary (number/total/balance), amount + PAY IN FULL, date, method (cash/check/credit/debit/ACH/bank/Stripe/other), reference #, notes → `payments` insert; **DB trigger maintains amount_paid/balance_due/status — never write those columns** | `invoices.record_payment` |
| I8 | Void | not Paid/Void | `invoices.void` |
| I9 | Delete (soft) | per-row | `invoices.delete` |
| I10 | Create/edit form modal | client, optional project, issue date, payment terms (8 options, auto-computes due date), due date override, deposit amount, line items, notes, internal notes | `invoices.create` / `invoices.edit` |
| I11 | FAB deep link | reads `?action=new` → opens create modal through setup gate | `invoices.create` |
| I12 | Setup gate / loading / empty states / i18n | as estimates (`triggerAction: "invoices"`) | — |
| I13 | Dead code | local `metrics` memo (outstanding/overdue/paidThisMonth/draftCount) computed but unrendered — superseded by MetricsHeader. No parity obligation. | — |

## 3 · /accounting — capabilities (4 URL-addressable tabs via `?tab=`)

| # | Capability | Detail | Gate |
|---|-----------|--------|------|
| A1 | Metrics header (dashboard tab) | `useAccountingMetrics`: total outstanding (excl. drafts — semantics deliberately match aging buckets), collected MTD (payments table), overdue, 90d+ aging, counts | `accounting.view` (route) |
| A2 | A/R aging report | 5 buckets — CURRENT / 1–30 / 31–60 / 61–90 / 90+ — horizontal bars, semantic colors, dollar totals; excludes Draft/Void/Paid, zero-balance | — |
| A3 | Top clients | top 5 by total billed, paid amount in parens | — |
| A4 | Invoice status breakdown | per-status count + dollar total, 6-status grid | — |
| A5 | Expense review hub (expenses tab) | `ExpenseReviewDashboard` split panel: REVIEW/HISTORY tabs w/ counts; period selector derived from batches; period summary line; lists grouped NEED REVIEW / AUTO-APPROVED / APPROVED / REJECTED; detail panel w/ line-item table, flag/unflag + comments, receipt lightbox, APPROVE (atomic `approve_expense_batch` RPC), reject-with-revisions modal, review notes; keyboard nav (↑/↓ select, Esc close) | tab shown `expenses.approve` |
| A6 | Integrations (integrations tab) | QuickBooks + Sage connection cards: OAuth connect, disconnect (environment-scoped), SYNC NOW, last-synced, auto-sync state; **never displays realm id** (Intuit security req); sync history list; how-sync-works explainer | `accounting.manage_connections` |
| A7 | QuickBooks import (import tab) | `QuickBooksImportTab`: start pull (Pull→Stage), reconciliation strip, customer match table w/ per-row decisions, apply w/ decisions; writes `action_url:"/accounting"` notification on apply | `accounting.manage_connections` |
| A8 | Tab deep links | `?tab=expenses` (FAB expense action target), `?tab=integrations`, `?tab=import` | — |

## 4 · /money/cashflow — placeholder

Static "available in the OPS iPhone app" notice + back-to-dashboard link. No data, no nav entry. Killed by redirect. The **full web cashflow forecast remains a separate plan** (`OPS-Web/docs/bugs/2026-05-11-cashflow-forecast-web-followup.md`) — Books absorbs the *route*, not that future scope.

## 5 · Reachability & integration obligations

| # | Obligation | Detail |
|---|-----------|--------|
| R1 | FAB `create-estimate` floating window | `CreateEstimateForm` (the estimate builder window) stays reachable; Books' NEW ESTIMATE affordances must not orphan it |
| R2 | FAB retargets (same commit as registry swap) | `expense`: `/accounting?tab=expenses` → `/books?segment=expenses` · `invoice`: `/invoices?action=new` → `/books?segment=invoices&action=new` |
| R3 | Registry swap + redirects in ONE commit | remove estimates/invoices/accounting entries, add BOOKS; middleware param-aware redirects (§6) |
| R4 | Stored notification `action_url`s | `/accounting` (QBO apply route — also retarget the writer), `/books/cashflow` (iOS `forecast_dip` dispatcher) must resolve |
| R5 | Dashboard widget nav targets | ~20 `navigate()`/`fallbackPath` sites point at `/invoices`, `/estimates`, `/accounting` (some with `?status=` params the old pages ignored); redirects make them safe; in-wave retarget commit planned |
| R6 | Middleware protected prefixes | add `/books`; keep old prefixes during redirect window |
| R7 | Setup-gate + `?action=new` behaviors | preserved per-segment |
| R8 | `auto-approve-rule-form.tsx` | NOT orphaned — used by `settings/expense-settings-tab.tsx`; stays put, out of Books scope |

## 6 · Redirect map (decided this wave — exact mapping documented per master plan §2)

| Old | New |
|-----|-----|
| `/estimates` (+params) | `/books?segment=estimates` (+params preserved) |
| `/invoices` (+params) | `/books?segment=invoices` (+params preserved, incl. `action=new`, `status=…`) |
| `/accounting` · `?tab=dashboard` | `/books?segment=invoices&view=aging` |
| `/accounting?tab=expenses` | `/books?segment=expenses` |
| `/accounting?tab=integrations` | `/books?segment=sync` |
| `/accounting?tab=import` | `/books?segment=sync&view=import` |
| `/money/cashflow` | `/books` |
| `/books/cashflow` (iOS forecast_dip action_url) | `/books` |

## 7 · Permission model for /books (decided this wave; refined at build)

- **Route:** visible/enterable with **any of** `invoices.view` / `estimates.view` / `expenses.approve` / `accounting.view` (mirrors the iOS `MainTabView.hasBooksAccess` any-of pattern; registry type gains `anyOfPermissions` + `entryPermissions`/`getAnyOfPermissionsForPath` helpers consumed by the layout gate, sidebar, and command palette). `expenses.approve` rather than `.view`: the web expenses segment is the review hub — web has no own-scope expense list, so `.view` alone would admit users to an empty hub.
- **Summary cards (ledger strip):** `accounting.view` (web analog of iOS `finances.view` card gating — web has no `finances.*` bits).
- **INVOICES segment:** `invoices.view` for the document list · the segment also admits `accounting.view`-only users, who land directly on the A/R aging view (old `/accounting` parity) with no list, search, or create affordances.
- **A/R view (`?view=aging`):** `accounting.view`.
- **ESTIMATES segment:** `estimates.view`.
- **EXPENSES segment:** `expenses.approve` (web parity = the review hub; web has no own-scope "my expenses" surface today and this wave does not invent one).
- **SYNC segment:** `accounting.manage_connections`.
- Never role-name filtering anywhere.

## 8 · Descope candidates (require Jackson sign-off)

1. **None planned.** All capabilities E1–A8 carry over. The only intentional non-carry is the `/money/cashflow` placeholder *content* (replaced by redirect; full web forecast already a separately-tracked plan) and dead code E15/I13.
