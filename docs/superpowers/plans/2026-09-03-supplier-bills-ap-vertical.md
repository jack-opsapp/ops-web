# Supplier Bills / AP Vertical — Implementation Plan

**Goal:** Ship the internal, production-grade supplier-bill prerequisite for OPS Accounting: guarded capture, custody, lifecycle, job costing, settlement, and QuickBooks/Sage outbound sync, without adding or changing MCP tools.

**Architecture:** A server-only Accounting domain service authenticates the current Firebase actor, stages the immutable source PDF in company-scoped S3 custody, and calls service-role-only PostgreSQL prepare/commit functions. PostgreSQL owns tenant and permission rechecks, exact-confirmation intents, duplicate/idempotency guards, all-or-nothing AP writes, derived balances/statuses, provider queue insertion, and fresh readback receipts. Provider-specific mappers and one AP queue worker translate canonical OPS rows to QuickBooks Vendor/Bill/BillPayment and Sage Vendor/PurchaseInvoice/ContactPayment contracts. Zero-balance documents reuse `save_expense_atomic` through the caller's verified Firebase token.

**Product boundary:** This phase is internal and server-side. It adds no customer review page and no MCP, vinyl-order, or Invisible Office behavior. Existing `/books`, expense categories, projects, permissions, connection tokens, queue/audit infrastructure, and S3 are reused.

## 1. Lock the contract with failing tests

- Add pure contract tests for the three DeksMart-shaped unpaid fixture scenarios, including two-job allocation, nullable due dates, total arithmetic, duplicate identity, and zero-balance expense routing.
- Add provider mapper tests for QuickBooks and Sage bills/payments, including deterministic provider-required blockers.
- Add migration contract tests for tables, RLS/grants, actor/tenant authority, prepare/commit confirmation, idempotency, duplicate indexes, atomic allocation/payment math, status transitions, PDF custody, queue creation, and fresh receipts.
- Add route/service tests for missing/invalid auth, cross-company rejection, PDF validation, and exact-confirmation commit behavior.

## 2. Build the additive data model and guarded transaction

- Add suppliers, bills, bill lines, project allocations, payments, source documents, provider links, payment-account mappings, and immutable bill events.
- Add private write intents with command hashes, exact confirmation text, expiry, idempotency, execution state, and receipt pointers.
- Add service-role-only prepare/commit/readback functions that re-resolve the active actor and `expenses.approve` + `accounting.view` authority at both prepare and commit.
- Derive `open`, `partial`, `paid`, and `void` from locked settlement state; forbid overpayment and voiding settled bills.
- Keep authenticated roles read-only through company-scoped RLS and explicit grants; keep every write behind the guarded RPC.

## 3. Add source-document custody and internal API

- Add a server-only service and authenticated internal prepare/commit routes.
- Validate PDF signature/type/size, compute SHA-256, store with a deterministic company-scoped immutable S3 key, and persist bucket/key/hash/size/original filename in the committed bill.
- On paid-document commit, execute the existing authenticated `save_expense_atomic` path with deterministic ids, then finalize a truthful supplier-bill intent receipt from the live expense row.

## 4. Integrate QuickBooks and Sage AP sync

- Extend the accounting queue constraints/types for `sage`, `supplier`, `supplier_bill`, and `supplier_bill_payment` without changing existing sales behavior.
- Add pure QuickBooks Vendor/Bill/BillPayment and Sage Vendor/PurchaseInvoice/ContactPayment payload mappers.
- Add an AP queue worker under the existing write kill switch, token refresh, leases, retries, poison-row isolation, events, and needs-review notifications.
- Persist provider ids/sync tokens only after successful provider writes; never infer required provider account, due-date, or bank mappings.

## 5. Verify and release

- Run focused tests, TypeScript, lint, and production build.
- Apply the additive migration, prove schema/RLS/function grants and rollback-only lifecycle behavior in production, then independently read back zero fixture residue.
- Update the OPS Software Bible schema/API/financial chapters and migration mirror, citing the exact OPS Web commit.
- Push the verified commit to `main`, wait for the production deployment, verify the internal routes fail closed without auth, and inspect live logs.
- Do not execute a real QuickBooks/Sage financial write; prove those paths with mapper/worker tests and dormant production queue/runtime checks.
