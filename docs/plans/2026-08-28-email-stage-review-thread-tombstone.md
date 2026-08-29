# Email Stage Review Thread Tombstone Repair Plan

> **For Claude:** Execute this plan in the isolated worktree only. Keep the shared OPS Web checkout untouched.

**Goal:** Let email sync publish its cursor when Gmail confirms that a thread disappeared after primary message persistence, without weakening fail-closed handling for any retryable, authorization, Microsoft mailbox, or persistence failure.

**Architecture:** Gmail converts only a parsed `threads.get` 404/410 with explicit `notFound`/`gone` provider evidence into the `ProviderApiError` subtype `ProviderThreadTombstoneError`. Stage review and the existing Phase B/C analysis consumers omit only that explicit type and rethrow every other failure. OAuth refresh errors, malformed responses, nested message/attachment failures, and Microsoft mailbox errors remain fatal. No database, schema, queue, or production-state change is required.

**Tech Stack:** TypeScript, Vitest, OPS Web email provider abstraction.

---

### Task 1: Prove the failure boundary

**Files:**

- Modify: `tests/unit/email/ai-sync-reviewer-terminal-detection.test.ts`
- Modify: `tests/unit/email/gmail-provider-rate-limit.test.ts`

1. Add a regression test where one requested provider thread throws explicit `ProviderThreadTombstoneError` and a healthy peer still reaches model evaluation and returns its result.
2. Prove Gmail maps parsed `threads.get` 404/410 responses to that explicit type.
3. Add boundary tests proving typed Gmail 503, generic Gmail 404, malformed Gmail 404, OAuth-refresh 404, and Microsoft mailbox 404 all still reject.
4. Run the focused test files and verify the tombstone cases fail against the production baseline for the expected fatal-fetch reason.

### Task 2: Implement the narrow repair

**Files:**

- Modify: `src/lib/api/services/email-provider.ts`
- Modify: `src/lib/api/services/providers/gmail-provider.ts`
- Modify: `src/lib/api/services/ai-sync-reviewer.ts`
- Modify: `src/app/api/integrations/email/analyze-continue/route.ts`
- Modify: `src/app/api/integrations/email/analyze-memory/route.ts`

1. Add the provider-neutral `ProviderThreadTombstoneError` type.
2. Emit it only around the direct Gmail `threads.get` response when the parsed Google body confirms `notFound`/`gone` with HTTP 404/410.
3. In the provider-thread fetch loop, continue without populating the thread map only for that explicit error; wrap and rethrow every other error unchanged.
4. Exclude skipped provider targets from `threadInputs` so no empty or invented model context is created.
5. Replace the two existing Phase B/C status-only deleted-thread catches with the explicit type while preserving `ProviderApiError` inheritance for compatibility.
6. Rerun the focused regression files to green.

### Task 3: Verify and integrate locally

**Files:**

- Verify: `src/lib/api/services/ai-sync-reviewer.ts`
- Verify: `src/lib/api/services/email-provider.ts`
- Verify: `src/lib/api/services/providers/gmail-provider.ts`
- Verify: `src/app/api/integrations/email/analyze-continue/route.ts`
- Verify: `src/app/api/integrations/email/analyze-memory/route.ts`
- Verify: `tests/unit/email/ai-sync-reviewer-terminal-detection.test.ts`
- Verify: `tests/unit/email/gmail-provider-rate-limit.test.ts`
- Verify: this plan

1. Run the focused test file, the adjacent sync-engine isolation tests, TypeScript checking, and `git diff --check`.
2. Review the complete diff and commit only these task-owned files with bug ID `84b04ee6-61f5-4237-94ab-358e29606e88` in the message body.
3. Fast-forward the clean local `main` integration worktree, rerun focused tests and diff checks there, and independently verify the merged commit.
4. Update the claimed Supabase bug with exact commit/test/local-main evidence, release the assignment, and leave customer-live verification explicit because no push or deploy is authorized.
