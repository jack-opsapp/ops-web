# Canpro cloud OPS OAuth compatibility implementation plan

**Goal:** Permit one exact Canpro HTTPS callback with explicit read-only scopes and expose the authenticated OPS actor/company binding to that source client.

**Architecture:** Extend both existing registration validators, keeping exact redirect storage and all consent, PKCE, rotation, approval and financial boundaries. Add a narrow GET identity route using the existing MCP bearer and current authority resolver. No new identity token, scope, credential type, or business read.

**Tech Stack:** Next.js, TypeScript, Vitest, PostgreSQL 17.

**Design System:** N/A; no UI changes.

**Required Skills:** systematic-debugging, using-git-worktrees, test-driven-development, custom-skills:executing-plans, supabase, verification-before-completion.

## 1. Exact callback and read ceiling

- Add failing tests in `src/lib/agent-control-plane/mcp/oauth/__tests__/canpro-client.test.ts` for the exact URI, look-alikes, mixed families, explicit scopes and rejection of prepare authority despite active v14 exposure.
- Run those tests; implement the smallest change in `oauth/clients.ts`.
- Create a forward migration for `register_mcp_oauth_client_as_system`; match the currently verified definition and preserve service-only ACLs. Enforce the same frozen v2 read ceiling in SQL.
- Prove registration, redirects, single-use codes, stale consent, refresh reuse, scope preservation and ACLs in an isolated PostgreSQL fixture. Reapply the migration and assert existing registration bytes are unchanged.

## 2. Bearer identity response

- Add `tests/unit/mcp/oauth-userinfo.test.ts`, exercising the real bearer and authority resolvers with synthetic RPC fixtures.
- Implement `src/app/api/mcp/oauth/userinfo/route.ts`: GET only, `{actorId,companyId}`, `ops.company.read`, no-store, existing transport limiter, generic errors, no cookie/query authentication or grant/token details.
- Test revoked/expired/disabled/wrong-issuer/wrong-resource credentials, membership removal/mismatch/inactivity, unavailable dependencies, scope and origin denial, rate limiting and repeated fresh authority lookup.

## 3. Verification and release handoff

- Run OAuth, bearer, principal and route regression suites, focused SQL runtime proof, TypeScript and diff checks.
- Update the Software Bible with a clearly local/prepared spec and exact migration mirror. Write `agent-control/docs/end-to-end-build/ops-oauth.md` for PM/source integration with tests, commit, prerequisites and cost boundary.
- Commit only owned source/test/docs changes. No push, production migration, deployment, registration, grant reuse, business read or activation.

## Baseline

Isolated detached worktree from production commit `c44cf655e733b257beaef8c7f37498ac057c8cb0`; Vercel `dpl_7qv5q6VTxRcB1DEU1nCU4nAuefAn` READY on app.opsapp.co. Initial 13 OAuth/bearer test files passed, 561 tests. Live metadata advertises active v14 including `ops.customers.prepare`; Canpro must send explicit scopes and remain within the twenty frozen v2 reads. Live userinfo path returns 404. SQL catalog read confirms the exact existing registration function accepts only Claude, ChatGPT and Codex callback families.
