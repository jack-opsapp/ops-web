# Email / Lead Assignment Authorization Hardening Plan

**Goal:** Make every email read, draft, attachment, send, ingestion, and Phase C action honor the approved lead-assignment contract while preserving mailbox identity, the real OPS actor, and exactly-once post-send reconciliation.

**Source of truth:** `docs/superpowers/specs/2026-07-15-lead-assignment-design.md`, especially §§6.4–6.6, 10.4, 12–18.

**Architecture:** Resolve Firebase identity to one canonical OPS `users.id` on the server, resolve each provider thread to its canonical mailbox-scoped opportunity relationship, and intersect opportunity scope with inbox scope for every lead-bound operation. Mailbox ownership authorizes transport only. A durable send-intent state machine is persisted before provider I/O; accepted provider results are reconciled idempotently without calling the provider again. Phase C and ingestion derive actor/assignee only from canonical OPS IDs or an enumerated system principal—never from email equality.

**Tech stack:** Next.js route handlers, TypeScript, Vitest, Supabase/Postgres, Gmail and Microsoft provider adapters.

**Design system:** N/A — backend/data-flow work. Existing UI wiring may change only to carry canonical IDs/idempotency keys and render existing notifications; no new styling.

**Hard constraints:** Never send provider mail during verification. Do not mutate Gmail/Microsoft state, apply a production migration, deploy, or push. Preserve the untracked lead-assignment spec owned by the parent task. Use mocked providers and local migration-contract tests only.

## Task 1 — Lock the authorization model with pure tests

**Create:**

- `src/lib/email/email-opportunity-access.ts`
- `tests/unit/email/email-opportunity-access.test.ts`

**Modify:**

- `src/lib/email/email-route-auth.ts`
- `src/lib/email/server-mailbox-access.ts`
- `src/lib/supabase/check-permission.ts`

1. Add failing tests for effective `all / assigned / own` scope resolution, including admin bypass and explicit proof that absent granular permissions never widen through legacy `pipeline.manage` or `inbox.view_company` grants.
2. Add failing tests proving linked reads require `pipeline.view ∩ inbox.view`, linked sends require `pipeline.edit ∩ inbox.send`, unassigned/unrelated shared-mailbox threads fail assigned scope, and personal ownership never replaces lead access. `inbox.view:assigned` is the explicit union of actor-owned personal-mailbox threads (including unlinked personal threads) and threads on currently assigned leads; it is not derived from the generic scope rank.
3. Add failing tests for canonical relationship resolution: internal thread ID + connection + provider thread + opportunity must agree; forged lead/thread/mailbox IDs fail closed.
4. Implement a server-only actor resolver returning canonical `{ userId, companyId }` and reject any supplied actor/company claim that disagrees.
5. Implement one reusable opportunity/thread/mailbox access resolver. Row-specific TypeScript authorization must call the canonical service-only opportunity helper; do not recreate `pipeline.manage` or `inbox.view_company` compatibility fallbacks outside the database-owned compatibility migration.

## Task 2 — Apply the same read intersection everywhere

**Modify:**

- `src/app/api/inbox/threads/route.ts`
- `src/app/api/inbox/threads/[id]/route.ts`
- `src/app/api/inbox/threads/[id]/attachments/route.ts`
- `src/app/api/integrations/email/attachment/route.ts`
- `src/app/api/inbox/drafts/route.ts`
- `src/app/api/integrations/email/draft/route.ts`
- `src/app/api/integrations/email/ai-draft/route.ts`
- `src/lib/api/services/email-thread-service.ts`

**Test:**

- `tests/integration/inbox/assigned-thread-authorization.test.ts`
- `tests/integration/inbox/assigned-draft-authorization.test.ts`
- `tests/integration/inbox/assigned-attachment-authorization.test.ts`

