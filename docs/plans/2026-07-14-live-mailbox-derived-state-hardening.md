# Live Mailbox and Derived Lead State Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Make every provider message produce exactly one correctly directed, mailbox-scoped, chronologically ordered CRM record, then reliably refresh thread state, lead state, summaries, and learning without ever treating an unsent draft as correspondence.

**Architecture:** Treat the provider message ID plus email connection as the immutable delivery identity. Reject non-delivery Gmail objects before SyncEngine, make activities the canonical delivered-message ledger, derive thread counters/latest state from that ledger, and mark thread analysis dirty until classification succeeds. Route sync, import, and operator-send paths through the same post-persistence contract so retries repair incomplete derived state instead of skipping it.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Vitest, Supabase/Postgres, Gmail and Microsoft Graph provider adapters.

**Design System:** N/A — backend and data-flow work only. The one TSX change is request wiring with no visual or copy change.

**Required Skills:** `supabase:supabase`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `custom-skills:executing-plans`, `vercel:react-best-practices` for the compose request wiring, and `superpowers:verification-before-completion`.

**Hard constraints:** Never send Gmail messages during verification. Do not mutate the live mailbox, production database, production migrations, or existing production leads. Keep every repair/backfill review-only.

---

### Task 1: Reject non-delivery Gmail objects

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`

**Files:**

- Modify: `src/lib/api/services/providers/gmail-provider.ts`
- Test: `tests/unit/email/gmail-provider-incremental-history.test.ts`

**Step 1: Write failing tests**

- Add a History fixture containing `DRAFT`, `SPAM`, and `TRASH` messages plus valid `INBOX` and `SENT` messages.
- Assert only delivered Inbox/Sent messages are returned while the final Gmail history cursor still advances past excluded objects.
- Add a sent-message fixture whose prior draft was replaced; assert only the surviving `SENT` message is returned.

**Step 2: Verify red**

Run: `npx vitest run tests/unit/email/gmail-provider-incremental-history.test.ts`

Expected: the new tests fail because unfiltered Gmail History currently emits every materialized message.

**Step 3: Implement the provider boundary**

- Filter materialized Gmail messages by `labelIds` before returning `SyncResult.emails`.
- Exclude any message carrying `DRAFT`, `SPAM`, or `TRASH`.
- Preserve cursor advancement and tombstone behavior; exclusion is not a retryable provider failure.
- Keep `SENT` messages even when the connection filter is Inbox-only because outbound correspondence is part of the lifecycle ledger.

**Step 4: Verify green**

Run the focused provider test and the email-ingestion routing test.

---

### Task 2: Preserve provider chronology and interleaving

**Skills:** `superpowers:test-driven-development`, `superpowers:systematic-debugging`

**Files:**

- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/app/api/integrations/email/send/route.ts`
- Modify: `src/app/api/integrations/email/import/route.ts`
- Modify: `src/app/api/integrations/gmail/historical-import/route.ts`
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: `tests/integration/lead-lifecycle-send-route.test.ts`
- Test: `tests/integration/email-opportunity-title-routes.test.ts`

**Step 1: Write failing chronology tests**

- Reproduce a catch-up where an outbound message occurred between two inbound messages but provider discovery returns buckets separately.
- Assert activity order, latest message direction, draft reply source, and lifecycle context use provider time, not insertion order.
- Assert manual sends and historical imports persist their provider/actual sent timestamp.

**Step 2: Verify red**

Expected: current activity inserts omit `created_at`, so catch-up ingestion order becomes conversation order.

**Step 3: Implement one occurrence-time contract**

- Persist `NormalizedEmail.date` as the email activity `created_at` value on sync/import paths.
- Persist `sentAt` as activity `created_at` on the OPS send path.
- Sort the combined provider worklist by provider timestamp before processing; use provider message ID as a stable tie-breaker.
- Keep database insertion time available through audit/event rows; do not overload lifecycle `occurred_at` with worker execution time.

**Step 4: Verify green**

Run the three focused suites and confirm chronological fixtures pass.

---

### Task 3: Make thread cache writes message-idempotent

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Modify: `src/lib/api/services/email-thread-service.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/app/api/integrations/email/send/route.ts`
- Test: create `tests/unit/inbox/email-thread-message-idempotency.test.ts`
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: `tests/integration/lead-lifecycle-send-route.test.ts`

