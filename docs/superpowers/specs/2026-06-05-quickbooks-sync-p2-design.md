# QuickBooks Sync P2 - Full CRUD Engine + Operator UX Design

Date: 2026-06-05
Project: `ops-web`
Branch: `docs/quickbooks-sync-p2-spec`
Supabase project: `ijeekuhbatykdomumfjx`
Primary validation company: Maverick Projects QuickBooks sandbox
Production customer status: CanPro QuickBooks OAuth is blocked until a QuickBooks admin authorizes OPS

## Decision

P2 is a QuickBooks-only implementation target. The architecture preserves the existing provider boundary where it already exists (`accounting_connections.provider`, token service, shared connection UI), but agents must not spend P2 building generic Sage abstractions. Sage remains supported by the legacy connection layer and expense edge-function path, but the new full CRUD engine is proven against QuickBooks first.

The build is contract-first. Backend and UX are planned together before any implementation agent starts. The operator must be able to see what the engine is doing, why it is paused, what failed, what can be retried, what changed source-of-truth, and whether OPS is safe to write to QuickBooks.

## Existing Base

The shipped base on `origin/main` has:

- QuickBooks OAuth and encrypted token storage.
- `accounting_connections.sync_direction`, default `pull_only`.
- `accounting_connections.propagate_deletes`, default `false`.
- Production write kill-switch: outbound writes require `ACCOUNTING_WRITE_ENABLED === "true"`.
- Read-only QuickBooks Pull -> Stage -> Review -> Apply.
- Company/customer mapping: QuickBooks company -> `clients`, QuickBooks contact -> `sub_clients`.
- Partial unique `(company_id, qb_id)` indexes on `clients`, `sub_clients`, `invoices`, `estimates`, and `payments`.
- Signed inbound QuickBooks webhook that fetches changed records by GET and applies them into OPS without writing to QuickBooks.
- Review UI under `/accounting`, with dictionary-backed copy and permission gates.

The shipped read-only path is not replaced. P2 adds the outbound queue engine, reconcile loop, operator health UI, and sandbox proof needed before any production write enablement.

## Hard Safety Rules

- Production `ACCOUNTING_WRITE_ENABLED` stays absent or false until P2 is built, reviewed, and Maverick sandbox validation passes.
- No agent may add, change, or remove production Vercel env vars.
- No agent may connect CanPro QuickBooks or attempt to bypass Intuit admin permission.
- No agent may write to QuickBooks production.
- All migrations must be additive, sentinel-guarded where relevant, and iOS-safe.
- Queue writes must be created by database triggers so OPS-Web and iOS writers are both captured.
- The engine must fail closed. Missing token, missing realm, invalid env, permission mismatch, or unknown entity type pauses the affected work and logs the reason.
- Provider writes happen only from explicit worker routes/cron under service-role control, never from direct client code.

## Scope

P2 builds full continuous two-way sync for QuickBooks:

- OPS -> QuickBooks create/update/void or inactivate for:
  - Customer
  - Invoice
  - Estimate
  - Payment
  - Invoice and estimate line items as part of their parent transaction payloads
- QuickBooks -> OPS inbound handling through the signed webhook and reconcile cron.
- Initial link/reconcile before enabling bidirectional mode for an already-imported company.
- Last-write-wins by timestamp with audit for every overwrite.
- OPS soft-delete always. QuickBooks propagation only when `propagate_deletes = true`.
- Retry/backoff with poison-record isolation.
- Operator-facing health, audit, queue, conflict, retry, pause, and enablement UI.
- Maverick sandbox validation that proves create/update/void/reconcile behavior end to end.

## Non-Goals

- Sage full CRUD engine.
- CanPro production connection or write testing.
- Full QuickBooks Jobs -> OPS Projects mapping.
- Chart of accounts setup or expense category remapping beyond existing expense sync behavior.
- Payroll, purchase orders, vendors, inventory sync, deposits, tax-code configuration, or bank feeds.
- Production write enablement.

## Operator UX Contract

