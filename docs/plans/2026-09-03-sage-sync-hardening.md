# Sage Bidirectional Sync Hardening Implementation Plan

> **For the executing agent:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Replace Sage's direct, business-ambiguous sync paths with an explicitly business-bound, queue-owned, idempotent connector proven by deterministic provider simulation, PostgreSQL 17 runtime tests, and an optional dedicated Sage test-business war game.

**Architecture:** Keep the hardened accounting queue as the shared reliability core. Add Sage-specific configuration, OAuth/business binding, transport, mapping, and reconciliation adapters; extend the database only with additive Sage identity/OAuth evidence and provider-generic queue safeguards. Sage sandbox is a logical OPS environment mapped to allow-listed Sage trial businesses on the normal Sage API host.

**Tech Stack:** Next.js 15 App Router, TypeScript, Vitest, Supabase/PostgreSQL 17, Sage Business Cloud Accounting API v3.1, React/Tailwind.

**Design System:** `.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `supabase:supabase`, `superpowers:verification-before-completion`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`.

**Safety boundary:** Never call production Sage or QuickBooks, push, deploy, or apply a production migration. Real Sage calls require the sandbox profile, both write gates, and an exact `SAGE_SANDBOX_BUSINESS_IDS` match. If credentials are absent, complete deterministic provider and PostgreSQL proof and report the provider test-business layer as blocked.

---

### Task 1: Sage profile and identity primitives

**Skills:** `superpowers:test-driven-development`

**Files:**

- Create: `src/lib/api/services/sage-config.ts`
- Create: `src/lib/api/services/sage-idempotency.ts`
- Create: `src/lib/api/services/__tests__/sage-config.test.ts`
- Create: `src/lib/api/services/__tests__/sage-idempotency.test.ts`

**Design tokens:** N/A.

1. Write failing profile tests for development's sandbox default, production's production default, invalid profile rejection, exact sandbox credential resolution, no sandbox-to-production credential fallback, redirect URI selection, comma-separated business-id normalization, and write-gate evaluation.
2. Run the two new test files and verify they fail because the modules do not exist.
3. Implement `getSageProviderEnvironment()`, `getSageCredentials(environment)`, `getAllowedSageBusinessIds(environment)`, and `assertSageWriteAllowed({ environment, businessId })`. The assertion requires `ACCOUNTING_WRITE_ENABLED=true`, `SAGE_WRITE_ENABLED=true`, and for production `SAGE_PRODUCTION_WRITE_ENABLED=true`; sandbox additionally requires a non-empty allow-list containing the exact business id.
4. Write failing tests proving one immutable queue UUID/resource tuple always returns the same 32-character lowercase hex idempotency id, while a different queue or resource cannot collide.
5. Implement the id as the first 32 hex characters of HMAC-SHA256 over `sage:<resource>:<queueId>`, keyed by `QB_TOKEN_ENC_KEY`. Reject malformed queue UUIDs and unsupported resources.
6. Run the new tests and existing QuickBooks config/token tests.
7. Commit: `feat(sage): add fail-closed provider profiles`.

### Task 2: Additive OAuth and Sage business schema

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Create: `supabase/migrations/20260904040000_sage_connection_identity_and_oauth.sql`
- Create: `tests/unit/supabase/sage-connection-identity-migration.test.ts`
- Create: `tests/sql/sage-sync-hardening-postgres17-baseline.sql`
- Create: `tests/sql/sage-sync-hardening-oauth-runtime.sql`
- Create: `tests/integration/sage-sync-hardening-postgres-runtime.test.ts`
- Modify: `src/lib/types/database.types.ts`

**Design tokens:** N/A.

1. Write migration-structure tests requiring nullable `sage_business_id`, `sage_business_id_lookup`, `sage_business_name`, and `sage_document_kind`; service-role-only OAuth attempt/selection tables; one writable Sage environment per company; lookup uniqueness per provider/environment; fixed `search_path`; and explicit `PUBLIC`/`anon`/`authenticated` revokes.
2. Build the minimal PostgreSQL 17 baseline from the live schema shapes already verified read-only. Do not read or write production during the harness.
3. Add failing SQL assertions for expired/replayed OAuth attempts, cross-company consumption, duplicate Sage business binding, multiple writable environments, and browser-role reads/writes to secret-bearing tables.
4. Implement an additive migration:
   - connection columns and indexes for encrypted Sage business identity;
   - `estimates.sage_document_kind` with `sales_estimate|sales_quote` check;
   - `accounting_oauth_attempts` with state digest, actor, company, environment, encrypted verifier, return surface, expiry, and atomic consumed timestamp;
   - `sage_business_selection_sessions` with encrypted pending grant, eligible business JSON, actor/company/environment, expiry, and atomic consumption;
   - service-role-only claim/consume RPCs using row locks and fixed search paths;
   - partial unique index for one writable Sage connection.