**Step 1: Write failing retry tests**

- Persist the same provider message twice after a simulated downstream failure.
- Assert `message_count`, `unread_count`, latest sender, and latest direction change once.
- Reconcile an OPS send followed by provider replay and assert the thread remains one message richer, not two.

**Step 2: Verify red**

Expected: `upsertFromEmail` blindly increments counters on every call.

**Step 3: Derive cache state from the canonical activity ledger**

- Scope activity reads by company, email connection, and provider thread ID.
- Set counts from distinct provider message rows instead of incrementing.
- Recompute latest fields from the newest delivered activity using provider occurrence time.
- Mark the thread unclassified after a genuinely new delivered message, but not after a duplicate replay that changed no canonical message state.

**Step 4: Verify green**

Run the new idempotency suite plus sync/send suites.

---

### Task 4: Scope all conversation reads to one mailbox and use the newest context

**Skills:** `superpowers:test-driven-development`, `vercel:react-best-practices`

**Files:**

- Modify: `src/lib/api/services/conversation-state/conversation-state.ts`
- Modify: `src/lib/api/services/ai-draft-service.ts`
- Modify: `src/lib/api/services/email-thread-service.ts`
- Test: create `tests/unit/inbox/conversation-mailbox-scope.test.ts`
- Test: create `tests/unit/email/ai-draft-recent-context.test.ts`

**Step 1: Write failing isolation tests**

- Create two email connections with the same provider thread ID and distinct messages.
- Assert conversation state, classifier context, reply provenance, and generated draft context never mix them.
- Create a 30-message thread; assert the newest 20 messages are used in chronological order.

**Step 2: Verify red**

Expected: current reads filter only by company and provider thread ID, and draft lookup selects the oldest 20 rows.

**Step 3: Implement scoped reads**

- Add `email_connection_id = thread.connection_id` to every activity/attachment query.
- Resolve the internal `email_threads` row with both `connectionId` and provider thread ID.
- Fetch newest 20 descending and reverse in memory for chronological prompt order.
- Use provider occurrence chronology from Task 2.

**Step 4: Verify green**

Run both new suites and existing conversation-state/draft suites.

---

### Task 5: Make thread and opportunity refresh retryable

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Modify: `src/lib/api/services/email-thread-service.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/app/api/inbox/reclassify/route.ts`
- Modify: `src/lib/api/services/ai-sync-reviewer.ts`
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: create `tests/unit/inbox/thread-summary-refresh.test.ts`
- Test: create `tests/integration/inbox-reclassify-dirty-thread.test.ts`

**Step 1: Write failing refresh tests**

- Existing inbound, existing outbound, manual-category, and duplicate-retry scenarios must all refresh summary context after a new delivered message.
- A classifier failure must leave the thread eligible for retry.
- Opportunity evaluation must run for every touched opportunity and update summary/signals even if stage does not change.

**Step 2: Verify red**

Expected: normal outbound/manual-category paths skip classification, errors are swallowed, and unchanged-stage signals remain stale.

**Step 3: Implement durable dirty-state semantics**

- Set `category_classified_at = null` only when a new canonical message is recorded.
- Make `classifyAndUpdate` preserve manual category while still refreshing summary.
- Stop swallowing database/classifier failures that would falsely mark a refresh complete.
- Classify each touched thread once per sync after all messages are persisted.
- Keep the reclassifier eligible to process dirty manual-category rows for summary refresh.
- Persist opportunity summary and latest AI evidence atomically on every successful evaluation, not only stage transitions.

**Step 4: Verify green**

Run refresh, reclassifier, AI reviewer, and sync suites.

---

### Task 6: Unify manual-send learning and draft feedback

**Skills:** `superpowers:test-driven-development`, `vercel:react-best-practices`

**Files:**

- Modify: `src/components/ops/compose-email-form.tsx`
- Modify: `src/app/api/integrations/email/send/route.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/lib/api/services/ai-draft-service.ts`
- Create: `src/lib/api/services/email-outbound-learning-service.ts`
- Create: `src/lib/email/outbound-learning-evidence.ts`
- Create: `supabase/migrations/20260713204500_agent_memory_schema_reconciliation.sql`
- Create: `supabase/migrations/20260713205000_email_outbound_learning_queue.sql`
- Test: `tests/integration/lead-lifecycle-send-route.test.ts`
- Test: `tests/unit/email/email-outbound-learning-service.test.ts`
- Test: `tests/unit/supabase/email-outbound-learning-queue-migration.test.ts`

