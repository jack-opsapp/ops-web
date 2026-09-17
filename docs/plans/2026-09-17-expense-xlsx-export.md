# Branded Expense Spreadsheet Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** From a batch in the OPS-Web expense console, download a real `.xlsx` "Expenses Invoice" for one person / one period — the company's logo, brand colour and address at the top — that opens correctly in Excel, Numbers and Google Sheets.

**Architecture:** Three isolated units. (1) A pure view-model module turns batch + lines + allocations + company + person into an `ExpenseExportDocument` — every money, split, overhead, recurring and rejection rule lives here and is unit-testable with no I/O. (2) A workbook writer turns that view-model plus logo bytes into an xlsx Buffer; ExcelJS is confined to this file. (3) A route handler authenticates, gates on permission, fetches, and streams the download. The console adds one quiet EXPORT control in the batch header.

**Tech Stack:** Next.js 15 route handler, Supabase (server client), **ExcelJS 4.4.0 (MIT, free)**. SheetJS Community — already installed — is **not** usable: it silently drops every fill/font/border on write (verified: a styled cell round-trips to a styles.xml with zero fills and one default Calibri font) and cannot embed images.

**Design System:** `.interface-design/system.md` + `ops-design-system/project/DESIGN.md`.
The workbook is a **customer-branded portable document**, not an OPS product surface — white paper, the *company's* accent colour, resolved from the same single source the estimate/invoice PDFs use (`portal_branding.accent_color`, default `#417394`). The OPS dark canvas and steel-blue accent do not appear in the file. What does carry over: terse UPPERCASE authority labels, formatted tabular numbers, `—` for empty, hairlines, ruthless omission, no emoji. The in-app EXPORT control is a product surface and must use tokens; it is a **ghost** control — accent is reserved for the primary CTA (APPROVE ALL / MARK PAID).

**Required Skills:** `ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`.

---

## Verified ground truth (do not re-derive)

- `batchOwedAmount` (`src/lib/types/expense-approval.ts:342`) is the console's number: `reimbursementAmount` wins when non-null (**including 0**) → `partially_approved` uses `approvedAmount ?? totalAmount` → `approvedAmount > 0` → else `totalAmount ?? 0`.
- `reimbursementAmount === 0` means **company-funded**: nothing is owed to the person (`isBatchApprovedWithoutPayout`).
- Verified against two real production batches (read-only). In one, the lines total and the reimbursement figure are equal; in the other they differ, because a recurring reimbursement is the only reimbursable part. The document must never print one of those numbers as if it were the other.
- `batch_number` is **not unique across companies** — always scope queries by `company_id`.
- `expense_project_allocations` is one-to-many with `percentage` + nullable `amount`; `project_id` is **TEXT with no FK**, so it cannot be PostgREST-joined — resolve titles in a second `projects` query (the existing service does this at `expense-approval-service.ts:55`).
- The existing console collapses splits to `allocations[0]` (`expense-approval-service.ts:111`). The export must **not** — it needs the full set. Production has lines split 50/50 across two jobs that sit on one property, e.g. "Deck 1 - 200 Alder St" and "Deck 2 - 200 Alder St".
- **Use `projects.title`, not `projects.address`**, for the job column. Two jobs on one property have identical addresses; only the title tells them apart, and the reference invoice's own "Address" column contains job nicknames rather than postal addresses. Column is labelled **JOB**.
- `expenses` has **no** generic notes column. `description` = Item, `merchant_name` = Store.
- `companies`: name, address, phone, email, website, logo_url are typically set while `physical_address` is often null. `portal_branding.logo_url` is usually null → fall back to `companies.logo_url`.
- Logos live on S3 and fetch fine server-side. Real ones are large (1000px+) and both square and banner-shaped, so the writer must downsample, preserve aspect, and handle SVG and missing/failed logos.
- Permission gate: the console uses `usePermissionStore().can("expenses.approve")`. Scopes on `expenses.view` are `all` | `own`.
- Fonts: **Arial** throughout. Mohave/JetBrains Mono/Cake Mono are not installed on a bookkeeper's Excel and would substitute unpredictably; the portable equivalent of "tabular lining numerals" is a real currency/date **number format** on a right-aligned cell. Documented divergence.

---

## Task 1: Add ExcelJS

**Files:** Modify `package.json`, `package-lock.json`

**Step 1:** `npm install exceljs@4.4.0 --save --no-audit --no-fund`
**Step 2:** Verify: `node -e "console.log(require('exceljs/package.json').version, require('exceljs/package.json').license)"` → `4.4.0 MIT`
**Step 3:** Commit `chore(deps): add exceljs for branded spreadsheet export`

