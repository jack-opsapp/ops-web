# Phase 16 financial readiness evidence

Local implementation only. No push, deployment, production migration, company policy enrollment, financial OAuth activation or real financial document trial was performed.

- `sql-summary.log`: **160 passing PostgreSQL assertions**, including the Phase15 adversarial cases repeated after owner enrollment, historical quote +8%, accepted-baseline and revision preservation, exact receipts/retries, stale source/tax/owner/consent, revoked pending approvals and two-session enrollment contention. All business rows are fictional in a unique disposable `ops_p16_*` database, dropped after the run.
- `final-tests.log`: **119 passing application/protocol tests**; ten existing loopback callback tests could not bind under the sandbox. `canary-tests.log`: those **10 passed** on the loopback-enabled rerun. Combined: **129 passed**, 12 files. These are synthetic protocol tests, not authenticated Claude or ChatGPT acceptance.
- `typecheck-8g.log`: full repository TypeScript check passed with an 8 GiB heap (`--noEmit --incremental false`), exit 0 and no diagnostics. Default 4 GiB checks exhausted memory without diagnostics.
- `owner-review.png`: real in-app browser inspection of the production React component with fictional responses. Exact source, owner/company, terms, unit, price provenance, tax and explicit enrollment control were visible. The fixture makes no production request and refuses persistence. It does not prove the authenticated dashboard or a host connection.
- `production-readonly.json`: live no-change financial baseline. Product count includes two old deleted rows; usable Canpro products remain zero.
- `source-readiness.json`: hashes and unresolved authority decisions for the recovered external Canpro documents. These are evidence references, not approved business rules.

## Reproduce local SQL proof

Run `OPS_P16_APPLY=1 bash tests/sql/financial-readiness-run.sh` from this web worktree with PostgreSQL 17. The runner uses the existing disposable local server at `/private/tmp/ops-editorial-pg/socket`, port `55439`, creates only a uniquely named `ops_p16_*` database and drops it on exit. It never accepts a remote URL. The local server itself belongs to a separate task and is not stopped by this runner. If it is unavailable, provision an isolated local PostgreSQL server and update the local-only socket/port values; do not redirect the runner to production.

The fixture-only consent labels and effect installation are explicitly synthetic and protected by the disposable database-name assertion. The production migration deliberately leaves the prior financial effect seal stale.

## UI and authority review

The changed page/component has no raw color, spacing, radius or font values; it uses the current OPS Tailwind tokens and shared Input/Textarea/Button components. English and Spanish dictionaries cover new copy. New source text is escaped by React; details disclose source ID/hash without rendering HTML. Inputs have labels; errors and receipts have live roles; actions disable while pending and a synchronous latch prevents duplicate clicks. Visiting the page only reads. Successful enrollment uses the exact sealed preview. Uncertain responses retain that preview for retry. Revocation requires an explicit second confirmation and cannot release any financial hold.

Owner policy setup reuses the existing financial policy ledger and current canonical permission resolver. Browser callers cannot select actor/company or call privileged RPCs directly. Force-RLS private tables expose no app-role direct access. Policies are immutable except retirement. Enrollment, retirement, durable receipt and notification occur atomically under the existing financial locks. The policy source gate also binds current owner and exact approved default tax row. Candidate v17 exposure and v12 consent validate together against v23/domain dispatch, but remain absent from selectable catalogs and public defaults.
