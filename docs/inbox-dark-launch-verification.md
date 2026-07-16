# Inbox Dark-Launch — Verification & Launch Runbook (T13)

- **Date:** 2026-06-02
- **Branch:** `feat/inbox-dark-launch-iso` (worktree `ops-web-inbox-dark-launch`)
- **Spec:** `docs/specs/2026-06-01-inbox-dark-launch-design.md` · **Plan:** `docs/plans/2026-06-01-inbox-dark-launch.md`

## 2026-07-15 assignment-safe follow-up — contact form → assigned review draft

- **Plan:** `docs/plans/2026-06-03-inbox-forwarded-form-new-thread.md`

**Current contract:** a website contact-form submission forwarded into a connected mailbox must never create a reply on the forwarder's provider thread. OPS creates or matches the lead first, preserves the exact mailbox/message/thread/activity identity, and starts a **clean new provider draft to the actual client** only after a canonical OPS user is the lead's current assignee. The first outreach is always review-only; this worker has no send capability.

**How:** company-mailbox ingestion leaves the lead unassigned. Personal-mailbox ingestion may assign only the connection's active canonical OPS owner through the guarded assignment operation. Migration `20260715178000_email_assignment_contact_form_drafts.sql` rendezvouses the immutable current assignment event with the exact inbound activity in a service-only queue. The worker rechecks assignment version, active user, canonical lead edit authority, `inbox.send`, active mailbox transport, the exact message-scoped lead key, customer identity, and `primary:CUSTOMER` autonomy immediately before provider draft creation. Company connector `user_id` is ignored; only `type='individual'` may use its exact owner as transport authority.

The model uses the assignee's `client_new_inquiry` learning profile and may generate a learned subject; `Thanks for reaching out` is the deterministic fallback. The body is rendered with the effective signature in this order: operator-scoped OPS signature, mailbox-wide OPS signature, then a supported provider signature. With no signature, drafting remains retryable and OPS keeps a persistent signature-required notification open.

**Atomicity and reconciliation:** after provider acceptance, one database transaction locks the opportunity and queue, rechecks the current assignment and autonomy, activates only the current assignee's Phase C history, links the new provider thread, and completes the queue row. If the provider accepted but OPS persistence failed, a retry inventories drafts and adopts only an exact post-watermark match (recipient, no CC, subject, normalized body), so it does not create a second provider draft. A later human send is reconciled from the immutable provider message/thread identity; edit learning must pass the assignment-aware outbound-learning authorization added by the July 2026 hardening chain.

**Local verification:** migration-contract, worker, runtime, mailbox-placement, provider-failure, signature, subject, reassignment, and no-send tests are included in the July 2026 email hardening suite. This branch has not applied the migration, deployed the worker, or written a real Gmail/Outlook draft.

**Live acceptance (run only after the complete migration chain and reviewed Operator activation are deployed):** ingest a real contact-form submission into company and individual Gmail/Outlook connections; verify the company lead stays unassigned and produces no draft until guarded assignment, the individual lead assigns only to its active owner, and the resulting item is a new review draft to the customer. Verify learned and fallback subjects, signature precedence and missing-signature notification, reassignment before/after provider acceptance, edit + native send reconciliation, and that no automated send occurs. Repeat the manual Pipeline **Draft** path on both providers.

## Historical 2026-06-02 baseline

The figures below describe the original dark-launch branch, not the July 2026 assignment-hardening branch. Use the focused and full verification recorded with the current implementation commit for release decisions.

- **Full vitest suite:** 2940 passed, 5 skipped, **14 failed**. **TypeScript: 0 errors** (`tsc --noEmit`).
- **All 14 failures are pre-existing and unrelated to this branch** — every one is in a file this branch never touched (verified via `git diff --name-only fedc55cc..HEAD` ∩ failing files = ∅): `uploads-presign` (8), `company-service-images` (2), `project-workspace-editing` (1), `calendar/map-task-to-event` (1), `use-table-keyboard-nav` (1), `api-client` Bubble rate-limit (1, timing-flaky), `visual/project-workspace.spec` (needs a browser). CI is already red on `main` (lint gate + these), per project history.
- **Every inbox test added by this initiative passes**, run together: idempotency helper, inbox_ui service, feature-flags route, auto-draft mailbox push, draft reconciliation (unit + integration), notification gating, pipeline draft-to-mailbox, admin toggle, route gate + feature-flag-definitions, auto-send kill switch, autodraft defaults.
- **Settings footprint preserved:** `src/components/settings/**` and `src/app/(dashboard)/calibration/**` contain **no** `inbox_ui` reference — mailbox connect/reconnect, sync controls, and the lead-import wizard stay available regardless of the inbox flag. Engine endpoints (`/api/cron/*`, lead creation in sync) are not gated by `inbox_ui`.
- **Live-schema CHECK verified (caught a prod-breaking bug):** vitest runs against a mocked DB and does NOT enforce Postgres CHECK constraints. Direct prod inspection found `ai_draft_history_status_check` rejected the reconciliation's `sent_from_mailbox` / `discarded_in_mailbox` writes — fixed by migration `20260602010000` (CHECK expanded to allow them; applied to prod, verified). Lesson: verify new status/enum values against the live constraint, never just the mocked tests.