5. Run structure tests and PostgreSQL OAuth runtime proof.
6. Regenerate only the affected handwritten database types; preserve unrelated generated-type changes.
7. Commit: `feat(sage): add durable OAuth business identity`.

### Task 3: Harden Sage OAuth, business selection, disconnect, and refresh

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `supabase:supabase`

**Files:**

- Create: `src/lib/api/services/sage-oauth-service.ts`
- Create: `src/app/api/integrations/sage/businesses/route.ts`
- Create: `tests/integration/sage-oauth-route.test.ts`
- Create: `tests/integration/sage-callback-route.test.ts`
- Create: `tests/integration/sage-business-selection-route.test.ts`
- Create: `tests/integration/sage-disconnect-route.test.ts`
- Modify: `src/app/api/integrations/sage/route.ts`
- Modify: `src/app/api/integrations/sage/callback/route.ts`
- Modify: `src/lib/api/services/accounting-token-service.ts`
- Modify: `tests/unit/services/accounting-token-service.test.ts`

**Design tokens:** N/A.

1. Copy the hardened QuickBooks route's auth spine into Sage tests: signed-in actor, authoritative company, `accounting.manage_connections`, conflicting-provider guard, selected return surface, and exact environment row.
2. Add failing tests for caller-supplied company substitution, missing permission, expired/replayed state, PKCE verifier use, code replay, environment substitution, token-body redaction, zero/one/multiple active businesses, sandbox allow-list filtering, and callback activation remaining pull-only.
3. Implement `S256` PKCE and opaque state. Store only the state digest and encrypted verifier in `accounting_oauth_attempts`; atomically consume the attempt before token exchange.
4. Implement token exchange and `/businesses` discovery through `sage-oauth-service.ts`. Validate response shapes and active subscription status. Never log provider bodies.
5. Auto-bind one eligible business. For multiple businesses, create a short-lived selection session and redirect with an opaque session id; store no token or business list in the URL.
6. Add authenticated GET/POST selection endpoints. POST re-fetches the businesses, proves the chosen id is still eligible, encrypts the business id/tokens, and activates the row as `pull_only`, `sync_enabled=false`, `propagate_deletes=false`.
7. Harden disconnect to auth/permission scope the exact environment row, use matching credentials, tolerate remote revoke transport failure, clear all local secret/business identity, and return 404 for no row.
8. Extend token refresh tests for Sage profile selection, five-minute expiry, rotating refresh token, missing replacement token, sibling refresh race, transient 429/5xx, `invalid_grant`, persistent 403, and sanitized errors.
9. Implement the Sage refresh branch without changing QuickBooks behavior.
10. Run all Sage OAuth tests plus existing QuickBooks OAuth/disconnect/token tests.
11. Commit: `fix(sage): secure OAuth and token lifecycle`.

