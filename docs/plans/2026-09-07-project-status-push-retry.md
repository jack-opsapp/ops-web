# Project status push retry implementation plan

**Goal:** Fix bug `2b23d92f-e1f4-4423-a6ec-429cb02aa200`: stop retrying an exact no-subscribed-recipient push rejection after rail persistence, while retaining a truthful terminal failure.

**Architecture:** Preserve the provider rejection as an optional typed dispatch failure, carry it through the existing deferred notification-error path, and pass `p_retryable=false` to the existing fenced failure RPC. All other failures remain retryable. No schema, authorization, recipient, preference, copy, or production-data changes.

**Tech stack:** TypeScript, Vitest, existing Supabase RPCs.

**Design system:** N/A; no UI or product copy changes.

**Required skills:** systematic-debugging, custom-skills:executing-plans, test-driven-development, verification-before-completion.

## Steps

1. Add `tests/integration/project-status-push-retry.test.ts`, exercising real OneSignal parsing, dispatch, project lifecycle, and outbox code against mocked external I/O. Prove the exact production response currently emits `p_retryable=true`. Include successful delivery, transient/ambiguous failures, rail persistence failures, existing rail rows, and later lifecycle failures.
2. Add `src/lib/notifications/notification-push-unavailable-error.ts`. Extend only the project-status dispatch failure in `dispatch-notification-event.ts` with the exact no-subscribed-recipient code. Require HTTP 200, explicit empty provider ID, and only the exact known error. Preserve all other responses.
3. In `project-lifecycle-service.ts`, translate that dispatch code into the typed error and retain its current deferred throw after core lifecycle work. In `project-status-lifecycle-outbox-service.ts`, terminalize only that typed error through the existing RPC, retaining the last error and batch failure visibility.
4. Run focused tests plus adjacent notification/lifecycle/cron tests, TypeScript, ESLint, formatting, and `git diff --check`. Review the diff for retry and persistence boundaries.
5. Commit only this batch. Verify the patch in a clean local-main integration path, merge locally, and independently re-run focused checks. Preserve unrelated branches and worktrees. Update the software bible in an isolated checkout and record exact proof in the claimed bug. Push, deploy, and any historical re-delivery remain human-authorized actions.
