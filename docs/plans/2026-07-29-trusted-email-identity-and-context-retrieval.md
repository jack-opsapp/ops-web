# Trusted Email Identity and Context Retrieval Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Restore reliable inbox lead classification, OPS logging, and reply drafting while using client-authored identity and automatically retrieving bounded older context when a long thread needs it.

**Architecture:** Keep the existing durable email-event trust boundary. Split each authored message into lifecycle body and signature evidence, resolve customer identity only from customer-authored content, and rank that evidence above `From` display names. Build a shared token-counted conversation pack over paginated durable history, expose a server-controlled retrieval tool to drafting and stage review, and treat uncertain accept-to-project relationships as one-lead review outcomes instead of mailbox-level persistence failures. Reuse existing opportunity review state and persistent notification infrastructure; no production schema change is required.

**Tech Stack:** Next.js 15, TypeScript, Supabase/Postgres, OpenAI Chat Completions tools, `js-tiktoken`, Vitest.

**Design System:** `.interface-design/system.md` was consulted. This change has no visual surface, so no design tokens or animation rules apply.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:verification-before-completion`.

---

## Task 1: Preserve client-authored signature evidence

**Files:**

- Modify: `src/lib/api/services/conversation-state/message-cleaner.ts`
- Modify: `src/lib/api/services/conversation-state/types.ts`
- Modify: `src/lib/api/services/conversation-state/conversation-state.ts`
- Test: `tests/unit/inbox/conversation-state/message-cleaner.test.ts`
- Test: `tests/unit/inbox/conversation-state/conversation-state.test.ts`

**Steps:**

1. Add failing tests for a structured cleaner result containing `authoredBody`, `lifecycleBody`, and `signatureBlock`, including quoted history, mobile footers, corporate signatures, postscripts, and an explicit empty provider-clean body.
2. Run:
   `node_modules/.bin/vitest run tests/unit/inbox/conversation-state/message-cleaner.test.ts tests/unit/inbox/conversation-state/conversation-state.test.ts`
   and confirm the new assertions fail.
3. Implement one canonical split function. Keep `cleanMessageBody` backward compatible by returning its `lifecycleBody`.
4. Add the authored and signature fields to `CleanMessage` and populate them during conversation assembly without changing lifecycle acceptance inputs.
5. Re-run the focused tests and commit:
   `feat(email): preserve authored signature evidence`

## Task 2: Resolve identity from customer-authored content only

**Files:**

- Modify: `src/lib/api/services/conversation-state/contact-resolver.ts`
- Modify: `src/lib/api/services/conversation-state/conversation-state.ts`
- Test: `tests/unit/inbox/conversation-state/contact-resolver.test.ts`
- Test: `tests/unit/inbox/conversation-state/conversation-state.test.ts`

**Steps:**

1. Add failing tests proving:
   - `Kevin Falk` in a customer signature outranks `Falks` from the mailbox header/local part.
   - An explicit self-identification such as `This is Kevin Falk` is accepted.
   - An operator-authored signature is never used as the client name.
   - Quoted signatures and unrelated third-party names are rejected.
2. Run the contact/conversation tests and confirm RED.
3. Add conservative first-person/signature extraction with generic-name, mailbox-local-part, operator-identity, and direction guards. Record provenance as verified customer-authored evidence.
4. Re-run the focused tests and commit:
   `fix(email): trust customer-authored identity`

## Task 3: Correct title precedence and safely repair auto-generated titles

**Files:**

- Modify: `src/lib/email/opportunity-title.ts`
- Modify: `src/lib/email/lead-enrichment.ts`
- Modify: `src/lib/api/services/sync-engine.ts`
- Test: `tests/unit/email/email-opportunity-title-live-pattern.test.ts`
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: `tests/unit/email/lead-enrichment.test.ts`

**Steps:**

1. Add failing tests that:
   - Customer-authored `Kevin Falk` beats inbound header `Falks`.
   - Exact canonical client identity beats an inbound display name.
   - `Falks — Email Inquiry` upgrades to `Kevin Falk — Email Inquiry`.
   - A custom operator title is never rewritten.
2. Run the three focused files and confirm RED.
3. Rank structured/customer-authored and exact-client identity above inbound header identity.
4. Pass the resolved conversation contact as a title candidate for new leads.
5. Add a narrow generated-title repair guard: update only recognized email title suffixes whose current identity equals `New Lead`, the current contact name, or the contact-email local-part display. Apply a stronger verified name atomically with enrichment.
6. Re-run focused tests and commit:
   `fix(leads): prefer verified client names in titles`

## Task 4: Extract the trusted full-history fact fold

**Files:**

- Add: `src/lib/api/services/conversation-fact-fold.ts`
- Modify: `src/lib/api/services/lead-summary-service.ts`
- Test: `tests/unit/email/lead-summary-trust-boundary.test.ts`

**Steps:**

1. Add a regression test proving the extracted fold remains byte-stable for price, scope, schedule, objection, and next-action evidence.
2. Run the trust-boundary test and confirm RED.
3. Move the trusted message and fact-fold types/functions into the shared module without changing behavior.
4. Re-run the complete trust-boundary test and commit:
   `refactor(email): share trusted conversation facts`

## Task 5: Build a token-bounded conversation pack and retrieval engine

**Files:**

- Add: `src/lib/api/services/conversation-context-pack.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Add: `tests/unit/email/conversation-context-pack.test.ts`

**Steps:**

1. Add failing tests for:
   - Deterministic `js-tiktoken` budgets.
   - Paragraph/sentence chunking of oversized messages.
   - Priority for the latest inbound, current facts, recent alternating turns, and older summary.
   - A clipping manifest with included/omitted counts, date span, partial-message markers, and retrieval availability.
   - Server-authorized retrieval by fact kind/query/date/evidence key with adjacent chunks and no cross-thread leakage.
   - A hard maximum of two retrieval rounds.
