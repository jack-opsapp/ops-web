# Nightly Health Defect Repairs Implementation Plan

> **For OPS engineering:** Execute this plan with `custom-skills:executing-plans`, strict red-green TDD, isolated origin/main worktrees, and fresh verification before any completion claim.

**Goal:** Remove the production defects found by the 2026-08-13 server-health audit without changing unrelated product behavior or mutating production business records.

**Architecture:** Restore the missing company-settings schema behind the existing service contracts, make cron failures observable, make notifications and analytics writes idempotent at durable database boundaries, preserve canonical App Store dimensions before fact upsert, and guarantee scheduled lead summaries either converge from trusted facts or fail the workload before its cursor advances. The web and iOS changes remain backward-compatible during rollout; production migrations land before clients that consume them.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Supabase/PostgreSQL, Swift 5.9, Supabase Swift, XCTest.

---

### Task 1: Restore company automation settings

**Files:**
- Create: `supabase/migrations/20260813170000_add_company_automation_settings.sql`
- Modify: `src/lib/types/database.types.ts`
- Modify: `src/app/api/settings/invoice/route.ts`
- Modify: `src/app/api/settings/schedule/route.ts`
- Modify: `src/app/api/cron/schedule-optimization/route.ts`
- Modify: `src/app/api/cron/financial-digest/route.ts`
- Test: `tests/unit/supabase/company-automation-settings-migration.test.ts`
- Test: focused settings and cron route suites

1. Add failing tests proving both JSON settings documents exist with exact safe defaults, invoice partial patches preserve sibling settings, canonical permission keys are enforced, and any company failure fails the workload.
2. Run each focused suite and confirm the expected missing-schema/merge/false-success failures.
3. Add object-checked JSONB columns and a service-role-only atomic invoice merge RPC; update routes and cron failure semantics minimally.
4. Regenerate or update database types from the verified migration contract.
5. Re-run the focused suites to green.

### Task 2: Make email anomaly handling deterministic and idempotent

**Files:**
- Create: `supabase/migrations/20260813172000_email_anomaly_notification_identity.sql`
- Modify: `src/lib/email/anomaly-thresholds.ts`
- Modify: `src/app/api/cron/email/anomaly-check/route.ts`
- Modify: `src/lib/email/pause.ts`
- Modify: `src/lib/pmf/recipients.ts`
- Test: `tests/unit/email/anomaly-thresholds.test.ts`
- Test: `tests/unit/email/email-anomaly-check-cron.test.ts`
- Test: `tests/integration/email-anomaly-cron.test.ts`
- Test: `tests/unit/supabase/email-anomaly-notification-identity-migration.test.ts`

1. Add failing regressions for the minimum-five baseline and collision-safe notification identity recovery.
2. Confirm the current threshold fires on a one-send baseline and the current keyless insert hits the wrong path.
3. Gate percentage alerts on five baseline sends and replace the direct insert with the event-scoped `create_email_anomaly_notification_if_new` boundary, keyed to the anomaly id independently of operator rotation.
4. Reconcile unresolved partial anomaly rows before dedupe, retry incomplete critical pauses without pausing twice, and durably recover each admin's pause notification.
5. Require a valid returned notification id before finalizing the anomaly and exclude resolved incidents from recovery.
6. Re-run all anomaly suites to green.

### Task 3: Preserve canonical App Store report dimensions

**Files:**
- Modify: `src/lib/analytics/app-store-parse.ts`
- Test: `tests/unit/app-store-parse.test.ts`
- Test: `tests/unit/app-store-sync-outage.test.ts`

1. Add a failing fixture with `Event` before canonical `Engagement Type` and distinct Get/Open rows.
2. Confirm file-order alias selection collapses those rows.
3. Resolve headers by declared canonical/alias priority, independent of provider column order.
4. Prove the two facts retain distinct identities and the segment completes without aggregation or data loss.

### Task 4: Make scheduled lead-summary refresh converge and fail honestly

**Files:**
- Modify: `src/lib/api/services/lead-summary-service.ts`
- Modify: `src/app/api/cron/lead-summary-refresh/route.ts`
- Test: `tests/integration/lead-summary-refresh-cron.test.ts`

1. Add failing tests proving repeated contract/refusal output with trusted current facts commits the deterministic fallback in the scheduled sweep.
2. Add a failing route test proving persistence/provenance failures do not advance the durable cursor and return HTTP 500 through the workload control.
3. Reuse the already-tested deterministic renderer after the bounded model retry when trusted current facts exist; defer terminal model-contract output when there are no current facts.
4. Keep persistence, provenance, and database failures in `failed`, return HTTP 500, and hold the durable cursor; allow terminal no-fact deferrals to advance so one record cannot starve the sweep.
5. Re-run the complete lead-summary integration suite to green.

### Task 5: Replace iOS analytics table upsert with a guarded append boundary

**Files:**
- Create: `supabase/migrations/20260813171000_append_analytics_events_rpc.sql`
- Test: `tests/unit/supabase/analytics-append-rpc-migration.test.ts`
- Modify: `ops-ios/OPS/Utilities/Analytics/AnalyticsService.swift`
- Modify: `ops-ios/OPS/Utilities/Analytics/AnalyticsEventQueue.swift`
- Test: `ops-ios/OPSTests/AnalyticsServiceFlushTests.swift`

1. Add failing database-contract and client transport tests for an authenticated Firebase subject with a stale/missing Supabase role, identity spoof rejection/overwrite, 50-event bounds, and retry idempotency.
2. Add a bounded SECURITY DEFINER append RPC behind a narrow public wrapper that derives canonical identity from the signed Firebase subject, binds the request to the client's expected subject, validates the whole batch before writing, and inserts with `ON CONFLICT (id) DO NOTHING`.
3. Add the narrow temporary legacy-client bridge needed by shipped Supabase Swift 2.41.1 clients; document an explicit adoption cleanup gate.
4. Inject an analytics batch transport in iOS and use persisted peek/RPC/exact-ID acknowledgement. Preserve oldest events at capacity, fail closed on persistence or account rotation, and isolate permanently invalid events in a bounded dead-letter queue.
5. Run focused Vitest and XCTest suites to green.

### Task 6: Keep the software bible current

**Files:**
- Modify: `ops-software-bible/03_DATA_ARCHITECTURE.md`
- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`
- Modify: `ops-software-bible/13_EMAIL_SYSTEM.md`
- Modify: `ops-software-bible/21_ANALYTICS_SYSTEM.md`

1. Document the company JSON settings authority/defaults and atomic invoice patch contract.
2. Document cron failure semantics, anomaly identity, App Store canonical-header precedence, scheduled lead-summary fallback/failure behavior, and analytics append/legacy cleanup sequence.
3. Cross-check every documented identifier against implementation and migration source.

### Task 7: Verify and package release-ready commits

1. Run focused suites for every repaired defect, then relevant broader TypeScript/lint/build checks and isolated iOS tests/build.
2. Inspect diffs for secrets, unrelated shared-worktree changes, destructive production actions, and migration ordering.
3. Run independent review against the audit evidence and repair plan; resolve every confirmed finding.
4. Commit atomic web and iOS changes on the release branches without pushing, deploying, applying migrations, or replaying production records.
5. Report exactly what is verified locally and the single explicit release authorization needed for migration/deployment/App Store delivery.
