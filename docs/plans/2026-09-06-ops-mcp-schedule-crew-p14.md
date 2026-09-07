# Phase 14 approved schedule and crew changes

**Goal:** Prepare an explicitly enumerated change to existing scheduled tasks, approve the exact complete before/after and effects once in OPS, then return an independently verified atomic receipt.

**Architecture:** One shared domain service and PostgreSQL transaction participant, used by human hosts and durable agents under the same actor/grant authority. Candidate manifest v22 / exposure v16 / consent v11 remain dormant; active v20/v14/v9 and dormant Phase 13 v21/v15 are preserved. Technical design and execution are authorized by the phase brief; no further technical-plan approval gate.

**Design system:** `ops-design-system/project/DESIGN.md`; existing approval desk, Tailwind tokens and EN/ES dictionaries.

**Required skills:** brainstorming, custom-skills:writing-plans, custom-skills:executing-plans, systematic-debugging, test-driven-development, supabase:supabase, ops-copywriter:ops-copywriter, custom-skills:ops-design, frontend-design, interface-design, ui-ux-pro-max, audit-design-system, requesting-code-review, verification-before-completion.

## Contract decisions

- A job is a project anchor; its schedulable work is a `project_tasks` occurrence. Bound 1–25 exact existing task IDs, exact source timestamp/schedule version, destination civil date, and an explicit unique crew set. No dynamic target query is saved. Scope rows are parts of that same visit, displayed and sealed with it. No project dates, scope composition, site-visit booking/capture, recurrence, status, money or customer message change.
- Reject missing/partial dates, ambiguous local time, unavailable work-hour/capacity evidence, malformed crew, unsupported dependencies/paired/recurring work and any hidden cascade. Account for every scope type and related project task. Booked visits and personal/time-off events remain authoritative conflict sources.
- Preserve all-day inclusive UTC storage date labels and exclusive company-local display ends. Timed work preserves local wall time and duration, with unique local-time resolution. Seal timezone conversion results and rules; never derive business dates from viewer timezone. Reject database/application rule mismatch. The hosted timezone-data refresh is an operational release gate, not a timestamp rewrite.
- Availability is explicitly evidence-bounded: current same-company active members, recorded working window, OPS commitments/time off, and relevant scope experience. No assertion of professional certification or unobserved external calendar availability. Unknown evidence blocks any dependent claim.
- Serialize source/target/availability changes with real database locks, including absence of conflicting rows. Rebuild source under those locks at prepare and commit. Protect both directions of concurrent booking races and verify through independent PostgreSQL sessions.
- Invoke canonical `private.update_task_with_event_for_actor`; fix its live time-column regex mismatch separately after reproduction. Preserve schedule versions, task mutation history and internal crew notifications. Suppress unapproved schedule cascade/full-auto/customer dispatch only through a private transaction-owned exact-write token, never a user-set session flag. Confirmation clearing is shown explicitly.
- Existing calendar subscriptions may fetch changed OPS rows later; receipts report consumer synchronization as unknown, never confirmed. No external calendar push intent is created for task-only changes. Existing internal crew events may deliver OneSignal pushes according to preferences. Customer notification remains a separately approved messaging action.
- Approval seals actor/company/grant/client/permission, exact input and sources, scope/effect graph, timezone rules, expiry and displayed proposal. Reauthorize before replay; reject changed-key input, stale state and action substitution. Cancellation before commit leaves all business state unchanged; undo after commit is a new exact proposal.

## Execution checklist

1. Reconcile fresh upstream, live schema/RLS/ACL/functions/triggers/outboxes, phase acceptance and timezone facts. Save technical read-only evidence under `docs/artifacts/phase14/`.
2. Build meaningful failing PostgreSQL/civil-time tests using disposable local fixtures, real canonical functions and mutation triggers. Reproduce current task-time type error. Establish regression samples for Vancouver, Los Angeles DST folds/gaps and 23/25-hour days.
3. Implement strict input/preview/receipt contracts, bounded source builder, current authority, frozen effect policy and exact atomic prepare/commit/reject/readback RPCs. Mirror migrations in Bible after verification.
4. Connect the shared domain facade and dormant capability registry. Use existing approval service/API/UI; enforce named-actor visibility, exact seal, no bulk/automatic execution, and retry-safe receipts.
5. Run focused integration/security tests, real concurrent booking/approval tests, typecheck and production build. Independent review must resolve all important scheduling findings. Verify prior phase regressions and preserve delivery-source replay repair.
6. Update Bible spec/API/data/scheduling/notification chapters and release evidence. Finish tested local work before requesting any remaining production migration or hosted timezone operation. Standing verified push/deployment permission covers dormant release only. No grants, consents, actual customer canary or active exposure change.

## Current verified starting evidence

- Fresh web origin/main: `4907dc649c28009079a600c78e7bbdcdb26b502e`; Bible `bae31ee`.
- Production PostgreSQL 17.6 (`17.6.1.063`) at 2026-09-06 23:31 UTC still resolves Vancouver 2026-11-02 midnight as 08:00Z.
- IANA current release 2026c and B.C. announcement require 07:00Z; hosted upgrade/support must supply correct tzdata. Supabase documented project upgrade takes the project offline; do not initiate without exact operational approval.
- Phase 12 changed-update business acceptance remains unproven; Phase 13 dormant release is verified in published Bible. New phase activation cannot claim or replace that acceptance.
- Independent baseline review confirms task mutation uses a different lock from public guest bookings, and row-only source locks cannot fence new bookings. It also confirms automatic confirmation/customer communication downstream of ordinary task changes.

## Costs

No new paid service, model invocation, provider subscription or recurring worker is planned. Existing Vercel and Supabase usage applies. Hosted maintenance downtime and any platform charges must be verified before proposing the exact database operation.

## Final local verification

127 focused application/regression tests, 51 actual PostgreSQL assertions and four independent-session concurrency cases pass. Production build/typecheck pass; the real preview component was inspected at desktop and phone widths. The remaining production gates are the two exact SQL migrations, a verified hosted timezone-data refresh, and separately authorized activation/business acceptance. See `docs/artifacts/phase14/README.md` and the Phase 14 Bible contract.
