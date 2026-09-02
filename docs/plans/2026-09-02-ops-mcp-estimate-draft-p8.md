# OPS MCP Estimate Draft Phase 8 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Build the dormant golden task “Quote [new lead] like the [past job], plus 8%” as an exact, evidence-backed draft-estimate preview that never creates, numbers, issues, approves, publishes, or sends an estimate.

**Architecture:** Add one immutable `prepare_estimate_from_past_job` capability on capability manifest v16 and dormant MCP exposure v10. A service-role-only PostgreSQL function revalidates the current actor, tenant, OAuth grant, exposure, manifest, scopes, granular permissions, target lead, source approved/converted estimate, active client, current default tax, and bounded line-item snapshot in one statement; server-owned TypeScript then performs checked minor-unit arithmetic, canonical hashing, output bounds, and an immediate final authority assertion before returning an ephemeral preview. The active customer surface remains byte-for-byte v2, and Phase 8 adds no commit/send path or persisted business artifact.

**Tech Stack:** Next.js 15 server TypeScript, Zod v4, Vitest, Supabase/PostgreSQL 17, SHA-256 canonical JSON proofing.

**Design System:** `.interface-design/system.md` reviewed; N/A for this backend-only capability because no UI or styling changes are permitted.

**Required Skills:** `custom-skills:writing-plans`, `custom-skills:executing-plans`, `superpowers:using-git-worktrees`, `superpowers:test-driven-development`, `superpowers:verification-before-completion`, `supabase:supabase`, `ops-copywriter:ops-copywriter`.

---

### Task 1: Freeze the Phase 8 contract and arithmetic

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for every returned customer-facing label or explanation.

**Files:**
- Create: `src/lib/agent-control-plane/contracts/estimate-draft.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/estimate-draft.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests for strict UUID inputs, exact canonical decimal percentage, fixed currency metadata, immutable bounds, half-away-from-zero percentage arithmetic, per-line discount/minimum/optional/tax behavior, overflow rejection, canonical sort order, prompt-safety markers, stable SHA-256 preview seals, and explicit zero-effect fields.
2. Run `npx vitest run src/lib/agent-control-plane/contracts/__tests__/estimate-draft.test.ts` and verify it fails because the contract does not exist.
3. Implement strict schemas and pure checked-integer functions. Accept only `target_opportunity_id`, `source_estimate_id`, and canonical `increase_percent`; derive all tenant, actor, customer, tax, source, and pricing facts from OPS.
4. Run the focused contract test and verify it passes.
5. Commit only the contract and its test as `feat(mcp): define exact estimate draft contract`.

### Task 2: Register immutable capability v16 and dormant exposure v10

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for the exact consent label and tool description.

**Files:**
- Create: `src/lib/agent-control-plane/registry/estimate-draft-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/estimate-draft-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-scope-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/domain-dispatch.test.ts`
- Modify: `tests/unit/settings/connected-agent-scope-labels.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests that require additive manifest v16/exposure v10, `ops.financials.prepare`, exact read scopes, `estimates.create` plus read-only supporting permissions, a single prepare-only tool, idempotent/closed-world annotations, no commit method, and unchanged active v2 bytes.
2. Run the focused registry, dispatch, and consent tests and verify the new expectations fail.
3. Remint v15 into immutable v16, append the available prepare definition, add v10 as v9 plus the new tool/scopes, add the exact consent label, and preserve historical revisions without mutation.
4. Run the focused registry, dispatch, and consent tests and verify they pass.
5. Commit the registry slice as `feat(mcp): register dormant estimate draft exposure`.

### Task 3: Build the authorized source repository

**Skills:** Use `supabase:supabase` and `superpowers:test-driven-development`.