**Step 1: Write failing learning tests**

- Assert the send request carries `draftHistoryId` and the final edited subject/body.
- Assert successful OPS sends enqueue one provider-scoped outcome instead of running model work inline.
- Assert provider replay repairs a failed post-send learning step without duplicating learned evidence.
- Assert Phase C disabled still records mandatory sent-draft/follow-up state without applying profile or memory learning.
- Assert retry-response loss is not misreported as a terminal job and stale max-attempt leases are surfaced.

**Step 2: Verify red**

Expected: compose fires feedback separately, send route does not learn, and sync replay exits on the existing activity.

**Step 3: Implement one post-send contract**

- Include draft provenance in the authenticated send request.
- Persist/reuse draft history before every approval/lifecycle delivery and make the send route the one canonical outcome owner.
- Enqueue one cleaned sample keyed by company + connection + provider message from both the send route and provider sync.
- Prepare expensive extraction off the irreversible send path, persist it before application, and apply profile/memory/draft/completion effects in one transaction with immutable receipts.
- Reject changed company/user/connection/thread/draft/follow-up provenance; expose sanitized diagnostics and an audited failed-job requeue RPC.
- Never turn a post-delivery learning failure into a response that invites the caller to send the email again; preserve a retryable internal state and return delivery success separately.

**Step 4: Verify green**

Run send, feedback, reconciliation, and outbound-learning suites.

---

### Task 7: Align enrichment provenance with applied lead values

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`

**Files:**

- Modify: `src/lib/email/lead-enrichment.ts`
- Modify: `src/lib/api/services/conversation-state/contact-resolver.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Test: `tests/unit/email/lead-enrichment-provenance.test.ts`
- Test: `tests/unit/email/lead-enrichment.test.ts`
- Test: `tests/unit/inbox/conversation-state/contact-resolver.test.ts`

**Step 1: Write failing precedence tests**

- A higher-confidence form/display/signature value may replace a weaker parsed/local-part value.
- Human-confirmed values remain protected.
- Provenance is written only for the value actually applied or confirmed current.

**Step 2: Verify red**

Expected: plausible wrong values block better facts while provenance can record the rejected value.

**Step 3: Implement confidence-aware promotion**

- Compare incoming source/confidence with the current field's provenance.
- Apply only strictly better evidence unless the field is human-protected.
- Persist provenance from the applied update decision, not independently from raw extraction.

**Step 4: Verify green**

Run enrichment, tenant-isolation, and contact resolver suites.

---

### Task 8: Cover imports, repair review, and full verification

**Skills:** `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `supabase:supabase`

**Files:**

- Modify: `src/app/api/integrations/email/import/route.ts`
- Modify: `src/app/api/integrations/gmail/historical-import/route.ts`
- Modify: `docs/audits/2026-07-13-email-ingestion-lead-project-hardening.md`
- Modify: `docs/backfills/2026-07-13-email-lead-project-repair-review.sql`
- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Test: `tests/integration/email-opportunity-title-routes.test.ts`
- Test: all changed email pipeline suites

**Step 1: Add failing import parity tests**

- Wizard and historical imports must populate the same canonical activity/thread/derived-state contract as steady sync.
- Import retries must be idempotent.

**Step 2: Implement parity**

- Route both imports through shared activity/thread/post-processing helpers.
- Do not create a parallel semantics path.

**Step 3: Extend the review-only repair plan**

- Detect Gmail IDs carrying draft/revision evidence, direction mismatches, inflated thread counts, missing activities, missing thread/opportunity summaries, and provenance disagreements.
- Keep every mutation commented/guarded and require explicit approval before production apply.

**Step 4: Update architecture documentation**

- Record delivery identity, mailbox scoping, provider chronology, dirty-summary retries, and applied-value provenance.

**Step 5: Verify**

- Run every changed focused suite.
- Run the complete email-pipeline suite.
- Run app TypeScript, ESLint on changed files, Prettier check, and `git diff --check`.
- Re-run the Gmail connector versus Supabase comparison read-only; never send a message and never execute repair SQL.
