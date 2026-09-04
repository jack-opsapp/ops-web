# Sage Bidirectional Sync Hardening Design

**Date:** 2026-09-03
**Status:** Approved for implementation
**Scope:** OPS Web, Supabase migration/runtime proof, Sage test-business war game, and OPS Software Bible updates

## Goal

Bring Sage Business Cloud Accounting to the same safety and confidence standard as the hardened QuickBooks connector without permitting any ambiguous provider write. The finished connector must survive OAuth/token failures, duplicate delivery, retries, partial success, stale claims, dependency races, tombstones, reconciliation starvation, and bidirectional echo pressure across clients, sales estimates/quotes, invoices, customer payments, suppliers, purchase invoices, and supplier payments.

Production Sage, production QuickBooks, deployment, push, and production database migration remain outside this implementation. Real provider writes are permitted only to a dedicated Sage test business whose exact identifier is explicitly allow-listed.

## Current-State Findings

The existing Sage implementation has two disconnected reliability models:

- `sage-sync-service.ts` performs direct push/pull operations for clients, invoices, estimates, and payments. It does not bind requests to an explicit Sage business, paginate, use Sage idempotency, classify retryable failures, or enforce a provider environment.
- Supplier bills use `accounting_sync_queue`, but `sage-purchasing-service.ts` still lacks explicit business binding, idempotency, retry policy, request correlation, and environment-aware write authorization.
- The OAuth initiate and disconnect route trusts a caller-supplied company id without authenticating the actor or checking `accounting.manage_connections`.
- OAuth state is stored in a connection column, has no expiry, is not one-time consumed, and does not use PKCE.
- The callback activates bidirectional writes immediately and never fetches or binds the selected Sage business.
- The legacy accounting cron still owns Sage sales writes, so those writes do not receive queue ownership, dependency fencing, stale-claim recovery, or deterministic replay.
- Pulls use one 200-record page and the non-contract `updated_from` parameter rather than `updated_or_created_since`.
- Current automated coverage proves QuickBooks behavior but provides no meaningful Sage connector war game.

Read-only production inspection on 2026-09-03 found no Sage connection rows, no Sage-linked clients/estimates/invoices/payments, and no Sage queue or sync-event rows. Existing accounting activity was QuickBooks-only.

## Sage Contract Constraints

The implementation follows the current Sage Business Cloud Accounting v3.1 contract:

- OAuth uses authorization-code flow. PKCE uses `S256`; authorization codes are single-use and expire after 60 seconds.
- Access tokens expire after 300 seconds. Refresh tokens rotate and expire after 31 days. Each successful refresh must atomically replace the stored refresh token.
- A token may access multiple businesses. Every accounting request must send `X-Business`; omitting it silently selects the user's lead business and is forbidden in OPS.
- Sage does not expose a separate sandbox host. OPS `provider_environment='sandbox'` means a dedicated test/trial business on the normal Sage API, protected by an exact business-id allow-list.
- POST and PUT requests support an `idempotency_id` inside the resource body. Sage retains the first result for seven days. The id is a random-looking 32-character GUID without hyphens and cannot be reused for a different resource.
- List endpoints paginate with at most 200 records per page and incremental reads use `updated_or_created_since`.
- Sage applies an application-wide daily request limit and concurrent-request limit. HTTP 429 must respect `Retry-After`.
- Contact, product, sales invoice, sales estimate, sales quote, and purchase invoice creation cannot be issued in parallel because Sage assigns sequential identifiers.
- `x_request_id` is the provider correlation identifier and must be retained in sanitized sync evidence.

Primary sources:

