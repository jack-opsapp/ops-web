# Canpro Supplier Bill Clearance — Implementation Plan

> **Required sub-skill:** Use `custom-skills:executing-plans` to implement this plan task by task.

**Goal:** Turn the existing supplier-bill accounting foundation into a complete Canpro-ready intake, reconciliation, approval, payment, and audit workflow across OPS Web and OPS iOS.

**Architecture:** A durable `supplier_bill_intake` layer owns captured documents before they become accounting liabilities. Capture persists the immutable source PDF and extracted facts immediately; review records the required checks and human dispositions; approval atomically promotes an eligible intake into the existing canonical AP tables and only then creates provider-sync work. Held and payroll-routed documents remain outside AP. Web is the dense reconciliation, approval, and payment surface; iOS is optimized for field capture and quick read-only review. Every mutating path stays behind authenticated server routes and service-role-only prepare/commit RPCs with exact confirmation and fresh readback.

**Tech stack:** Next.js 15, TypeScript, React Query, Supabase/PostgreSQL, AWS S3, `pdfjs-dist`, Vitest, SwiftUI, PDFKit, Vision/VisionKit, XCTest.

**Release boundary:** Implement, test, document, and commit locally. Do not apply the new production migration, push either repository, deploy web, or release iOS without Jackson's separate approval.

---

## Product and design decision

Canpro's supplier documents are not ordinary expenses. They must pass three explicit audits before payment:

1. Rate compliance.
2. Duplicate billing.
3. Plan-versus-site quantity or scope variance.

Material invoices also need order/specification and receipt verification. Employee invoices belong in payroll, not AP. A document with an unresolved exception must be held with a reason and next action. Provider sync must never begin before approval.

### Layout variants considered

1. **Hierarchical list:** Lifecycle sections with nested suppliers. Rejected because multi-job invoices and exception work become hidden behind disclosure controls.
2. **Grid dashboard:** Metric cards and separate queues. Rejected because a low-frequency setup/dashboard treatment takes space away from the document being cleared.
3. **Flow board:** Review, to pay, paid, and held columns. Rejected because wide kanban movement is weak for dense invoice line reconciliation and mobile use.
4. **Hybrid master-detail — selected:** A flat lifecycle-filtered list plus a focused detail workspace. It preserves fast scanning while giving multi-job lines and audit evidence the room they need.

### Web wireframe

```text
┌ BOOKS ──────────────────────────────────────────────────────────────┐
│ INVOICES  ESTIMATES  EXPENSES  BILLS  SYNC            [NEW BILL]  │
│ REVIEW 12     TO PAY 4     PAID     HELD 2                         │
├──────────────────────────────┬──────────────────────────────────────┤
│ SUPPLIER / INVOICE / JOB     │ DEKSMART · 43066        $10,842.16 │
│ DeksMart  43066      3 JOBS  │ Source PDF · captured 11:42         │
│ DeksMart  42995      1 JOB   │                                      │
│ ...                          │ CLEARANCE                            │
│                              │ 01 RATE          PASS                │
│                              │ 02 DUPLICATE     CLEAR               │
│                              │ 03 QTY / SCOPE   1 EXCEPTION         │
│                              │                                      │
│                              │ LINES + JOB ALLOCATION               │
│                              │ [line reconciliation table]          │
│                              │                                      │
│                              │ OWNER  KRISTY    TARGET  SEP 13       │
│                              │ [HOLD]              [APPROVE TO PAY] │
└──────────────────────────────┴──────────────────────────────────────┘
```

### iOS wireframe

```text
┌ BOOKS ───────────────────────┐
│ INVOICES ESTIMATES EXPENSES… │
│ REVIEW | TO PAY | PAID | HELD│
├──────────────────────────────┤
│ DEKSMART             $10,842 │
│ 43066 · 3 JOBS · 1 FLAG      │
├──────────────────────────────┤
│ DEKSMART              $4,216 │
│ 42995 · 1 JOB · CLEAR        │
│                              │
│                         [+]  │
└──────────────────────────────┘

Detail push:
┌ BILL 43066 ──────────────────┐
│ CLEARANCE  2 / 3             │
│ RATE             PASS        │
│ DUPLICATE        CLEAR       │
│ QTY / SCOPE      REVIEW      │
│ [lines + allocation]         │
│ APPROVAL + PAYMENT IN OPS WEB│
└──────────────────────────────┘
```

### Visual system

