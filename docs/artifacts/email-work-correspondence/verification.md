# Existing-job email correspondence — verification

Date: 2026-09-09. Status: local implementation; database migration and web release pending explicit approval. No production data was changed.

## Incident and cause

Read-only production inspection confirmed that the reported email concerned crew damage and deducting a replacement from an existing bill. The sender was already an exact subcontact of the customer with an in-progress project. The prior sales records were archived, and the project did not have an opportunity link. The forwarded message was intentionally message-scoped. The ingestion path treated the lack of an eligible sales match as permission for a new lead; it had no independent existing-project work-purpose gate. The classifier's own summary described existing-job reimbursement while a terminal sales guess was coerced to an active negotiation stage.

This fix preserves archived-sales eligibility rules and forwarded-message isolation. It adds independent exact customer/project context and current-message purpose/evidence checks before new-sale creation.

## Implemented behavior

- Existing-job correspondence is retained on the proven project. Ambiguous identity, property or purpose stays readable in the default Needs Review tab.
- New work from an established customer requires a current-message verbatim evidence span. Old quoted/forwarded requests cannot grant that authority.
- Automatic classification, patterns, deferred recovery, outbound initiation and both import entry points share the boundary. Existing lead ownership and authenticated external intake remain authoritative.
- Wizard imports hydrate the exact provider source under the mailbox lease before finalizing a review hold. Empty provider-clean bodies fall back to the retained original body.
- Exact company/mailbox/message/thread receipts make retries idempotent. Stale pending parents fall back to review; finalized receipts and operator acknowledgement survive replay.
- No new opportunity/client, archived lead reopening, sales-stage advance, new-lead notification or Phase C sales draft is produced by a correspondence receipt.
- Project email reads use signed-in activities RLS. Notifications contain generic text, not email bodies/subjects.

## Evidence

- **333 distinct Vitest tests passed across 11 affected suites.** Three suites: 134 passed. Eight other suites: 198 passed; the project-activity suite was then extended and rerun at 12 passed, replacing its earlier 11 tests. Covers sync/recovery, classification and evidence parsing, relationship matching, imports, route authorization, Phase C suppression and project activity visibility/body fallback.
- **20 PostgreSQL 17 checks passed**, including concurrent replay, exact source/tenant checks, subcontact/project attachment without a sale, immutable receipts, acknowledgement replay, deleted pending project, changed pending contact, and rejection of NULL-marker legacy recovery. Run `bash tests/sql/email-work-correspondence-run-runtime.sh` to reproduce against its disposable local cluster.
- Focused TypeScript check: exit 0. Its checked-in `tsconfig.json` covers every changed TypeScript source and reachable dependencies.
- ESLint over all changed TypeScript sources: exit 0, no errors; 14 pre-existing console warnings.
- Independent read-only review completed. Findings about quoted forwards, interrupted inbound/outbound persistence, counters, Stage B bounds, import body hydration, stale-parent recovery, SQL NULL semantics and Microsoft365 action coverage were corrected and regression checked.
- Live schema/RLS were fetched through Supabase before writing the migration. The local SQL fixture reproduces relevant current column types and exercises the actual migration; unrelated production triggers and RLS are not replicated.

## Limits and release order

The full repository TypeScript sweep exhausted the default heap; the scoped check is the completion evidence. No production migration, paid model evaluation, provider mutation, live mailbox replay, browser canary or iOS build/release was performed. The web UI reuses existing timeline/review components and design tokens; hook/authorization tests, type checking and lint cover the change, not a production visual canary.

No new paid service/subscription is introduced. Classification uses the existing configured API; added prompt tokens and classification of known-project emails that previously bypassed the model can increase normal usage. Exact incremental cost depends on traffic; no paid evaluation was run for this repair.

After explicit approval: verify the then-current deployment/main state, apply the additive migration, release the web code, verify the production RPC permissions and UI, and perform an authorized controlled mailbox canary. The existing incorrect lead is intentionally unchanged; this implementation contains no historical deletion or reparenting script.

Primary source: `supabase/migrations/20260909051427_email_existing_job_correspondence.sql` and `src/lib/email/email-work-routing.ts`. Bible updates describe the same behavior and mark the migration unapplied under `migrations/pending/`.
