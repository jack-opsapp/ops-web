# QuickBooks → OPS Read-Only Sync (Sub-project A) — Design

- **Status:** Draft for review
- **Date:** 2026-06-01
- **Owner:** Jackson Sweet
- **Initiative:** `QUICKBOOKS SYNC` — Phase 1 (read-only validation draw)
- **Surface:** OPS-Web (`ops-web`) + Supabase. iOS Books is read-only consumer (already built).
- **Test subject:** Company **Canpro Deck and Rail** (`a612edc0-5c18-4c4d-af97-55b9410dd077`) — the owner's own real OPS company, connected to its real (production) QuickBooks Online company file.
- **Revision (2026-06-01, post-sandbox verification):** Line-item AND estimate import brought INTO scope; every field mapping below VERIFIED against live QuickBooks **sandbox** JSON (Invoice / Estimate / Payment / Customer / Item) and live OPS schema + triggers. See §5.4–5.7 and §8.

> This is **Sub-project A** of a two-part initiative. Sub-project B (profit/revenue-per-employee KPI) is a separate spec and depends on this landing first. See **§13 Out of scope**.

---

## 1. Decision log (locked during brainstorming, 2026-06-01)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Primary goal of the pull | **Populate Books with real $** — pull CanPro's customers/invoices/payments so OPS Books shows real revenue, A/R, cash. Used to **validate OPS's internal accounting math** against QuickBooks as a trusted source. |
| 2 | Long-term direction | Eventual **symbiotic two-way sync** (QB ↔ OPS). This phase builds the **pull half** of that engine, not a throwaway. |
| 3 | Direction now | **Read-only / pull-only**, enforced as a hard mode — write-to-QB functions are unreachable for this connection. |
| 4 | OPS target | **CanPro's real OPS account** (the owner's own company). |
| 5 | Merge model | **Dry-run review** — pull lands in staging; owner reviews proposed matches/dupes/new before anything writes to live tables. |
| 6 | Trigger cadence | **Manual-only** during validation. No scheduled/cron sync. |
| 7 | History depth | **All open invoices + trailing 24 months** of closed invoices/payments. |
| 8 | Token security | **Plain-text for now** (Supabase RLS + at-rest disk encryption only). Encryption-at-rest deferred — tracked as bug `7600a1a2-566b-4d11-82a9-db72e966ee85` (must fix before enabling QB/Sage for any other customer). |
| 9 | Intuit app | Owner **already has** a QuickBooks Developer production app + keys. Will supply `client_id`, `client_secret`, registered `redirect_uri`. |

---

## 2. Goal & non-goals

**Goal.** Connect CanPro's real QuickBooks Online company file in a guaranteed read-only mode, pull its customers, invoices, and payments into an OPS staging area, let the owner review and approve a proposed set of changes, and on approval write them into CanPro's live OPS tables — so the iOS Books P&L, Cash Flow, and A/R cards populate with real money for the first time, validating OPS's internal accounting computations.

**Non-goals (this phase).**

- No writing of any kind to QuickBooks (no customers/invoices/estimates/payments pushed).
- No scheduled/background sync.
- No multi-company / general-availability rollout. One company, owner-controlled.
- No per-job profit, no per-employee economics (Sub-project B).
- No token encryption-at-rest (deferred, bug filed).
- No Sage work (QuickBooks only this phase; Sage is a structural twin we leave untouched).

**Success criteria.**

1. After connect + pull + apply, CanPro's iOS Books **P&L**, **Cash Flow**, and **A/R aging** cards show non-zero, plausible numbers that the owner recognizes as CanPro's real figures.
2. The web review screen's "QuickBooks says $X / OPS will show $Y" totals reconcile (A/R balance matches QB to the cent; collected-in-window matches imported payments).
3. CanPro's QuickBooks company file is **provably unchanged** — zero create/update/delete API calls to Intuit (verifiable in the sync log and Intuit's audit trail).
4. CanPro's existing 349 clients are not duplicated; matched clients gain a `qb_id` link; only owner-approved new clients are created.

---

## 3. Findings that shape this design (verified 2026-06-01)

