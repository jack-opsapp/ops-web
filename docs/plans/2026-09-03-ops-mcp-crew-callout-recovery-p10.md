# OPS MCP Phase 10 — Crew Call-Out Recovery Implementation Plan

> Execute end-to-end in the isolated Phase 10 worktrees. No real assignment, schedule, calendar, draft, or message mutation is permitted during implementation or verification.

**Goal:** Ship a production-deployed but dormant, deterministic crew call-out recovery prepare capability that fails closed when identity, authority, availability, qualification evidence, or recipients are not provable.

**Architecture:** Extend `OpsAgentDomainService` with a strict contract and pure deterministic planner. A service-role-only Supabase RPC assembles one tenant-scoped, grant-pinned source snapshot and a replay assertion revalidates it after computation. Register the capability in manifest v18 and dormant exposure v12 while preserving active production exposure v2.

**Tech:** TypeScript, Zod v4, Vitest, Next.js 15, PostgreSQL/Supabase, SQL runtime harness, Vercel.

---

### Task 1: Lock the contract with failing tests

**Files:**

- Create: `src/lib/agent-control-plane/contracts/crew-callout-recovery.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/crew-callout-recovery.test.ts`
- Modify: `src/lib/agent-control-plane/contracts/index.ts`

Write and run failing tests for strict identity/date input, exact civil-window output, deterministic hashes, smallest same-day assignment, overlap exclusion, role/work-history truth, reschedule fallback, uncovered reasons, exact recipient drafts, and zero effects. Implement only enough pure contract logic to make each case pass, then refactor under green tests.

### Task 2: Register dormant v18/v12 authority

**Files:**

- Create: `src/lib/agent-control-plane/registry/crew-callout-recovery-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/crew-callout-recovery-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: relevant registry and OAuth consent tests

Add the exact high-risk prepare scopes and all-scope app permissions, publish manifest v18 and dormant exposure v12, preserve v2 as the active production exposure, and add consent labels without broadening any existing client or grant.

### Task 3: Build the authoritative read boundary test-first

**Files:**

- Create: `src/lib/agent-control-plane/services/crew-callout-recovery/crew-callout-recovery-repository.ts`
- Create: `src/lib/agent-control-plane/services/crew-callout-recovery/__tests__/crew-callout-recovery-repository.test.ts`
- Create: `src/lib/agent-control-plane/services/crew-callout-recovery/__tests__/crew-callout-recovery-sql-contract.test.ts`
- Create: `supabase/migrations/*_agent_crew_callout_recovery_preview.sql`

Specify failing repository and migration contract tests first. Add a service-role-only read RPC and exact replay assertion with empty `search_path`, grant/client/consent pinning, current actor permission proof, tenant/entity enforcement, canonical source hashing, strict bounds, and zero business writes. Reuse existing availability-source indexes; add an index only when the exact production access path lacks one.

### Task 4: Wire service reauthorization and transport

**Files:**

- Create: `src/lib/agent-control-plane/services/crew-callout-recovery/crew-callout-recovery-service.ts`
- Create: `src/lib/agent-control-plane/services/crew-callout-recovery/__tests__/crew-callout-recovery-service.test.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify: focused runtime/dispatch tests

Test and implement trusted repository/service construction, pre-read reauthorization, post-compute reauthorization, exact source replay, prompt-safe output bounds, stable error mapping, and host-neutral dispatch.

### Task 5: Prove SQL behavior and replay safety

**Files:**

- Create: `tests/sql/agent-crew-callout-recovery-schema-setup.sql`
- Create: `tests/sql/agent-crew-callout-recovery-runtime.sql`
- Create: `tests/integration/agent-control-plane/crew-callout-recovery-postgres-runtime.test.ts`

Run isolated PostgreSQL tests for exact/ambiguous identity, tenant isolation, actor deactivation, permission and grant drift, time off, working hours, conflicting tasks/site visits/personal events, role evidence, same-task history, inaccessible linked projects, source bounds, deterministic replay, stale source rejection, function privilege closure, and zero writes.

### Task 6: Update the Bible and release record

**Files:**

- Modify: `ops-software-bible/03_DATA_ARCHITECTURE.md`
- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md`
- Modify: `ops-software-bible/07_SPECIALIZED_FEATURES.md`
- Modify: `ops-software-bible/10_JOB_LIFECYCLE_AND_DATA_RELATIONSHIPS.md`
- Create: `ops-software-bible/specs/2026-09-03-ops-mcp-crew-callout-recovery-p10.md`
- Mirror the applied migration under `ops-software-bible/migrations/`

Document exact inputs, evidence limits, planner policy, draft rules, future mutation boundary, v18/v12 dormancy, current v2 production exposure, live ledger, deployment, independent readback, and the absence of new paid services. Correct the stale Phase 9 “unreleased” wording while preserving its release evidence.

### Task 7: Verify, integrate, migrate, deploy, and read back

Run focused unit/integration/SQL tests, formatter/lint/typecheck for changed paths, the production build, and a diff/security review. Commit atomic changes in both isolated worktrees. Apply the additive migration to production, independently prove function shape/privileges and zero business mutation, fast-forward the production branches, push both repositories, observe the Vercel production deployment, then read back public OAuth/MCP metadata and unauthenticated MCP behavior to prove active exposure remains v2/read-only. Record exact commit, ledger, deployment, and live evidence in the Bible.
