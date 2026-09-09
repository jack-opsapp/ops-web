# Existing-job email routing implementation plan

**Goal:** An email about work already underway or delivered must never manufacture a new sales opportunity. Retain it against the proven customer/project, or visibly hold it for review when identity or intent is uncertain.

**Architecture:** Separate the purpose of a message from the identity of its sender. Extend the existing classifier calls with an explicit work-intent result; check the live customer and project relationship independently of archived opportunity eligibility. Persist non-sales correspondence through an idempotent, company/mailbox-scoped database boundary, preserving source evidence and project timeline visibility without reopening archived leads or invoking sales automation. Preserve genuine additional/new-work requests.

**Tech stack:** TypeScript, existing OpenAI classification requests, Supabase/PostgreSQL, Vitest.

**Design system:** `.interface-design/system.md` consulted; reuse existing project timeline and notification rail. No new visual surface.

**Required skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:using-git-worktrees, superpowers:requesting-code-review, supabase:supabase, ops-copywriter:ops-copywriter, superpowers:verification-before-completion.

**Authorization:** Plan and execute locally. No push, deployment, production migration, provider mutation, historical cleanup, or replay against production. Current production example is evidence only. Worktree starts at c3e9f141d; the affected code matches deployed 4bddcf182.

## 1. Capture behavioral regressions

- Add literal anonymized fixtures for the reported forwarded damage email: known subcontact, one in-progress project, archived old leads, no new work requested.
- Cover scheduling/access, billing/payment, warranty/callback, ambiguous identity, multiple projects, deleted/foreign-company records, and a real new-work request by the same customer.
- Assert no opportunity/client insertion, no archived lead reopening, retained source activity, and visible project correspondence/review.
- Run focused tests before implementation and record the expected failures.

## 2. Classify purpose without adding another model call

- Extend `src/lib/api/services/email-ai-classifier.ts` and `ai-sync-reviewer.ts` with new-work / existing-job / uncertain intent and source evidence.
- Existing-job correspondence must survive classification as a persistence result; it must not become noise or disappear through lead-confidence filtering.
- Judge the current message, with quoted history as context only. Keep exact message identities and strict response validation. Missing/unverified purpose cannot grant new-lead authority for a known existing project.
- Exercise strict parsing, Stage B corrections, single-message forwards, refusal/provider failure, and legacy consumers.

## 3. Resolve customer/project independently of sales records

- Add a focused service under `src/lib/email/` for company-scoped exact customer/subcontact identity and project matching.
- Prefer exact property address when present; a locality is not a project identity. A unique project may be selected only with a proven customer and explicit existing-job intent. Ambiguity becomes review.
- A known existing project with unclear intent blocks automatic lead creation. Explicit new work remains eligible for ordinary lead routing.
- Apply the guard to automatic pattern, AI promotion, outbound initiation, and recovery paths; preserve authenticated intake markers and already-linked message ownership.

## 4. Persist correspondence safely

- Verify live columns, RLS, triggers, and provider-activity uniqueness before writing migration code.
- Add a service-only guarded persistence function and durable receipt as needed. It must validate active mailbox/company/source identity and current client/project membership, preserve one exact provider activity, and reject conflicting reparenting.
- Store project timeline evidence and notify the responsible mailbox operator for inbound correspondence/review, idempotently. Replays repair incomplete projection without duplicating activity, note, notification, or lead.
- Keep project correspondence out of lead counters, stage classification, acceptance conversion, lead notifications and sales-draft autonomy.
- Run local SQL contracts for idempotence, tenant isolation, project/client mismatch, and stale/conflicting ownership.

## 5. Integrate and verify

- Extend `tests/unit/email/email-opportunity-title-sync-engine.test.ts` with real sync-path regressions and a narrow new service suite.
- Cover normal sync, forwarded message scope, classification recovery, retries after partial persistence, pattern bypass and explicit new work.
- Run affected classification/reviewer/matching/sync suites, TypeScript and lint checks. Use bounded tests; do not make unrelated baseline failures a completion gate.
- Run a read-only replay of the live example through the pure decision layer. No paid model evaluation or live mutations.
- Obtain an independent code review and fix all material findings.

## 6. Document and close

- Update `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md` and relevant API/schema documentation in the same session, marking local versus live status accurately.
- Commit coherent implementation, tests, migration and plan changes. Deliver exact evidence and the migration/deployment approval still needed before customers receive the fix.

## Execution record

Implemented all six steps locally. The exact production example was read without writes and represented with anonymized current-message, customer/subcontact, archived-sales and active-project fixtures. Completed the general routing boundary, import hydration, replay safety, project/review visibility and independent review fixes. Verification evidence and release limits are recorded in `docs/artifacts/email-work-correspondence/verification.md`.

Production migration, web deployment, provider replay and changes to the existing incorrect lead remain unperformed. They are not implicit in this local implementation authorization.