Verified against live Supabase (`ops-app`, `ijeekuhbatykdomumfjx`), the `ops-web` codebase, and the bible. **Drift is stated explicitly because specs here are authoritative and not line-reviewed by the owner.**

1. **Two accounting integrations exist, and they disagree — this must be reconciled.**
   - **(a) Deployed edge-function path (bible-documented):** Supabase functions `accounting-oauth` + `accounting-sync-expense` (+ deprecated `accounting-batch-create`, still deployed). This is **push-only, expenses-only** (OPS → QB Purchase / Sage OtherPayment). It reads nothing back.
   - **(b) ops-web Next.js path (NOT in bible):** `/api/integrations/quickbooks{,/callback}`, `/api/sync`, `sync-orchestrator.ts`, `quickbooks-sync-service.ts`. This is an **untested bidirectional** sync of clients/invoices/estimates/payments that **pushes to QB first, then pulls**. Its cron (`/api/cron/accounting-sync`) is **not registered in `vercel.json`**, so only the manual `POST /api/sync` button can trigger it.
   - **Implication:** the dangerous capability (writes to QB) lives in path (b)'s `sync-orchestrator`. This design **builds on path (b)** (it already has the pull functions and the connection model) but **adds a hard direction mode** so the push half cannot run for a pull-only connection. Path (a) is left as-is (it's expense-push, irrelevant to this read draw) but **must not be invoked** for CanPro during this phase.

2. **CanPro is operations-heavy but money-empty in OPS.** 349 clients, 208 projects, 381 opportunities, 11 users — but **0 invoices, 0 payments, 0 estimates**, 4 expenses. So invoices/payments import as a **clean seed** (no collisions); the **only** merge problem is customers vs the 349 existing clients.

3. **Customer matchability is good.** Of 349 clients: 348 have a name, 241 have an email. Email is the high-confidence match key; name is the fallback.

4. **QuickBooks was never actually connected.** One stub `accounting_connections` row exists for CanPro (created 2026-03-06, `is_connected=false`, no tokens, no realm). Clean slate.

5. **`accounting_connections.company_id` is `text`** while business tables (`clients`, `invoices`, `payments`, `estimates`) use **`uuid`** `company_id`. The connection stores the uuid as a string. All joins must cast deliberately. (Existing orchestrator already lives with this.)

6. **`qb_id text` exists on `clients`, `invoices`, `estimates`, `payments`** (and `sage_id` too). These are the link columns; all currently null for CanPro.

7. **Invoice balance is trigger-maintained.** `trg_payment_balance` → `update_invoice_balance()` recomputes `invoices.amount_paid = SUM(non-void payments.amount)`, `balance_due = invoices.total − amount_paid`, and `status` (`paid` / `partially_paid` / unchanged) on every payment insert/update/delete. This dictates apply order (see §8).

8. **The `accounting` feature flag is OFF by default** and `accounting_sync_log` has RLS enabled but (per migration audit) no policy — reads go through the service role. This phase uses a per-user feature-flag override to enable the surface for the owner only.

9. **`QB_ENVIRONMENT` is dead config** — the QB API base in `quickbooks-sync-service.ts` is hardcoded to production (`quickbooks.api.intuit.com`). Since we connect a real production company in read-only mode, production is correct; we will wire `QB_ENVIRONMENT` properly so a future sandbox is possible, but it is not required for this test.

---

## 4. Architecture: Pull → Stage → Review → Apply

```
QuickBooks Online (CanPro, READ ONLY)
        │  GET /v3/company/{realmId}/query   (Customer, Invoice, Payment)
        ▼
[1] PULL service (pull-only mode; push functions unreachable)
        │  raw provider records
        ▼
[2] STAGE  →  qbo_staging_* tables (NOT live business tables)
        │  + computed match proposals (client matching)
        ▼
[3] REVIEW (web: /accounting → "QuickBooks Import" review screen)
        │  owner inspects matches / dupes / new / totals; QB$ vs OPS$
        │  owner approves (all or per-section)
        ▼
[4] APPLY (idempotent, qb_id-keyed) → live clients / invoices / payments
        ▼
iOS Books (P&L, Cash Flow, A/R) light up with real CanPro money
```

**Component inventory (new vs. modified):**

