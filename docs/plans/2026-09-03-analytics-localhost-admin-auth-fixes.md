# Analytics Localhost Exclusion and Admin Auth Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Keep non-production web traffic out of GA4 collection and every OPS report, clean contaminated warehouse history through the existing replay mechanism, and make the first `/admin` navigation recover expired Firebase sessions without bouncing to `/dashboard`.

**Architecture:** Define one property-aware production-host registry and compose its GA4 Data API filter into all marketing and web-app reports while leaving iOS untouched. Guard browser collection at runtime by production hostname. Version the warehouse filter so the existing atomic date-replacement sync automatically replays retained history. For admin navigation, treat JWT expiry as a middleware routing hint only, listen for Firebase ID-token refreshes, and keep cryptographic verification plus the admin allowlist as the authorization boundary.

**Tech Stack:** Next.js App Router, TypeScript, Firebase Auth, Google Analytics Data API, Supabase/Postgres analytics warehouse, Vitest, node:test.

**Design System:** N/A. No visual or user-facing copy changes.

**Required Skills:** `custom-skills:writing-plans`, `custom-skills:executing-plans`, `custom-skills:data-strategist`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`, `superpowers:verification-before-completion`, `supabase:supabase`.

---

## Task 1: Establish the analytics hostname contract

**Files:**
- Modify: `src/lib/analytics/property-registry.ts`
- Create: `src/lib/analytics/ga4-report-filter.ts`
- Modify: `src/lib/analytics/__tests__/ga4-client.test.ts`

1. Add failing tests for the exact production hosts: marketing accepts `opsapp.co`, `www.opsapp.co`, and `try.opsapp.co`; web app accepts only `app.opsapp.co`; iOS has no hostname filter.
2. Add failing tests showing an existing event/page filter is combined with the production-host filter through an AND expression.
3. Run the focused test and confirm it fails for the missing contract.
4. Add immutable hostnames to the property registry and a typed filter-composition helper.
5. Re-run the focused test and confirm it passes.

## Task 2: Stop non-production traffic at collection

**Files:**
- Modify: `src/lib/analytics/ga-config.ts`
- Modify: `src/components/layout/GoogleAnalytics.tsx`
- Modify: `tests/unit/google-analytics-config.test.tsx`
- Modify in ops-site worktree: `src/lib/analytics/ga-config.ts`
- Modify in ops-site worktree: `src/components/layout/GoogleAnalytics.tsx`
- Modify in ops-site worktree: `src/lib/analytics/__tests__/ga-config.test.ts`
- Modify in ops-site worktree: `src/components/layout/__tests__/google-analytics.test.tsx`

1. Add failing execution tests proving localhost, loopback addresses, Vercel previews, and arbitrary hosts produce no GA configuration call.
2. Add passing-host expectations for each surface's canonical production hosts.
3. Run both repositories' focused tests and confirm the new cases fail.
4. Pass the surface allowlist into the generated config script and exit before initializing GA when the runtime hostname is not allowed.
5. Re-run both repositories' focused tests.

## Task 3: Exclude non-production hosts from every GA4 report

**Files:**
- Modify: `src/lib/analytics/ga4-acquisition-client.ts`
- Modify: `src/lib/analytics/ga4-client.ts`
- Modify: `src/lib/admin/analytics-queries.ts`
- Modify: `src/lib/admin/spec-analytics-queries.ts`
- Modify: `tests/unit/ga4-acquisition-sync.test.ts`
- Create: `tests/unit/admin/analytics-queries.test.ts`
- Create or modify: focused SPEC analytics request tests

1. Add failing request-shape tests for the warehouse acquisition query, direct website reports, blog reports, and SPEC reports.
2. Prove iOS conversion QA keeps its event filter without adding a hostname dimension.
3. Run focused tests and observe the expected failures.
4. Compose the property-aware hostname filter into every web GA4 request without requesting `hostName` in the response rows.
5. Re-run focused tests and search all `runReport` call sites to prove no web reporting path was missed.

## Task 4: Replay contaminated warehouse history

**Files:**
- Modify: `src/lib/admin/ga4-acquisition-sync.ts`
- Modify: `tests/unit/ga4-acquisition-sync.test.ts`

1. Add a failing test showing a completed pre-filter sync state restarts from the 14-month retention boundary.
2. Add a failing test showing a current-version in-progress cursor continues normally.
3. Introduce a hostname-filter version in sync metadata and ignore stale completion/cursor state.
4. Re-run the acquisition sync tests. The existing `replace_ga4_daily_acquisition` RPC atomically deletes and replaces each property/date, so replay removes contaminated rows without a schema migration.

## Task 5: Repair first-load `/admin` session routing

**Files:**
- Create: `src/lib/auth/firebase-id-token-cookie.ts`
- Modify: `src/middleware.ts`
- Modify: `src/lib/firebase/auth.ts`
- Modify: `src/components/providers/auth-provider.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `tests/unit/middleware.test.ts`
- Create: `tests/unit/auth/firebase-id-token-cookie.test.ts`
- Modify: `tests/unit/auth/auth-provider-actor-binding.test.tsx`
- Modify: Firebase auth mocks in affected integration/unit tests

1. Add failing JWT-expiry tests for malformed, missing-exp, expired, skew-boundary, and fresh tokens.
2. Add failing middleware regressions: an expired cookie preserves the exact `/admin` destination, clears stale cookies, and may render `/login`; a fresh token keeps safe post-login routing.
3. Add a failing provider regression showing a same-user `onIdTokenChanged` refresh rewrites the canonical cookie and clears the legacy cookie without resetting actor state.
4. Implement the pure expiry helper as a routing signal only. Prefer `ops-auth-token`, fall back to `__session`, and leave authorization to Firebase signature verification plus `isAdminEmail`.
5. Replace the reactive listener with `onIdTokenChanged`, align cookie lifetime to token expiry with skew, add `Secure` on HTTPS, and clear `__session` whenever the canonical cookie is written.
6. Preserve the complete admin destination when server verification fails, while preventing a non-admin user from looping back to admin.
7. Re-run all focused auth tests.

## Task 6: Close the adjacent admin diagnostics exposure

**Files:**
- Modify: `src/app/api/admin-debug/route.ts`
- Create or modify: `tests/unit/api/admin-debug.test.ts`

1. Add a failing test proving an unauthenticated request cannot read environment-presence, project, company-count, or user-count diagnostics.
2. Protect the route with the existing cryptographic admin guard and canonical cookie precedence.
3. Re-run the focused route test.

## Task 7: Verify, document, and commit

**Files:**
- Modify: `ops-software-bible/21_ANALYTICS_SYSTEM.md`
- Modify: this implementation plan only if execution discoveries require it

1. Update the analytics bible with production-host collection/reporting boundaries and the filter-version replay behavior.
2. Run focused tests for analytics, middleware, auth provider, and admin diagnostics in OPS-Web and GA collection tests in ops-site.
3. Run type-check, lint on touched files if supported, and production builds for both repositories.
4. Inspect diffs and working-tree status; confirm no unrelated files are staged.
5. Commit atomic changes in each repository. Do not push or deploy without explicit approval.