### Task 4: Build the business-bound Sage API client

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`

**Files:**

- Create: `src/lib/api/services/sage-api-client.ts`
- Create: `src/lib/api/services/__tests__/sage-api-client.test.ts`
- Create: `tests/fixtures/sage/businesses-page-1.json`
- Create: `tests/fixtures/sage/businesses-page-2.json`
- Delete after consumers migrate: `src/lib/api/services/sage-purchasing-service.ts`
- Delete after consumers migrate: `src/lib/api/services/sage-sync-service.ts`

**Design tokens:** N/A.

1. Write a stateful fake-fetch test harness that records method, URL, headers, body, request order, and response request id without logging credentials.
2. Add failing tests proving construction rejects an empty business id and every accounting call sends the exact `X-Business` header.
3. Add failing tests for one refresh-and-replay on 401, persistent 403 disconnect classification, `Retry-After` extraction on 429, bounded retry classification for 408/425/5xx, terminal validation 4xx, empty 204 responses, JSON-shape failure, and sanitized `x_request_id` evidence.
4. Add pagination tests for 201+ records, `$next` traversal, page-number fallback, incremental `updated_or_created_since`, duplicate overlap rows, and repeated-cursor rejection.
5. Add write tests requiring the resource-scoped `idempotency_id`, stable replay, resource mismatch prevention, encoded ids, and accepted-write evidence.
6. Implement a single `SageApiClient` with injected token supplier, refresh callback, disconnect callback, clock, sleep, randomness, and fetch. Separate `list/get` from `create/update/voidOrDelete` methods so read-only tests cannot access write functions.
7. Run client tests and type-check the module.
8. Do not delete legacy services until Tasks 6–8 remove all imports.
9. Commit: `feat(sage): add business-bound API client`.

### Task 5: Canonical full-line-item Sage mappers

**Skills:** `superpowers:test-driven-development`

**Files:**

- Create: `src/lib/api/services/sage-push-mappers.ts`
- Create: `src/lib/api/services/sage-normalize.ts`
- Create: `src/lib/api/services/__tests__/sage-push-mappers.test.ts`
- Create: `src/lib/api/services/__tests__/sage-normalize.test.ts`
- Modify: `src/lib/accounting/supplier-bills/provider-mappers.ts`
- Modify: `src/lib/accounting/supplier-bills/__tests__/provider-mappers.test.ts`

**Design tokens:** N/A.

1. Add failing mapper tests for customer/supplier contacts, sales estimate, legacy sales quote, sales invoice, customer receipt, purchase invoice, and supplier payment.
2. Prove every financial document carries every OPS line with description, quantity, unit price, mapped ledger account, tax type/rate, and exact calculated total. Assert missing required account/tax/payment-account mappings fail before API I/O.
3. Add tests for zero/negative quantity policy, decimal rounding, empty lines, over-allocation, contact/invoice id dependencies, document dates, due/expiry dates, and supported status transitions.
4. Implement pure resource envelopes with the queue-derived `idempotency_id` inside the documented Sage resource namespace.
5. Refactor supplier-bill mappers to call the canonical Sage mapper primitives so AP and AR cannot diverge.
6. Add inbound normalization tests for complete line items, statuses, outstanding amounts, allocations, tombstones/voids, sales estimate versus quote identity, and provider timestamps.
7. Implement normalization without database access.
8. Run mapper/normalizer and supplier-bill contract tests.
9. Commit: `feat(sage): preserve canonical financial documents`.

### Task 6: Generalize queue creation, dependencies, and recovery for Sage

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Create: `supabase/migrations/20260904050000_sage_queue_hardening.sql`
- Create: `tests/unit/supabase/sage-queue-hardening-migration.test.ts`
- Create: `tests/sql/sage-sync-hardening-queue-runtime.sql`
- Modify: `tests/integration/sage-sync-hardening-postgres-runtime.test.ts`
- Modify: `src/lib/api/services/accounting-sync-queue-types.ts`
- Modify: `src/lib/types/database.types.ts`

**Design tokens:** N/A.

1. Add failing SQL cases proving Sage receives no queue row while pull-only/disabled, a QuickBooks connection cannot absorb a Sage job, sandbox and production jobs cannot cancel each other, duplicate trigger delivery coalesces, and provider-origin writes enqueue nothing.
2. Add create/update same-burst cases for contacts and documents; parent dependency cases for invoice/payment and supplier bill/payment; tombstone-after-update cases; stale unaccepted claim recovery; and stale accepted-write non-recovery.
3. Extend queue evidence with nullable `provider_request_id`, `provider_accepted_at`, and `idempotency_expires_at`. Keep old rows valid.
4. Generalize `enqueue_accounting_sync()` to select the one exact writable accounting connection, then emit provider-correct operations and payload snapshots. Continue suppressing all provider-origin transactions.
5. Extend `claim_accounting_sync_queue` with same-entity create fences, parent dependency checks, lifecycle ordering, fair entity-type interleaving, expired-lock recovery, and accepted-write exclusion. Preserve connection/company/provider scoping and service-role-only execution.
6. Add SQL sentinels for grants, fixed search paths, bounded batch sizes, indexes supporting each claim predicate, and one writable Sage environment.
7. Run PostgreSQL queue runtime tests and all existing QBO queue/payment/reconciliation runtime tests to prove no regression.
8. Commit: `feat(sage): extend durable accounting queue`.

### Task 7: Make every Sage outbound write queue-owned

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`