## Current guarantee map

| Guarantee | Verified by |
|---|---|
| Assigned Inbox visibility is the pipeline/inbox intersection | `assigned-thread-authorization.test.ts`, `assigned-widget-authorization.test.ts`, `email-opportunity-access.test.ts` |
| Draft and attachment access uses the same canonical lead boundary | `assigned-draft-authorization.test.ts`, `assigned-attachment-authorization.test.ts` |
| Provider sends are durable, actor-attributed, and never duplicated during reconciliation | `email-send-intents-migration.test.ts`, `email-send-intent-service.test.ts`, `email-send-reconciliation-*.test.ts`, `lead-lifecycle-send-route.test.ts` |
| First contact-form outreach is a new review draft, assignment-fenced, and has no send capability | `email-assignment-contact-form-drafts-migration.test.ts`, `email-assignment-contact-form-draft-worker.test.ts`, `email-assignment-contact-form-draft-runtime.test.ts`, `mailbox-draft-push.test.ts` |
| Company mailbox identity never becomes user identity; personal ownership is exact | `email-legacy-text-identity-compatibility.test.ts`, `phase-c-email-actor.test.ts`, `outbound-learning-actor.test.ts` |
| Missing signatures block drafts/sends and keep one actionable notification open | `phase-c-learning-signatures-migration.test.ts`, `email-send-route-hardening.test.ts`, signature service/runtime suites |
| Converted lead images are projected idempotently without staffing the project | `email-conversion-photo-materialization-migration.test.ts`, `email-conversion-photo-worker.test.ts`, guarded conversion tests |

## Deferred to a live environment / launch (needs running app + real mailboxes)

Run these before flipping anything on for real users:

1. **Connect smoke:** From Settings → Integrations → Email, connect a **Gmail** mailbox and an **Outlook** mailbox; run "Import Your Pipeline". Confirm leads import and ongoing sync creates leads.
2. **Gate smoke (`inbox_ui` off, the default):** `/inbox` redirects to `/pipeline`; Inbox sidebar item hidden; inbox-leads widget CTA goes to `/pipeline`.
3. **Team on:** enable `inbox_ui` for your company (`/admin/system`); `/inbox` loads; nav item returns.
4. **Assigned-thread round-trip:** assign a shared-mailbox lead to a user whose OPS login differs from the mailbox address; confirm complete history is visible and an OPS reply uses the original mailbox while recording that OPS user as actor. Reassign during compose and confirm provider I/O is denied.
5. **Phase C mailbox draft round-trip:** create a linked draft, edit + send from the native mail client, and confirm the exact provider message reconciles to the current assignee's profile. Reassign before native send and confirm no old-user profile mutation. Test Gmail and Outlook.
6. **Contact-form first reply:** run the company-unassigned, company-assigned, personal-owner, missing-signature, generated-subject, fallback-subject, provider-accepted/DB-retry, and reassignment-race cases described above.
7. **Pipeline draft:** click **Draft** on an authorized Pipeline lead and confirm the review draft is saved to the thread's mailbox. Confirm another assignee, an unassigned lead under assigned scope, and another user's personal mailbox are denied.
8. **Notifications:** confirm assignment, signature-required, connection-disable, lead-classified, acceptance, and sync-complete notifications reach only their canonical recipients and route to `/pipeline` when Inbox UI is unavailable.
9. **Attachment conversion:** ingest JPEG/PNG/HEIC correspondence photos, convert the lead, run the materializer twice, and confirm one project photo per source attachment with no project/task assignee copied from the lead.
10. **Cost review:** after week 1, read actual drafting spend on `OPENAI_API_KEY_DRAFTING`; model and provider invocation cost must be measured from production telemetry.

## Release blockers and explicit limitations

- Do not enable the Operator preset until its reviewed activation migration lands after the complete email chain. The absent activation is intentional and keeps new assigned-scope behavior fail-closed.
- Assignment-event Realtime fan-out, child-table scoped RLS, and strict permission transports must use their independently reviewed parent-task migrations. Do not recreate those contracts in email code.
- A provider and Postgres cannot share one transaction. If assignment changes after the final pre-provider draft check but before provider acceptance, OPS rejects all attribution and learning; the unlinked, unsent provider draft may remain quarantined in Drafts. Release monitoring must expose these rare orphaned provider drafts for operator cleanup.
- Provider-draft recovery depends on the provider's draft inventory. Validate pagination/coverage against high-volume Gmail and Outlook mailboxes before broad rollout; an unavailable inventory fails closed and never creates a second draft on that retry.
- Production completion requires the complete reviewed migration order, deployment, live policy/function readback, real-mailbox acceptance on both providers, and proof that no unauthorized provider send occurred. Local green tests are not production proof.
