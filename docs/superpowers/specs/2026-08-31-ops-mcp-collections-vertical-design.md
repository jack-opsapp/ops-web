# OPS MCP Collections Vertical — Design

**Date:** 2026-08-31
**Status:** Approved for local implementation by the OPS MCP vision handoff
**Source:** `ops-software-bible/specs/2026-08-30-ops-mcp-vision-handoff.md`

## Objective

Deliver the smallest complete Invisible Office vertical for the operator question “Who owes me money?” The capability returns exact, server-owned receivables aging facts and prepares one consolidated collection draft per debtor for explicit human approval. Preparation and approval never send a message, move money, issue a financial document, or make a legal threat.

The implementation is local only. It does not push, deploy, apply a migration, activate an MCP exposure, or change live OAuth state.

## Protected boundaries

- The active customer-facing MCP contract remains the immutable `2026-08-29.mcp-exposure.v2` read-only surface.
- The existing `2026-08-30.mcp-exposure.v3` synthetic canary and its OAuth clients, grants, consent catalogue, acceptance script, migration chain, and activation mechanics remain byte-for-byte unchanged.
- Collections uses a new inactive `2026-08-31.mcp-exposure.v4` contract and a new `2026-08-31.capability-manifest.v10` manifest. Merely defining these revisions does not make them grantable or customer-visible.
- Every prepare and approval statement re-checks the current user, tenant membership, exact OAuth grant, client, grant revision, exposure revision, scope ceiling, permission snapshot, and required granular permissions.
- Private storage has RLS enabled, no browser policies, and no direct `anon`, `authenticated`, or `service_role` table privileges. Narrow `SECURITY DEFINER` RPCs use a pinned search path and explicit execute grants.

## Human and interface intent

The human is a trades business owner between jobs who needs to know which customers owe money, why the number is correct, and exactly what will be approved. The job is to verify and approve one debtor’s draft without accidentally contacting anyone. The interface should feel like a precise receivables control sheet: dense, calm, factual, and impossible to misread.

### Domain exploration

- **Domain:** receivables ledger, aging ladder, invoice stack, due-date clock, correspondence trail, approval seal, collection cadence.
- **Color world:** black command-deck canvas, neutral steel text, olive current balance, tan early overdue, copper receivables, rose serious overdue, brick destructive boundary.
- **Signature:** an immutable approval seal that binds the exact debtor, invoice facts, aging state, recipient, subject, and body to one SHA-256 preview. The queue card shows that bound package before the operator can approve it.
- **Defaults rejected:** one bulk collections blast becomes one action per debtor; an editable email composer becomes an immutable factual preview; a summary-only balance card becomes an exact invoice ledger; a generic “approve” action becomes `APPROVE DRAFT` with an explicit `NOT SENT` boundary.

The implementation reuses the existing action-card shell, token classes, type hierarchy, reduced-motion behavior, and queue navigation. It adds no new visual token, color, radius, spacing constant, font, animation, or screen.

## Capability contract

### `prepare_collections`

Input:

- `as_of_date` — optional canonical calendar date. When absent, the server resolves the company timezone and derives the current business date.
- `idempotency_key` — required, 8–200 characters, canonical safe alphabet.

Required OAuth scopes:

- `ops.correspondence.read`
- `ops.customer_contacts.read`
- `ops.customers.read`
- `ops.financial_documents.read`
- `ops.operations.prepare`
- `ops.operations.read`

Required current permissions, all at company-wide scope:

- `clients.view`
- `email.view`
- `invoices.view`
- `reports.view`

Risk and limits:

- medium-risk prepare operation
- maximum 100 invoice rows over four fixed pages
- maximum 25 debtors
- maximum 25 contacts per debtor through the existing customer-context contract
- maximum 120,000 output characters
- durable actor/grant/company prepare rate limits
- exact argument-hash conflict on idempotency-key reuse

If the invoice catalogue has another page after the fixed 100-row bound, preparation fails closed. It never reports a partial total as the answer to “Who owes me money?”

## Server-owned aging

Only invoices with a positive `balance_due` and a collectible status are included: `awaiting_payment`, `partially_paid`, `past_due`, and `sent`. Draft, paid, void, and written-off documents are excluded.

For each invoice:

- `days_past_due = max(0, as_of_date - due_date)` using calendar dates, never client clock arithmetic.
- aging buckets are exact and closed: `current`, `1_30`, `31_60`, `61_90`, `91_plus`.
- amount, currency, document number, issue date, due date, status, and evidence reference come from the trusted sales-document read boundary.

Invoices are grouped by canonical primary-client identity. Totals are never combined across currencies. Each debtor returns currency-separated balances and bucket totals. Debtors sort by maximum days past due descending, then canonical customer ID. Invoices sort by due date, document number, then canonical invoice ID.

## Recipient resolution

The service reads the canonical customer profile, duplicate state, and purpose-bound communication contacts.

A debtor is approval-ready only when all of the following hold:

1. Customer context is complete and not over its result bound.
2. The canonical customer is not in duplicate-review state.
3. The primary client email is contactable; or, only when the primary email is unavailable, there is exactly one contactable sub-client email.
4. A blocked or ambiguous primary email never falls through to a different contact.
5. Multiple possible sub-client recipients are treated as ambiguous.
6. The selected contact still belongs to the tenant and exact canonical debtor at the database gate.
7. The selected normalized email is not shared by another active client or sub-client in the tenant.

