# OPS MCP Promise Recovery — Phase 4 Implementation Plan

> Execute in this isolated worktree. Keep the live v2 exposure active, keep v3/v4/v5 dormant, apply no migration, and perform no push or deployment.

**Goal:** Deliver the smallest complete read-only `check_customer_reply` vertical for golden task 13 with exact evidence and Foundation Zero fail-closed coverage.

**Architecture:** A new dormant additive MCP read re-resolves the current MCP actor, reads one bounded source-ledger snapshot through a service-role-only SQL RPC, and performs deterministic promise/reply/resolution classification in a transport-neutral service. The authoritative safe source projection replaces stale copied conversation-turn bodies; conversation turns remain hash-bound evidence links. The same migration repairs the existing context/evidence wrapper chain so provider-normalized HTML bodies and stable attachment references survive those active-v2 paths too.

**Stack:** Next.js/TypeScript, Zod 4 MCP contracts, Vitest, Supabase/Postgres security-definer RPCs.

---

### Task 1: Freeze the public contract and classification behavior

**Files:**

- Create: `src/lib/agent-control-plane/contracts/promise-recovery.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/promise-recovery.test.ts`

1. Write failing tests for strict input parsing, all answer states, coverage invariants, exact evidence references, prompt-safe marking, canonical ordering, and forbidden confident negatives from incomplete coverage.
2. Implement the Zod schemas, constants, and inferred types.
3. Run the focused contract test and confirm green.

### Task 2: Build the authoritative source repository

**Files:**

- Create: `src/lib/agent-control-plane/services/promise-recovery/promise-recovery-repository.ts`
- Create: `src/lib/agent-control-plane/services/promise-recovery/__tests__/promise-recovery-repository.test.ts`

1. Write failing repository tests for exact actor/exposure binding, cancellation, malformed/oversized rows, authoritative source text, deterministic chronology, aggregate body/attachment evidence budgets, and hash-bound turn references.
2. Implement the trusted repository and strict snapshot parser.
3. Run the repository test and confirm green.

### Task 3: Implement deterministic promise recovery

**Files:**

- Create: `src/lib/agent-control-plane/services/promise-recovery/promise-recovery-service.ts`
- Create: `src/lib/agent-control-plane/services/promise-recovery/__tests__/promise-recovery-service.test.ts`

1. Write failing tests for exact customer resolution, significant topic matching, request/promise/reply/resolution definitions, latest-trigger chronology, unanswered commitments, unreadable/unattributed/attachment/bound gaps, and current-actor reauthorization.
2. Implement the pure analyzer and trusted service.
3. Prove no metadata-only inference and no mutation path.
4. Run the service tests and confirm green.

### Task 4: Register a dormant additive read-only capability

**Files:**

- Create: `src/lib/agent-control-plane/registry/promise-recovery-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/promise-recovery-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`

1. Write failing tests that the dormant exposure preserves Phase 3's complete hiring what-if tool/scope set, adds only `check_customer_reply` and its required read scopes, resolves to its immutable manifest, maps to the real domain method, and remains inactive while v2 stays active.
2. Add the read capability definition, successor manifest/exposure, domain mapping, composition, and runtime repository/service.
3. Run manifest, exposure, dispatch, runtime, and transport regressions.

### Task 5: Add the unapplied read-only database contract

**Files:**

- Create: `supabase/migrations/20260901122000_agent_promise_recovery_read.sql`
- Create: `src/lib/agent-control-plane/services/promise-recovery/__tests__/promise-recovery-sql-contract.test.ts`

1. Write failing SQL contract tests for dependency preflight, current grant/permission checks, company predicates, exact participant/current-operator attribution, source-ledger projection, no copied-turn body authority, deterministic ordering, row/body/aggregate-payload bounds, service-role-only ACL, historical-manifest reproof, stable attachment fallback, and absence of DML.
2. Implement the private authority assertion and public stable security-definer read RPC. Guardedly repair the existing private context/evidence implementations so both source current provider-normalized body/hash/attachment facts and fail explicitly on invalid evidence.
3. Run focused SQL and migration guard tests. Do not apply the migration.

### Task 6: Verify the full local vertical and live prerequisites

**Files:**

- Delete: `docs/artifacts/phase4-correspondence-rejection-diagnostic.ts`

1. Run all new focused tests and type checking.
2. Run the agent-control-plane regression suite, separating pre-existing sandbox-only canary limitations from product failures.
3. Run live read-only discovery over representative HTML: substantive safe body, exact two-turn chronology, stable attachment evidence, exact provider-source/turn hash attribution, and current tenant/actor authority. Record current wrapper failures rather than claiming acceptance.
4. Emulate the guarded `pg_get_functiondef` transformations read-only against production and prove provider source overlay, copied-body removal, source binding, attachment fallback, and explicit invalid-source handling. Do not execute the generated DDL.
5. Re-read the database state to prove no writes, grants, exposure activation, or migration application occurred.

### Task 7: Update the Software Bible and commit atomically

**Files:**

- Modify: `ops-software-bible/04_API_AND_INTEGRATION.md` in the isolated Bible worktree.

1. Document the Phase 4 definitions, additive dormant boundary, Foundation Zero repairs/live evidence, coverage semantics, strict current-operator attribution, local verification, and explicit not-live status.
2. Confirm both worktrees contain only Phase 4 files.
3. Commit the web implementation and Bible update as separate atomic conventional commits.
4. Run final verification from clean committed worktrees and report local-ready versus production-live status plainly.
