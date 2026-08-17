# Lead Reply Quality Implementation Plan

> **Design system:** N/A. This is server-side email drafting logic; no visual or interactive surface changes.

## Task 1: Deterministic response disposition

**Files:**

- Create `src/lib/api/services/conversation-state/response-disposition.ts`
- Modify `src/lib/api/services/conversation-state/types.ts`
- Modify `src/lib/api/services/conversation-state/router.ts`
- Modify `src/lib/api/services/conversation-state/conversation-state.ts`
- Modify `tests/unit/inbox/conversation-state/router.test.ts`
- Create `tests/unit/inbox/conversation-state/response-disposition.test.ts`

Write failing table-driven tests for acknowledgements, sign-offs, completion updates, mixed thanks-plus-question, acceptance, and schedule requests. Implement the pure classifier and wire its disposition/mode into routing.

## Task 2: Current-message attachment context

**Files:**

- Modify `src/lib/api/services/conversation-state/types.ts`
- Modify `src/lib/api/services/conversation-state/conversation-state.ts`
- Modify `src/lib/api/services/conversation-state/draft-context.ts`
- Modify `tests/unit/inbox/conversation-state/conversation-state.test.ts`
- Modify `tests/unit/inbox/conversation-state/draft-context.test.ts`

Write failing tests proving repeated content and decorative inline assets are not new inspectable material, and that only current-message attachments reach the acknowledgement block. Add source and durable identity metadata to attachment references, then implement chronological deduplication.

## Task 3: Reply progression and learned edit overrides

**Files:**

- Modify `src/lib/api/services/conversation-state/draft-system-prompt.ts`
- Modify `src/lib/api/services/conversation-state/draft-context.ts`
- Modify `src/lib/api/services/conversation-state/__tests__/draft-system-prompt.test.ts`
- Modify `tests/unit/inbox/conversation-state/draft-context.test.ts`

Write failing prompt-contract tests for first versus ongoing replies, mode-specific brevity, no invented schedule, and active `more_direct`/`shorter` learned preferences. Implement explicit trusted reply directives outside the untrusted email block.

## Task 4: Complete opportunity context and deliberate no-reply behavior

**Files:**

- Modify `src/lib/api/services/phase-c-autonomy-router.ts`
- Modify `src/lib/api/services/ai-draft-service.ts`
- Modify or create focused Phase C and AI-draft tests under `tests/unit/email/`

Write failing tests proving Phase C passes the latest inbound activity id plus the authorized access projection, and that `update_lead_only` returns a deliberate no-reply result rather than a human-review error. Reuse the existing bounded source-bound opportunity query. Remove stale `ai_summary` from prompt context.

## Task 5: Provider noise and follow-up accuracy

**Files:**

- Modify `src/lib/api/services/known-platforms.ts`
- Modify `tests/unit/inbox/conversation-state/party-classifier.test.ts`
- Modify `src/lib/email/opportunity-lifecycle-evaluator.ts`
- Modify `src/lib/api/services/opportunity-lifecycle-action-service.ts`
- Modify `src/lib/api/services/lead-follow-up-send-service.ts`
- Modify follow-up unit tests

Write failing tests for Jobber transactional senders and for legacy default follow-up copy at sequence one and two. Add Jobber to provider detection. Introduce a shared compatibility renderer that preserves custom templates while replacing the old quote-assuming default with sequence-aware neutral copy.

## Task 6: Documentation and verification

**Files:**

- Modify the relevant sections of `ops-software-bible/04_API_AND_INTEGRATION.md` and/or `ops-software-bible/07_SPECIALIZED_FEATURES.md`

Run every new test red before implementation and green after. Then run the complete focused drafting/follow-up suite, TypeScript type-check, and the broad unit test suite. Review the final diff for unrelated changes, commit atomically, and report that nothing is pushed or deployed.

