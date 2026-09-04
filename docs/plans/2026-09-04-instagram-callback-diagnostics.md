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
