# Customer Message Preparation and Approved Send Implementation Plan

**Goal:** Add one exact, editable customer email follow-up capability that prepares from current correspondence, requires approval in OPS, sends through the existing mailbox transport once, and returns a truthful durable receipt.

**Architecture:** Extend the shared domain capability layer with a dormant customer-message prepare contract. Persist the exact sender, recipient, thread, rendered message, evidence and source versions in a private proposal, surface the existing approval queue, and commit through the existing approved-action email intent, mailbox lease and reconciliation state machine. Keep MCP exposure, consent and grants unchanged until separately activated.

**Tech Stack:** Next.js 15, TypeScript, Zod, Supabase PostgreSQL, existing Gmail/Microsoft 365 provider adapters, Vitest and PostgreSQL 17 contract tests.

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`; reuse the existing approval detail and tokens.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`.

### Task 1: Repair delivery-source replay

- Add a forward migration that keeps the immutable original evidence hash while accepting repeated capture of the same retained bytes after text re-projection.
- Extend and run the real PostgreSQL contract, including changed-byte conflict and mutation-guard checks.
- Commit the isolated repair.

### Task 2: Define the customer-message contract

- Add strict input, proposal, status and receipt schemas for one existing-thread individual email follow-up.
- Bind exact sender mailbox, one authoritative recipient, subject, body, provider thread/reply identity, source message versions, policy/capability versions, proposal hash, approver and expiry.
- Reject CC/BCC, attachments, new-thread outreach, unsupported commitments and ambiguous identity.

### Task 3: Persist preparation and exact approval

- Add private proposal/policy state and service-only prepare/commit/reject/read RPCs.
- Reauthorize tenant, actor, record, mailbox and correspondence access at preparation and send claim.
- Reject changed evidence, new inbound/outbound progress, changed permissions/scopes/policy, edit drift, expired/reused approvals and competing idempotency keys.

### Task 4: Reuse the provider send state machine

- Add the customer-follow-up action type to the existing approved email intent only after exact OPS approval.
- Preserve durable claim-before-provider-I/O, mailbox serialization, provider acceptance persistence, unknown-outcome quarantine and reconciliation without blind resend.
- Return prepared, approved/queued, attempted, provider-accepted, reconciled-sent, failed, cancelled-before-send or unknown truthfully; never call provider acceptance delivery.

### Task 5: Present approval and receipts

- Reuse the current approval screen to show correspondence provenance, exact From/To/Subject/body/thread, expiry and effect limits.
- Use existing design tokens and localized OPS copy; editing creates a new proposal and invalidates the old approval.
- Resolve the persistent approval notification only on reject or terminal reconciliation.

### Task 6: Verify and document

- Run focused contract, authorization, concurrency, provider-failure and UI tests plus typecheck, lint and production build.
- Reconcile the delivery-source CI failure and distinguish unrelated broad-suite failures.
- Update API, data, correspondence, approval and notification Bible sections and mirror migrations.
- Commit source and Bible atomically; push/deploy the dormant software under standing authorization, while leaving exposure/consent/grants and any real send inactive.
