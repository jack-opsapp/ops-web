# MCP v3 Synthetic Canary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add one expiring, exact-subject production canary lane that can issue and exercise an inactive v3 day-closeout grant while public discovery, registration, and ordinary consent remain read-only v2.

**Architecture:** A private Supabase binding is the only source of canary eligibility. Consent, code exchange, refresh, bearer resolution, and routine authority independently recheck the same exact client/user/company/revision/expiry facts; ordinary OAuth continues resolving the active immutable v2 exposure. A local loopback acceptance command provisions the dedicated client and binding, performs real signed-in PKCE consent without logging credentials, runs the existing host contract, then revokes and independently proves cleanup.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Zod, Supabase/PostgreSQL 17, Firebase-authenticated consent, OAuth 2.0 authorization code + PKCE, MCP JSON-RPC, Vitest, real PostgreSQL rollback fixtures.

**Design System:** `.interface-design/system.md` exists, but this phase has no UI or styling change. The existing consent panel and labels are reused unchanged.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `superpowers:verification-before-completion`.

---

### Task 1: Private canary binding and database authority predicate

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices` (`security-privileges`, `security-rls-basics`, `schema-foreign-key-indexes`, `schema-constraints`, `lock-short-transactions`, `lock-deadlock-prevention`).

**Files:**
- Create: `tests/sql/mcp-v3-synthetic-canary-runtime.sql`
- Create: `supabase/migrations/20260831190000_mcp_v3_synthetic_canary.sql`
- Create: `tests/unit/supabase/mcp-v3-synthetic-canary-migration.test.ts`
- Modify: `.github/workflows/ci.yml`

**Design tokens:** N/A — database only.

**Step 1: Write the failing PostgreSQL fixture**

Create a rollback-only fixture that mirrors the exact current production prerequisites, includes two companies, two users, active/inactive memberships, v2/v3 clients, and literal expected results. Assert:

- `private.mcp_oauth_canary_bindings` has RLS enabled, no policies, no direct grants, a UUID primary key, unique client binding, and indexes covering every foreign key;
- provisioning accepts only exact v3 + the v3 consent catalogue, an enabled client, active exact membership, and an expiry within the fixed bound;
- identical provisioning replays one row; any changed user/company/client/revision/expiry conflicts;
- cross-user, cross-company, cross-client, inactive membership, disabled client, expired binding, and disabled binding resolve false;
- disable is idempotent and revokes/de-leases only the exact bound v3 routine/grant family;
- the active v2 path and historical v1/v2 grants remain eligible without a canary row; and
- every function is `SECURITY DEFINER`, non-leakproof, search-path pinned, and executable only by `postgres` and `service_role`.

**Step 2: Run the SQL fixture and verify RED**

Run:

```bash
psql "$OPS_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/mcp-v3-synthetic-canary-runtime.sql
```

Expected: FAIL because the table and canary RPCs do not exist.

**Step 3: Add the source-contract test and verify RED**

The Vitest file must prove the migration contains executable effects, not prose: it imports the migration into the existing temporary PostgreSQL contract harness or asserts parsed function signatures/ACLs through the established migration-test utilities. It must name the realistic breaks each assertion catches.

Run:

```bash
node node_modules/vitest/vitest.mjs run tests/unit/supabase/mcp-v3-synthetic-canary-migration.test.ts
```

Expected: FAIL because the migration is absent.

**Step 4: Implement the minimal migration**

Add the private table and narrow functions:

- `public.provision_mcp_oauth_canary_as_system(...)`
- `public.resolve_mcp_oauth_canary_as_system(...)`
- `public.disable_mcp_oauth_canary_as_system(...)`

Use exact immutable revision checks, `clock_timestamp()` expiry checks, one statement or consistent client→binding→grant→routine lock order, no external work inside transactions, explicit revokes, and covering indexes for every foreign key. The resolver returns only a boolean/exposure fact set needed by the server; it never returns names or business data.

Update the existing grant mint, refresh rotation, bearer resolution, grant/token/client revocation, and day-closeout authority functions in this forward migration so v3 requires a current exact canary while v1/v2 behavior remains unchanged. Refresh failure on an expired/disabled canary revokes the exact family atomically. Canary disablement disables and de-leases the exact synthetic routine.

**Step 5: Run SQL and source contracts to verify GREEN**

Run both commands from Steps 2 and 3. Expected: PASS with rollback leaving no local fixture state.

**Step 6: Register the real SQL fixture in CI**

Add it immediately after the existing day-closeout configuration fixture. Preserve Node 22 and the current PostgreSQL service.

**Step 7: Commit**

```bash
git add tests/sql/mcp-v3-synthetic-canary-runtime.sql supabase/migrations/20260831190000_mcp_v3_synthetic_canary.sql tests/unit/supabase/mcp-v3-synthetic-canary-migration.test.ts .github/workflows/ci.yml
git commit -m "feat(mcp): add exact synthetic v3 canary authority"
```

### Task 2: Server-owned exposure resolver

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/agent-control-plane/mcp/oauth/canary.ts`
- Create: `src/lib/agent-control-plane/mcp/oauth/__tests__/canary.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/oauth/grants.ts`
- Modify: `src/lib/agent-control-plane/mcp/oauth/index.ts`

