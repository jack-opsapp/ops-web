# External API Zero-Cost Norcut Pilot Implementation Plan

> **Execution note:** This plan replaces the unapproved dedicated Upstash dependency in the July 23 external API plan. AWS remains the file quarantine and delivery layer, Vercel remains the public edge, and the existing OPS Supabase project becomes the durable exact-quota authority.

**Goal:** Launch the Norcut pilot so its original estimate submission creates one OPS customer and one lead, safely carries photos/files through AWS, and powers a privacy-safe Norcut analytics view without adding a dedicated Redis bill.

**Architecture:** Vercel WAF absorbs coarse anonymous floods before the application. Every protected OPS API request then consumes an atomic fixed-window quota in Supabase for the HMAC-derived network, credential, and company identities. Analytics bypasses the unprovisioned private cache during the pilot and reads the privacy-safe OPS projection directly. Norcut keeps the OPS credential server-side, requests short-lived AWS upload capabilities, lets the browser upload bytes directly to AWS, and submits only opaque upload IDs plus the original form data to OPS. The Norcut reference ID is the stable external submission/idempotency identity, preventing retries or the later email thread from creating another lead.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Supabase/PostgreSQL guarded RPCs, Vercel WAF, AWS S3/CloudFront/GuardDuty/SQS, Vitest, Playwright.

---

## Task 1: Reconcile the external API branch with current OPS Web

**Files:**
- Merge current `origin/main` into `feat/lead-intake-api`
- Resolve only the overlapping email lifecycle, routing, database type, and focused test files

**Steps:**
1. Record the clean baseline and overlapping paths.
2. Merge `origin/main` without rewriting shared history.
3. Preserve current main lifecycle/email fixes while retaining external-intake behavior.
4. Run the external API baseline tests and the overlapping email lifecycle tests.
5. Commit the reconciliation as one atomic merge.

## Task 2: Replace Redis rate limiting with guarded Supabase quotas

**Files:**
- Create: `supabase/migrations/<latest>_external_api_rate_limits.sql`
- Modify: `src/lib/external-api/security/strict-rate-limit.ts`
- Modify: `src/lib/external-api/security/network-fingerprint.ts`
- Modify: `src/lib/external-api/http/boundary.ts`
- Modify: `src/app/api/cron/external-api-maintenance/route.ts`
- Modify: `tests/unit/external-api/strict-rate-limit.test.ts`
- Modify: `tests/integration/external-api-request-boundary.test.ts`
- Add focused SQL contract coverage under `tests/sql/external-api/`

**Steps:**
1. Add failing unit tests for exact RPC payloads, malformed responses, transport failures, timeouts, denials, and retry timing.
2. Add a private fixed-window table keyed by scope, HMAC identity, policy, and database-derived window start.
3. Add a service-role-only `consume_external_api_rate_limits_as_system(jsonb)` RPC that:
   - accepts a bounded number of checks;
   - recognizes only the approved external API scope/policy combinations;
   - uses the database clock;
   - increments every requested window atomically;
   - returns the strictest allowance, remaining quota, and retry delay;
   - never accepts raw IP addresses or credential secrets.
4. Add a service-role-only bounded purge RPC for expired windows.
5. Replace the Redis REST implementation with the Supabase RPC adapter while preserving the existing boundary interface and fail-closed `503` behavior.
6. Rename provider-specific `redisIdentity` fields to `rateLimitIdentity`.
7. Call the bounded purge from the existing guarded maintenance job and expose only the count.
8. Prove grants, search paths, row access, policy validation, concurrent increments, and malformed-input rejection with SQL contracts.

## Task 3: Remove the unprovisioned private analytics cache

**Files:**
- Modify: `src/lib/external-api/analytics/private-cache.ts`
- Modify: analytics cache unit/service tests
- Modify: `.env.example`

**Steps:**
1. Add failing tests proving the production default never makes an external cache request and always reports `unavailable`.
2. Replace the configured Redis cache with an immutable no-op private cache.
3. Keep the injectable cache interface and deterministic cache keys for tests and a future approved private cache.
4. Remove the Redis URL/token environment variables and launch dependency.
5. Verify analytics still authorizes revocation before reading directly from the privacy-safe projection.

## Task 4: Refresh launch, cost, API, and Bible documentation

**Files:**
- Modify: `docs/runbooks/external-api-launch.md`
- Modify: `docs/runbooks/external-api-cost-and-service-gate.md`
- Modify: `docs/api/external-lead-intake-and-analytics.md`
- Modify: `docs/plans/2026-07-23-external-lead-intake-and-analytics-api.md`
- Modify: `docs/superpowers/specs/2026-07-23-lead-intake-and-analytics-api-design.md`
- Modify in isolated Bible worktree: `03_DATA_ARCHITECTURE.md`
- Modify in isolated Bible worktree: `04_API_AND_INTEGRATION.md`
- Modify in isolated Bible worktree: `08_DEPLOYMENT_AND_OPERATIONS.md`
- Mirror the rate-limit migration in `ops-software-bible/migrations/`

