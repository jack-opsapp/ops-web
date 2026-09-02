# Instagram OAuth Connection Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Let an OPS admin connect the professional Instagram account once, keep the publishing credential current automatically, and remove static access-token setup from the release path.

**Architecture:** An admin-authenticated initiation route mints an opaque one-time OAuth state and redirects through Meta's Instagram Login flow. The callback exchanges and verifies the credential, encrypts it with an OPS-managed Vercel key, and persists service-role-only connection metadata. The publisher resolves the active connection and renews it under a database lease before expiry. The Social command deck shows one state-aware connect/manage control and blocks launch while disconnected.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase Postgres/RLS/RPC, AES-256-GCM, Meta Instagram API with Instagram Login, TanStack Query, Vitest, Testing Library.

**Required skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `vercel:auth`, `vercel:env-vars`, `vercel:nextjs`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch`.

**Approved design:** `docs/superpowers/specs/2026-09-01-instagram-agent-publishing-design.md`

---

### Task 1: Add the service-role-only connection schema

**Files:**

- Create with Supabase CLI: `supabase/migrations/<generated>_create_instagram_connection.sql`
- Test: `tests/unit/social/instagram-connection-migration.test.ts`

Write the migration contract test first. Add one global connection row, one-time OAuth states, encrypted token fields, safe metadata, refresh lease fields, RLS/revocations, atomic state consumption, refresh claiming, token replacement, failure recording, and disconnect functions. Every security-definer function uses an empty search path, fully qualified objects, and service-role-only execution.

### Task 2: Build the encrypted connection repository and Meta OAuth client

**Files:**

- Create: `src/lib/social/token-cipher.ts`
- Create: `src/lib/social/instagram-oauth-state.ts`
- Create: `src/lib/social/instagram-oauth-client.ts`
- Create: `src/lib/social/instagram-connection-repository.ts`
- Create: `src/lib/social/instagram-connection-service.ts`
- Tests: `tests/unit/social/instagram-token-cipher.test.ts`, `tests/unit/social/instagram-oauth-state.test.ts`, `tests/unit/social/instagram-oauth-client.test.ts`, `tests/unit/social/instagram-connection-service.test.ts`

Write failing tests before each module. Prove fail-closed key handling, authenticated encryption/tamper rejection, opaque expiring state, single-use consumption, strict Meta response parsing, required-scope checks, safe error redaction, account identity verification, proactive refresh, refresh lease release, and no secret-bearing public status.

### Task 3: Add admin connect, callback, status, and disconnect routes

**Files:**

- Create: `src/app/api/admin/social/instagram/route.ts`
- Create: `src/app/api/admin/social/instagram/callback/route.ts`
- Tests: `tests/unit/api/admin-social-instagram-route.test.ts`, `tests/unit/api/admin-social-instagram-callback-route.test.ts`

The initiation, status, and disconnect actions retain the Firebase admin gate. The callback trusts only an atomically consumed state minted by a verified admin, rechecks that admin identity, and returns to `/admin/social` with a non-secret result code. Add `Cache-Control: no-store` to every response.

### Task 4: Resolve renewable credentials in the publisher

**Files:**

- Modify: `src/lib/social/instagram-client.ts`
- Modify: `src/lib/social/publisher.ts`
- Tests: `tests/unit/social/instagram-client.test.ts`, `tests/unit/social/publisher.test.ts`

Replace the eager static-token client with an asynchronous connection-backed client provider. The batch heartbeat checks refresh eligibility even with an empty queue. Missing, expired, or invalid connections fail closed without claiming launchable posts; review artifacts remain intact.

### Task 5: Add the state-aware Social connection control

**Files:**

- Modify: `src/lib/hooks/use-social-posts.ts`
- Modify: `src/lib/api/query-client.ts`
- Modify: `src/app/admin/social/_components/social-command-deck.tsx`
- Modify: `src/i18n/dictionaries/en/admin-social.json`
- Modify: `src/i18n/dictionaries/es/admin-social.json`
- Test: `tests/unit/components/social-command-deck.test.tsx`

Write the interaction tests first. Disconnected state has one primary `CONNECT INSTAGRAM` action and disables launch. Connected state collapses to a compact account control with disconnect confirmation. Loading and failure states never imply a valid connection. All styling uses existing OPS tokens and all copy is dictionary-backed.

### Task 6: Document, verify, and prepare activation

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `vercel.json` only if the existing heartbeat cannot own refresh
- Modify: the relevant `ops-software-bible` social automation section

Document the Meta redirect URL and the four server-held values: Instagram App ID, Instagram App Secret, OPS-generated token encryption key, and the existing OPS-generated automation secret. Run focused tests, the full social suite, type-check, lint affected files, design-system audit, and a production build. Commit atomically. Do not apply the migration, write Vercel production variables, push, deploy, or publish to Instagram without the explicit production gates.