- [Authentication](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/authenticating/authentication)
- [Best practices](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/key-concepts/best-practices)
- [Idempotency](https://developer.sage.com/accounting/docs/v1.0.0/guides/learning/key-concepts/idempotency)
- [Accounting API v3.1](https://developer.sage.com/accounting/apis/sagebusinesscloudaccounting/3.1.0/accounting)

## Chosen Architecture

Sage becomes a provider adapter on the existing durable accounting runtime. The queue, claim ownership, retry lifecycle, suppression rules, issue notifications, and audit evidence remain shared infrastructure. Sage-specific modules own configuration, OAuth/business selection, API transport, payload mapping, external lifecycle semantics, and inbound normalization.

This avoids two rejected approaches:

1. Repairing the direct Sage service would leave sales and purchasing on different reliability models and preserve unsafe bypasses.
2. Copying the QuickBooks stack into a parallel Sage-only runtime would duplicate queue correctness and allow the providers to drift again.

## Safety Boundary

### Logical provider environments

`provider_environment` remains `sandbox | production`, but Sage always uses `https://api.accounting.sage.com/v3.1`. Environment selects credentials, redirect URI, write policy, and allowed business identities—not the host.

`sage-config.ts` resolves one explicit profile:

- `SAGE_ACTIVE_PROFILE=sandbox|production`; development defaults to `sandbox`, production defaults to `production`, and invalid values throw.
- Production credentials: `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, optional `SAGE_REDIRECT_URI`.
- Sandbox credentials: `SAGE_SANDBOX_CLIENT_ID`, `SAGE_SANDBOX_CLIENT_SECRET`, optional `SAGE_SANDBOX_REDIRECT_URI`. Sandbox never falls back to production credentials.
- `SAGE_SANDBOX_BUSINESS_IDS` is a comma-separated allow-list of exact Sage business UUIDs. A sandbox callback or write for any other business fails closed.
- `SAGE_WRITE_ENABLED=true` and the existing `ACCOUNTING_WRITE_ENABLED=true` are both required for provider writes.
- Production Sage writes additionally require `SAGE_PRODUCTION_WRITE_ENABLED=true`. This variable is absent and false for this work.

### Immutable business binding

An additive migration gives each Sage connection:

- `sage_business_id` — AES-256-GCM encrypted exact Sage business id.
- `sage_business_id_lookup` — lowercase SHA-256 hex for deterministic equality and uniqueness.
- `sage_business_name` — display-only provider name returned by `/businesses`.

Every Sage API client is constructed with an already-decrypted business id and unconditionally sends `X-Business`. There is no overload that permits a missing business id. Queue rows and reconciliation reads are scoped by the exact `connection_id`; a provider/environment sibling cannot satisfy or cancel them.

Only one connected, sync-enabled, non-pull-only Sage environment may be writable per company. The database enforces this with a partial unique index equivalent to the QuickBooks invariant.

## OAuth and Business Selection

### Initiation

`POST /api/integrations/sage` performs the same authenticated server checks as the hardened QuickBooks route:

1. Verify the signed-in actor.
2. Resolve their OPS user and authoritative company.
3. Require `accounting.manage_connections`.
4. Reject a different active accounting provider.
5. Resolve the server-controlled Sage profile; never trust the browser to select credentials.
6. Create a 10-minute OAuth attempt containing a state digest, actor, company, environment, encrypted PKCE verifier, return surface, and unconsumed status.
7. Return the Sage authorization URL with `S256` PKCE and the opaque state token.

OAuth attempts live in a service-role-only `accounting_oauth_attempts` table. The callback atomically consumes one exact, unexpired attempt. State replay, actor/company substitution, environment substitution, and callback replay fail closed.

### Callback and business binding

The callback exchanges the code using the attempt's credential profile and PKCE verifier, encrypts the rotating token pair, then fetches `/businesses` before activating the connection.

- Zero eligible active businesses: revoke the grant when possible, clear pending secrets, and return a safe error.
- One eligible business: bind it automatically.
- More than one eligible business: persist encrypted pending tokens plus a short-lived service-role-only business-selection session and redirect to the existing Books sync surface for explicit selection.
- Sandbox: filter eligible businesses through `SAGE_SANDBOX_BUSINESS_IDS`; zero matches fails closed.

The business-selection GET/POST routes repeat actor/company/permission checks. POST re-fetches `/businesses`, verifies that the chosen id is still active and eligible, then atomically binds the connection. Activation defaults to `sync_direction='pull_only'`, `sync_enabled=false`, and `propagate_deletes=false`; outbound synchronization still requires the existing explicit Full CRUD enable action.

### Disconnect and refresh

Disconnect authenticates and permission-checks the actor, selects the exact environment row, attempts refresh-token revocation with the matching credential profile, then clears local tokens and business binding even when the remote revoke call fails. It returns 404 for an absent row.

`AccountingTokenService` gains a Sage profile resolver and retains its sibling-refresh race handling. A refresh response must include both tokens and a positive expiry. `invalid_grant` or persistent provider-wide 403 marks the connection disconnected; transient 401/429/5xx never falsely reports reconnect-required. Raw token or provider bodies are never logged.

## Sage API Client

One `SageApiClient` replaces the two current transports. Its public methods are business-bound and separated into read and write capabilities.

### Request behavior

- Always send `Authorization`, `Accept`, and `X-Business`.
- Send `Content-Type` only for body requests.
- Parse and retain sanitized `x_request_id` and retry metadata.
- Redact response bodies from logs. Typed errors may expose only status, provider error code, safe summary, request id, and retry class.
- A 401 triggers one centralized token refresh and one replay.
- A persistent 403 disconnects the grant because Sage documents provider-wide 403 as an invalid authorization state.
- A 429 schedules according to `Retry-After`; 408/425/500/502/503/504 use bounded exponential backoff with jitter.
- Validation/authz 4xx responses are terminal or `needs_review`; they are never blind-retried.
- GET pagination follows `$next` when present, otherwise increments page until fewer than 200 records return. A repeated cursor/page is rejected as a provider-loop defect.

### Write behavior

- POST/PUT bodies include a deterministic 32-character `idempotency_id` derived from the immutable queue job id plus provider resource type. Replays of the same job use the same id; different resources cannot collide.
- DELETE/void operations use the provider's idempotent resource endpoint and tolerate an already-absent/already-void terminal state after verification.
- Create operations are serialized per Sage business. Updates/deletes may run only after the entity's create and required parent creates have succeeded.
- Successful writes return external id, safe provider state, request id, and whether the result was an idempotent replay.

## Entity Model and Dependency Graph

### Sales-side mappings

- OPS `clients` ↔ Sage `contacts` with customer contact type.
- OPS `estimates` ↔ Sage `sales_estimates` by default. Legacy rows already linked as `sales_quotes` retain their provider kind. A nullable `sage_document_kind` check-constrained to `sales_estimate | sales_quote` prevents endpoint ambiguity.
- OPS `invoices` ↔ Sage `sales_invoices`.
- OPS `payments` ↔ Sage `contact_payments` with explicit invoice allocation.

Every sales document sends its complete OPS line-item set, including description, quantity, unit price, mapped ledger account, tax rate/type, and stable local line identity where Sage permits analysis/reference fields. Missing required account/tax mappings block before provider I/O and create one actionable sync issue.

### Purchasing mappings

- OPS supplier ↔ Sage contact with vendor contact type.
- OPS supplier bill ↔ Sage `purchase_invoices`.
- OPS supplier payment ↔ Sage `contact_payments` with vendor-payment type and explicit purchase-invoice allocation.

The existing supplier/category/payment-account mapping tables remain authoritative. Purchase documents preserve the complete line-item snapshot, not a summarized total.

### Dependency order

The queue claim contract enforces:

1. Customer/supplier contact create.
2. Sales estimate/quote or purchase invoice create.
3. Sales invoice create where it depends on a customer and optional estimate.
4. Customer/supplier payment after its contact and target invoice exist.
5. Updates after the same entity's create is terminal-success.
6. Tombstone/void after all preceding writes for the entity are terminal.

An unresolved or terminal-failed parent blocks dependents with an explicit dependency reason. It does not consume retry attempts or permit a child provider write with a missing foreign id.

## Queue Ownership and Failure Recovery

The additive migration generalizes the existing OPS-origin trigger from QuickBooks-only to the one exact writable accounting connection. Sage and QuickBooks cannot both receive the same mutation.

- The legacy `sync-orchestrator` and `/api/cron/accounting-sync` become read-only for Sage. They cannot issue provider writes.
- Sage sales and purchasing workers both claim from `accounting_sync_queue` and share the same worker-ownership/finalization RPCs.
- A claim is connection-, provider-, company-, and environment-scoped. Locks include worker id and expiry.
- Stale processing claims are reclaimed only when the lock expired and the previous attempt did not record accepted provider evidence.
- A provider success followed by local finalization failure is replayed with the same Sage idempotency id while the seven-day replay window is valid. Once the window cannot be proven valid, the job becomes `needs_review` rather than risking a duplicate.
- Database overload and schema-cache failures stop the batch immediately. Later jobs are not sent after local durability becomes uncertain.
- Max attempts, next-run time, last safe error, provider request id, accepted-at time, and idempotency-window deadline are durable queue evidence.
- Duplicate cron delivery and concurrent workers produce at most one active claim and one logical provider resource.

## Inbound Reconciliation and Echo Suppression

Sage reconciliation is polling-based. A service-role-only RPC produces one fair, bounded batch across clients, estimates/quotes, invoices, customer payments, suppliers, purchase invoices, and supplier payments. Each lane orders unseen first, then least-recently-reconciled. Tombstoned/void/terminal records are excluded from ordinary comparison and handled in a dedicated lifecycle lane.

Incremental list reads use `updated_or_created_since`, explicit 200-record pagination, and a small overlap window. Applying inbound records runs inside provider-origin suppression:

- The suppression identity is provider + connection + entity type + external id.
- Direct row writes and payment-derived invoice-balance writes carry the same transaction-local marker.
- Line-item replacement is atomic and suppression-covered.
- Provider-origin updates cannot enqueue a mirror write back to Sage.
- OPS edits after the inbound transaction remain queue-visible.

Reconciliation records a canonical fingerprint of financially relevant fields. Matching fingerprints update the reconciliation timestamp without rewriting OPS rows. Conflicts with unsynced OPS edits become `needs_review`; the provider never silently overwrites a newer local edit.

## Tombstones and Voids

Lifecycle operations are resource-specific and never represented as generic DELETE:

- Contact removal uses Sage-supported inactive/delete behavior only after dependent-resource validation.
- Sales invoice deletion maps to Sage's void endpoint and verifies the resulting void state.
- Purchase invoice, estimate, and quote deletion use their documented delete/void semantics and verify the terminal state.
- Customer and supplier payments use the supported delete/void path, then inbound application reverses the affected OPS invoice/bill balance atomically.
- `propagate_deletes=false` suppresses every outbound lifecycle mutation.
- A provider-side tombstone marks the linked OPS record/provider link without destroying OPS audit history.

## Product Surface

The existing single accounting-provider entry point remains. Sage adds only the state required for safe multi-business authorization:

- One brief business-selection step when the Sage grant exposes multiple eligible businesses.
- A compact connected state showing the bound Sage business and sandbox marker.
- Reconnect and disconnect actions remain behind the connected-state control.

All copy remains localized in English and Spanish. No permanent side-by-side provider cards or new dashboard surface is introduced.

## War-Game Strategy

### Layer 1: deterministic provider contract

A stateful fake Sage server validates headers, bodies, idempotency scope, pagination, request ordering, token rotation, and cleanup. Tests cover:

- OAuth initiation, callback replay, expired state, PKCE mismatch, actor/company substitution, business selection, disconnect, refresh race, rotating refresh token, invalid grant, and persistent 403.
- Missing/mismatched `X-Business`, production/sandbox credential crossover, non-allow-listed sandbox business, disabled write gates, and wrong connection id.
- Create/update/void/delete for every entity, full line items, tax/account mapping failures, and parent-child ordering.
- 401 replay, 429 with `Retry-After`, retryable 5xx, terminal 4xx, duplicate job delivery, concurrent workers, provider success/local failure, and idempotency expiry.
- Pagination beyond 200, repeated cursor defense, overlap-window duplicates, fair lane progress, echo suppression, tombstones, and unsynced-edit conflicts.

### Layer 2: PostgreSQL 17 runtime proof

A minimal PostgreSQL harness loads the baseline queue/payment logic followed by the new migration. SQL assertions prove:

- one writable Sage environment per company;
- exact connection/environment queue isolation;
- create and parent dependency fences;
- stale-claim recovery and accepted-write protection;
- deterministic duplicate suppression;
- fair reconciliation across all lanes;
- service-role-only RPC execution and fixed search paths;
- payment move/void balance repair and provider-origin echo suppression;
- sandbox cleanup can identify only the run's OPS rows.

### Layer 3: real Sage test business

This layer runs only when dedicated sandbox credentials, token-encryption key, and an allow-listed test business id are present. The runner:

1. Creates uniquely tagged clients/suppliers.
2. Creates sales estimates and quotes, sales invoices, customer payments, purchase invoices, and supplier payments with multiple line items.
3. Exercises update, allocation change, void/delete, duplicate delivery, retry, pull reconciliation, and refresh.
4. Reads every resource back through the same explicit `X-Business` binding.
5. Cleans provider objects in reverse dependency order and independently confirms absence/terminal state.
6. Deletes only OPS records whose exact ids are recorded in the run manifest and verifies zero remaining rows.

The run manifest is a verification artifact under `docs/artifacts/` or a temporary directory and is never committed with credentials or raw provider bodies. If credentials are absent, Layer 3 is reported as blocked while Layers 1 and 2 remain mandatory.

## Migration and Release Boundary

The migration is additive and must include sentinels. It is written and proven locally but not applied to production in this task. Code and Bible branches may be merged into local `main` only after focused tests, PostgreSQL runtime proof, type-checking, formatting, security review, and final diff review pass.

No push, Vercel deployment, production migration, production Sage call, production QuickBooks call, or customer-live claim is authorized.

## Success Criteria

The work is complete locally when:

- Every Sage provider request is bound to one exact Sage business.
- Every Sage write is queue-owned, environment-gated, idempotent, dependency-safe, and fail-closed.
- Sales and purchasing preserve complete line items and correct allocations.
- OAuth, callback, selection, refresh, and disconnect have durable security tests.
- Local simulation and PostgreSQL 17 prove every named war-game failure class.
- Real Sage test-business proof and cleanup pass when credentials exist; otherwise the exact credential/business blocker is reported.
- The Software Bible reflects the implemented—not merely planned—contract.
- The web and Bible branches are clean and merged into local `main`; nothing is pushed or deployed.