The UI must make accounting sync feel controlled, not magical. A business owner should know whether OPS is importing, writing, paused, waiting for review, or blocked.

### Surfaces

P2 adds or extends these `/accounting` surfaces:

- `// INTEGRATIONS`
  Connection, environment, mode, write gate, and enablement status.
- `// QUICKBOOKS IMPORT`
  Existing read-only import remains available.
- `// SYNC HEALTH`
  Queue state, last worker run, blocked writes, retry counts, and webhook/reconcile freshness.
- `// AUDIT LOG`
  Per-record change trail with source, direction, before/after summary, QB id, OPS id, and result.
- `// CONFLICTS`
  Records where timestamps, linkage, or delete behavior require operator review.

These ship as tabs in the existing accounting page. Do not create a separate accounting command page in P2. The visual design must use OPS-Web tokens and existing product UI patterns.

### Required States

| State | Meaning | UI behavior |
|---|---|---|
| `read_only` | Connection imports only | Show current safe state. Full CRUD CTA disabled or gated by explicit confirmation. |
| `write_gate_off` | `sync_direction = bidirectional` but env kill-switch off | Show `SYS :: WRITE GATE OFF`; no push action available. |
| `initial_reconcile_required` | Bidirectional requested, but initial link/reconcile not complete | Show blocking checklist. No outbound queue drain. |
| `active` | Queue drains and webhook/reconcile operate normally | Show queue depth, last run, last successful write, last inbound event. |
| `paused_by_operator` | Operator paused sync | Queue records accumulate, no outbound writes. |
| `paused_by_system` | Token, env, schema, or repeated failure blocks progress | Show reason, affected entity, and next action. |
| `retrying` | Failed item is inside retry window | Show next retry time and attempt count. |
| `needs_review` | Conflict or unsafe delete requires operator decision | Show record diff and source-of-truth recommendation. |
| `verified` | Latest sandbox or company proof passed | Show last verification timestamp and counts. |

### Operator Copy

All user-facing text must live in `src/i18n/dictionaries/{en,es}/accounting.json`. OPS voice:

- Page title: `// QUICKBOOKS SYNC`
- Safe import state: `READ-ONLY`
- Write-gate state: `SYS :: WRITE GATE OFF`
- Active state: `SYNC ACTIVE`
- Blocking state: `REVIEW REQUIRED`
- Retry action: `RETRY`
- Pause action: `PAUSE SYNC`
- Resume action: `RESUME SYNC`
- Enable action: `ENABLE FULL CRUD`
- Destructive confirmation: `DESTRUCTIVE. NO UNDO.`

No emoji. No exclamation points. Numbers are mono, formatted, and never raw.

### Enable Full CRUD Flow

The enablement flow is deliberately staged:

1. Operator chooses QuickBooks connection.
2. UI verifies permission `accounting.manage_connections`.
3. UI shows checklist:
   - QuickBooks connected.
   - Read-only import applied or initial link/reconcile complete.
   - Queue schema active.
   - Write gate status.
   - Sandbox proof status if environment is non-production.
4. Operator selects mode `Full CRUD`.
5. Operator chooses `propagate_deletes` on or off.
6. Operator confirms the exact behavior:
   - OPS changes will write to QuickBooks.
   - QuickBooks changes will overwrite OPS when QB is newer.
   - OPS deletes are soft in OPS.
   - QuickBooks delete/void becomes OPS soft-delete or void.
   - Delete propagation to QuickBooks only happens when enabled.
7. Route records `sync_direction = bidirectional`, `propagate_deletes`, and creates an `initial_reconcile_required` gate if link state is incomplete.
8. Outbound worker still requires `ACCOUNTING_WRITE_ENABLED === "true"`.

In production, a missing env write gate keeps the connection non-writing even if the UI records full CRUD preference.

## Backend Architecture

P2 replaces the legacy direct scan-and-push `sync-orchestrator` behavior for QuickBooks writes with a queue-based engine.

### Data Flow

