# Codex MCP OAuth Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the Codex desktop client connect to the OPS remote MCP server through its current DCR OAuth flow without weakening Claude compatibility or the read-only exposure boundary.

**Architecture:** Retain the existing DCR-only authorization-server design. Add one shared TypeScript redirect policy that preserves the two exact Claude callbacks and accepts only Codex's observed native callback shape: HTTP on literal IPv4 loopback `127.0.0.1`, an explicit port from 1 through 65535, and one bounded base64url callback identifier under `/callback/`. Keep client membership, consent preview, authorization code, and token exchange redirect binding byte-exact. Add an append-only migration that gives the service-role registration RPC the same storage boundary; no schema, CIMD, issuer-response, port-equivalence, scope, exposure, or existing-grant change.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, PostgreSQL 17, Supabase migrations, OAuth 2.0 DCR + PKCE S256, MCP Streamable HTTP.

**Design System:** N/A — no visual or UI change.

**Required Skills:** `superpowers:systematic-debugging`, `superpowers:test-driven-development`, `custom-skills:writing-plans`, `custom-skills:executing-plans`, `superpowers:verification-before-completion`, `ops-copywriter:ops-copywriter` for the revised externally visible registration error.

---

### Task 1: Pin the Codex DCR redirect contract

**Skills:** `superpowers:test-driven-development`

**Files:**

- Modify: `src/lib/agent-control-plane/mcp/oauth/__tests__/clients.test.ts`
- Modify: `tests/unit/mcp/oauth-routes.test.ts`
- Modify: `tests/unit/mcp/oauth-consent.test.ts`

1. Add the captured real Codex registration payload with an explicit ephemeral port and callback identifier.
2. Add literal expectations accepting that payload while preserving both Claude callbacks.
3. Add adversarial cases for foreign hosts, `localhost`, IPv6, missing/zero/out-of-range ports, wrong paths, userinfo, query, fragment, whitespace/control characters, percent-encoded path confusion, and malformed callback identifiers.
4. Add route-level assertions that accepted Codex bytes reach the registration RPC unchanged and invalid bytes never reach persistence.
5. Add consent and token cases proving an exact registered Codex redirect remains exact through preview, code creation, and code exchange.
6. Run the focused tests and verify they fail only because Codex redirects are not yet admitted.

### Task 2: Implement the narrow HTTP callback policy

**Skills:** `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`

**Files:**

- Modify: `src/lib/agent-control-plane/mcp/oauth/clients.ts`
- Modify: `src/app/api/mcp/oauth/register/route.ts`
- Modify: `src/app/.well-known/oauth-authorization-server/route.ts`

1. Implement a strict parser for the observed Codex loopback URI shape.
2. Preserve byte-exact Claude allowlisting and make `isAllowlistedRedirectUri` the single shared policy consumed by registration, consent, and token routes.
3. Replace the Claude-only rejection description with a neutral, privacy-safe redirect-policy error.
4. Update server comments to state DCR support for Claude and Codex while keeping CIMD deliberately unadvertised.
5. Run the focused TypeScript suites and verify green.

### Task 3: Reassert the policy in PostgreSQL

**Skills:** `superpowers:test-driven-development`

**Files:**

- Create: `supabase/migrations/20260829192448_mcp_oauth_codex_dcr_callbacks.sql`
- Create: `tests/sql/agent-mcp-oauth-codex-dcr-runtime.sql`
- Modify: `tests/integration/agent-control-plane/p2-postgres-runtime.test.ts`

1. Add the SQL runtime fixture first and include it at the new migration checkpoint.
2. Verify the full-wave test fails because the migration and ledger entry do not exist.
3. Add an append-only migration replacing only the latest eight-argument registration RPC body.
4. Accept the two exact Claude HTTPS callbacks or the exact bounded Codex loopback regex plus numeric port range; reject every other redirect URI.
5. Keep function signature, result schema, privileges, search path, volatility, and all scope/consent/exposure checks unchanged.
6. Run the PostgreSQL 17 full-wave and replay proof in a disposable local database.

### Task 4: Verify the complete connector boundary

**Skills:** `superpowers:verification-before-completion`

**Files:**

- Test only

1. Run all OAuth client, route, consent, grant, metadata, and transport tests.
2. Run the complete agent-control-plane suite with the MCP SDK dependency present.
3. Run TypeScript with the repository's Node 22 runtime and sufficient heap.
4. Run the full PostgreSQL 17 migration wave and independent residue check.
5. Confirm exactly eleven reads and seven scopes remain externally exposed and every write stays dark.
6. Confirm no temporary clients, grants, tokens, databases, or test worktrees remain.

### Task 5: Update durable documentation and commit atomically

**Skills:** `custom-skills:executing-plans`

**Files:**

- Modify: `API-REFERENCE.md`
- Modify: OPS Software Bible `04_API_AND_INTEGRATION.md`
- Modify: OPS Software Bible `03_DATA_ARCHITECTURE.md`
- Modify: OPS Software Bible `specs/2026-08-29-mcp-read-catalogue-p2.md`
- Create: OPS Software Bible `migrations/20260829192448_mcp_oauth_codex_dcr_callbacks.sql`

1. Record local Codex DCR compatibility without claiming deployment or live success.
2. Mirror the migration byte-for-byte into the bible.
3. Commit OPS-Web code/tests/migration/docs as one atomic OAuth compatibility change.
4. Commit the bible mirror and status update separately.
5. Stop before push, migration application, deployment, or production OAuth registration; those require Jackson's explicit release authorization.
