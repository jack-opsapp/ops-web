# W2 — QuickBooks outbound write gaps (bug burndown, 2026-07-03)

Branch: `fix/qbo-outbound-gaps` (off `origin/main` @ 9583c129). Sandbox: Maverick
(company `ddee107c`, connection `956dfa13`, provider_environment `sandbox`).

## TL;DR

Five bugs were filed on **2026-06-06**, at the very start of the QuickBooks
outbound push. `origin/main` has advanced a long way since then (the
`13947f15` / `c04d1e8c` / `16389539` hardening commits). Reconciling each bug
against the **live** queue, the **live** DB trigger, and the current code:

| Bug | Priority | Reality on main today | What this branch does |
|-----|----------|----------------------|-----------------------|
| 6496546c fallback service item | URGENT | env resolver exists but production read the legacy **unsuffixed** names first (unsafe across the sandbox→prod switch); estimate-create row already drained | **Fix:** environment-strict resolver (production can never read a sandbox/unsuffixed value) + tests. Drain the one still-stuck row. |
| 3c86af66 webhook skips inactive customer | HIGH | already fixed in `13947f15` — the Customer read carries `Active IN (true, false)` | **Verify + lock** with a pull-service test. |
| 65d563f5 Full CRUD leaves propagate_deletes=false | HIGH | route + data already coherent; UI added a switch but enabling Full CRUD still defaulted deletes **off** | **Fix:** Full CRUD now propagates deletes by default (explicit opt-out), + copy. |
| 40da3f20 payment 400, no diagnostics | HIGH | already fixed — redacted provider diagnostics landed (`16389539`); payment create **succeeded live** (QBO 182) | **Verify + close.** Regression coverage already exists. |
| 3255f3fc voids route to needs_review | HIGH | already fixed — invoice/payment void + estimate delete all implemented; payment void **succeeded live** | **Verify + close.** Regression coverage already exists. |

Net: **1 real code fix** (Bug 1 resolver), **1 UX fix** (Bug 3 default), **3
verify-and-close** with the fixes already shipped. Every one is backed by live
DB evidence, not assumption.

## Live evidence (queue state, 2026-07-03)

- estimate-create `e9efe0fe` → **succeeded**, QBO 183. (fallback fix drained it)
- invoice-update `6b9207f7` → **needs_review**, but the error is no longer
  "fallback service item required" — it is now
  `[6000] … Make sure all your transactions have a GST/HST rate before you save.`
  The fallback fix worked; the row is now blocked on a **Canadian tax-code**
  requirement (see "Drain" below).
- payment-create `21a3744d` → **succeeded**, QBO 182. (Bug 4's 400 is gone)
- payment-void `bdbf367b` → **succeeded**, QBO 182. (Bug 5 void works)
- customer create/update/inactivate → all **succeeded** outbound.
- connection `956dfa13`: `sync_direction=bidirectional`, `propagate_deletes=true`,
  `is_connected=true`, `sync_enabled=true`.

## Bug 1 — the actual remaining defect

`push-queue/route.ts` resolved the fallback service item and tax codes from env
names that, **for production**, read the legacy unsuffixed `QB_FALLBACK_*` /
`QB_TAX_CODE_*` **first**. Item ids and tax-code ids are realm-specific, so once
a connection flips to production, an unsuffixed value left over from sandbox
would be attached to a production write → QuickBooks 400. That is the
"unsuffixed → unsafe across the switch" part of the bug.

Fix: resolution moved into `quickbooks-config.ts` (the single source of truth
for QB env) as pure, tested functions, scoped by `provider_environment`:

- **sandbox** reads `QB_SANDBOX_*` / `QBO_SANDBOX_*`, then the legacy unsuffixed
  names as a last resort (so no existing sandbox config breaks).
- **production** reads **only** `QB_PROD_*` / `QBO_PROD_*` (+ `QB_PRODUCTION_*`
  aliases). It never reads an unsuffixed or sandbox value. Flipping to
  production can only ever resolve a value explicitly set for production, or
  resolve nothing (a safe, loud block) — never a realm-mismatched id.

## Bug 3 — the product decision

Enabling "Full CRUD" passed the connection's current `propagate_deletes` (false
for a read-only connection), so Full CRUD turned on but voids/inactivations
silently never propagated until the operator found a second switch. The reporter
explicitly called this out as contradicting "end-to-end create/update/void."

Decision: **Full CRUD means full CRUD.** Enabling it now defaults delete
propagation **on** — the confirmation dialog is the consent step — with the
"Propagate deletes" switch as an explicit opt-out. Applied to both the Settings
tab and the Books connection modal; warning copy (en + es) updated.

**No data migration.** Live audit found **0** connections in the incoherent
state (`bidirectional` + `propagate_deletes=false`). A blanket backfill to
`true` was deliberately NOT written: it would silently flip an existing
connection into pushing deletes to a customer's real QuickBooks with no consent
step — an unsafe surprise for a financial behavior. The fix is forward-only; new
enables consent via the dialog.

## Drain of the stuck invoice-update row

`6b9207f7` failed on GST/HST at 03:26 on 2026-06-07 — **before** the sandbox
tax-code envs were configured (the later estimate write at 04:53 succeeded). It
was never re-driven. This branch resets it to `pending`; the live 15-minute push
cron re-drives it automatically.

It will drain **iff** the sandbox taxable tax-code env is set. Confirm in Vercel:

- `QB_SANDBOX_TAX_CODE_TAXABLE_ID` (and `QB_SANDBOX_TAX_CODE_NONTAXABLE_ID`)

Verify it drained:

```sql
select status, external_id, last_error, updated_at
from accounting_sync_queue where id = '6b9207f7-b128-40a3-b606-3ef637432da6';
-- want: status='succeeded'
```

## What Jackson needs to do

1. **Merge** `fix/qbo-outbound-gaps` when ready (ops-web `main` auto-deploys to
   customers — your call, your go).
2. **Confirm/set the production env vars before going live on a production QBO
   file:** `QB_PROD_FALLBACK_SERVICE_ITEM_ID`, `QB_PROD_TAX_CODE_TAXABLE_ID`,
   `QB_PROD_TAX_CODE_NONTAXABLE_ID` (production now reads ONLY the `QB_PROD_*` /
   `QB_PRODUCTION_*` names — this is the safety fix). Sandbox is unchanged.
3. **Confirm the sandbox taxable tax-code env** (`QB_SANDBOX_TAX_CODE_TAXABLE_ID`)
   so the reset invoice-update row drains on the next cron.

## Test evidence

- `quickbooks-fallback-config.test.ts` — 15 tests (env-strict resolver, incl. the
  "production never reads unsuffixed" safety case).
- `quickbooks-pull-service.test.ts` — 3 tests (inactive-inclusive Customer read).
- `quickbooks-write-service.test.ts` (16) + `qbo-push-mappers.test.ts` (25) —
  pre-existing, cover the void/delete routing + payment mapping + diagnostics
  redaction that Bugs 4/5 named. All green.
- Full accounting service suite: **186 passed**. Changed files typecheck + lint
  clean. (Pre-existing suite failures are all in catalog-setup/`xlsx` and
  projects-table — unrelated to this workstream.)
