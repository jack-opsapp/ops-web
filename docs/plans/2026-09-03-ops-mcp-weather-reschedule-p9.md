# OPS MCP Weather Reschedule Phase 9 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Build the dormant golden task “Rain Thursday. Slide the outdoor work, keep the indoor job, tell everyone.” as an exact weather-bound schedule proposal plus complete recipient-bound drafts, with zero schedule or communication side effects.

**Architecture:** Add one immutable `prepare_weather_reschedule` capability on capability manifest v17 and dormant MCP exposure v11. A service-role-only PostgreSQL boundary revalidates the current actor, tenant, OAuth grant, exposure, manifest, scopes, granular edit/read permissions, company settings, target schedule, explicit outdoor task types, fresh project forecasts, conflicts, assignments, and exact primary recipients in one bounded snapshot. Server-owned TypeScript groups project work, finds the first clear conflict-free date under `rain-reschedule-policy:v1`, builds deterministic drafts, seals the exact preview, and immediately reasserts both authority and the aggregate source revision before returning. Active customer exposure remains byte-for-byte v2; no task, project, calendar, provider draft, message, or delivery row is written.

**Tech Stack:** Next.js 15 server TypeScript, Zod v4, Vitest, Supabase/PostgreSQL 17, SHA-256 canonical JSON proofing.

**Design System:** `.interface-design/system.md` reviewed; N/A for this backend-only capability because no UI or styling changes are permitted.

**Required Skills:** `custom-skills:writing-plans`, `custom-skills:executing-plans`, `superpowers:using-git-worktrees`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `supabase:supabase`, `ops-copywriter:ops-copywriter`.

---

### Task 1: Freeze the Phase 9 contract and scheduling policy

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for every returned draft and explanation.

**Files:**
- Create: `src/lib/agent-control-plane/contracts/weather-reschedule.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/weather-reschedule.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests for the strict date-only input, exact source snapshot schemas, rain thresholds, 12-hour freshness, explicit fact/forecast/proposal/draft separation, project-group scheduling, interval and crew/project collision rules, stable canonical ordering, exact draft correspondence, prompt-safety markers, stable SHA-256 proposal seals, bounds, and zero effects.
2. Run the focused contract test and verify it fails because the contract does not exist.
3. Implement strict schemas and pure deterministic projection functions. Accept only `target_date`; derive every other value from current OPS sources.
4. Run the focused contract test and verify it passes.
5. Commit as `feat(mcp): define weather reschedule contract`.

### Task 2: Register immutable capability v17 and dormant exposure v11

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for consent labels, descriptions, and server instructions.

**Files:**
- Create: `src/lib/agent-control-plane/registry/weather-reschedule-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/weather-reschedule-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-scope-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify: `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/domain-dispatch.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts`
- Modify: `tests/unit/settings/connected-agent-scope-labels.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests that require additive manifest v17/exposure v11, the two exact prepare scopes and supporting read scopes, current all-scope schedule/client/inbox/project/task authority, a single prepare-only tool, closed-world/idempotent annotations, no commit/send method, and unchanged v1–v10 plus active v2 bytes.
2. Run the focused registry, dispatch, grant-pinning, server, and consent tests and verify the new expectations fail.
3. Remint v16 into immutable v17, append the capability, append v11 as v10 plus the new tool/scopes, add exact consent labels and instructions, and preserve every historical revision.
4. Run the focused tests and verify they pass.
5. Commit as `feat(mcp): register dormant weather reschedule exposure`.

### Task 3: Build the authorized snapshot repository

**Skills:** Use `supabase:supabase` and `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/agent-control-plane/services/weather-reschedule/weather-reschedule-repository.ts`
- Create: `src/lib/agent-control-plane/services/weather-reschedule/__tests__/weather-reschedule-repository.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests for exact RPC names and arguments, grant/manifest/exposure/capability bindings, caller-abort propagation, strict invalid-envelope rejection, database error normalization, immutable snapshots, observed-time equality, target-date equality, and independent final source/authority assertion.
2. Run the focused repository test and verify it fails because the adapter does not exist.
3. Implement the bounded RPC adapter. Pass no caller-selected company, actor, permission, outdoor type, recipient, forecast, or destination date.
4. Run the focused test and verify it passes.
5. Commit with Task 4 so no unreferenced production adapter lands alone.

### Task 4: Build the deterministic prepare service

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for exact deterministic email drafts and error explanations.