- Carbon-black canvas, glass panels, hairline boundaries, zero static shadows.
- Cake Mono for authority labels, JetBrains Mono for money/status, Mohave for readable content.
- Steel blue only for the primary action and focus; olive/tan/rose are semantic only.
- The signature element is the numbered **clearance rail**. It makes the required audit sequence legible and physically locks approval until all required findings have a disposition.
- Use existing motion helpers only. No new custom animation is required.
- Web uses the existing Tailwind/design tokens and Lucide icons. iOS uses `OPSStyle` and SF Symbols only.
- iOS controls remain at least 44 pt, safe above the custom tab bar, usable one-handed, and readable outdoors.

---

## Task 1: Define and test the intake domain

**Files:**

- Create: `src/lib/accounting/supplier-bills/intake-contracts.ts`
- Create: `src/lib/accounting/supplier-bills/__tests__/intake-contracts.test.ts`
- Modify: `src/lib/accounting/supplier-bills/contracts.ts`

### Steps

1. Write failing table-driven tests for:
   - material, subcontractor, and employee classification;
   - required check sets for each classification;
   - `review`, `to_pay`, `held`, `paid`, and `payroll` stage derivation;
   - approval rejection while a required check is unresolved;
   - hold requiring both a reason and next action;
   - nullable supplier due date and separate planned payment date;
   - ordered-versus-invoiced quantity facts and unit-of-measure preservation;
   - deterministic exact-cent proportional allocation, including remainder assignment;
   - human allocation override validation;
   - normalized address/PO job matches remaining suggestions until confirmed.
2. Run only the new test and confirm the expected failures.
3. Implement the pure contracts, canonicalization, money arithmetic, and stage derivation.
4. Re-run the focused test and the existing supplier-bill contract tests.
5. Commit: `feat(accounting): define supplier bill clearance contract`.

## Task 2: Lock the database behavior before writing the migration

**Files:**

- Create: `src/lib/accounting/supplier-bills/__tests__/intake-migration-contract.test.ts`
- Create through Supabase CLI: `supabase/migrations/20260904040358_supplier_bill_intake_clearance.sql`

### Steps

1. Write failing behavior-oriented SQL contract tests that apply the migration in the existing controlled harness and prove:
   - normalized intake, line, allocation, check, document, and event storage;
   - company-bound foreign keys and indexes;
   - `accounting.view` read scope;
   - separate `accounting.bills.capture`, `accounting.bills.approve`, and `accounting.bills.pay` authority;
   - service-role-only mutation RPCs with `SECURITY DEFINER`, empty `search_path`, schema qualification, and revoked public/authenticated execution;
   - exact-confirmation prepare/commit and idempotent replay;
   - immutable document/event rows;
   - duplicate invoice and source-document detection;
   - unresolved findings blocking approval;
   - employee routing to payroll without an AP bill;
   - approval promoting exactly once to canonical bill/line/allocation rows;
   - provider queue creation only during approval promotion;
   - hold never creating provider work;
   - payment owner and planned date required before `to_pay`;
   - payment permission independent from approval permission;
   - append-only audit snapshots and fresh receipts.
2. Confirm the test fails because the intake schema/RPCs do not exist.
3. Use `supabase migration new supplier_bill_intake_clearance`; if the CLI is unavailable, document the tooling blocker and create the timestamp from the repository's canonical migration generator before editing SQL.
4. Implement the additive migration. Preserve the existing AP tables and RPCs for compatibility; add versioned intake prepare/commit functions rather than destructively changing a released function signature.
5. Re-run focused SQL and migration tests until green.
6. Commit: `feat(db): add supplier bill intake clearance`.

## Task 3: Add extraction and Canpro reconciliation rules

**Files:**