**Files:**
- Create: `src/lib/agent-control-plane/services/estimate-draft/estimate-draft-repository.ts`
- Create: `src/lib/agent-control-plane/services/estimate-draft/__tests__/estimate-draft-repository.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing repository tests for the exact RPC name/arguments, caller-abort propagation, invalid RPC envelopes, database error normalization, immutable snapshots, and an independent final authority assertion.
2. Run the repository test and verify it fails because the repository does not exist.
3. Implement one bounded RPC adapter that passes the authenticated actor/grant/exposure/manifest/capability tuple and exact source/target IDs; never pass a caller-selected company, permission, tax rate, customer, or totals.
4. Run the repository test and verify it passes.
5. Commit the repository slice with the service in Task 4 so no unreferenced production adapter lands alone.

### Task 4: Build the deterministic prepare service

**Skills:** Use `superpowers:test-driven-development`; use `ops-copywriter:ops-copywriter` for terse result explanations.

**Files:**
- Create: `src/lib/agent-control-plane/services/estimate-draft/estimate-draft-service.ts`
- Create: `src/lib/agent-control-plane/services/estimate-draft/__tests__/fixtures.ts`
- Create: `src/lib/agent-control-plane/services/estimate-draft/__tests__/estimate-draft-service.test.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`
- Modify: `src/lib/agent-control-plane/mcp/__tests__/runtime.test.ts`

**Design tokens:** N/A — backend-only.

1. Write failing tests for current-actor reauthorization, cross-tenant rejection, inactive/merged/deleted target rejection, source status and target-client integrity, ambiguous/default-tax failure, source flag inconsistencies, line bounds, source drift, abort/timeout, output bounds, two-call replay stability, injection-marked business text, current-tax application, exact totals, source provenance, and every prohibited side effect remaining false/zero.
2. Run the focused service/runtime tests and verify they fail for the missing service.
3. Implement the service as a trusted composition-root dependency. Authorize through manifest-owned scopes/permissions, fetch the one-statement snapshot, calculate only from server-owned facts, build canonical evidence and totals, hash the preview, recheck current authority immediately before return, and expose no persistence or commit method.
4. Run the focused service/runtime tests and verify they pass.
5. Commit Tasks 3–4 as `feat(mcp): prepare estimates from authorized history`.

### Task 5: Add the PostgreSQL 17 authority and snapshot boundary

**Skills:** Use `supabase:supabase` and `superpowers:test-driven-development`.

**Files:**
- Create via `supabase migration new agent_estimate_draft_preview`: `supabase/migrations/<generated>_agent_estimate_draft_preview.sql`
- Create: `src/lib/agent-control-plane/services/estimate-draft/__tests__/estimate-draft-sql-contract.test.ts`
- Create: `tests/integration/agent-control-plane/estimate-draft-postgres-runtime.test.ts`
- Create: `tests/sql/agent-estimate-draft-runtime.sql`
- Create: `tests/sql/agent-estimate-draft-replay-runtime.sql`

**Design tokens:** N/A — backend-only.

1. Discover the installed Supabase CLI commands with `npx supabase --help`, `npx supabase migration --help`, and `npx supabase migration new --help`; create the imperative migration through the CLI.
2. Write failing SQL contract and disposable PostgreSQL 17 tests for exact object shape, empty `search_path`, explicit schema qualification, private helper ACLs, service-role-only public RPC ACLs, current actor/grant/client/exposure/manifest/scope/label checks, current granular permissions, same-company joins, status/client/tax/line bounds, no free-text authority, source drift, replay stability, zero writes, and rollback-clean reruns.
3. Run the focused SQL contract/runtime tests and verify they fail before the migration exists.
4. Implement the migration using a security-definer function only where RLS bypass is required, revoke `PUBLIC`, `anon`, and `authenticated`, grant only `service_role`, cap every array/string/result, and assert the function catalog/ACL at migration time.
5. Run the SQL contract test and both fresh PostgreSQL 17 runtime/replay proofs.
6. Run Supabase security/performance advisors against the current live baseline and record that Phase 8 was not applied to production.
7. Commit the database/runtime proof slice as `feat(mcp): secure estimate draft snapshot boundary`.

### Task 6: Document and mirror the contract

**Skills:** Use `custom-skills:executing-plans`; use `ops-copywriter:ops-copywriter` only for quoted user-facing copy.

**Files:**
- Create in Bible: `specs/2026-09-02-ops-mcp-estimate-draft-vertical.md`
- Modify in Bible: `07_SPECIALIZED_FEATURES.md`
- Modify in Bible: `09_FINANCIAL_SYSTEM.md`
- Mirror byte-for-byte in Bible: `supabase/migrations/<generated>_agent_estimate_draft_preview.sql`

**Design tokens:** N/A — backend-only.

1. Write the canonical Phase 8 contract: purpose, input/output, exact selection rules, financial arithmetic, permission/scopes, tenant boundary, drift/idempotency behavior, prompt safety, zero effects, and dormant rollout gates.
2. Update the feature and financial-system ledgers with the new prepare-only behavior and explicit issue-confirmation boundary.
3. Verify the migration mirror with `shasum -a 256` on both copies.
4. Commit Bible changes only after the OPS-Web commits as `docs(mcp): define estimate draft vertical`.

### Task 7: Verify the whole dormant vertical

**Skills:** Use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`.

**Files:**
- Verify all Phase 8 files and untouched active v2 contract.

**Design tokens:** N/A — backend-only.

1. Run every Phase 8 contract, registry, dispatch, repository, service, runtime, SQL contract, and disposable PostgreSQL 17 test from a fresh process.
2. Run the inherited MCP exposure/grant-pinning tests that prove v1–v9 immutability and active v2 behavior.
3. Run a targeted TypeScript check over the Phase 8 dependency graph and formatting/lint checks for changed files.
4. Inspect the final diffs, confirm no secret/artifact/root pollution, and confirm both worktrees are clean after commits.
5. Re-read production without mutation: active MCP advertises the original read-only v2 scope set; v10 has zero clients and grants because no production migration, registration, deployment, or activation occurred.
6. Report separately: local implementation readiness, grant readiness, deployment/migration readiness, and customer-live status. Do not push, deploy, migrate production, register a v10 client, grant v10 authority, or activate v10.