**Design tokens:** N/A — server-only.

**Step 1: Write failing resolver tests**

Use literal complete RPC rows. Prove the wished-for API:

```ts
resolveOAuthExposureForSubject({ rpcClient, client, userId, companyId })
```

returns active v2 for an ordinary active-v2 client, returns v3 only for one exact current binding, and returns `null` rather than falling back when a client is pinned to inactive v3 but its binding is missing, expired, disabled, malformed, cross-tenant, or unavailable. Prove request input cannot select a revision and RPC failures fail closed.

**Step 2: Run and verify RED**

```bash
node node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/mcp/oauth/__tests__/canary.test.ts
```

Expected: FAIL because the resolver does not exist.

**Step 3: Implement the minimal resolver and typed RPC adapter**

Resolve the client's stored immutable revision first. Active v2 uses the existing active object. Inactive v3 requires the exact database predicate and then resolves the existing catalogue object. Unknown revisions and every malformed row return null or throw the existing opaque store error at the correct boundary.

**Step 4: Run and verify GREEN**

Run the Step 2 command and the existing OAuth grants tests. Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/agent-control-plane/mcp/oauth/canary.ts src/lib/agent-control-plane/mcp/oauth/__tests__/canary.test.ts src/lib/agent-control-plane/mcp/oauth/grants.ts src/lib/agent-control-plane/mcp/oauth/index.ts
git commit -m "feat(mcp): resolve exact canary exposure"
```

### Task 3: Consent context and decision use the exact canary

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Modify: `tests/unit/mcp/oauth-consent-routes.test.ts`
- Modify: `src/app/api/mcp/oauth/authorize/context/route.ts`
- Modify: `src/app/api/mcp/oauth/authorize/decision/route.ts`

**Design tokens:** N/A — existing consent UI and copy remain byte-identical.

**Step 1: Add failing route tests**

Prove:

- ordinary DCR/client consent remains the exact v2 scopes, labels, and revision;
- the exact authenticated canary user/company/client receives only the seven v3 scopes and existing v3 labels;
- context and decision independently recheck the binding;
- a missing/expired/disabled/cross-user/cross-company/cross-client binding returns the existing opaque `invalid_request` and never falls back to v2;
- disabling the binding between preview and decision blocks code creation; and
- no response discloses whether a canary row exists.

**Step 2: Run and verify RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/mcp/oauth-consent-routes.test.ts
```

Expected: FAIL on the canary cases while existing v2 cases stay green.

**Step 3: Implement minimal route changes**

Fetch the registered client after authentication, call the shared subject resolver, and feed the returned immutable exposure into existing scope and consent-catalog functions. Keep every current validation, rate limit, no-store header, one-time preview, redirect rule, and opaque error unchanged.

**Step 4: Run and verify GREEN**

Run the Step 2 command plus the OAuth client/scope-catalog suites. Expected: PASS.

**Step 5: Commit**

```bash
git add tests/unit/mcp/oauth-consent-routes.test.ts src/app/api/mcp/oauth/authorize/context/route.ts src/app/api/mcp/oauth/authorize/decision/route.ts
git commit -m "feat(mcp): consent one exact v3 canary"
```

### Task 4: Code exchange, refresh, and bearer reauthorization

**Skills:** `superpowers:test-driven-development`, `supabase:supabase-postgres-best-practices`.

**Files:**
- Modify: `tests/unit/mcp/oauth-routes.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts`
- Modify: `src/app/api/mcp/oauth/token/route.ts`
- Modify: `src/lib/agent-control-plane/mcp/bearer.ts`

**Design tokens:** N/A — protocol only.

**Step 1: Add failing token and bearer tests**

Prove exact v3 canary code exchange, one-tool discovery, refresh rotation, spent-token family revocation, and current binding recheck on every bearer. Prove binding expiry/disable between code and exchange, between exchange and bearer, and between refreshes returns the existing opaque error and no token. Re-run existing v1/v2 grant-pinned fixtures byte-for-byte.