**Cost:** $0. MIT, no paid tier. Server-only — confine the import to the route/writer so it never enters a client bundle.

---

## Task 2: The document view-model (pure, no I/O)

**Skills:** `superpowers:test-driven-development`

**Files:**
- Create: `src/lib/expenses/export/expense-export-model.ts`
- Test: `src/lib/expenses/export/__tests__/expense-export-model.test.ts`

**Contract:**

```ts
export interface ExpenseExportRow {
  date: Date | null;
  job: string;          // project title, joined for splits, "—" for overhead
  item: string;
  store: string;
  note: string;         // "" when the line needs no explanation
  cost: number;
  currency: string;
  payable: boolean;     // false => excluded from the payable total
  muted: boolean;       // render de-emphasised (excluded lines)
}

export interface ExpenseExportDocument {
  company: { name; address; phone; email; website; logoUrl } ;
  person:  { name; address: string | null; phone: string | null };
  periodLabel: string;      // "August 2026" | "Aug 1 – Aug 15, 2026"
  batchNumber: string;
  statusLabel: string;      // BATCH_STATUS_DISPLAY
  rows: ExpenseExportRow[];
  linesTotal: number;       // sum of EVERY live row, matching the console's TOTAL
  payableTotal: number;     // batchOwedAmount — what the console says
  excludedTotal: number;    // linesTotal - payableTotal when positive
  companyFunded: boolean;   // reimbursementAmount === 0
  taxTotal: number | null;  // only when any line carries tax
  currency: string;
  currencies: string[];     // >1 => render one total row per currency
  accentColor: string;
  filename: string;
}
```

**Rules to test (one test each):**
0. `linesTotal` sums **every** live line (rejected included), because
   `recalculate_expense_batch_total` does — the document must not disagree with
   the console. `payableTotal` is the figure that excludes them.
1. Simple batch → one row per line, dates as `Date`, costs as `number`.
2. Split line → job reads `"Deck 1 - 200 Alder St · Deck 2 - 200 Alder St"`, cost stays the **full** line amount once (never double-counted).
3. Overhead line (no allocation) → job is `"—"`.
4. Recurring line → note reads the recurring label; still payable.
5. Rejected line → `payable: false`, `muted: true`, **still inside** `linesTotal`, note carries the reason.
6. Partial approval → `payableTotal === approvedAmount`, `excludedTotal` is the difference.
7. `reimbursementAmount === 0` → `companyFunded: true`, `payableTotal === 0`.
8. `reimbursementAmount = 350` with lines totalling 500 → `payableTotal === 350`, `excludedTotal === 150`.
9. Missing person address/phone → fields are `null` (**no empty labels, no placeholders**).
10. Missing receipt reason → note explains it.
11. Mixed currencies → `currencies.length === 2`, no cross-currency sum.
12. Tax present on any line → `taxTotal` set; all-null tax → `taxTotal === null`.
13. Filename: `Northgate Decking - Expenses - Dana Whitfield - August 2026.xlsx`, with `/ \ : * ? " < > |` stripped.

**All fixtures use invented companies/people/addresses/amounts** — ops-web is a PUBLIC repo.

**Commit** `feat(expenses): model the branded expense export document`

---

## Task 3: The workbook writer

**Skills:** `ops-design`, `custom-skills:interface-design`

**Files:**
- Create: `src/lib/expenses/export/expense-workbook.ts`
- Test: `src/lib/expenses/export/__tests__/expense-workbook.test.ts`

**Layout (landscape letter, fit 1 page wide):**

| Band | Content |
|------|---------|
| Row 1 | Brand colour bar across all columns (thin) |
| Rows 2–6 | Logo image (left, anchored, aspect preserved) · company name in brand colour · address / phone / email / website in grey, each line only if present |
| Row 8 | `EXPENSES` title, large, grey |
| Rows 9–12 | `PAYABLE TO` + person (+ their address/phone if present) · `PERIOD` · `BATCH` · `STATUS` — label grey UPPERCASE, value in brand colour |
| Row 14 | Table header: `DATE · JOB · ITEM · STORE · NOTE · COST`, white on brand fill, auto-contrast |
| Rows 15+ | Lines. Date `mm/dd/yyyy`, cost `$#,##0.00` right-aligned. Zebra fill at ~3%. Excluded rows greyed. **No filler rows.** |
| After | `TOTAL` → when payable differs: `LINES TOTAL`, `NOT REIMBURSED`, `PAYABLE TO <name>`. When `companyFunded`: `COMPANY-FUNDED — NO REIMBURSEMENT DUE` and no payable figure. Tax memo only when `taxTotal`. |

