# Unanswered lead recovery

**Goal:** Recover the exact unanswered sales conversations from the previous seven Vancouver calendar days, including forwarded Victoria-office Wix leads that never reached OPS or were linked to the wrong lead, and create retry-safe OPS-local reply drafts without any Gmail/provider mutation.

## Behaviour contract

- Gmail and Microsoft 365 are read-only throughout recovery. The recovery surface cannot label, archive, send, forward, create a provider draft, update a provider draft, or advance a provider sync cursor.
- Recovery is message-scoped and bounded by an explicit reviewed manifest. It is not a mailbox-history replay or a bulk historical backfill.
- Forwarded customer identity comes from strict nested-message evidence. The forwarding office mailbox is transport metadata, never the customer, and ordinary forwarded customer emails receive the same effective-sender treatment as recognized contact forms.
- Existing correctly ingested messages are reused. Missing messages enter through the canonical ingestion/matching path; wrongly linked messages move through a guarded exact-message RPC with company, connection, source-owner, target-owner, actor, and sender checks.
- A retry cannot create a second activity, event, opportunity, thread link, attachment attribution, or local draft.
- Recovery never changes `opportunities.assigned_to` directly, never changes a manual or terminal stage, and never converts a lead or creates a project merely to make drafting possible.
- A draft candidate must be an active sales lead whose latest meaningful customer event has no later meaningful company response across all known fragments. Warranty, service, active-project, internal, automated, and non-actionable conversations are excluded.
- Drafts are stored only in OPS with exact source activity/event provenance and a null provider draft id. A final compare-and-swap fence rechecks correspondence, stage, authorization, and duplicate state immediately before persistence.
- Email bodies remain untrusted model input. They cannot issue instructions to tools, alter authorization, broaden the manifest, or select recipients.

## Implementation sequence

1. Add failing characterization tests for the exact nested Wix forwarding shape and a generic Victoria-office forward whose nested external sender must become the effective inbound customer.
2. Make persisted direction, matching, activity identity, and event identity consume the same strict effective-sender result without weakening contact-form validation.
3. Add a provider-read-only exact-message recovery service and CLI. Dry-run is the default; apply requires a content-addressed approved manifest and refuses records outside the seven-day Vancouver window.
4. Add a guarded exact-message reparent RPC for the bounded wrongly linked cases. Preserve stage, assignment, manual override, project state, and authorization while recomputing only correspondence projections owned by the moved message.
5. Add an OPS-local unanswered-lead drafting service and CLI with source-bound idempotency, final-state fencing, and no provider mutation capability.
6. Cover missing provider-only leads, correctly linked leads, shared forwarding threads, wrongly linked messages, fragmented threads, alternate participants, later replies, manual/terminal protection, attachment attribution, idempotent retry, and provider-write denial.
7. Update the email integration and lifecycle Bible sections, run focused and lifecycle suites, TypeScript checks, and the production build, then run a read-only shadow against the reviewed live conversations.
8. Commit atomic changes. Do not push, deploy, apply migrations, or mutate live Gmail/Supabase until the resulting manifest and deployment boundary are explicitly approved.

## Verification gates

- The mailbox-first shadow set contains every actionable sales conversation in the window, including provider-only Victoria forwards, and reports exclusions with a deterministic reason.
- The recovery dependency surface exposes provider reads only; static and runtime tests fail if any provider mutation is attempted.
- Exact retries and concurrent retries yield one canonical message/event/draft outcome.
- No test or implementation path writes `opportunities.assigned_to`, bypasses guarded transition/conversion helpers, or changes manual/terminal stages.
- The final live evaluation is Gmail read-only and Supabase SELECT-only.
