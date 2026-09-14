# Signup analytics repair — September 14, 2026

Status: verified locally, not pushed, merged, deployed, or production-canary tested. No production configuration, database schema, historical accounts, or iOS release changed.

Base: `0086cd591`. Isolated checkout: `ops-web-signup-analytics`. Existing shared checkout work was left untouched.

## Verification

- Final targeted run at 21:02 UTC: **14 test files, 171 tests passed** in 5.08 seconds, one worker.
- Auth creation / identity guard / update truthfulness; setup owner role / write truthfulness; analytics flush auth; UTM capture; durable analytics service and sanitizer; signup capture; save browser evidence; actual setup navigation; optional referral question; GA configuration regressions.
- Changed-file semantic and syntax check: **15 TypeScript files, zero diagnostics**, using real imported dependency types. Reproduce with `node docs/artifacts/signup-analytics/typecheck.mjs 0086cd591`.
- ESLint on all 15 changed TypeScript files: **zero warnings/errors**. `git diff --check`: clean.
- Independent read-only review found two issues (custom-host collection and editing during pending saves); both were fixed, regression-tested, and re-reviewed with no remaining blocker. Browser telemetry failures and token-refresh stalls also have tests and do not trap or fail an otherwise successful save.
- Changed UI audit: reused existing styles and tokenized toast wrapper, localized new retry copy in English/Spanish. Disabled fieldset and guarded callbacks preserve the submitted data during pending requests. No new style literals, layout redesign, or animation introduced. Component tests cover this behavior; no live authenticated browser canary was performed.

The repository-wide `tsc --noEmit --incremental false` exhausted its default 4 GB Node heap before returning diagnostics. It is **not** reported as passed. The focused check is intentionally scoped to this repair, not the entire dependency graph's diagnostics. Existing Firebase test-import assertion warnings and the Vite CJS deprecation warning appeared in passing runs; deliberate rejection tests also print expected error logs.

## Delivery boundaries

- Classified first-touch source is stored in the existing new-user JSONB insert, before company creation. Existing users and insert-race winners retain their source; unknown history is not invented.
- Browser attempted / acknowledged / rejected / unconfirmed outcomes are separate from the server-produced result. Server diagnostics share the browser session and attempt; they do not create canonical trial or activation conversions.
- The existing event ledger namespace and setup JSON remain client writable; neither the event name nor the source snapshot is immutable or trusted business authority. Server result writes are best effort and missing evidence is possible.
- No new schema, GA property change, paid service, or iOS change is required. Push/deploy and natural production readback still require Jackson's approval.
