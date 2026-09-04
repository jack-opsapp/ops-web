# MCP Tool Request Form Implementation Plan

> **For implementation:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Replace the public MCP guide's email link with a secure, accessible two-field form that durably records tool requests for OPS review.

**Architecture:** A client form posts a bounded JSON document to a same-origin Next.js route. The route strictly validates and normalizes the submission, reduces IPv6 network identities to `/64`, derives domain-separated HMAC identities for the network and normalized email, and calls one service-role-only Supabase RPC. That RPC resolves idempotent replay before rate checks, atomically consumes dedicated durable network/email limits and writes the fixed `feature_requests` row; the OPS support email is scheduled only after a new durable row and remains a best-effort side effect. No browser-supplied company or user identity is accepted and no public database privilege or RLS policy is widened.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Supabase/Postgres, React Email, Vitest, Testing Library, Playwright.

**Design System:** `.interface-design/system.md`

**Required Skills:** `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:verification-before-completion`.

---

### Task 1: Lock the server intake and database contract

**Skills:** Test-driven development, Supabase security and Postgres constraints.

**Files:**

- Create: `tests/unit/mcp/tool-request-intake.test.ts`
- Create: `tests/unit/mcp/tool-request-supabase-store.test.ts`
- Create: `tests/sql/public-mcp-tool-request-submission-contract.sql`
- Create: `src/lib/agent-control-plane/mcp/tool-request/intake.ts`
- Create: `supabase/migrations/20260904042010_public_mcp_tool_request_submission.sql`

**Steps:**

1. Write failing intake tests for strict body shape, UUID submission IDs, normalized email, 20–4,000-character details, honeypot suppression, created/replayed/rate-limited outcomes, persistence failures, and notification scheduling only after a new durable row.
2. Write failing adapter tests for the exact RPC name and arguments, one-row result validation, submission/result identity equality, `23505` idempotency conflict mapping, `22023` validation mapping, and generic fail-closed storage errors.
3. Write a SQL contract harness that proves service-role-only execution, no table access outside the owner, identical replay before rate checks, conflicting UUID reuse, bounded cleanup, exact fixed-window limits and retry delays, and rollback of all three counters when persistence fails.
4. Add `private.mcp_tool_request_rate_limit_windows` with forced RLS, no non-owner grants, fixed policy revision, digest-only identities, and bounded expired-window cleanup.
5. Add `public.submit_public_mcp_tool_request_as_system(uuid,text,text,text,text,text)` as a pinned-search-path `SECURITY DEFINER` function. Require `private.require_external_api_service_role()`, acquire deterministic advisory locks, return identical replays before rate checks, and atomically consume the counters plus insert the fixed request row.
6. Enforce dedicated limits on newly created requests: 5 per network identity per UTC hour, 20 per network identity per UTC day, and 3 per email identity per UTC day. Denials and replays must consume no counters; denials return the exact reset delay.
7. Persist only server-fixed `type`, `platform`, `source_screen`, `status`, active-exposure metadata, normalized requester content, and explicit public-intake identity sentinels so the identity-stamping trigger cannot infer an unrelated user or company.
8. Revoke all function/table access from every non-owner role, then grant RPC execution only to `service_role`.
9. Run the focused TypeScript and SQL contract suites and confirm they pass.

### Task 2: Add the public POST boundary

**Skills:** Test-driven development, Supabase security.

**Files:**

- Create: `tests/unit/mcp/tool-request-route.test.ts`
- Create: `src/app/api/developers/mcp/tool-requests/route.ts`
- Modify: `src/lib/external-api/security/network-fingerprint.ts`
- Modify: `tests/unit/external-api/network-fingerprint.test.ts`

**Steps:**

1. Write failing handler tests for same-origin JSON requests, the 20 KiB body-envelope bound, malformed JSON, route-scoped IPv6 `/64` normalization, coarse network denial, limiter unavailability, valid creation, replay, honeypot suppression, validation failure, and safe generic failures.
2. Run the focused test and confirm the route is missing.
3. Implement the route with same-origin checks, JSON-only/body-size enforcement, and strict bounded validation. Preserve exact IPv4 identities, unwrap IPv4-mapped IPv6 to IPv4, and canonicalize native IPv6 addresses to their `/64` network for this route without changing the shared external-API fingerprint default.
4. Keep the existing fail-closed coarse network prelimit ahead of body parsing. Pass only separately domain-bound HMAC identities for the canonical network and normalized email to the dedicated atomic RPC; raw IP and email values must never enter the rate-limit table.
5. Return explicit no-store responses with safe status codes: `201` for creation or honeypot suppression, `200` for identical replay, `400` invalid, `403` cross-origin, `409` conflicting UUID reuse, `429` with `Retry-After`, `500` opaque persistence failure, and `503` unavailable security dependencies.
6. Re-run route, intake, adapter, and network-normalization tests and confirm they pass.

### Task 3: Add the operator alert

