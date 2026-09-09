# Calibration server context implementation plan

**Goal:** Repair bug 049cb3f5-ffec-4a8e-871e-6da56f7e4054 so an authorized calibration deck request can read its nested category and graduation data.

**Architecture:** Bind the already-created server database client to the calibration deck's async execution through the existing `runWithSupabase` helper. Preserve the existing authentication, permission, and actor/mailbox filters. The nested category and accuracy services continue enforcing the same contracts.

**Tech stack:** Next.js route handlers, TypeScript, Supabase, AsyncLocalStorage, Vitest.

**Design system:** N/A; server execution context only. No UI or copy changes.

**Required skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:systematic-debugging, superpowers:using-git-worktrees, superpowers:test-driven-development, superpowers:verification-before-completion.

## Evidence and scope

Production recorded 63 calibration deck HTTP 500 requests in the audit window and a matching founder report at 2026-09-08T05:24:11Z. The current production source 4bc3221cb does not bind nested `requireSupabase` calls. Live RPC ACLs independently confirm that actor acceptance and category accuracy reads require service_role. A Firebase assertion also appears on successful queue requests and is not treated as the calibration root cause on its own.

## Steps

1. Add `tests/integration/calibration-deck-context.test.ts`, exercising the real route, calibration service, category service, accuracy service, and context helper with external auth/database I/O replaced. Test successful nested reads, concurrent legacy-context clearing, truthful database failure, and existing access denial.
2. Run the new test against unchanged production source. Require a 500-versus-200 regression on nested reads before modifying source.
3. In `src/app/api/calibration/deck/route.ts`, import `runWithSupabase` and wrap only `CalibrationService.getDeckState(...)` in its callback using the already-created `supabase`. Preserve all access checks and error handling.
4. Run the focused calibration, mailbox isolation, category accuracy, and context suites serially; run TypeScript, focused lint/format and `git diff --check`. Investigate relevant failures and compare unrelated diagnostics against the production baseline.
5. Record the runtime contract in the software bible. Commit only task-owned files. Replay the exact patch onto a clean local-main candidate, verify it, and fast-forward the clean main integration checkout. Do not merge unrelated divergent history.
6. Independently verify local main and guard the bug completion update with exact owner and batch. Clear assignment only after merge proof; leave status in_progress and append the release-needed marker. No push, deployment, migration, business mutation, or provider action.
