# Email inquiry creation boundary implementation plan

**Goal:** Retain email without creating clients or leads unless the current inbound message establishes a new customer inquiry.

**Architecture:** Remove sender/pattern/contact-form shortcuts from automatic sales creation. All unmatched inbound candidates use the existing classifier and one source-evidence routing gate before client or opportunity persistence. Parsed forms rejected or omitted by classification remain readable in Email Review. Existing linked conversations and authenticated external-intake correlation retain their current ownership. Outbound subject patterns alone cannot create sales records.

**Tech stack:** TypeScript, existing email sync orchestration and classification, Vitest, existing Supabase correspondence RPC (no schema migration).

**Design system:** Existing `.interface-design/system.md` consulted. No UI or copy changes.

**Required skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:verification-before-completion. Continue in the existing isolated workspace. The requesting-code-review skill requires an independent read-only reviewer before release.

## 1. Reproduce the production failure and adjacent bypasses

- Extend `tests/unit/email/email-opportunity-title-live-pattern.test.ts` to run the real sync engine against isolated provider/database doubles.
- Replay the exact Wix author notification and assert zero client/opportunity creation, with inbox retention.
- Cover configured sender/subject patterns, non-inquiry form content, valid form inquiries, old quoted inquiries, and outbound estimate-subject messages.
- Extend `tests/unit/email/email-work-routing.test.ts` so new customers also need current-message new-work evidence, including omitted/malformed intent.
- Run tests before implementation and record the expected failures. Baseline: 27 tests pass across work routing, contact-form gate, and sync engine; existing unrelated capture/Firebase warnings present in the sync test harness.

## 2. Enforce one automatic creation boundary

- `src/lib/api/services/sync-engine.ts`: remove deterministic pattern/platform creation; classify unmatched inbound through a single queue. Retain parsed forms without a qualifying result in Email Review. Remove outbound estimate-subject creation and the now-unused get-or-create helper.
- `src/lib/email/email-work-routing.ts`: require explicit `new_work` plus source-matching evidence regardless of customer/project history. Clarify administrative platform notifications and form submissions in classifier instructions.
- `src/lib/email/contact-form-lead-gate.ts`: replace automatic creation helpers with a narrow form-candidate predicate used for lossless review retention. A parsed submitter is identity, not permission to create a lead.
- Preserve authenticated intake linking, existing thread ownership, durable correspondence retry behavior, and explicit operator-approved imports/manual creation. Do not change customer records during implementation.
- Persist deferred form classification audits before their readable review receipts. Preserve effective sender identity and exact-message scope through classification, prior feedback, and recovery; shared transport threads cannot provide another customer's context.
- Preserve eligible project suggestions after actual inquiry-authorized creation, with the existing assignment and feature/execution guards.

## 3. Verify the changed behavior

- Run focused regression suites for sync creation, contact-form identity, work routing, classifier/reviewer contracts, thread context, exact-message recovery, outbound reconciliation, and external-intake correlation.
- Verify successful genuine inquiries, project correspondence, ambiguous review, missing classification, replay without duplicates, and no model fallback on classification errors.
- Run TypeScript check and production build as appropriate; distinguish baseline/environment failures from changes.
- Review all remaining automatic client/opportunity writes. No source-only assertions as a substitute for runtime tests.

## 4. Document and prepare release

- Update this task's audit artifact and the bible email-routing sections with the correction, proof, and local-versus-live state.
- Commit only this task's source/tests/docs, preserving other work.
- Production push/deployment remains a separate explicit approval under OPS root instructions; present the tested correction for that final approval.

## Completion — 2026-09-09

Local implementation and independent review are complete. Final affected-suite run: 320 tests pass in 20 files; scoped TypeScript passes; ESLint reports zero errors and six existing console warnings; diff whitespace check passes. The full repository TypeScript attempt exhausted the default Node heap, so it is not counted as passing. No new production build, model call, database write, migration, inbox replay, push, or deployment occurred in this correction.

[Verification and release boundary](../artifacts/email-work-correspondence/inquiry-boundary-verification.md) records reproductions, final commands, limitations, and the required release approval.