1. Write failing route tests covering assigned/all/own scopes, unlinked shared threads, other-assignee threads, cross-company IDs, shared clients with sibling leads, and personal mailboxes.
2. Filter list queries before serialization; never fetch a company-wide page and filter only in the browser.
3. Gate detail, sibling context, activities, commitments, drafts, and attachments through the same canonical helper.
4. Include canonical `connectionId` and `providerThreadId` in authorized thread detail so deep-linked replies do not recover identity from a separate list cache.
5. Require send authority for provider-draft creation/update/delete; keep read-only draft listing on the view intersection.

## Task 3 — Add a durable, idempotent provider-send contract

**Create:**

- `supabase/migrations/20260715162000_email_send_intents.sql`
- `src/lib/api/services/email-send-intent-service.ts`
- `src/lib/api/services/email-send-reconciliation-service.ts`
- `tests/unit/supabase/email-send-intents-migration.test.ts`
- `tests/unit/email/email-send-intent-service.test.ts`

**Modify:**

- `src/app/api/integrations/email/send/route.ts`
- `src/lib/hooks/use-inbox-threads.ts`
- `src/components/ops/inbox/inbox-route.tsx`
- `tests/integration/lead-lifecycle-send-route.test.ts`

1. Write failing tests proving spoofed actor/company/connection/thread/opportunity IDs fail before provider I/O and an assigned actor whose login differs from the shared mailbox can send.
2. Add `email_send_intents` with a company-scoped deterministic idempotency key; canonical actor, mailbox, internal/provider thread, opportunity, draft provenance, request fingerprint, state, provider result, reconciliation attempts, and timestamps; revoke browser writes.
3. Persist and claim the intent before provider I/O. A retry of an accepted/reconciling/reconciled intent must never call the provider again. A retry of an in-flight intent returns a delivery-unknown/recovery response rather than risking a duplicate.
4. Pin replies to the existing thread connection. Permit a sender switch only as an explicit new conversation with no reply/provider-thread identifiers, linked to the same opportunity.
5. Persist provider acceptance immediately, then run idempotent activity/correspondence/thread/draft/learning reconciliation. If it fails, retry reconciliation once from the intent and return `202 reconciliationPending` without resending.
6. Preserve drafts on provider rejection and write no sent activity. Enrich a sync-won outbound activity with the canonical OPS actor instead of losing attribution.
7. Generate one stable idempotency key per compose/send attempt in the client hook and reuse it on transport retry.

## Task 4 — Make Phase C actor ownership assignment-aware

**Create:**

- `src/lib/email/phase-c-email-actor.ts`
- `tests/unit/email/phase-c-email-actor.test.ts`

**Modify:**

- `src/lib/api/services/sync-engine.ts`
- `src/lib/api/services/phase-c-autonomy-router.ts`
- `src/lib/api/services/auto-send-service.ts`
- `src/app/api/cron/auto-send/route.ts`
- `src/app/api/integrations/email/analyze-memory/route.ts`
- `src/app/api/inbox/phase-c-backfill/route.ts`
- Phase C calibration/status queries that read draft history directly

1. Add failing tests for company mailbox + assigned actor, unassigned lead, personal mailbox owner, reassignment, deactivation, and differing login/mailbox addresses.
2. Resolve the Phase C user from current opportunity assignment for shared mailboxes and from the canonical active personal-connection owner only when assignment still authorizes that owner.
3. Remove `connection.userId` and `users.email = mailbox` fallbacks from personal learning, notifications, signatures, draft ownership, and auto-send authority.
4. Persist `actor_user_id` and the expected `assignment_version` on pending auto-sends; atomically claim rows and reauthorize current assignment, lead edit/send scopes, and exact mailbox before send.
5. Cancel/pause stale rows on reassignment, deactivation, or connection disable; never move them to another user's profile or mailbox.

## Task 5 — Harden ingestion, relationship reconciliation, and assignment

**Modify:**

- `src/lib/api/services/sync-engine.ts`
- `src/lib/api/services/email-matching-service-v2.ts`
- `src/app/api/integrations/email/import/route.ts`
- `src/app/api/integrations/gmail/historical-import/route.ts`
- `src/lib/api/services/email-attachments/attachment-runtime.ts`