| Component | New / Modified | Role |
|-----------|----------------|------|
| `accounting_connections.sync_direction` (column) | **New** (additive migration) | `'pull_only' \| 'push_only' \| 'bidirectional'`. CanPro = `pull_only`. Default for existing rows = `'bidirectional'` to preserve current behavior, or `'pull_only'` if we want safety-by-default (see §6). |
| `qbo_staging_customers` / `_invoices` / `_payments` | **New** tables | Hold pulled raw + normalized records pre-apply, keyed by `(company_id, qb_id)`. |
| `qbo_import_runs` | **New** table | One row per pull: status, counts, QB-vs-OPS totals, started/finished, error. |
| `qbo_customer_matches` | **New** table | Per staged customer: proposed action (`link` / `create` / `skip`), matched `client_id`, match basis + confidence. |
| Pull service (`quickbooks-pull-service.ts`) | **New** (extracted from / wrapping existing `pullClients`/`pullInvoices` + new `pullPayments`) | Read-only QB queries with pagination + the 24-month/open window. |
| `sync-orchestrator.ts` | **Modified** | Honor `sync_direction`; in `pull_only`, never call any `push*`. Route pull → staging (not live tables). |
| `POST /api/integrations/quickbooks/import` (run pull→stage) and `POST .../import/apply` | **New** routes | Replace the dangerous `POST /api/sync` for this connection. Manual triggers only. |
| Review UI (`/accounting` → Import tab) | **New** | Dry-run review + approve. |
| OAuth callback | **Modified** | On connect, set `sync_direction='pull_only'`, `sync_enabled=false` (no auto-sync), and **do not** auto-trigger any sync. |
| iOS Books | **Unchanged** | Consumes resulting `invoices`/`payments` as it does today. |

---

## 5. Entity scope & field mappings

Pulled from QuickBooks (read-only). Amounts are CAD/whatever the QB file uses; OPS stores `numeric(12,2)`.

### 5.1 Customer → `clients`
| QB field | Staging | Applied to `clients` |
|----------|---------|----------------------|
| `Id` | `qb_id` | `qb_id` (link) |
| `DisplayName` (fallback `CompanyName`, `GivenName+FamilyName`) | `name` | `name` (only on **create**; never overwrite existing) |
| `PrimaryEmailAddr.Address` | `email` | `email` (create only; do not clobber) |
| `PrimaryPhone.FreeFormNumber` | `phone` | `phone_number` (create only) |
| `BillAddr` (Line1/City/CountrySubDivisionCode/PostalCode) | `address` | `address` (create only) |
| `Active` | `active` | filter: skip inactive unless referenced by a pulled invoice |

### 5.2 Invoice → `invoices`
| QB field | Staging | Applied to `invoices` |
|----------|---------|----------------------|
| `Id` | `qb_id` | `qb_id` (link / idempotency key) |
| `DocNumber` | `invoice_number` | `invoice_number` |
| `CustomerRef.value` | `customer_qb_id` | resolve → `client_id` via matched/created client |
| `TotalAmt` | `total` | `total` |
| `Balance` | `balance` | drives `balance_due` (see §8) |
| `TxnDate` | `issue_date` | `issue_date` |
| `DueDate` | `due_date` | `due_date` |
| derived (QB has no status field) | `status` | `paid` if `Balance=0`; `partially_paid` if `0 < Balance < TotalAmt`; else `past_due` if `DueDate < today` else `awaiting_payment`. Voided / zero-total QB invoices → **skip + flag** (not imported). |
| — | — | `company_id` = CanPro; `created_by` = importer system user (owner) |

Pull filter: `WHERE TxnDate >= {today−24mo}` **UNION** `WHERE Balance > '0'` (catches older still-open invoices), deduped by `Id`.

### 5.3 Payment → `payments`
| QB field | Staging | Applied to `payments` |
|----------|---------|----------------------|
| `Id` | `qb_id` | `qb_id` (idempotency key) |
| `TotalAmt` | `amount` | `amount` |
| `TxnDate` | `payment_date` | `payment_date` |
| `Line[].LinkedTxn[ TxnType=Invoice ].TxnId` | `invoice_qb_id` | resolve → `invoice_id` via invoice `qb_id` |
| `PaymentMethodRef.name` (best-effort) | `payment_method` | `payment_method` (nullable) |
| — | — | `client_id` from the linked invoice's client; `created_by` = importer |

