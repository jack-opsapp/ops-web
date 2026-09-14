# Signup attribution and save outcomes

> Execute with custom-skills:executing-plans. Jackson approved implementation of these two improvements; push/deployment are not approved.

**Goal:** Preserve source information for accounts that never create a company, and distinguish company-save attempts, confirmed persistence, and failure.

**Architecture:** Add a classified, raw-identifier-free `signup_attribution` snapshot to the existing `users.setup_progress` JSON on the new-account insert. Existing-account login and race recovery must preserve the winner's original snapshot. Browser setup requests carry an anonymous attempt/session context; authenticated server outcome events reuse that session rather than inventing extra product sessions. Browser transport failures remain distinguishable from confirmed server rejection. No schema or permission changes, no historical attribution invention, and no business-conversion changes.

**Tech stack:** Existing Next.js routes, Firebase verification, Supabase, analytics queue and Vitest.

**Design system:** `.interface-design/system.md`; no styling/layout/motion changes. Preserve the current interface.

**Skills:** systematic-debugging, test-driven-development, using-git-worktrees, supabase, writing-plans, executing-plans. Apply wizard-audit's retry, skipped-step, repeated-action and interruption checks to the web setup flow; its Swift-specific UI checks are inapplicable.

## 1. Preserve source on account creation

- Extend `tests/integration/sync-user-creation.test.ts`: production signup with Google organic cookie retains its classified source without a company; missing/expired/malformed evidence remains unknown; local/preview requests are excluded; race winner's snapshot is retained.
- Run these tests and observe the missing snapshot failure.
- Implement `src/lib/analytics/signup-attribution.ts`, call it only on the new-user insert in `src/app/api/auth/sync-user/route.ts`, and type the optional snapshot in `src/lib/types/models.ts`.
- Capture the browser first touch synchronously before `UserService.syncUser` sends its request, without allowing denied cookie access to break authentication.
- Re-run new and existing auth/UTM tests.

## 2. Record save outcomes truthfully

- Add executable tests for successful save, HTTP rejection, malformed response, missing authentication, lost response, duplicate attempt and analytics-storage failure.
- Implement a small browser save/telemetry helper and a server outcome recorder. Use existing privacy sanitization and the production-host boundary. Never send form fields, tokens, free-text errors or raw acquisition identifiers to telemetry.
- Instrument `src/app/api/setup/progress/route.ts` at resolved identity, company-write and checkpoint boundaries. Missing company data (skip/checkpoint-only) must not be counted as a company save.
- Update setup's identity/company handlers to emit completed only after an acknowledged successful save, not before the request. Replace the default "direct" setup-source claim with the saved source or unknown.
- Keep the form and its values on an unconfirmed save, using the existing localized error toast for retry. Prevent duplicate submissions and navigation while the save is in flight. No visual redesign.
- Reuse browser session IDs for server events; no fabricated product sessions. Failed telemetry may never change the save response.

## 3. Verify and document

- Run bounded auth, setup, first-touch and analytics regression suites serially with one worker, plus changed-file type/lint checks.
- Independently review privacy, replay/duplicates, production-only gating, data preservation and outcome truthfulness.
- Update `ops-software-bible/21_ANALYTICS_SYSTEM.md` with exact storage/event contracts and explicit local-not-deployed status.
- Commit only this task's files. Leave shared checkout and production untouched.