**Steps:**
1. Record the approved no-Upstash decision and the two-layer WAF/Supabase boundary.
2. Document exact quotas, fail-closed behavior, retention, cleanup, and expected incremental cost.
3. Remove Upstash provisioning and environment setup from the current launch checklist.
4. Preserve historical context by marking the July 23 Redis choice as superseded rather than silently erasing it.
5. Update the Bible without touching the dirty primary Bible checkout.

## Task 5: Verify OPS Web and prepare a private pilot deployment

**Files:**
- No production mutation

**Steps:**
1. Regenerate OpenAPI and prove it has no unintended contract drift.
2. Run external API unit, integration, SQL, type, and build checks.
3. Deploy the reconciled branch to a private Vercel preview only.
4. Configure and verify the preview WAF rule for `/v1/*` without changing the production project.
5. Exercise missing-secret, invalid-key, quota-denial, cache-bypass, and AWS upload-capability paths in preview.
6. Stop for explicit approval before applying production Supabase migrations or deploying OPS Web production.

## Task 6: Connect Norcut’s original estimate submission

**Files:**
- Create server-only OPS API client under `lib/ops/`
- Create a same-origin upload-reservation endpoint under `app/api/`
- Modify: `components/services/EstimateForm.client.tsx`
- Modify: `app/services/estimate/actions.ts`
- Modify: `app/services/estimate/validate-lead.ts` as required by the OPS contract
- Modify/add focused estimate form, action, and API-client tests

**Steps:**
1. Read Norcut brand and design-system sources before changing its form.
2. Add a server-only client that requires the OPS base URL and intake credential and never exposes either credential to the browser.
3. Fetch/cache only safe intake configuration server-side and fail closed if the configured source/form no longer exists.
4. On submit, reserve upload capabilities using stable per-file identities and a stable Norcut reference.
5. Upload each verified file directly from the visitor’s browser to the one-time AWS capability with the exact required headers.
6. Submit contact, structured job address, services, property type, timing, notes, full source attribution, upload IDs, and the Norcut reference to OPS.
7. Use deterministic idempotency keys for upload reservation and final submission retries.
8. Keep a local Norcut delivery receipt for admin continuity, but do not create an independent second lead workflow or resend an email that can be ingested as another lead.
9. Return success only after OPS confirms the lead; surface a calm retry state without discarding the visitor’s form if OPS is temporarily unavailable.
10. Verify photos bypass the Vercel function body limit and no credential/storage path reaches browser logs or rendered HTML.

## Task 7: Add Norcut’s OPS-backed analytics view

**Files:**
- Create server-only analytics client under `lib/ops/`
- Modify the authenticated admin dashboard under `app/admin/(gated)/(working)/`
- Add focused server/client rendering and failure-state tests

**Steps:**
1. Read the Norcut dashboard and data-visualization guidance before UI work.
2. Query only the privacy-safe metrics/feed endpoints with a separate analytics credential.
3. Show the smallest useful dashboard: lead volume, response timing, decision conversion, and source performance for Norcut’s source.
4. Format every metric from its returned unit/definition and visibly distinguish suppressed or incomplete evidence from zero.
5. Do not persist customer data, free-form answers, or files in analytics storage.
6. Provide a quiet unavailable state that leaves the rest of Norcut admin operational.
7. Verify desktop/mobile layout, keyboard access, reduced motion, and brand-token compliance.

## Task 8: Production gate and end-to-end pilot proof

**Files/State:**
- OPS Supabase production migrations
- OPS Web production deployment and WAF rule
- Norcut production environment and deployment
- One controlled test submission

**Steps:**
1. Present the exact production mutations, rollback path, and expected cost to Jackson.
2. After explicit approval, apply the external API migration series and verify every table, RPC, grant, and policy by live readback.
3. Create the least-privilege Norcut intake and analytics principals, allowed source/form/origin, and securely store their credentials.
4. Deploy OPS Web production, configure the `/v1/*` WAF rule, and verify fail-closed health.
5. Deploy Norcut production with its server-only credentials.
6. Submit one controlled Norcut lead with a photo, prove exactly one customer and one lead were created, prove the file reaches its final safe state, and verify the source characteristics appear in both the lead feed and Norcut analytics.
7. Verify a repeated submission with the same identity replays instead of duplicating.
8. Revoke/rotate test credentials if any were exposed during testing and record the final monthly cost baseline.