No recipient is inferred from invoice free text, historical email headers, or model output.

## Correspondence readability and cadence gate

For each selected recipient, a same-statement service-only RPC inspects immutable provider-delivery sources from the debtor’s oldest included invoice issue date through the preparation timestamp. It validates the recipient binding against current tenant data before reading.

The debtor is blocked from approval when:

- any matching delivered item is rejected, blank, or otherwise unreadable;
- the latest outbound item is less than seven calendar days old;
- the latest inbound item is less than three calendar days old;
- the normalized recipient identity is shared across active customers; or
- coverage cannot be proven complete.

The tool still returns exact debt and aging facts for a blocked debtor, but it does not create an approval action. The result names the precise blocking reason. Normalized correspondence bodies never enter logs, audit rows, action payloads, or MCP output.

## Deterministic draft policy

There is one consolidated draft per ready debtor, not one message per invoice. Copy is deterministic and generated only from canonical customer name, exact invoice facts, exact currency-separated balances, and the oldest aging bucket.

Tone escalates without legal claims:

- `current`: factual advance payment reminder
- `1_30`: friendly overdue reminder
- `31_60`: firm request for a payment date
- `61_90`: direct request for payment or a firm payment date
- `91_plus`: direct overdue notice with the exact oldest days-past-due fact

Every draft asks the customer to reply if an invoice needs to be resent or if something is holding payment up. Drafts never mention liens, collections agencies, legal rights, credit reporting, service suspension, penalties, or promises about enforcement.

## Prepare persistence

Preparation persists one private run containing:

- the exact authority and revision binding;
- the idempotency key and SHA-256 argument hash;
- the server-owned business date and preparation timestamp;
- the complete immutable result snapshot.

For every approval-ready debtor it also persists one private change set and one public queue action of type `approve_collections_draft`. Blocked debtors receive no action. A single standard notification points the operator to the queue and reports the number of drafts ready.

The change-set payload contains the exact debtor, invoice facts, balances, recipient, subject, body, and truth boundary. Its canonical JSON representation is hashed. The queue action stores that preview and `sha256:` digest without editable fields.

## Approval boundary

Approval occurs through the authenticated OPS queue, not through MCP. The queue service recognizes `approve_collections_draft` as its own non-delivery action and never passes it to any email transport.

The database approval RPC:

1. locks the exact tenant/action/change-set tuple;
2. accepts no edited payload;
3. verifies the supplied preview hash;
4. rejects expired, consumed, non-pending, retargeted, or cross-tenant rows;
5. re-checks current user membership, OAuth grant/client/revision/scope binding, exposure revision, and permission snapshot;
6. consumes the change set once;
7. records an immutable confirmation and receipt;
8. marks the queue action executed with effect `collections_draft_approved_inside_ops`.

The receipt must state:

- `messages_sent: 0`
- `money_moved: false`
- `financial_documents_issued: 0`
- exact action/change-set/confirmation IDs
- exact preview digest
- exact receipt digest
- commit timestamp and replay state

Approval writes no email action, send intent, outbox row, payment, invoice, estimate, credit note, or legal workflow. Autonomous execution and bulk approval explicitly reject the action type.

Rejection uses a narrow database decision RPC so private draft state and public queue state remain consistent. It records `left_open_inside_ops`, sends nothing, and creates no commit receipt.

## Failure behavior

- Invalid input: typed validation failure before business reads.
- Missing current permissions or stale actor/grant: forbidden, no persistence.
- Source bound or stale catalogue: fail closed, no partial answer.
- Missing/ambiguous/blocked recipient: facts returned, debtor draft blocked, no action.
- Unreadable/recent correspondence: facts returned, debtor draft blocked, no action.
- Persistence ambiguity: one reconciliation read by the exact idempotency binding; never a blind second prepare.
- Reused key with different input: idempotency conflict.
- Approval response loss: retry with the same action-derived idempotency key returns the stored immutable receipt.
- Approval key or preview mismatch: conflict, no state change.

## Verification gates

- Contract tests for canonical dates, closed aging buckets, mixed-currency separation, output coupling, immutable preview fields, and zero-effect receipts.
- Service tests for exact aging edges, sorting, status exclusion, 100-row fail-closed behavior, recipient ambiguity, duplicate state, correspondence blocking, deterministic copy, current reauthorization, and persistence replay.
- SQL contract tests for RLS, privilege revocation, pinned search paths, tenant predicates, exact revision binding, idempotency, preview hashing, single-use approval, truthful receipts, no email/payment/document writes, and explicit bulk/autonomous fences.
- Queue-service tests proving approval cannot edit or send, rejection is coherent, replay is stable, and bulk/autonomous paths reject the action type.
- Registry and runtime tests proving v2 and v3 remain unchanged, v4 is inactive, v4 grants only its exact scopes, and dispatch reaches only the collections service for a v4-pinned actor.
- Type check, focused suite, broader agent-control-plane suite, migration lint/static validation, and final git diff/status audit.