Pull filter: `WHERE TxnDate >= {today−24mo}`. Payments not linked to a pulled invoice are still imported (client-level) but flagged in review; they contribute to Cash Flow but not to any invoice balance.

### 5.4 Line items (QB `Line[]` → OPS `line_items`) — VERIFIED against live sandbox JSON (2026-06-01)

Import **only** `DetailType = "SalesItemLineDetail"` lines.

| QB | OPS `line_items` | Note |
|----|------------------|------|
| `Line.Description` (fallback `SalesItemLineDetail.ItemRef.name`) | `name` (required) | every sales line in real data had a Description |
| `Line.Description` | `description` | |
| `SalesItemLineDetail.Qty` (default 1) | `quantity` | fractional allowed (real data had Qty 3.5) |
| `SalesItemLineDetail.UnitPrice` | `unit_price` | |
| — | `line_total` | **GENERATED**, = `round(qty × unit_price × (1−disc%/100),2)`; equals QB `Line.Amount` (verified 9.5×5 = 47.5). Never inserted. |
| `SalesItemLineDetail.TaxCodeRef != "NON"` | `is_taxable` | `"TAX"`→true, `"NON"`→false |
| QB `Item.Type` (via `ItemRef`) | `type` (LABOR/MATERIAL/OTHER) | QB has **no** LABOR/MATERIAL/OTHER concept (real items are `Type:"Service"`). Default **OTHER**; optionally `Inventory`/`NonInventory`→MATERIAL. Does not affect Books totals. |
| `Line.LineNum` | `sort_order` | |
| parent | `estimate_id` **xor** `invoice_id` | DB CHECK enforces exactly one |
| — | `product_id` | **NULL** — no catalog pre-creation (see below) |

**Skip these line types** (not product lines): `SubTotalLineDetail` (computed Σ — verified present as the trailing line on every invoice/estimate), `DiscountLineDetail` (fold into header discount), `DescriptionOnly` (fold into notes or skip), `GroupLineDetail` (flatten its nested `Line[]`). Tax lives under `TxnTaxDetail.TaxLine`, never in `Line[]`.

**No catalog pre-creation required (answers the build question).** QB lines reference QB `Item`s via `ItemRef`, but OPS `line_items.product_id` is **nullable** and `name` is free text, so lines import standalone. Importing the QB `Item` catalog into OPS `products` is *optional fidelity only* and is **out of scope** here — OPS `products` has required `kind` ∈{service,material,package}, `base_price`, `pricing_unit` ∈{each,flat_rate,linear_foot,sqft,hour,day}, and `tiered_pricing`, so synthesizing products from bare QB Items is high-risk for zero validation benefit.

**Insert safety:** `line_items` has **no triggers** (verified) — inserting lines does NOT recompute invoice/estimate headers, so QB-authoritative `subtotal`/`tax_amount`/`total` set on the header stand regardless of line rounding.

### 5.5 Header tax & totals (verified)

QB carries tax at the **transaction level** in `TxnTaxDetail` (not per line): `TotalTax` → `{invoice,estimate}.tax_amount`; `TaxLine[].TaxLineDetail.TaxPercent` → `.tax_rate`. The trailing `SubTotalLineDetail.Amount` (= Σ line amounts) → `.subtotal`; `TotalAmt` → `.total`. Verified: 335.25 + 26.82 = 362.07 = `TotalAmt`. Per-line `TaxCodeRef` only drives `is_taxable`.

### 5.6 Estimate → `estimates` (now IN scope — maps as cleanly as invoices)

Estimates import cleanly (verified) and unlock the estimate→invoice chain, so they are included.

| QB | OPS `estimates` |
|----|-----------------|
| `Id` | `qb_id` |
| `DocNumber` | `estimate_number` |
| `CustomerRef.value` | `client_id` (via matched client) |
| `TxnDate` | `issue_date` |
| `ExpirationDate` (when present) | `expiration_date` |
| `TotalAmt` / SubTotal / `TxnTaxDetail` | `total` / `subtotal` / `tax_amount` / `tax_rate` (per §5.5) |
| `TxnStatus` (Pending/Accepted/Closed/Rejected) | `status` (verified enum) — `Pending`→`sent` (→`expired` if `ExpirationDate < today`), `Accepted`→`approved`, `Closed`→`converted`, `Rejected`→`declined` |
| `Line[]` (SalesItemLineDetail) | `line_items` with `estimate_id` per §5.4 |