**Step 2: Run and verify RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/mcp/oauth-routes.test.ts src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts
```

Expected: FAIL only on the new canary assertions.

**Step 3: Implement minimal exchange and bearer changes**

Authorization-code exchange resolves from the consumed code's persisted subject facts and passes the exact exposure into the database mint transaction. Refresh remains grant-pinned and lets the database atomically enforce the canary before rotating. Bearer RPC resolution supplies the active revision required by the database predicate; no request-controlled revision enters any call.

**Step 4: Run and verify GREEN**

Run the Step 2 command plus all OAuth grants tests. Expected: PASS.

**Step 5: Commit**

```bash
git add tests/unit/mcp/oauth-routes.test.ts src/lib/agent-control-plane/mcp/__tests__/bearer.test.ts src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts src/app/api/mcp/oauth/token/route.ts src/lib/agent-control-plane/mcp/bearer.ts
git commit -m "feat(mcp): enforce canary through token lifetime"
```

### Task 5: Routine handoff loses authority with the canary

**Skills:** `superpowers:test-driven-development`, `supabase:supabase-postgres-best-practices`.

**Files:**
- Modify: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-config.test.ts`
- Modify: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-service.test.ts`
- Modify: `src/lib/agent-control-plane/services/day-closeout/day-closeout-routine-config.ts`
- Modify: `src/lib/agent-control-plane/mcp/actor-reauthorization.ts`

**Design tokens:** N/A — server-only.

**Step 1: Add failing authority-loss tests**

Prove one exact canary grant can create/disable a synthetic routine through the existing signed-in settings boundary while the global worker is off. Expiry, disablement, grant/token/client revoke, membership loss, and permission loss must reject before business reads and disable/de-lease the exact routine.

**Step 2: Run and verify RED**

```bash
node node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-config.test.ts src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-service.test.ts
```

Expected: FAIL on canary loss.

**Step 3: Thread current active revision into existing trusted calls**

Pass only the server-owned active revision needed by the SQL predicate. Preserve the current actor/company/client/grant binding and all safe-disable behavior.

**Step 4: Run and verify GREEN**

Run the Step 2 command and both real SQL fixtures. Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-config.test.ts src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-service.test.ts src/lib/agent-control-plane/services/day-closeout/day-closeout-routine-config.ts src/lib/agent-control-plane/mcp/actor-reauthorization.ts
git commit -m "feat(mcp): bind routines to current canary authority"
```

### Task 6: Privacy-safe provisioning, consent, acceptance, and cleanup command

**Skills:** `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/agent-control-plane/mcp/canary-acceptance.ts`
- Create: `src/lib/agent-control-plane/mcp/__tests__/canary-acceptance.test.ts`
- Create: `scripts/mcp-v3-canary-acceptance.ts`
- Modify: `scripts/mcp-day-closeout-host-acceptance.ts`
- Modify: `package.json`

**Design tokens:** N/A — local operator command only.

**Step 1: Add failing lifecycle tests**

Use a real loopback HTTP server and fake external fetch boundary to prove fresh S256 PKCE/state, exact callback matching, timeout, state mismatch, denied consent, non-JSON, provisioning conflict, orphan-client disablement, aggregate-only output, in-memory token handling, refresh/reuse proof, grant/binding/client cleanup, and cleanup on every failure path. Tests must assert stdout/stderr never contain tokens, codes, verifier, redirect URL, company/user/client IDs, or business strings.

**Step 2: Run and verify RED**

```bash
node node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/mcp/__tests__/canary-acceptance.test.ts
```

Expected: FAIL because the lifecycle orchestrator does not exist.

**Step 3: Implement the minimal orchestrator and CLI**

The CLI accepts service secrets and exact IDs only through environment variables, binds loopback before registration, opens the consent URL without printing it, keeps credentials in memory, runs the existing host acceptance validator, proves refresh reuse and revocation, and always cleans up in `finally`. It refuses the named `PERSONA TEST POOL` company and any preflight that cannot prove a dedicated synthetic tenant and active exact operator authority.

**Step 4: Run and verify GREEN**

Run the Step 2 command and existing host-acceptance tests. Expected: PASS with privacy assertions.

**Step 5: Commit**

```bash
git add src/lib/agent-control-plane/mcp/canary-acceptance.ts src/lib/agent-control-plane/mcp/__tests__/canary-acceptance.test.ts scripts/mcp-v3-canary-acceptance.ts scripts/mcp-day-closeout-host-acceptance.ts package.json
git commit -m "feat(mcp): automate synthetic canary acceptance"
```

### Task 7: Full release-candidate verification and Bible update

**Skills:** `custom-skills:executing-plans`, `supabase:supabase`, `superpowers:verification-before-completion`.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-mcp-v3-synthetic-canary-design.md`
- Modify in isolated Bible worktree: `specs/2026-08-30-ops-mcp-day-closeout-foundation-zero.md`

**Design tokens:** N/A.

**Step 1: Run the complete focused suite**

Run real SQL contracts, all MCP/OAuth/day-closeout/routine tests, typecheck, Prettier check, repository lint, and a clean Node 22 production build. Record exact counts and inherited unrelated warnings separately.

**Step 2: Prove the release diff**

Verify:

- public active constant remains v2;
- public metadata still serializes exactly 20 scopes;
- public DCR cannot register v3;
- no canary row or environment toggle exists by default;
- all new tables/functions are private/service-role-only;
- no send/payment/issue/delete/mass capability entered v3; and
- no token, identifier, or business content can enter logs or artifacts.

**Step 3: Update the Bible**

Document the exact dormant canary contract, migration, safety proof, cost posture, live release order, consent action Jackson must take, and remaining activation gates. Do not claim production or host acceptance until independently observed.

**Step 4: Commit documentation**

```bash
git add docs/superpowers/specs/2026-08-31-mcp-v3-synthetic-canary-design.md
git commit -m "docs(mcp): record canary release candidate"
```

Commit the Bible update separately in its isolated repository.

**Step 5: Stop at the release gate**

Do not push, apply the migration, deploy, provision a canary, activate v3, or enable the worker without Jackson's explicit release permission. Report the verified local candidate and the single next action in plain English.