**Files:**

- Create: `src/lib/api/services/sage-queue-processor.ts`
- Create: `src/lib/api/services/__tests__/sage-queue-processor.test.ts`
- Create: `src/app/api/cron/accounting/sage/push-queue/route.ts`
- Create: `tests/integration/sage-push-queue-route.test.ts`
- Modify: `src/lib/api/services/supplier-bill-provider-sync-service.ts`
- Modify: `src/lib/api/services/supplier-bill-queue-processor.ts`
- Modify: `src/app/api/cron/accounting/sage/push-supplier-bills/route.ts`
- Modify: `src/app/api/cron/accounting-sync/route.ts`
- Modify: `src/app/api/sync/route.ts`
- Modify: `src/lib/api/services/sync-orchestrator.ts`

**Design tokens:** N/A.

1. Add processor tests for exact connection/provider/company/environment checks, direction gate, layered write gates, business decryption, sandbox allow-list, missing parent ids, and unknown resource/operation rejection before fetch.
2. Add duplicate delivery, retryable 429/5xx, terminal validation, invalid grant, accepted-provider/local-finalization failure, replay inside seven days, expired replay window, lock-owner mismatch, and database-overload batch-stop tests.
3. Implement the processor as: load claimed row → load exact connection → validate write boundary → get valid token → build business-bound client → reload authoritative OPS graph → map → write → durably record accepted evidence → finalize external ids/provider links → complete job.
4. Serialize Sage creates per connection. The cron claims a small fair batch but processes provider writes sequentially; it stops immediately after uncertain local durability.
5. Route supplier bills through the same client and accepted-write/finalization contract. Keep the old supplier-bill URL as a compatibility wrapper that invokes the unified worker without a separate transport.
6. Make `/api/cron/accounting-sync` and `/api/sync` refuse legacy Sage writes and return queue-managed semantics. Delete Sage push branches from `sync-orchestrator` while retaining safe pull compatibility until Task 8 replaces it.
7. Run Sage queue tests, supplier-bill tests, generic accounting route tests, and the QBO push-queue suite.
8. Commit: `fix(sage): make provider writes queue-owned`.