2. Run the new test and confirm RED.
3. Add `js-tiktoken` as a direct dependency.
4. Implement deterministic packing and lexical retrieval over already-authorized history. Do not add embeddings, a vector database, or a new table.
5. Re-run the new test and commit:
   `feat(email): add bounded conversation retrieval`

## Task 6: Page complete scoped history

**Files:**

- Modify: `src/lib/api/services/conversation-state/conversation-state.ts`
- Modify: `src/lib/api/services/ai-draft-service.ts`
- Test: `tests/unit/inbox/conversation-state/conversation-state.test.ts`
- Test: `tests/unit/email/ai-draft-recent-context.test.ts`

**Steps:**

1. Add failing tests with more than one page of activities, including equal timestamps, to prove deterministic `(created_at, id)` ordering and no 20/200-message rejection.
2. Run both files and confirm RED.
3. Replace fixed limits with bounded page loops using ordered `.range(from, to)`.
4. Preserve the existing source-bound authorization and fail closed on malformed provider identity.
5. Re-run focused tests and commit:
   `fix(email): load complete scoped conversations`

## Task 7: Give reply drafting automatic older-context retrieval

**Files:**

- Modify: `src/lib/api/services/ai-draft-service.ts`
- Modify: `src/lib/api/services/conversation-state/draft-context.ts`
- Test: `tests/unit/email/ai-draft-recent-context.test.ts`

**Steps:**

1. Add failing mocked-completion tests for:
   - A clipped initial pack causing `retrieve_conversation_context`.
   - Server validation and a second completion using returned evidence.
   - Maximum two retrieval rounds.
   - An unresolved retrieval holding the draft for review.
   - No clipping/retrieval language leaking into the customer-facing draft.
2. Run the draft test and confirm RED.
3. Integrate the shared pack and OpenAI tool loop. Keep the final draft output contract unchanged.
4. Re-run focused tests and commit:
   `feat(inbox): retrieve older context for drafts`

## Task 8: Give classification and stage review the same retrieval path

**Files:**

- Modify: `src/lib/api/services/ai-sync-reviewer.ts`
- Test: `tests/unit/email/ai-sync-reviewer-terminal-detection.test.ts`

**Steps:**

1. Add failing tests for clipped classification/stage context, tool retrieval, strict final JSON, round limits, and unresolved-evidence review deferral.
2. Run the focused reviewer test and confirm RED.
3. Integrate the shared pack/tool loop while preserving per-customer isolation and the existing strict final response format.
4. Re-run focused tests and commit:
   `feat(email): retrieve older context for lead review`

## Task 9: Match accepted leads using canonical property-address proof

**Files:**

- Modify: `src/lib/email/opportunity-relationship-matching.ts`
- Test: `tests/unit/email/opportunity-relationship-matching.test.ts`

**Steps:**

1. Add failing tests proving:
   - A missing opportunity address may use the canonical client property address.
   - Exactly one active same-client project with the same full property identity is linked.
   - Municipality/locality-only data is rejected.
   - Multiple matches, mismatched client mirrors, and a project linked elsewhere produce coded review-required errors.
2. Run the focused test and confirm RED.
3. Add a typed relationship-review error with stable codes.
4. Load the canonical client address when the opportunity address is absent and compare only full property-address identity.
5. Re-run focused tests and commit:
   `fix(leads): prove accepted project relationships`

## Task 10: Isolate reviewable leads from the mailbox cursor

**Files:**

- Modify: `src/lib/api/services/sync-engine.ts`
- Modify: `src/lib/email/email-opportunity-notification.ts` only if the existing event helper needs an exported wrapper
- Test: `tests/unit/email/email-opportunity-title-sync-engine.test.ts`
- Test: `tests/unit/email/sync-engine-ai-provider-isolation.test.ts`
- Test: `tests/unit/email/worker-40001-backoff-contract.test.ts`

**Steps:**

1. Add failing tests proving one relationship-review result:
   - Sets `operator_action_required_at`.
   - Emits the existing persistent `accept_review_won` notification.
   - Does not enter the aggregated cursor-holding failure list.
   - Still lets subsequent leads run and publishes the provider checkpoint.
   - Does not swallow genuine database/persistence failures.
2. Run the three focused files and confirm RED.
3. Catch only the typed relationship-review error in `maybeAutoAdvanceOnAccept`, persist the review state/notification, log the code, and return normally.
4. Keep serialization, database-pressure, and semantic write failures cursor-holding.
5. Re-run focused tests and commit:
   `fix(email): isolate lead review from mailbox sync`

## Task 11: Update the OPS Software Bible

**Files:**

- Modify: `../ops-software-bible/07_SPECIALIZED_FEATURES.md`
- Modify: `../ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`

**Steps:**

1. Confirm the sibling repository is clean in the target files.
2. Document:
   - Client-authored identity precedence and operator-signature exclusion.
   - Token-bounded manifests and automatic retrieval.
   - Full-history durable-event trust boundary.
   - Canonical property-address matching.
   - Per-lead review isolation from mailbox cursor progression.
3. Review the rendered Markdown and commit the bible update independently:
   `docs(email): document trusted context retrieval`

## Task 12: Full verification

**Files:** No new files expected.

**Steps:**

1. Run all touched focused test files.
2. Run:
   `npm run typecheck`
3. Run:
   `npm run lint`
4. Run:
   `npm test -- --run`
5. Inspect `git diff --check`, `git status --short`, and the local commit list.
6. Verify no production database mutation, push, or deployment occurred.
7. Report the verified product outcome, any remaining live backfill needed, and the exact authorization boundary for push/deploy.