```
OPS table change
  -> database trigger
  -> accounting_sync_queue
  -> worker claims due rows
  -> QuickBooks push mapper
  -> accounting_sync_events audit row
  -> update OPS qb_id / sync metadata
  -> notify operator when needed

QuickBooks webhook
  -> signature verification
  -> realm lookup
  -> fetch changed QB entity by GET
  -> compare timestamps
  -> apply or flag conflict
  -> audit row

Reconcile cron
  -> pull recently changed QB entities
  -> compare linked OPS rows
  -> repair drift or flag conflict
  -> audit row
```

### Queue Table

Add `accounting_sync_queue`.

Required columns:

- `id uuid primary key`
- `company_id uuid not null`
- `connection_id uuid not null`
- `provider text not null default 'quickbooks'`
- `entity_type text not null`
- `entity_id uuid not null`
- `external_id text null`
- `operation text not null`
- `source_table text not null`
- `source_action text not null`
- `source_updated_at timestamptz null`
- `idempotency_key text not null`
- `status text not null default 'pending'`
- `attempts int not null default 0`
- `max_attempts int not null default 5`
- `run_after timestamptz not null default now()`
- `locked_at timestamptz null`
- `locked_by text null`
- `last_error text null`
- `payload_snapshot jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Status values:

- `pending`
- `claimed`
- `succeeded`
- `failed`
- `blocked`
- `needs_review`
- `cancelled`

Terminal statuses are `succeeded`, `failed`, `blocked`, `needs_review`, and `cancelled`. Active coalescing applies only to `pending` and `claimed`.

Operation values:

- `create`
- `update`
- `void`
- `inactivate`
- `delete_soft`
- `link`
- `reconcile`

Entity values:

- `customer`
- `invoice`
- `estimate`
- `payment`

Line items are not queued as independent QuickBooks records. A line item trigger queues its parent invoice or estimate.

Idempotency:

- Unique active key on `(company_id, provider, entity_type, entity_id, operation, idempotency_key)` where status is not terminal.
- Multiple updates to the same record before a worker runs should coalesce into one pending row when safe.
- The worker should always refetch current OPS state before writing to QB. The queue snapshot is diagnostic, not authoritative.

### Trigger Coverage

Triggers must enqueue changes from:

- `clients`
- `sub_clients` only when relevant to QuickBooks customer contact shaping
- `invoices`
- `estimates`
- `payments`
- `line_items`

Trigger rules:

- Ignore changes when no connected QuickBooks connection exists.
- Ignore changes when `sync_direction = 'pull_only'`.
- Ignore changes caused by inbound QuickBooks apply to avoid echo loops.
- Ignore changes where `qb_id` is being set by import/linking unless a real outbound update is needed.
- For `line_items`, enqueue parent invoice/estimate update.
- For deleted or soft-deleted rows, enqueue delete behavior based on entity and connection settings.

Echo-loop prevention uses a transaction-local source marker. Service-role inbound apply paths must call `set_config('ops.sync_source', 'quickbooks', true)` inside the transaction before updating OPS rows. Queue triggers must read `current_setting('ops.sync_source', true)` and skip outbound enqueue when the value is `quickbooks`. Do not add sync-source columns to iOS-synced tables in P2.

### Audit Tables

Add `accounting_sync_events` as the complete audit trail. `accounting_sync_log` can remain as legacy summary history, but P2 needs record-level events.

Required columns:

- `id uuid primary key`
- `queue_id uuid null`
- `company_id uuid not null`
- `connection_id uuid null`
- `provider text not null`
- `direction text not null`
- `entity_type text not null`
- `entity_id text null`
- `external_id text null`
- `operation text not null`
- `status text not null`
- `source text not null`
- `ops_updated_at timestamptz null`
- `qb_updated_at timestamptz null`
- `decision text null`
- `before_snapshot jsonb not null default '{}'::jsonb`
- `after_snapshot jsonb not null default '{}'::jsonb`
- `error text null`
- `created_at timestamptz not null default now()`

Direction values:

- `ops_to_qb`
- `qb_to_ops`
- `reconcile`
- `system`

Decision values:

- `ops_won`
- `qb_won`
- `skipped`
- `needs_review`
- `retry`
- `blocked`

### Worker

Add a cron route that drains queue rows:

- `POST /api/cron/accounting/quickbooks/push-queue`

Requirements:

- Authenticated by `CRON_SECRET`.
- Uses service-role Supabase.
- Requires `ACCOUNTING_WRITE_ENABLED === "true"`.
- Claims due rows with `for update skip locked` through an RPC to avoid double workers.
- Processes bounded batches.
- Refreshes token through `AccountingTokenService`.
- Refetches current OPS state before every push.
- Calls QuickBooks through a new write client.
- Writes `accounting_sync_events`.
- Updates queue status and retry schedule.
- Creates persistent notifications for blocked or needs-review states.

Retry:

- Exponential backoff with bounded max attempts.
- 429 and 5xx retry.
- 400 validation failures block or needs_review depending on reason.
- 401/invalid_grant marks connection disconnected and pauses company queue.
- Unknown entity or missing foreign link blocks the queue row with exact reason.

### QuickBooks Write Client

Add a write-side service distinct from `QuickBooksPullService`.

Recommended files:

- `src/lib/api/services/quickbooks-write-service.ts`
- `src/lib/api/services/qbo-push-mappers.ts`
- `src/lib/api/services/qbo-conflict.ts`
- `src/lib/api/services/accounting-sync-queue-service.ts`
- `src/lib/api/services/accounting-sync-audit-service.ts`

The write client must:

- Use QuickBooks API v3 host from the same environment helper.
- Never log raw tokens or raw provider error bodies.
- Validate entity IDs before URL/query interpolation.
- Use QuickBooks `SyncToken` for updates where required.
- Fetch the current QB entity before update/void when needed.
- Return normalized write result `{ qbId, syncToken, metaUpdatedAt, raw }`.
- Increment a write-call counter for testability.

### Push Mappers

Customer:

- OPS `clients` -> QBO Customer.
- If `qb_id` exists, update existing Customer.
- If no `qb_id`, create Customer and write returned ID to `clients.qb_id`.
- For company/contact shape, parent `client` drives QBO `CompanyName` and `DisplayName`. Contact fields can come from canonical `sub_clients` where available.
- Soft delete with `propagate_deletes = true` should inactivate Customer, not hard-delete.

Invoice:

- OPS `invoices` + `line_items` -> QBO Invoice.
- CustomerRef requires linked `clients.qb_id`.
- Missing customer link blocks invoice push and queues customer first when possible.
- Header totals are OPS authoritative for OPS-created invoices; QuickBooks response then becomes linked state.
- Update uses existing `qb_id` and fetched `SyncToken`.
- Void behavior uses QuickBooks-supported void/sparse update path; never hard-delete.

Estimate:

- OPS `estimates` + `line_items` -> QBO Estimate.
- Same customer dependency and update rules as invoices.
- Accepted/converted states must respect OPS status mapping.

Payment:

- OPS `payments` -> QBO Payment.
- Requires linked customer and invoice when the payment applies to an invoice.
- If invoice is not linked, block or queue invoice dependency.
- Voided payment maps to QuickBooks void behavior when supported; otherwise needs_review.

Line items:

- No independent queue item.
- Parent transaction mapper owns line array.
- Product/item mapping should use existing item catalog if available, otherwise use service line fallback documented in mapper tests.

## Reconciliation

P2 uses last-write-wins by timestamp, with audit.

Timestamp sources:

- OPS: `updated_at`, or entity-specific timestamp where stronger.
- QB: `MetaData.LastUpdatedTime`.

Rules:

- If QB is newer, apply QB to OPS and audit `qb_won`.
- If OPS is newer, enqueue OPS -> QB and audit `ops_won`.
- If timestamps are missing or equal but material fields differ, mark `needs_review`.
- If link is missing but a deterministic match exists, create link event.
- If a conflict touches money totals, status, void/delete, or customer link, surface it in `// CONFLICTS`.