### Task 8: Add fair pull reconciliation, lifecycle application, and echo suppression

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`, `superpowers:systematic-debugging`

**Files:**

- Create: `src/lib/api/services/sage-reconcile-service.ts`
- Create: `src/lib/api/services/__tests__/sage-reconcile-service.test.ts`
- Create: `src/app/api/cron/accounting/sage/reconcile/route.ts`
- Create: `tests/integration/sage-reconcile-route.test.ts`
- Create: `tests/sql/sage-sync-hardening-reconcile-runtime.sql`
- Modify: `supabase/migrations/20260904050000_sage_queue_hardening.sql`
- Modify: `tests/integration/sage-sync-hardening-postgres-runtime.test.ts`
- Modify: `src/lib/api/services/sync-orchestrator.ts`

**Design tokens:** N/A.

1. Add failing RPC/runtime tests for unseen-first and least-recently-seen ordering, fair progress across seven Sage lanes, exact connection/environment filtering, tombstone exclusion, and raw external payment ids.
2. Implement a service-role-only `list_sage_reconcile_candidates(connection_id, limit)` RPC with a 1–100 clamp, lane interleaving, fixed search path, and browser-role revokes.
3. Add route tests for cron authorization, no production execution during tests, incremental overlap window, 200-record pagination, missing business identity, and read-only behavior.
4. Add application tests for contacts, estimate/quote lines, invoice lines, customer payment allocation moves/voids, supplier bill/payment links, provider-side tombstones, and partial page failure.
5. Implement inbound application inside exact provider-origin suppression. Use canonical fingerprints to avoid no-op rewrites; protect newer unsynced OPS edits by creating `needs_review` instead of overwriting.
6. Recalculate both old and new invoice/bill balances for payment moves or voids in one transaction. The suppression marker must cover derivative balance writes.
7. Replace Sage pull logic in `sync-orchestrator`; then remove all remaining imports of `sage-sync-service.ts` and delete both legacy Sage transport files.
8. Run Sage reconciliation tests, PostgreSQL proof, and QBO reconciliation/payment tests.
9. Commit: `feat(sage): reconcile without echoes or starvation`.

### Task 9: Add the one-time Sage business-selection state

**Skills:** `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:test-driven-development`

**Files:**

- Create: `src/components/books/sync/sage-business-selection-modal.tsx`
- Create: `tests/unit/components/sage-business-selection-modal.test.tsx`
- Modify: `src/components/books/segments/sync-segment.tsx`
- Modify: `src/components/books/sync/connection-badge.tsx`
- Modify: `src/lib/hooks/use-accounting.ts`
- Modify: `src/i18n/dictionaries/en/accounting.json`
- Modify: `src/i18n/dictionaries/es/accounting.json`
- Modify: `tests/unit/components/books-sync-segment.test.tsx`

**Design tokens:** `<Surface variant="dense">`, `rounded-modal`, `border-glass-border`, `bg-surface-input`, `bg-surface-hover`, `text-text`, `text-text-2`, `text-text-3`, `text-olive`, `text-tan`, `text-rose`, `ring-ops-accent`; Mohave body, JetBrains Mono metadata/numbers, Cake Mono Light uppercase title/buttons.

1. Record the interface intent before code: the owner has just authorized Sage and must bind one business with certainty; the modal should feel like a final identity check, not another setup dashboard. Use pure-black canvas ancestry, dense glass, borders-only depth, and no decorative iconography.
2. Evaluate four structures against existing Books patterns:

   ```text
   Hierarchical page:    BOOKS > SYNC > SAGE > business list        (too much navigation)
   Dashboard/grid:       [business] [business] [business]            (wrong frequency/prominence)
   Flow-focused modal:   // SELECT SAGE BUSINESS\n[row]\n[row]\n[CANCEL] [CONNECT]  (selected)
   Hybrid inline panel:  connected badge expands into business rows  (weak interruption safety)
   ```

3. Write failing component tests for loading, expired session, zero options, one/many options, keyboard/radio selection, disabled submit, duplicate submit, server rejection, success refetch, focus return, and URL cleanup.
4. Write terse localized product copy. English authority labels: `SELECT SAGE BUSINESS`, `CONNECT`, `CANCEL`; helper: `Choose the Sage business OPS will sync.`; sandbox metadata: `SANDBOX`. Spanish must communicate the same action and risk without literal awkwardness.
5. Implement one dense modal using existing dialog/button/radio primitives. No new color, spacing, radius, font, icon, or animation values. Use the existing dialog transition and reduced-motion behavior.
6. Show the bound Sage business name and `SANDBOX` marker in the compact connected badge. Do not add provider cards or permanent setup acreage.
7. Run component/i18n tests and render at 375, 768, 1024, and 1440 widths. Verify keyboard operation and visible focus.
8. Run `custom-skills:audit-design-system` against only the touched UI/dictionaries and fix every violation before commit.
9. Commit: `feat(sage): add explicit business selection`.

### Task 10: Complete the deterministic Sage war game

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `supabase:supabase`

**Files:**

- Create: `tests/helpers/fake-sage-server.ts`
- Create: `tests/integration/sage-war-game.test.ts`
- Create: `tests/sql/sage-sync-hardening-payment-runtime.sql`
- Modify: `tests/integration/sage-sync-hardening-postgres-runtime.test.ts`

**Design tokens:** N/A.

1. Model token, business, contact, estimate, quote, invoice, payment, supplier, purchase-invoice, and supplier-payment state in the fake server. Require `X-Business` and resource-scoped idempotency on every write.
2. Execute the complete dependency graph with at least two lines per financial document and assert exact provider state and local external-id finalization.
3. Inject each failure class: auth expiry, refresh rotation, 403 revocation, 429, 500/503, response loss after acceptance, local finalization loss, duplicate cron delivery, concurrent workers, stale claims, dependency failure, pagination duplication, partial page failure, tombstone/void, payment move, and reconciliation conflict.
4. Assert at-most-one logical provider object, no child before parent, no cross-business request, no echo job, fair reconciliation progress, and an explicit terminal/review outcome for every queue row.
5. Run the fake-provider war game repeatedly with deterministic clock/randomness to prove replay stability.
6. Run the PostgreSQL payment/queue/reconcile/OAuth scripts together on PostgreSQL 17.
7. Commit: `test(sage): war-game connector recovery edges`.

### Task 11: Add a sandbox-only real provider runner and cleanup proof

**Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`

