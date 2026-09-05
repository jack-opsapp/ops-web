# Instagram Callback Diagnostics Implementation Plan

**Goal:** Identify the exact failing completion step in the live Instagram login without logging credentials or changing OAuth behavior.

**Architecture:** Record source-defined stage labels and allowlisted local error codes. Preserve callback responses, one-time state handling, scope validation, encryption, and account storage. Meta messages, tokens, codes, state, URLs, and response bodies never enter diagnostics.

**Tech Stack:** Next.js, TypeScript, Vitest, existing Vercel logs.

**Design System:** Not applicable; no UI changes.

**Required Skills:** systematic-debugging, custom-skills:executing-plans, test-driven-development, verification-before-completion.

## Evidence

- Production deployment `dpl_7BCJY52J5SB6KwmY7qdCrLSzCUH3`, source `f901c6d9c0e1bd63abddcb616a697f7fb9115ad6`.
- At 2026-09-04 22:18:02 UTC, the callback returned the generic connection failure after consuming its state. No account was stored; the publishing queue is empty.
- Current OAuth source matches that deployment. The five focused test files pass 27 tests. Meta's business-login and getting-started examples match the existing fixtures; a different live response shape remains unproven.
- Vercel returned no saved trace for request `2w868-1788560282142-8defd3a8dfff`.

## Task 1: Prove safe failure diagnostics

Add tests for allowlisted error codes and numeric statuses, rejection of arbitrary messages/metadata, and precise stage reporting when token exchange, token upgrade, profile parsing, encryption, or storage fails. Run the tests before changing production code and verify that they fail for missing diagnostics.

## Task 2: Add bounded diagnostics

Add a shared diagnostic serializer containing only fixed stage labels, known local codes, bounded numeric HTTP/provider codes, and a fixed response-shape classification. Add stage tracking to `instagram-oauth-client.ts` and `instagram-connection-service.ts`; rethrow the original errors after logging. Keep public callback output generic.

## Task 3: Verify and document

Run focused social and API tests, formatting, and targeted TypeScript checks. Update the operations runbook and software bible with the observed incident and diagnostic release status. Commit only this change. Production deployment still requires explicit approval under OPS rules. After approval, deploy the narrow change, request one fresh account connection, read the stage/code, correct the evidenced cause, and independently verify encrypted account persistence and the displayed username. Never publish a test post.

## Local verification completed

- Eight new stage-logging cases failed before implementation because no diagnostic log was emitted, then passed with the change.
- Final social/API run: 18 files, 149 tests passed. Targeted source TypeScript and formatting checks passed.
- Independent review found no behavioral regression or disclosure. Its coverage finding was addressed with malformed long-token/profile and invalid-JSON cases; the final run above includes them.
- Release only this diagnostic commit on top of the then-current production/main state. Do not deploy this older release worktree wholesale.
- Production remains unchanged and the root cause remains unproven until a fresh attempt runs with diagnostics.

## Approved production deployment

- Jackson explicitly approved deployment of the diagnostic update.
- Integrated only this change onto then-current production/main `6a2a7c94b`; release commit `4cfa65ef6e2de2dfe7ab0557da222b7f1908b581`.
- Repeated all 149 focused tests, targeted TypeScript, and formatting against that integrated revision; all passed.
- Vercel deployment `dpl_FBcP4c3v3TSvsjNyEADuFK2M9Q32` completed at 2026-09-04 22:51 UTC and was verified READY with `app.opsapp.co`.
- Live missing-code callback probe returned HTTP 307 to the canonical `invalid_callback` URL; unauthenticated admin API probe returned 401. Both sent `no-store` caching.
- Requested one fresh operator login to obtain the actual diagnostic evidence. Connection success and the root cause remain unverified; no post was created or published.

## Follow-on correction from live evidence

- The 22:57:54 UTC attempt on diagnostic production returned `code_exchange / INSTAGRAM_OAUTH_RESPONSE_INVALID / object`. Existing source only accepts a `data` array.
- Accept direct records and exactly one wrapped record for token and profile responses; retain all field, permission, encryption, state, and publishing safeguards.
- Eleven regression/safety cases failed before implementation. The final 183-test focused suite, targeted TypeScript, and formatting passed. An actual client/cipher/service test verifies encrypted persistence and safe public status; independent review found no actionable issue.
- The code correction is committed locally as production integration candidate `fc287e5895b2a6a05f77afe3cb1d5589a8ce4413` and copied to this implementation branch. It is not deployed. Deploy only after the required explicit approval, preserving any newer production commits.
- Root failure location is now established; the returned credential contents and subsequent live steps remain unverified until a fresh successful login. No post is authorized or created.

## Parser correction release approved

Jackson explicitly approved deployment of the connection fix on 2026-09-04. Current production/main is still `4cfa65ef6`; candidate `fc287e589` contains only the verified parser correction and tests. Deployment and a fresh live connection attempt are the remaining checks.