**Files:**
- Create: `src/lib/agent-control-plane/services/weather-reschedule/weather-reschedule-service.ts`
- Create: `src/lib/agent-control-plane/services/weather-reschedule/__tests__/fixtures.ts`
- Create: `src/lib/agent-control-plane/services/weather-reschedule/__tests__/weather-reschedule-service.test.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/runtime.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests for the exact golden task, current-actor reauthorization, cross-tenant rejection, stale/missing/malformed weather, free-text injection, invalid settings, unsupported task dependencies, locked/recurring/paired work, missing or invalid crew, schedule collisions, recipient ambiguity/suppression, incomplete correspondence, source drift, abort/timeout, output bounds, replay stability, exact project grouping, correct indoor retention, correct draft wording, and every prohibited effect remaining false/zero.
2. Run the focused service/runtime tests and verify they fail for the missing service.
3. Implement the trusted service: authorize through manifest-owned policy; read one exact snapshot; group by project; choose the first clear conflict-free date; build fact/forecast/proposal/draft projections; enforce one draft per recipient/project with complete item coverage; hash the preview; and reauthorize plus assert the source revision immediately before return.
4. Run the focused service/runtime tests and verify they pass.
5. Commit Tasks 3–4 as `feat(mcp): prepare weather reschedule previews`.

### Task 5: Add the PostgreSQL 17 authority and snapshot boundary

**Skills:** Use `supabase:supabase` and `superpowers:test-driven-development`.

**Files:**
- Create via `supabase migration new agent_weather_reschedule_preview`: `supabase/migrations/<generated>_agent_weather_reschedule_preview.sql`
- Create: `src/lib/agent-control-plane/services/weather-reschedule/__tests__/weather-reschedule-sql-contract.test.ts`
- Create: `tests/integration/agent-control-plane/weather-reschedule-postgres-runtime.test.ts`
- Create: `tests/sql/agent-weather-reschedule-runtime.sql`
- Create: `tests/sql/agent-weather-reschedule-replay-runtime.sql`

**Design tokens:** N/A — backend-only.

1. Discover the installed Supabase CLI migration commands, then create the migration through the CLI.
2. Write failing source-contract and disposable PostgreSQL 17 tests for service-role-only ACLs, fixed search paths, exact current actor/grant/client/exposure/manifest/scope/label/permission checks, tenant isolation, explicit outdoor IDs, local-date and interval correctness, current project/task/client/sub-client/user rows, email normalization/suppression/shared-address rejection, fresh numeric Open-Meteo evidence, bounded rows and strings, source hashing, drift assertion, replay stability, zero business writes, and rollback-clean reruns.
3. Run the focused SQL tests and verify they fail before the migration exists.
4. Implement the stable security-definer snapshot and assertion RPCs plus private helpers. Revoke `PUBLIC`, `anon`, and `authenticated`; grant only `service_role`; schema-qualify all objects; cap every aggregate; and assert catalog shape/ACLs inside the migration.
5. Run the SQL contract test and both fresh PostgreSQL 17 runtime/replay proofs.
6. Re-run Supabase advisors as a read-only production baseline and record that Phase 9 was not applied.
7. Commit as `feat(mcp): secure weather reschedule snapshot boundary`.

### Task 6: Document and mirror the contract

**Skills:** Use `custom-skills:executing-plans`; use `ops-copywriter:ops-copywriter` only for quoted user-facing copy.

**Files:**
- Create in Bible: `specs/2026-09-03-ops-mcp-weather-reschedule-vertical.md`
- Modify in Bible: `04_API_AND_INTEGRATION.md`
- Modify in Bible: `07_SPECIALIZED_FEATURES.md`
- Modify in Bible: `10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Mirror byte-for-byte in Bible: `migrations/<generated>_agent_weather_reschedule_preview.sql`

**Design tokens:** N/A — backend-only.

1. Document the exact input/output, rain policy, schedule algorithm, recipient rule, permission/scopes, tenant boundary, forecast freshness, revision binding, prompt safety, failure modes, zero effects, and dormant gates.
2. Update the API, specialized-feature, and scheduling ledgers with the prepare-only behavior and explicit future mutation/send boundary.
3. Verify the migration mirror with SHA-256.
4. Commit after all OPS-Web commits as `docs(mcp): define weather reschedule vertical`.

### Task 7: Verify the whole dormant vertical

**Skills:** Use `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, and `superpowers:finishing-a-development-branch`.

**Files:**
- Verify all Phase 9 files and untouched active v2 contract.

**Design tokens:** N/A — backend-only.

1. Run every Phase 9 contract, registry, grant-pinning, dispatch, repository, service, runtime, SQL source-contract, and disposable PostgreSQL 17 test from fresh processes.
2. Run inherited v1–v10 immutability and active-v2 exposure tests.
3. Run targeted TypeScript, lint, and formatting checks for the Phase 9 dependency graph.
4. Request an independent code review and resolve all valid findings.
5. Inspect final diffs, confirm no secrets/artifact/root pollution, verify migration mirror hashes, and confirm both branches are clean after commits.
6. Read production again without mutation: active MCP remains v2 and v11 has zero clients and grants because no production migration, deployment, registration, grant, or activation occurred.
7. Report local implementation, local commits, production migration, deployment, grant/activation, runtime proof, and customer-live status separately. Do not push, deploy, migrate production, create a v11 client/grant, or activate v11.
