# MCP Full Read Exposure V2 Implementation Plan

> **For implementation:** REQUIRED SKILL: Use `custom-skills:executing-plans` task-by-task, with strict test-driven development.

**Goal:** Make all 34 implemented OPS read capabilities available to newly consented Claude and ChatGPT/Codex connectors, then prove every tool against the Maverick sandbox company.

**Architecture:** Add an immutable `2026-08-29.mcp-exposure.v2` catalogue revision containing the exact 34 manifest-v8 reads and their exact 20 read scopes. Keep exposure v1 byte-for-byte unchanged. Carry each validated grant's stored exposure revision into the request boundary and build that request's MCP server from the exact pinned catalogue revision. New DCR and consent flows select active v2; existing v1 clients, grants, access tokens, refresh tokens, and consent snapshots remain v1 and cannot gain a tool or scope silently. The current database schema already stores non-null exposure and consent revisions generically, so this is a code-only release with no migration.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, OAuth 2.0 DCR + PKCE S256, MCP Streamable HTTP, PostgreSQL 17/Supabase, Vercel.

**Design System:** N/A — no visual surface or new user-facing copy. The existing consent catalogue already contains labels for all 20 read scopes.

**Required Skills:** `superpowers:test-driven-development`, `custom-skills:writing-plans`, `custom-skills:executing-plans`, `supabase:supabase`, `plugin-dev:mcp-integration`, `superpowers:verification-before-completion`, `vercel:verification`, `vercel:deployments-cicd`, `superpowers:finishing-a-development-branch`.

---

### Task 1: Pin the immutable v2 public contract

**Files:**

- Modify: `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`
- Modify: `src/lib/agent-control-plane/registry/__tests__/manifest-v8.test.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`

1. Write literal failing tests for the exact ordered 34 tool IDs, exact ordered 20 grantable read scopes, deep freezing, catalogue membership, active-v2 selection, and fail-closed unknown revision handling.
2. Preserve and reassert the exact v1 bytes, digest, 11 tools, and seven scopes.
3. Add the immutable v2 object, validate every catalogue revision against manifest, domain-dispatch, registered-scope, operation, and consent-label invariants, then select v2 as active.
4. Keep the legacy `SUPPORTED_READ_SCOPES` compatibility view pinned to v1 so old compatibility consumers and tests do not masquerade as the active catalogue.
5. Run the two focused registry suites and observe red before implementation, green after.

### Task 2: Pin every request to its grant's exposure revision

**Files:**

- Modify: `src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/transport.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/bearer.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`

1. Write failing boundary tests proving bearer validation propagates the stored `exposure_revision` unchanged.
2. Write real server-list tests proving a v1 grant receives exactly 11 tools, a v2 grant receives exactly 34, and an unknown grant revision fails closed before registration or domain dispatch.
3. Add `exposureRevision` to immutable `McpGrantFacts` and resolve the exact catalogue revision inside the per-request server factory.
4. Do not derive exposure from supplied scopes, active configuration, tool arguments, actor data, or client claims.
5. Preserve scope enforcement, actor re-resolution, rate limiting, evidence proofs, serialization, audit, and all write-dark behavior.

### Task 3: Advertise the active v2 consent surface consistently

**Files:**

- Modify: `tests/unit/mcp/oauth-routes.test.ts`
- Modify: `tests/unit/mcp/oauth-consent.test.ts`
- Modify: `src/app/.well-known/oauth-protected-resource/route.ts`
- Modify: `src/app/.well-known/oauth-protected-resource/api/mcp/route.ts`

1. Write failing metadata tests with literal expectations for all 20 active read scopes at both RFC 9728 routes and the RFC 8414 authorization-server route.
2. Make protected-resource metadata resolve the active exposure catalogue instead of the v1 compatibility constant.
3. Reassert that fresh DCR, blank-scope resolution, consent preview, authorization code, access token, and bearer challenge all use the same active-v2 scope ceiling.
4. Reassert that old v1 refresh preserves its original exact scope set and exposure revision without widening.

### Task 4: Verify the complete local boundary

**Files:**

- Test only

1. Run the focused registry, bearer, transport, OAuth scope/client/grant/route/consent, manifest-v8, and metadata suites.
2. Run all MCP and agent-control-plane suites, TypeScript, lint for touched files, and the production build with the repository's Node 22 runtime.
3. Run the PostgreSQL migration wave/runtime suites to prove the already-live generic revision schema accepts v2 without DDL and all 34 read RPC contracts remain valid.
4. Run independent security review for existing-grant non-widening, unknown-revision failure, scope/tool parity, cross-company isolation, writes remaining absent, and rollback safety.
5. Confirm this change creates no new vendor, subscription, database tier, or paid infrastructure cost; it uses normal existing Vercel and Supabase request capacity.

### Task 5: Release and verify production

**Files:**

- Modify: `API-REFERENCE.md`
- Modify: OPS Software Bible `04_API_AND_INTEGRATION.md`
- Modify: OPS Software Bible `specs/2026-08-29-mcp-read-catalogue-p2.md`

1. Record immutable v1/v2 behavior, the exact full read catalogue, connector re-consent requirement, and existing-grant safety without claiming live proof early.
2. Commit OPS-Web and Bible changes atomically in their isolated worktrees.
3. Push the verified OPS-Web change to main under Jackson's explicit release approval and verify the exact Vercel deployment SHA, READY state, production alias, metadata, unauthenticated challenge, and runtime logs.
4. Push the Bible update only after its status matches verified production reality.
5. Rollback remains a code-only active-revision change: v1 stays compiled, immutable, and immediately selectable without schema or data rollback.

### Task 6: Re-consent Maverick and exercise all 34 reads

**Files:**

- Create/update verification artifact under `docs/artifacts/` only if durable evidence is useful; never store tokens or business payloads.

1. Preserve the existing v1 connection as the backward-compatibility canary, then create a fresh v2 DCR/consent grant for Maverick through the system browser.
2. Verify the new grant advertises exactly 34 tools and 20 read scopes; verify the old grant still advertises exactly 11 tools.
3. Run a dependency-aware read-only matrix across all 34 tools. Discovery reads supply opaque customer, job, task, site-visit, deck-design, artifact, document, expense, catalogue-item, and purchase-order references to dependent reads.
4. Treat a schema-valid empty result or typed `NOT_FOUND` caused by absent sandbox fixture data as a successful boundary result, while separately reporting coverage gaps. Do not treat authentication, authorization, internal, malformed-contract, or cross-company failures as success.
5. Specifically prove `list_site_visits` → `get_site_visit_context` → `get_deck_design_geometry`, including authoritative surface square footage, railing linear feet, and geometry payload when a Maverick deck fixture exists.
6. Report a 34-row pass/fail matrix with no customer payloads or secrets, any fixture gaps, and exact production/customer-live status.