**Bonus linkage:** QB `Invoice.LinkedTxn[TxnType="Estimate"].TxnId` (verified present) → resolve to the matched estimate and set OPS `invoices.estimate_id`, reflecting the estimate→invoice chain inside OPS.

### 5.7 Payment can apply to multiple invoices (refinement, verified)

A QB `Payment` has a `Line[]`, each with `LinkedTxn[TxnType="Invoice"].TxnId`. Import **one OPS `payments` row per linked invoice line** — `amount` = that line's `Amount`, `invoice_id` resolved via the invoice's `qb_id`, `client_id` from `CustomerRef`. `UnappliedAmt` (overpayment/credit) is reported in review, not written as an invoice payment. `reference_number` ← `PaymentRefNum` / `LineEx` `txnReferenceNumber` when present; `payment_method` ← `PaymentMethodRef.name` when present (absent in sandbox sample — nullable).

---

## 6. Read-only enforcement (the safety core)

Defense in depth — any **one** of these is sufficient; we implement all:

1. **Direction mode.** New `accounting_connections.sync_direction`. The CanPro row is `'pull_only'`. `runSyncForConnection` (and the new import route) **assert** `sync_direction != 'push_only'` and **never call** any `push*` method when not `bidirectional`. In `pull_only`, the push code path is guarded out entirely.
2. **Separate entry point.** This phase uses **new** `POST /api/integrations/quickbooks/import` (pull→stage) and `.../import/apply` (stage→live). The legacy `POST /api/sync` (which pushes-then-pulls) is **not used** for this connection; we additionally gate `/api/sync` to refuse connections whose `sync_direction='pull_only'`.
3. **No scheduler.** `sync_enabled=false` on the connection; the cron remains unregistered in `vercel.json`. Nothing fires automatically.
4. **Apply writes only to OPS.** The apply step writes to `clients`/`invoices`/`payments` in Supabase — never to Intuit.
5. **Audit assertion in the success criteria:** the import run records `qb_write_calls=0`; a non-zero value is a hard failure.

> Recommendation (decide at build): set the **default** `sync_direction` for any *existing/new* connection to `'pull_only'` rather than `'bidirectional'`, so the still-untested push path can never run by accident anywhere until two-way is deliberately built and tested. This is safer and costs nothing now. The legacy bidirectional behavior would then require an explicit opt-in.

---

## 7. Customer matching algorithm (dry-run)

For each staged QB customer, compute a proposed action and confidence, store in `qbo_customer_matches`, surface in review. **Nothing is written to `clients` here.**

1. **Exact email match** (case-insensitive, trimmed) to an existing `clients.email` (non-deleted, same company) → propose **link**, confidence **high**.
2. Else **exact normalized-name match** (lowercase, collapse whitespace, strip punctuation/“inc/ltd/llc”) → propose **link**, confidence **medium**; if >1 client matches the name → propose **needs-review** (ambiguous), list candidates.
3. Else **fuzzy name** (trigram similarity ≥ 0.6 via `pg_trgm`) → propose **link?**, confidence **low** (defaults to *create* unless owner links).
4. Else → propose **create new client**.

Reuse the existing **`clients.merged_into_client_id`** mechanism for any duplicates the owner chooses to merge rather than link.

On **apply**: `link` writes `qb_id` onto the existing client (and nothing else — never overwrites name/email/phone/address); `create` inserts a new client carrying `qb_id`; `skip` drops the customer and any invoices/payments that depend on it (reported).

---

## 8. Apply semantics (correctness)

Order matters because of the `trg_payment_balance` trigger (§3.7). Apply runs in a transaction per import run:

1. **Clients** — apply `link` / `create` / `skip` per approved matches. Now every needed client has a `qb_id`.
2. **Estimates & invoice headers** — upsert on `(company_id, qb_id)`. Set `subtotal`, `tax_amount`, `tax_rate`, `total` from QB-authoritative values (§5.5); `invoice_number`/`estimate_number`, `issue_date`, `due_date`/`expiration_date`, resolved `client_id`, provisional `status`; and `invoices.estimate_id` from the linked estimate (§5.6). (Do **not** yet trust `amount_paid`/`balance_due`.)
3. **Line items** — insert SalesItemLineDetail lines per §5.4, keyed for idempotency on `(parent qb_id, QB line Id)` (or replace-all-by-parent on re-import). `line_items` has **no triggers**, so this is purely additive — header totals set in step 2 are untouched.
4. **Payments** — upsert on `(company_id, qb_id)`, one row per linked invoice line (§5.7). Each insert fires `trg_payment_balance`, which recomputes the invoice's `amount_paid`/`balance_due`/`status` from imported payments.
5. **Reconcile invoices to QB-authoritative balances** — final `UPDATE invoices SET amount_paid = total − {QB Balance}, balance_due = {QB Balance}, status = {derived}, paid_at = {if paid}` for every imported invoice. This corrects any gap where QB payments predate the 24-month window (so OPS A/R **exactly matches QB**), while the `payments` table still holds the in-window payments that feed Cash Flow.

**Idempotency.** Every entity keys on `(company_id, qb_id)`. Re-running pull+apply updates in place — no duplicates. A second import is a safe no-op if nothing changed in QB.

**Reversibility.** Because every imported row carries `qb_id`, a clean "undo this import" is possible (delete where `qb_id` in run-set and not manually edited). Provided as an operator action for the test, not user-facing.

---

## 9. Review UI (web)

Location: `/accounting`, new **"QuickBooks Import"** tab (gated by `accounting.manage_connections`, which the owner has). Military-minimal, design-system tokens, JetBrains Mono tabular numbers, em-dash for empty.

Sections:

1. **Run header** — connection status, "Last pulled HH:MM", a single **`PULL FROM QUICKBOOKS`** action (read-only; copy makes clear nothing is sent to QB).
2. **Reconciliation strip** — `QUICKBOOKS` vs `OPS (after import)`: open A/R total, # open invoices, collected (24mo), # customers. Deltas highlighted; green when matched to the cent.
3. **Customers** — table of proposed `link` / `create` / `skip` with confidence, inline candidate picker for ambiguous/low-confidence, bulk-accept.
4. **Invoices / Payments** — counts + totals to be created, with any orphans (payment without a pulled invoice) flagged.
5. **Apply** — `APPLY TO OPS` (enabled after review), with per-section apply (customers first is allowed). Confirmation states exactly what will be written.

Notification-rail event on apply completion (`persistent: false`, `actionUrl` → Books), per OPS notification standard.

Copy is drafted with `ops-copywriter` before build.

---

## 10. What lights up in iOS Books (and what doesn't)

- **P&L card** — `payments in` (imported payments, 24mo), `net cash`, margin. ✅
- **Cash Flow card** — weekly net from imported payments. ✅
- **A/R card** — outstanding + aging buckets from imported open invoices (balances reconciled to QB). ✅ This is the strongest validation surface.
- **Forecast card** — already works from CanPro's 381 opportunities; unaffected. ✅
- **Jobs card (per-job profit)** — **will NOT populate from this pull.** QB invoices carry no OPS `project_id`, so QB revenue can't be auto-attributed to CanPro's 208 projects. Expected boundary; it motivates Sub-project B and a future project-linking step. Explicitly surfaced, not hidden.

---

## 11. Security, permissions, config