- Create: `src/lib/accounting/supplier-bills/pdf-extraction.ts`
- Create: `src/lib/accounting/supplier-bills/canpro-reconciliation.ts`
- Create: `src/lib/accounting/supplier-bills/__tests__/pdf-extraction.test.ts`
- Create: `src/lib/accounting/supplier-bills/__tests__/canpro-reconciliation.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

### Steps

1. Add `pdfjs-dist`; this is local PDF parsing and adds no usage-based service cost.
2. Write synthetic DeksMart-shaped text fixtures covering one-job, multi-job, blank PO, tracking, SKU, ordered/invoiced quantities, UOM, freight/glue/hazmat, and a missing due date.
3. Confirm failing tests for extracted facts and false-positive boundaries.
4. Implement local PDF text extraction and a conservative parser that returns facts plus confidence/provenance, never invented values.
5. Implement Canpro rule suggestions:
   - slick/smooth vinyl ceiling CAD 2.25/sq ft;
   - fuzzy vinyl ceiling CAD 2.00/sq ft;
   - diverter/scupper CAD 25 each;
   - drain CAD 15 each;
   - duplicate candidates by normalized supplier/invoice and source hash;
   - quantity variance from ordered/invoiced or confirmed plan/site evidence;
   - shared-charge proportional suggestion by material subtotal with exact-cent remainder.
6. Treat every detection as a suggestion requiring a human disposition.
7. Re-run focused tests.
8. Commit: `feat(accounting): extract and reconcile supplier invoices`.

## Task 4: Build authenticated intake services and routes

**Files:**

- Create: `src/lib/accounting/supplier-bills/intake-service.ts`
- Create: `src/lib/accounting/supplier-bills/intake-repository.ts`
- Create: `src/lib/accounting/supplier-bills/__tests__/intake-service.test.ts`
- Create: `src/app/api/internal/accounting/supplier-bills/intakes/route.ts`
- Create: `src/app/api/internal/accounting/supplier-bills/intakes/[intakeId]/route.ts`
- Create: `src/app/api/internal/accounting/supplier-bills/intakes/[intakeId]/prepare/route.ts`
- Create: `src/app/api/internal/accounting/supplier-bills/intakes/[intakeId]/commit/route.ts`
- Create route tests beside each route.
- Modify: `src/lib/accounting/supplier-bills/document-custody.ts`
- Modify: `src/lib/accounting/supplier-bills/route-auth.ts`

### Steps

1. Write failing service/route tests for missing/invalid auth, company isolation, capture limits, extraction, durable first save, list/detail reads, stale revision rejection, exact confirmation, and action-specific authority.
2. Extend document custody so a PDF can belong to an intake before promotion while retaining deterministic company/request/hash storage.
3. Implement:
   - `POST /intakes` multipart capture;
   - `GET /intakes` lifecycle-filtered summaries;
   - `GET /intakes/:id` full detail;
   - prepare/commit mutations for facts, job confirmation, allocations, check disposition, hold/release, approval, payment scheduling, payment record, and payroll routing.
4. Return stable error codes and fresh state after every commit.
5. Re-run route/service and existing AP tests.
6. Commit: `feat(accounting): expose guarded supplier bill intake api`.

## Task 5: Build the Web Bills review console

**Files:**

- Create: `src/components/books/segments/bills-segment.tsx`
- Create: `src/components/books/bills/bill-capture-dialog.tsx`
- Create: `src/components/books/bills/bill-list.tsx`
- Create: `src/components/books/bills/bill-review-panel.tsx`
- Create: `src/components/books/bills/bill-clearance-rail.tsx`
- Create: `src/components/books/bills/bill-line-reconciliation.tsx`
- Create: `src/components/books/bills/bill-source-document.tsx`
- Create: `src/hooks/use-supplier-bill-intakes.ts`
- Create: `tests/unit/books/bills-segment.test.tsx`
- Create: `tests/e2e/books-bills.spec.ts`
- Modify: `src/components/books/books-page.tsx`
- Modify: `src/i18n/dictionaries/en/books.json`
- Modify: `src/i18n/dictionaries/es/books.json`

### Steps

1. Write failing component tests for:
   - Bills visibility under `accounting.view`;
   - action buttons respecting capture/approve/pay permissions;
   - lifecycle filter counts;
   - source-document access;
   - multi-job line allocation edits;
   - required disposition notes;
   - approval disabled until clearance and payment planning are complete;
   - held and payroll states never offering provider sync.
2. Add Bills between Expenses and Sync in the existing Books segment control and URL contract.
3. Implement the token-driven master-detail console using current Books/TableShell/Workbar patterns.
4. Implement drag/drop and file-picker capture, extraction preview, explicit confirmation, and immediate durable upload.
5. Add loading skeleton, empty state, recoverable error, stale-update conflict, offline read-only, success, and permission-denied states.
6. Add terse OPS copy to both English and Spanish dictionaries; no inline user-facing strings.
7. Use the existing reduced-motion-aware segment/panel transitions only.
8. Run focused unit tests, the new browser flow, type-check, and lint.
9. Commit: `feat(books): add supplier bill clearance console`.

## Task 6: Build iOS capture, cache, and quick review

**Files:**

- Create: `OPS/DataModels/SupplierBillIntake.swift`
- Create: `OPS/Services/SupplierBills/SupplierBillCaptureQueue.swift`
- Create: `OPS/Services/SupplierBills/SupplierBillIntakeService.swift`
- Create: `OPS/Services/SupplierBills/SupplierBillCache.swift`
- Create: `OPS/ViewModels/SupplierBillIntakeViewModel.swift`
- Create: `OPS/Views/Books/Bills/SupplierBillsView.swift`
- Create: `OPSTests/Books/SupplierBillCaptureQueueTests.swift`
- Create: `OPSTests/Books/SupplierBillIntakeModelTests.swift`
- Create: `OPSTests/Services/SupplierBillCacheTests.swift`
- Create: `OPSTests/Services/SupplierBillIntakeServiceTests.swift`
- Create: `OPSTests/ViewModels/SupplierBillIntakeViewModelTests.swift`
- Modify: `OPS/Views/Books/BooksSection.swift`
- Modify: `OPS/Views/Books/BooksTabView.swift`
- Modify: `OPS/Views/Books/Ledger/BooksLedger.swift`
- Modify: `OPS/Views/MainTabView.swift`

### Steps

1. Write failing XCTest coverage for decoding, lifecycle filters, company isolation, durable offline capture, offline cache survival, exact capture identity, and retry-versus-rejection behavior.
2. Add the Bills section gated by `accounting.view`, with capture independently gated by `accounting.bills.capture`.
3. Implement the authenticated API service using `AppConfiguration.apiBaseURL` and Firebase ID tokens.
4. Implement protected Application Support storage for last-known summaries/details and an immutable PDF capture queue. Both remain company-isolated and survive relaunch; queued PDFs are removed only after the server confirms the exact stable capture identity.
5. Implement PDF import plus VisionKit document scan. Paper scans are converted to protected PDFs locally; extraction remains server-authoritative so offline capture never presents provisional facts as final.
6. Add the five lifecycle filters, flat bill rows, cached detail review, Canpro checks, line/job status, and source-document access. Keep approval, hold disposition, payroll handoff, and payment in the web console where the complete evidence and authority controls are visible.
7. Respect 44 pt targets, Dynamic Type, VoiceOver labels, outdoor contrast, safe-area clearance above the custom tab bar, and reduced motion.
8. Run focused tests, then the narrow iOS test plan and compile in an isolated DerivedData path.
9. Commit: `feat(books): add supplier bill capture and clearance`.

## Task 7: Update the OPS Software Bible

**Files:**

- Modify: `03_DATA_ARCHITECTURE.md`
- Modify: `04_API_AND_INTEGRATION.md`
- Modify: `07_SPECIALIZED_FEATURES.md`
- Create: `specs/2026-09-03-canpro-supplier-bill-clearance.md`
- Copy from web commit: `migrations/20260904040358_supplier_bill_intake_clearance.sql`

### Steps

1. Document the intake-versus-canonical-AP boundary, normalized schema, permissions, exact-confirmation RPCs, API endpoints, lifecycle, provider-sync boundary, iOS cache behavior, and Canpro audit rules.
2. Cite exact OPS Web and iOS code paths and local commit hashes.
3. Mirror the exact migration byte-for-byte and verify with `cmp`.
4. Explicitly mark the migration and clients as local/unreleased until separately approved.
5. Commit: `docs(accounting): document supplier bill clearance`.

## Task 8: Design, security, and completion verification

**Files:**

- Verify all files changed by Tasks 1–7.
- Store temporary screenshots/logs only under `docs/artifacts/` and remove them unless reference-worthy.

### Steps

1. Run the focused supplier-bill tests, affected Books tests, TypeScript, lint, and production build.
2. Run the iOS focused tests and compile using the isolated worktree/local package cache.
3. Audit web styling against Tailwind/OPS tokens and iOS styling against `OPSStyle`; confirm no new hardcoded colors, spacing, radii, fonts, shadows, or decorative icons.
4. Audit keyboard navigation, focus states, Dynamic Type, VoiceOver, 44 pt mobile targets, contrast, reduced motion, and bottom-bar clearance.
5. Run migration static/security checks and independently confirm:
   - no authenticated direct writes;
   - no public RPC execution;
   - empty `search_path` and schema-qualified definer functions;
   - approval is the first point at which a canonical AP bill/provider queue can exist;
   - payroll and held documents cannot enter AP;
   - audit/document records are immutable.
6. Render and inspect the web list/detail/capture states and iOS list/detail/capture states. Fix visual deviations before completion.
7. Confirm all worktrees are clean except deliberate commits and the untouched pre-existing iOS artifact directory in the primary checkout.
8. Report local completion and proof separately from the unreleased production state. Ask for release approval only after all local proof is green.