**Skills:** OPS copywriter and existing transactional-email conventions.

**Files:**

- Create: `src/lib/email/react/templates/McpToolRequest.tsx`
- Modify: `src/lib/email/sendgrid.tsx`
- Test: `tests/unit/mcp/tool-request-intake.test.ts`

**Steps:**

1. Keep the already-written failing assertion that notification is scheduled only after the RPC returns `created`; honeypots, replays, rate denials, and failures never notify.
2. Add a terse internal email to the configured OPS support address containing the requester email, request body, submission ID, and `/admin/feedback` action.
3. Schedule the SendGrid work through Next.js `after()` so email latency cannot block the browser response. Catch and log a fixed non-PII failure marker; never turn a stored request into a failed browser response.
4. Run the focused intake, route-wiring, and SendGrid adapter tests.

### Task 4: Build the embedded two-field form

**Skills:** OPS design, interface design, frontend design, UI/UX, OPS copywriter.

**Files:**

- Create: `tests/unit/mcp/request-tool-form.test.tsx`
- Create: `src/app/developers/mcp/_components/request-tool-form.tsx`
- Modify: `src/app/developers/mcp/_components/mcp-guide-page.tsx`
- Modify: `src/i18n/dictionaries/en/mcp-docs.json`
- Modify: `src/i18n/dictionaries/es/mcp-docs.json`

**Design tokens:** `glass-surface`, `bg-surface-input`, `border-line`, `border-rose-line`, `text-text`, `text-text-2`, `text-text-3`, `text-rose`, `font-cakemono`, `font-mohave`, `font-mono`, `rounded`, `min-h-control-36`, `ring-ops-accent`, `ring-offset-black`, and the established Tailwind spacing tokens.

**Steps:**

1. Write failing component tests for labels, inline validation, exact payload, one stable submission ID across retry, sending state, success state, rate-limit copy, retryable failure, preserved values, honeypot, and safety association.
2. Run the focused test and confirm the component is missing.
3. Implement the client component with visible work-email and request-details fields only. Use the canonical static glass surface and primary action, rose error borders, the standard focus treatment, no decorative motion beyond established component behavior, semantic labels, linked errors, first-error focus, `aria-busy`, live status regions, and a 15-second request timeout.
4. Replace mail-only dictionary keys with complete English and Spanish state/validation copy.
5. Embed the form in the existing `request-tool` section and remove the mailto/icon imports.
6. Re-run component and page tests.

### Task 5: Update guide and browser contracts

**Skills:** Test-driven development and interface design.

**Files:**

- Modify: `tests/unit/mcp/guide-page.test.tsx`
- Modify: `tests/e2e/mcp-guide.spec.ts`

**Steps:**

1. Replace the mailto assertions with semantic form assertions and an intercepted successful POST.
2. Keep the deep-link, responsive viewport, navigation, clipboard, and reduced-motion coverage.
3. Run the focused unit suite and Playwright guide suite.

### Task 6: Update the software bible

**Skills:** OPS architecture documentation conventions.

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/ops-software-bible-mcp-guide-release/04_API_AND_INTEGRATION.md`

**Steps:**

1. Replace the documented mailto workflow with the exact public form/API persistence, validation, HMAC identity, IPv6 `/64`, atomic rate-limit, replay, support-alert, safety, and admin-review contract.
2. Verify the documented endpoint, fixed database metadata, RPC ACL, windows, limits, and response behavior against the implementation and tests.
3. Do not copy the migration into the Bible archive or edit `03_DATA_ARCHITECTURE.md` until the migration is actually applied in production.
4. After production apply, mirror the applied migration byte-for-byte and update the canonical schema description in the same Bible commit.

### Task 7: Audit, verify, and release

**Skills:** Design-system audit and verification before completion.

**Steps:**

1. Scan every changed UI file for hardcoded colors, spacing, radii, font values, inaccessible state copy, and forbidden visual patterns.
2. Run formatting, ESLint for changed files, TypeScript, focused Vitest suites, and the MCP Playwright suite.
3. Perform a production build and inspect warnings separately from failures.
4. Commit the web change atomically, but do not deploy a route that depends on an unapplied RPC.
5. Under separate explicit production-database approval, apply the migration first and independently verify the table, forced RLS, canonical ACL, function definition, and contract behavior. This uses existing Supabase/Postgres infrastructure and introduces no new paid service.
6. Only after the migration is proven, mirror it into the Bible archive and update `03_DATA_ARCHITECTURE.md`.
7. Fetch and safely rebase the isolated web branch if `origin/main` moved, then re-run the changed vertical.
8. Push the verified web commit to `main` under the user's explicit web-release approval.
9. Wait for the production Vercel deployment, verify it is `READY`, fetch the live guide and endpoint, and submit one clearly marked sandbox tool request only if it can be safely removed or retained as test evidence.
10. Report the live outcome, proof, and any unrelated baseline warnings.