- **Tokens:** plain-text this phase (decision #8); encryption-at-rest deferred via bug `7600a1a2-566b-4d11-82a9-db72e966ee85`. The review UI and logs must never render raw tokens.
- **Permissions:** connect/import/apply gated by `accounting.manage_connections` (owner has it; granted to Owner+Office roles). Per memory: never filter by role — gate via `has_permission`/permission catalog. If a new permission bit is introduced (e.g. `accounting.import`), it must be registered in `src/lib/types/permissions.ts` so account-holders aren't silently denied.
- **Feature flag:** enable the Import surface for the owner only via a `feature_flag_overrides` row on the `accounting` flag (flag stays OFF globally).
- **Env / Intuit:** `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI` (must exactly match the URI registered in the owner's Intuit app), `QB_ENVIRONMENT=production`. Wire `QB_ENVIRONMENT` to select the API base (prod now; sandbox-ready). Set in Vercel (ops-web) env.
- **Cost:** QuickBooks Online API access and an Intuit developer account are **free**; no per-call or connector fees for a direct integration. The only real cost is engineering time and the (mitigated) risk of touching a live company file. No Vercel/Supabase tier change required.

---

## 12. Phasing / milestones

- **A0 — Schema & safety rails.** Additive migration: `sync_direction` column, `qbo_staging_*`, `qbo_import_runs`, `qbo_customer_matches`. Direction-mode guard in `sync-orchestrator`. (iOS-sync-safe: all additive.)
- **A1 — Read-only pull service.** `quickbooks-pull-service.ts` with paginated Customer/Invoice/Estimate/Payment queries (including `Line[]`) + the open/24-month window; writes to staging; `qb_write_calls` counter (must stay 0).
- **A2 — Matching engine.** Customer match computation → `qbo_customer_matches` (`pg_trgm` enabled).
- **A3 — Apply engine.** Transactional, idempotent, trigger-aware (§8) — clients → estimate/invoice headers → line items → payments → balance reconcile, plus estimate→invoice linkage and an undo operator action.
- **A4 — Review UI.** Import tab, reconciliation strip, approve flow, notification event. (`ops-copywriter` + `ops-design` + `frontend-design`.)
- **A5 — Connect + live test.** Wire Intuit prod creds, connect CanPro read-only, pull → review → apply, verify success criteria §2, confirm zero QB writes.

---

## 13. Out of scope → Sub-project B (separate spec)

Profit/revenue-per-employee KPI on iOS Books. Requires net-new labor model that **does not exist today** and that **QuickBooks' standard accounting scope cannot supply** (no payroll/wage API): a per-user cost rate (additive nullable column, App-Store-safe), captured hours per employee per job (the dormant iOS `TimeEntry` model + a real `time_entries` table + capture UI), and a revenue-attribution rule. This pull provides the **revenue numerator** for company-level metrics but no labor-cost denominator. B is brainstormed and specced after A's live test, with real CanPro data in hand.

---

## 14. Locked decisions & residual risks

Per owner delegation of technical authority (2026-06-01), the following are **decided**, not open:

1. **`sync_direction` default = `pull_only` for ALL connections.** The untested bidirectional push path requires an explicit, deliberate opt-in to `bidirectional` (only when two-way is actually built + tested). Nothing can write to any provider by accident.
2. **Line `type` = inferred from QB `Item.Type`:** `Inventory`/`NonInventory` → `MATERIAL`; everything else (Service, etc.) → `OTHER`. (QB has no LABOR concept; does not affect Books totals — purely categorization.)
3. **Invoice status** derived per §5.2; **estimate status** mapped per §5.6 against the verified enums (`invoices.status` ∈ draft/sent/awaiting_payment/partially_paid/past_due/paid/void/written_off; `estimates.status` ∈ draft/sent/viewed/approved/changes_requested/declined/converted/expired/superseded).
4. **Voided / zero-total QB invoices → skipped + flagged**, never imported as live A/R.
5. **Line-item re-import = delete-all-by-parent then re-insert** (safe: `line_items` has no triggers/children). Headers and payments remain `(company_id, qb_id)` upserts.
6. **Multi-currency:** import amounts as-is in the QB file's home currency (CanPro = CAD; sandbox = USD); **no FX conversion**. If a multi-currency file is detected (`CurrencyRef` ≠ home), flag in review — cross-currency handling is out of scope this phase.
7. **Payment without a linked invoice** (deposits/retainers) → imported at client level, flagged; counts toward cash-in, excluded from A/R.

**Residual risk to confirm at A5 (live connect), not blocking the plan:**

- Confirm which code path created the 2026-03-06 stub connection (edge-function `accounting-oauth` vs ops-web callback) and that the connect flow we wire is the ops-web `pull_only` one.
- Confirm production Intuit credentials/redirect URI match before connecting CanPro's real file.