Add reconcile route:

- `POST /api/cron/accounting/quickbooks/reconcile`

Schedule:

- Every 15 to 30 minutes in non-production/sandbox validation.
- Production schedule only after P2 signoff and explicit deployment decision.

Reconcile must operate as backstop, not primary event path. Webhook remains first line for QB -> OPS.

## Delete and Void Semantics

OPS delete behavior:

- OPS keeps soft-delete semantics.
- `deleted_at` on clients/invoices/estimates triggers outbound behavior only when connection is bidirectional and writes are enabled.
- `payments.voided_at` maps to payment void behavior.

QuickBooks -> OPS behavior:

- QB Customer delete/inactivate -> OPS `clients.deleted_at`, plus contact sub-client soft state where appropriate.
- QB Invoice delete/void -> OPS invoice status `void`, or `deleted_at` when the source truly disappears.
- QB Estimate delete/void -> OPS estimate `deleted_at` or terminal status.
- QB Payment void/delete -> OPS `payments.voided_at`.

Propagation:

- If `propagate_deletes = false`, OPS soft-deletes do not write deletes/voids to QB. Audit `skipped`.
- If `propagate_deletes = true`, OPS soft-deletes write inactivation/void where QuickBooks supports it. Never hard-delete real books.
- Any unsupported delete path becomes `needs_review`.