**Non-negotiables:**
- Header-row fill text colour chosen by **relative luminance** of the accent (WCAG) — never hardcode white.
- Column widths sized to content, not fixed guesses.
- `pageSetup`: `orientation: "landscape"`, `paperSize: 1` (Letter), `fitToWidth: 1`, `fitToHeight: 0`, margins set.
- `printTitlesRow` repeats the table header on page 2+.
- Logo embedded via `workbook.addImage({ buffer, extension })`; if logo bytes are absent the header reflows with **no gap and no placeholder**.
- The logo is bounded by **column A's width**, not the page. A wide banner lockup otherwise renders over the company name — a square logo hides this, so it must be tested with a wide one.

**Round-trip test:** write the buffer → re-open with `new ExcelJS.Workbook().xlsx.load(buf)` → assert: a cell holds a real `Date`; a cost cell is `typeof number` with numFmt `$#,##0.00`; the header fill argb equals the accent; `workbook.model.media.length === 1`; `worksheet.pageSetup.orientation === "landscape"`; total cell equals `payableTotal`.

**Commit** `feat(expenses): write the branded expense workbook`

---

## Task 4: The route handler

**Files:**
- Create: `src/app/api/expenses/batches/[batchId]/export/route.ts`
- Test: `src/app/api/expenses/batches/[batchId]/export/__tests__/route.test.ts`

**Steps:** authenticate → resolve company → load batch **scoped by `company_id`** (404 otherwise) → gate: `expenses.approve` OR (`expenses.view` and the batch is the caller's own); 403 otherwise → load lines + all allocations + project titles + company + person + branding → fetch logo server-side (CORS-proof; 5s timeout, failure is non-fatal) → build model → write workbook → respond with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and an RFC 5987 `Content-Disposition` filename.

**Never writes.** Read-only end to end.

**Commit** `feat(expenses): serve the branded expense export`

---

## Task 5: The EXPORT control + copy

**Skills:** `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`

**Files:** Modify `src/components/expenses/batch-detail-panel.tsx`, `src/i18n/dictionaries/{en,es}/books.json`

Quiet ghost control in the batch header row beside the status chip — **not** in the footer, which belongs to the lifecycle verb. Available in every batch state (the document carries the status; a missing button is a worse question than an honest one). Disabled with a reason while a batch has zero lines. Gate with the same permission the route enforces.

Copy keys (`en` + `es`): `expenses.detail.export`, `expenses.detail.exporting`, `expenses.detail.exportEmpty`, `expenses.detail.exportFailed`. UPPERCASE authority, no emoji, no exclamation.

**Commit** `feat(expenses): add EXPORT to the batch header`

---

## Task 6: Prove it

1. `npx vitest run src/lib/expenses/export src/app/api/expenses` → all green.
2. `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` → no **new** errors (baseline: 6 pre-existing test-file errors).
3. Generate a real file from `EXP-BATCH-0006` via a local preview, render it to an image, and eyeball it against the reference.
4. `custom-skills:audit-design-system` on the touched UI.

Proof artefacts rendered from real data stay in the session scratchpad and are **never committed**.

---

## Task 7: Same-session documentation

- `ops-software-bible/09_FINANCIAL_SYSTEM.md` — new "Expense spreadsheet export" section with source file paths.
- New memory file + one `MEMORY.md` line.

---

## Out of scope (deliberate)

**No multi-person / whole-console export.** The document mirrors how the crew invoices and how the office pays: one person, one period. Recording spend against jobs across everyone is a different job that the accounting sync already owns. Adding a second document now would be building for possibility, not for the office's actual month-end.

---

## Build log — where the plan met reality

- **`linesTotal` includes rejected lines.** Reading `recalculate_expense_batch_total` showed it sums every non-deleted line regardless of status, so excluding them (as first planned) would have made the document contradict the console. The document now shows `TOTAL` / `NOT REIMBURSED` / `PAYABLE` and reconciles.
- **`payment_method = 'company_card'` is the real "not owed" marker**, discovered in `private.execute_expense_decision`: only non-company-card lines become `reimbursed` on payout. The brief did not mention it.
- **A wide logo overran the company name.** Found only by exporting a second company whose logo is a banner rather than a square. Fixed by bounding the logo to its column; regression-tested with a 1000×300 fixture.
- **A failed logo fetch was completely silent.** A transient failure during the run could not be diagnosed because the catch swallowed it. It now always logs a greppable server warning.
- **`gap-1.5`/`h-3.5` emit no CSS here** — OPS overrides Tailwind's numeric spacing scale and `3.5` is not in it. Icons use the `icon-16` semantic token the Tailwind config mandates.
