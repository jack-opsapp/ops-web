# OpenAI Quota Alert Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Warn the configured OPS platform owner before OpenAI budget exhaustion through OpenAI's native budget emails, and immediately surface a durable OPS rail notification plus push when the API reports true credit exhaustion.

**Architecture:** Every production OpenAI client is created by one monitored factory. Exact `insufficient_quota` failures open one deduplicated incident through service-only Supabase functions; a later successful request resolves only the incident captured before that request. Notifications use canonical OPS user identity, never mailbox identity, and Gmail is never used.

**Tech Stack:** Next.js 15, TypeScript, OpenAI Node SDK, Supabase/Postgres, OneSignal, Swift/SwiftUI, Vitest, XCTest.

**Design System:** Existing OPS notification rail, `.interface-design/system.md`, `ops-design-system/project/DESIGN.md`, and iOS `OPSStyle` only. No new screen or improvised visual tokens.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `openai-docs`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `custom-skills:mobile-ux-design`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`.

---

## Task 1: Add the service-only notification identity and recovery contract

**Files:**

- Create: `tests/unit/supabase/openai-quota-notification-migration.test.ts`
- Create: `supabase/migrations/<timestamp>_openai_quota_notification_contract.sql`
- Modify: `src/lib/types/database.types.ts`

1. Write failing migration contract tests for a service-role-only notification create function that returns the durable notification identity, creation status, and incident version without changing the existing boolean RPC.
2. Require quota observations and recovery to share one transaction advisory lock: each failure advances the exact unresolved generation and reasserts unread, while the second service-role-only function resolves only the captured notification ID and expected version with matching recipient user, derived company, type, dedupe key, and unresolved state. Read/unread must remain presentation state.
3. Require locked search paths, revoked browser execution, active-user and company validation, and no email-derived recipient lookup.
4. Implement the migration, run the focused test, parse the SQL, and regenerate or minimally reconcile generated database types.

## Task 2: Build the durable OpenAI quota incident service

**Files:**

- Create: `tests/unit/notifications/openai-quota-alert-service.test.ts`
- Modify: `tests/unit/notifications/server-notification-retry-boundary.test.ts`
- Modify: `tests/unit/notifications/onesignal.test.ts`
- Create: `src/lib/notifications/openai-quota-alert-service.ts`
- Modify: `src/lib/notifications/server-notification-service.ts`
- Modify: `src/lib/integrations/onesignal.ts`

1. Write failing tests for canonical recipient configuration, exact company validation, deduplication, durable-row-first ordering, bounded monitoring work, UUID-based push idempotency, and safe failure behavior.
2. Extend `createTrustedNotifications` nonbreakingly with `createdNotifications: Array<{ notificationId, recipientUserId }>` while preserving all existing result fields.
3. Implement `OPENAI CREDITS EXHAUSTED` as a persistent `ai_provider_quota` rail item. Include `/admin/platform-health` only when the configured recipient already has that page's access.
4. Push only for a newly created durable row, using `{ type: "ai_provider_quota", screen: "notifications" }` and the notification UUID as the OneSignal idempotency key.
5. Implement exact incident ID/version capture and generation-safe recovery resolution. A failure after capture must invalidate stale recovery; recovery before a later failure must allow a fresh incident. Keep monitoring best effort so notification infrastructure cannot mask the original model result.

## Task 3: Centralize and monitor all OpenAI clients

**Files:**

- Create: `tests/unit/api/openai-client-monitoring.test.ts`
- Create: `tests/unit/api/openai-constructor-boundary.test.ts`
- Create: `src/lib/api/services/openai-monitoring.ts`
- Modify: `src/lib/api/services/openai-clients.ts`

1. Write failing tests proving ordinary 429 errors remain retryable and only `error.code === "insufficient_quota"` opens an incident.
2. Test generation-safe recovery: capture an existing incident ID and version before a request; resolve that exact generation only after a 2xx OpenAI response; never let a later success resolve an incident created or reconfirmed during the same request window.
3. Test the five-minute preflight-read gate, cold-start eligibility, and failure-forced recheck without using it to suppress quota incident creation.
4. Implement a monitored custom fetch/client wrapper with safe metadata only: workload, environment key source, endpoint/model, status, code/type, and provider request ID. Never log keys, prompts, message bodies, headers, or customer content.
5. Add a static test that rejects production `new OpenAI(...)` outside the canonical factory.

## Task 4: Move every OpenAI workload behind the factory

**Files:**

- Modify: `src/lib/api/services/email-classifier.ts`
- Modify: `src/lib/catalog-setup/agent/setup-agent-service.ts`
- Modify: `src/lib/admin/briefing-steps/ai-analysis.ts`
- Modify: `src/app/api/inbox/reclassify/route.ts`
- Modify: affected focused tests

1. Replace every bypass constructor with a named workload client and explicit environment key-source label.
2. Preserve specialized-key fallback to `OPENAI_API_KEY`, so shared fallback workloads converge on one incident.
3. Split exact quota exhaustion from ordinary rate limiting in the reclassification route.
4. Run the constructor-boundary test and every affected workload test.

## Task 5: Register the notification and configuration contract

**Files:**

- Modify: `src/lib/api/services/notification-service.ts`
- Modify: `src/lib/notifications/notification-meta.ts`
- Modify: `.env.example`
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`

1. Register `ai_provider_quota` with existing OPS icons, critical semantics, and existing rail behavior; add no hardcoded visual values.
2. Document `OPS_PLATFORM_ALERT_USER_ID` as the sole recipient identity and `OPS_PLATFORM_ALERT_COMPANY_ID` as a required invariant check.
3. Document that OpenAI native 75%, 90%, and 100% project budget emails provide early warning; OPS handles only confirmed provider exhaustion and recovery.
4. Document that Gmail is never part of this alert path.

## Task 6: Add cold-launch-safe iOS notification-rail routing

**Worktree:** Create an isolated `ops-ios` worktree; do not touch the dirty primary checkout.

**Files:**

- Modify: `OPS/AppDelegate.swift`
- Modify: `OPS/Utilities/DeepLinkCoordinator.swift`
- Modify: `OPS/Views/MainTabView.swift`
- Modify: `OPSTests/LeadNotificationRouteParserTests.swift`

1. Write failing pure routing tests for `screen=notifications` and `type=ai_provider_quota`.
2. Route both warm and cold/PIN-gated launches through the existing deep-link coordinator to `AppState.showingNotifications`.
3. Reuse the existing notification rail and `OPSStyle`; do not create a new screen or dead `platform_health` deep link.
4. Run focused XCTest and a worktree-local DerivedData build after confirming no competing build uses that path.

## Task 7: Verify, review, and prepare release

1. Run all focused Vitest suites, migration contract tests, SQL parsing, `npm run type-check`, `npm run format:check`, and `npm run build`.
2. Run the relevant iOS tests and build in the isolated worktree.
3. Run an independent security/correctness review covering dedupe races, recovery races, service-role exposure, identity spoofing, secret leakage, Gmail exclusion, and push failure behavior.
4. Correct every finding and rerun proof.
5. Commit web and iOS changes atomically. Do not push, apply migrations, deploy, or write provider state until Jackson gives the final live-release approval.
