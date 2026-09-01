# OPS MCP Payroll Projection — Phase 6 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `custom-skills:executing-plans` to implement this plan task-by-task.

**Goal:** Add one dormant, read-only `check_payroll_readiness` MCP capability that answers golden task 10 with exact OPS-owned cash and obligations, actual payer-delay evidence, conservative scenarios, and fail-closed data-quality disclosure.

**Architecture:** A strict target-date tool authorizes company-wide finance reads, re-resolves MCP authority, and calls one bounded service-role-only PostgreSQL RPC. PostgreSQL owns tenant isolation, source selection, durable net settlement chronology, bounds, and snapshot integrity; TypeScript owns the frozen ISO currency exponent map, exact minor-unit conversion, checked integer totals, recurrence, empirical distributions, scenario math, decisions, item-level attribution, and the response contract. Manifest v14 and exposure v8 add the tool without changing active v2 or prior dormant exposure bytes.

**Tech Stack:** Next.js 15, TypeScript, Zod v4 alias, Vitest, Supabase/PostgreSQL 17, disposable local PostgreSQL, MCP SDK.

**Design System:** N/A — no visual interface changes.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `ops-copywriter:ops-copywriter`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`.

---

### Task 1: Lock the response contract and projection math

**Skills:** test-driven development, OPS copywriter.

**Files:**

- Create: `src/lib/agent-control-plane/contracts/payroll-readiness.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/payroll-readiness.test.ts`
- Create: `src/lib/agent-control-plane/services/payroll-readiness/__tests__/fixtures.ts`
- Create: `src/lib/agent-control-plane/services/payroll-readiness/__tests__/payroll-readiness-service.test.ts`

Write failing behavior tests first for strict target input, target/horizon validation, exact minor units, 24-hour freshness, scheduled coverage, cadence expansion, payroll cutoff, approved reimbursement debt, empirical p25/p50/p75, same-day receivable exclusion, best/base/worst math, decision states, missing payer histories, duplicate identities, balance mismatches, evidence refs, versioning, and prompt safety. Run only these tests and observe missing-module failures. Implement the minimum pure schemas and calculator; rerun to green.

### Task 2: Add the trusted repository and service boundary

**Skills:** test-driven development, Supabase.

**Files:**

- Create: `src/lib/agent-control-plane/services/payroll-readiness/payroll-readiness-repository.ts`
- Create: `src/lib/agent-control-plane/services/payroll-readiness/payroll-readiness-service.ts`
- Create: `src/lib/agent-control-plane/services/payroll-readiness/__tests__/payroll-readiness-repository.test.ts`

Write failing tests for exact RPC arguments, abort propagation, malformed snapshots, stale actor/grant/scope/permission rejection, result size limits, invalid input transport, and unavailable-source transport. Implement the weak-set trusted repository/service, exact manifest/exposure binding, authority re-resolution, and bounded response.

### Task 3: Add dormant manifest v14 and exposure v8

**Skills:** test-driven development, OPS copywriter.

**Files:**

- Create: `src/lib/agent-control-plane/registry/payroll-readiness-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/payroll-readiness-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify related runtime, dispatch, exposure, and server tests.

Write failing registry and runtime tests first. Add the capability, manifest resolver, domain method, runtime wiring, and immutable v8 exposure containing the four Phase 5 tools plus `check_payroll_readiness`. Prove active v2 identity and exact v1-v7 stability.

### Task 4: Add and prove the PostgreSQL read contract

**Skills:** Supabase, Postgres best practices, test-driven development.

**Files:**

- Create: `supabase/migrations/20260901190000_agent_payroll_readiness.sql`
- Create: `src/lib/agent-control-plane/services/payroll-readiness/__tests__/payroll-readiness-sql-contract.test.ts`
- Create: `tests/sql/agent-payroll-readiness-setup.sql`
- Create: `tests/sql/agent-payroll-readiness-runtime.sql`
- Create: `tests/integration/agent-control-plane/payroll-readiness-postgres-runtime.test.ts`
- Modify: `src/lib/types/database.types.ts`

Write SQL-contract and runtime tests first. Add nullable obligation metadata and coverage fields, safe constraints, targeted partial/composite indexes, the read-domain revision and triggers, exact authority assertion, and bounded snapshot RPC. Prove wrong tenant/grant/scope/permission/revision failures, exact settlement chronology, provider-identity integrity flags, source bounds, index use, replay, migration parity, and service-role-only execute authority on PostgreSQL 17.

### Task 5: Verify, review, document, and commit

**Skills:** verification before completion, requesting code review.

Run focused tests after each red-green cycle, then the full agent-control-plane suite, broad test suite, TypeScript, lint, format check, migration parity, disposable PostgreSQL 17 runtime, and production build under Node 22. Request a read-only independent review of authority, cash math, temporal correctness, data completeness, prompt safety, and test evidence; repair valid findings test-first and rerun all gates. Update the Software Bible with exact schema, behavior, revisions, evidence, and dormant/local-only state. Commit OPS-Web and Bible atomically on their isolated Phase 6 branches. Do not push, deploy, apply the migration, create grants/clients, or activate exposure v8.