## Access Control and Notifications

Access:

- `/accounting` requires `accounting.view` and accounting feature flag.
- Import, integrations, sync-mode, retries, pause/resume, and conflict decisions require `accounting.manage_connections`.
- Queue drain and reconcile routes are service-role and cron-secret gated.
- Webhook remains unauthenticated at middleware level but signature-verified and fail-closed.

Notifications:

- Persistent notification for:
  - system pause
  - token reconnect required
  - conflicts requiring review
  - retry exhaustion
  - initial reconcile complete
- Standard notification for:
  - sync verified
  - batch completed with no failures
- Notifications must include `action_url` into `/accounting` with the relevant tab/query state.

## UI Implementation Guidance

The UI agent must use:

- OPS design system.
- Existing page/tabs patterns in `/accounting`.
- `lucide-react` icons because Carbon is target state but not installed.
- No decorative icons.
- Mono numbers with tabular lining.
- Existing `Button`, `Card`, query hooks, and dictionary pattern.

Recommended components:

- `src/components/accounting/qbo/sync-health-tab.tsx`
- `src/components/accounting/qbo/sync-audit-log.tsx`
- `src/components/accounting/qbo/sync-conflicts-table.tsx`
- `src/components/accounting/qbo/full-crud-enable-panel.tsx`
- `src/lib/hooks/use-qbo-sync-health.ts`
- `src/lib/hooks/use-qbo-sync-actions.ts`

Required visible data:

- Current mode.
- Write gate state.
- Queue depth by status.
- Last outbound write.
- Last inbound webhook.
- Last reconcile.
- Last token refresh.
- Failed row count.
- Retry exhaustion count.
- Conflict count.
- Propagate deletes state.

## Testing Strategy

Unit tests:

- Queue trigger SQL text and sentinel checks.
- Queue claim RPC behavior.
- Push mapper fixtures for Customer, Invoice, Estimate, Payment.
- Last-write-wins comparator.
- Delete propagation matrix.
- Echo-loop prevention.
- Write gate exactness.
- Dictionary key parity.

Integration tests:

- Route auth and permission gates.
- Worker processes pending queue rows only when env gate true.
- Worker blocks missing customer/invoice dependencies.
- Worker retries 429/5xx.
- Worker pauses on invalid_grant.
- Webhook writes audit events and avoids retry storms.
- Reconcile produces expected wins/conflicts.
- UI renders every required operator state.

Sandbox tests:

- Connect Maverick sandbox through non-production deployment.
- Enable bidirectional only in sandbox/non-production.
- Create OPS client -> verify QBO Customer.
- Update OPS client -> verify QBO Customer update.
- Create OPS estimate with lines -> verify QBO Estimate.
- Convert/update invoice with lines -> verify QBO Invoice.
- Record payment -> verify QBO Payment.
- Void payment/invoice according to setting -> verify QB and OPS state.
- Change QB customer/invoice/payment -> verify webhook or reconcile applies to OPS.
- Run repeated queue/reconcile cycles -> verify idempotency and no duplicates.
- Force token failure if possible -> verify pause/reconnect UI.
- Force retryable error through mocked test route or fixture -> verify retry/backoff.

Final sandbox proof must include:

- DB queue counts before/after.
- `accounting_sync_events` sample rows.
- OPS record `qb_id` integrity.
- QuickBooks sandbox record evidence.
- No duplicate customers/invoices/payments.
- Balance reconciliation.
- UI screenshot or browser smoke for health/conflict/audit surfaces.

## Workstream Split

Use these spawned task titles:

- `QUICKBOOKS SYNC - P2-1` Engine/Data Contract
- `QUICKBOOKS SYNC - P2-2` QuickBooks Push Mappers
- `QUICKBOOKS SYNC - P2-3` Webhook/Reconcile
- `QUICKBOOKS SYNC - P2-4` Operator UX
- `QUICKBOOKS SYNC - P2-5` Maverick Sandbox QA

Each agent prompt must include:

- Worktree path and branch.
- Exact files in scope.
- Explicit out-of-scope list.
- Required tests.
- Requirement to preserve unrelated dirty files.
- Requirement to report exact files changed, commands run, pass/fail results, and unresolved risks.
- Ban on production env changes.
- Ban on QuickBooks production writes.

## Review Gates

Gate 1: Spec approval.

- This document accepted by user.

Gate 2: Implementation plan approval.

- A task-by-task plan exists with file ownership and agent prompts.

Gate 3: Migration review.

- Live schema verified through Supabase MCP.
- Additive migrations only.
- RLS/advisor concerns reviewed.
- iOS-synced table changes are nullable/additive.

Gate 4: Agent output review.

- I review each agent's diff and summary before integration.
- Conflicts are resolved explicitly.
- No broad refactors accepted without direct relation to P2.

Gate 5: Local verification.

- `tsc --noEmit`.
- Targeted Vitest suites for queue, mappers, reconcile, UI, routes.
- Migration tests.

Gate 6: Maverick sandbox verification.

- Non-production deployment.
- Sandbox keys.
- `ACCOUNTING_WRITE_ENABLED=true` only in non-production.
- End-to-end scenarios pass.

Gate 7: Bible update.

- `ops-software-bible/04_API_AND_INTEGRATION.md`.
- `ops-software-bible/09_FINANCIAL_SYSTEM.md`.
- Any data architecture notes for new tables/RLS.

Gate 8: Production decision.

- Separate go/no-go.
- Explicit user approval required before any production write gate change.

## Risks

- QuickBooks update semantics require `SyncToken`; mapper must fetch current QB state before update.
- Queue triggers can create echo loops if inbound apply source is not marked correctly.
- Money totals can drift if line item mapping and header totals disagree.
- Payment mapping depends on invoice linkage.
- QuickBooks Jobs remain out of P2 scope and can still appear in customer data.
- UI can give false confidence if health states are not sourced from real queue/audit data.
- Production and sandbox QuickBooks envs are global per deployment; never flip production to sandbox for testing.

## Acceptance Criteria

P2 is accepted when:

- Full CRUD engine is implemented behind the write gate.
- Operator UI shows real sync health, queue, conflicts, retry, and audit state.
- Maverick sandbox proves OPS -> QB and QB -> OPS create/update/void/reconcile flows.
- No duplicate QB-linked records appear in OPS.
- No duplicate OPS-created records appear in QB during repeated runs.
- Last-write-wins decisions are audited.
- Delete propagation follows `propagate_deletes`.
- All blocking states create exact operator guidance.
- Production remains non-writing unless explicitly approved after sandbox signoff.