**Test:**

- `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- `tests/integration/email-opportunity-title-routes.test.ts`
- existing attachment attribution suites

1. Run deterministic relationship matching for every eligible external inbound/outbound message before duplicate-lead creation, not only selected classification/form paths.
2. Preserve connection + provider thread + message + opportunity identity on all activity, thread, correspondence, attachment, and draft rows.
3. Company-mailbox lead creation always leaves `assigned_to = null`; suggestions stay advisory.
4. Personal-mailbox lead creation calls the guarded assignment operation with the canonical active owner and system provenance; it never writes `assigned_to` directly or resolves by email.
5. Verify cross-connection replies reconcile only through explicit provider/relationship evidence and never borrow another mailbox's provider thread identity.

## Task 6 — Handle personal-connection disable without fictitious rerouting

**Modify:**

- email connection disconnect/deactivation route(s)
- notification service integration
- sync and send connection-status preflights

**Test:**

- `tests/integration/email-connection-disable.test.ts`

1. Add failing tests proving disabled personal connections stop sync/send and do not fall back to the company mailbox for an existing thread.
2. Resolve affected active conversations by exact connection and linked active opportunity.
3. Emit one durable, actionable company-wide assignment-admin warning with reconnect/forwarding/new-path guidance; dedupe and resolve it when no affected conversation remains.

## Task 7 — Remove browser access to mailbox credentials and learning ledgers

**Create/modify:**

- sanitized email-connection list/update/disconnect API
- `src/lib/hooks/use-email-connections.ts`
- legacy Gmail connection hook(s)
- corrective migration revoking `anon` / `authenticated` direct DML on `email_connections`, `ai_draft_history`, `pending_auto_sends`, and `email_send_intents`

**Test:**

- connection API route tests
- migration grant/policy contract tests

1. Write failing tests proving serialized connection DTOs never contain access/refresh tokens.
2. Move browser hooks to authenticated server routes with sanitized descriptors.
3. Scope personal connection management to its canonical owner and company connection management to integration settings permission.
4. Revoke broad browser table grants after route compatibility is in place; document deployment order so code precedes the grant-revocation migration.

## Task 8 — Lock conversion's non-staffing boundary

**Modify/test:**

- conversion route/RPC contract tests only where email work touches conversion
- project-conversion test fixtures

1. Assert assigned conversion rechecks the assignment/version under lock.
2. Assert the won opportunity retains `assigned_to`.
3. Assert conversion creates no project owner, membership, or task `team_member_ids` from the lead assignee.

## Task 9 — Verification, documentation, and integration

1. Update the OPS Software Bible with the actor/mailbox/client identity split, scope intersections, send-intent lifecycle, mailbox-disable behavior, and Phase C profile ownership.
2. Generate database types only after the final local migration set is coherent; do not apply production DDL.
3. Run focused red/green suites for each task, then relevant email/inbox/supabase suites, TypeScript, lint on changed files, and production build.
4. Inspect the diff for provider calls in tests or live-mutation tooling; verification must use mocks/local SQL contracts only.
5. Request independent code review for authorization bypasses, actor/profile pollution, exactly-once send failure windows, and conversion staffing leakage.
6. Commit in atomic backend/data/test groups. Do not stage the parent-owned untracked spec. Do not push, deploy, or apply migrations.

## Integration dependencies owned by the lead-assignment implementation

- Canonical permission catalog/scopes and deterministic legacy migration.
- Opportunity `assigned_to` FK/index plus `assignment_version`.
- Canonical opportunity view/edit helpers callable from service-role routes with an explicit actor.
- Guarded assignment operation, immutable assignment events, and access-change outbox.
- Conversion helper/RPC enforcing assignment under lock.

Email code must fail closed until these contracts exist; it must not recreate assignment mutation or bypass them locally.