**Files:**

- Create: `scripts/sage-sandbox-war-game.ts`
- Create: `src/lib/api/services/__tests__/sage-sandbox-manifest.test.ts`
- Create: `docs/runbooks/sage-sandbox-war-game.md`

**Design tokens:** N/A.

1. Write manifest tests requiring a unique run id, exact Sage business id, exact OPS ids, external ids by resource, created-at timestamps, cleanup status, and redaction of tokens/provider bodies.
2. Implement a runner that exits before network I/O unless profile is sandbox, both write gates are true, the token key exists, dedicated sandbox credentials exist, and the selected business is exactly allow-listed.
3. Create uniquely tagged customer and supplier contacts, sales estimate, sales quote, sales invoice, customer payment, purchase invoice, and supplier payment with multiple lines. Record every accepted id immediately.
4. Exercise update, payment reallocation, duplicate request replay, pull reconciliation, token refresh, and documented void/delete operations. Read back every result through the exact `X-Business` header.
5. In `finally`, clean provider resources in reverse dependency order. Delete only OPS rows whose exact ids appear in the manifest. Independently re-read provider terminal state and query zero remaining OPS rows.
6. Write the redacted manifest under `docs/artifacts/sage-sandbox-war-game/` only when it is useful proof; otherwise use a temporary directory and remove it after reporting.
7. If credentials are unavailable, run the preflight to its explicit `BLOCKED` result. Do not weaken the gate or use production credentials.
8. Commit: `test(sage): add sandbox-only acceptance runner`.

### Task 12: Update the Software Bible and complete local integration

**Skills:** `superpowers:verification-before-completion`, `supabase:supabase`

**Files:**

- Modify in Bible worktree: `03_DATA_ARCHITECTURE.md`
- Modify in Bible worktree: `04_API_AND_INTEGRATION.md`
- Modify in Bible worktree: `09_FINANCIAL_SYSTEM.md`
- Copy in Bible worktree: `migrations/20260904040000_sage_connection_identity_and_oauth.sql`
- Copy in Bible worktree: `migrations/20260904050000_sage_queue_hardening.sql`

**Design tokens:** N/A.

1. Run the Sage-focused Vitest suite, complete accounting/QBO regression pack, PostgreSQL 17 runtime suite, TypeScript type-check, and formatting checks for every touched file.
2. Run the real Sage sandbox runner only if its strict preflight passes. Preserve the exact blocked reason otherwise.
3. Review migration security: additive changes, company/connection/provider/environment scope, RLS, explicit grants/revokes, fixed search paths, bounded inputs, correct indexes, idempotent sentinels, and no production application.
4. Review UI against `.interface-design/system.md` and `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`; verify zero hardcoded visual values, complete English/Spanish copy, keyboard/focus states, and no permanent provider-card regression.
5. Inspect the web diff and commit any final coherent fixes. Record the final web commit id.
6. Update the three Bible chapters with the implemented schema, API/OAuth/business-binding contract, queue/reconciliation/tombstone behavior, exact env vars, test-business meaning, runtime proof, release boundary, and code commit id. Mirror both unapplied migration files and label them local-only pending release approval.
7. Commit Bible changes: `docs(sage): document durable sync hardening`.
8. Re-run focused web tests after documentation references settle and prove both worktrees clean.
9. Merge the web branch into the existing local `main` integration worktree only if its checkout is clean and the merge is conflict-free. Merge the Bible branch into local `main` only if unrelated dirty files do not overlap; otherwise stop and report the exact local-main integration blocker without stashing or discarding user work.
10. Verify the local-main commit graph contains the Sage web and Bible commits. Do not push, deploy, or apply either migration.

## Final proof report

Report separately:

- implemented and locally committed;
- automated provider-contract proof;
- PostgreSQL 17 proof;
- real Sage test-business proof or exact credential blocker;
- cleanup readback;
- web local-main merge;
- Bible local-main merge;
- explicitly not pushed, deployed, production-migrated, or customer-live.
