# OPS MCP Day Closeout / Foundation Zero Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use custom-skills:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a local-only, production-grade `prepare_day_closeout` vertical plus OPS-owned routine state and exact authenticated internal-filing receipts without changing the active read-only MCP exposure.

**Architecture:** Add a closeout-specific domain service beside the existing read catalogue. It composes already-authorized read services, applies one versioned server metric definition, and persists through narrow service-role RPCs. Add an immutable inactive v3 exposure with one prepare scope/tool, while keeping v1/v2 byte-for-byte stable. Reuse the Firebase-authenticated agent queue for exact preview approval; commit and receipt issuance are one locked database transaction. A bounded cron worker claims OPS-owned routine runs and revalidates the current actor, grant, scopes, and granular permissions before using the same service.

**Tech stack:** Next.js 15 route handlers, TypeScript, zod-v4, MCP SDK v2, Supabase/Postgres RPCs, Vitest/Testing Library, Tailwind design tokens, existing notification and approval-queue surfaces.

**Required skills:** `supabase:supabase`, `superpowers:test-driven-development`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:wireframe`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`.

## Product and interface decision record

**Human:** A trades owner at the 8 PM tailgate close, tired and trying to leave the business in a safe state for tomorrow.

**Task:** Verify what is unresolved, understand what OPS could not evaluate, and confirm one exact internal closeout filing without accidentally sending or changing customer/financial records.

**Feel:** A measured end-of-shift manifest: dense enough to trust, calm enough to scan once.

**Palette:** Existing OPS monochrome hierarchy; tan only for attention, rose only for blocked/error, olive only for clear/completed, steel blue only for the one approval action/focus ring.

**Depth:** Existing queue card’s glass + hairline system. No new surface tier, shadow, or decorative treatment.

**Typography:** Existing Cake Mono authority labels, Mohave sentence-case findings, JetBrains Mono numbers/amounts/timestamps.

**Spacing:** Existing 8px base and current ActionCard internals. No new raw spacing values.

### Wireframe variants considered

1. **Hierarchical dedicated closeout page:** strongest long-form hierarchy, but duplicates the queue and creates permanent acreage for a daily transient review.
2. **Dashboard/grid closeout:** scannable, but turns a decision into a dashboard and over-promotes once-per-day state.
3. **Flow-focused queue card — selected:** summary first, exact immutable manifest on expand, one `FILE CLOSEOUT` action, and existing reject path.
4. **Hybrid notification drawer:** fast entry, but too little room for exact approval and risks hiding the authority boundary.

## Task 1 — Freeze contracts and safety invariants

**Files:**

- Create: `src/lib/agent-control-plane/contracts/day-closeout.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-scope-catalog.ts`
- Create: `src/lib/agent-control-plane/registry/day-closeout-capability.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Test: `src/lib/agent-control-plane/contracts/__tests__/day-closeout.test.ts`
- Test: `src/lib/agent-control-plane/registry/__tests__/day-closeout-capability.test.ts`

Write failing contract tests first for strict input, canonical dates/timezones/idempotency keys, closed component/reason states, analytics disclosure, mixed-currency separation, correspondence coverage suppression, immutable exact preview, truthful receipt states, and prompt-safety markers. Implement the schemas and manifest entry with only the required read scopes plus `ops.operations.prepare`; no send/write scope.

## Task 2 — Add local database state and domain-specific RPCs

**Files:**

- Create through `supabase migration new`: `supabase/migrations/*_agent_day_closeout_foundation_zero.sql`
- Test: `src/lib/agent-control-plane/services/day-closeout/__tests__/migration-contract.test.ts`

Create private closeout routine, canonical run, typed routine-failure, change-set, confirmation, and receipt tables plus narrow public service-role RPCs. Revoke public table/function privileges by default; grant only exact service-role RPC entrypoints. Add company/actor/client/grant bindings, immutable preview digest, expiry, single-use confirmation, idempotency uniqueness, leases, retry fields, statuses, and indexes. Commit RPCs must lock, re-resolve current authority, verify current grant/client/scopes, compare exact digest/binding/version, perform the internal filing, write the truthful receipt, and support same-key replay without duplicate effects. Blocked and failed occurrences must never masquerade as partial `DayCloseoutResult` snapshots.

## Task 3 — Build the server-owned closeout projection

**Files:**

- Create: `src/lib/agent-control-plane/services/day-closeout/day-closeout-metric.ts`
- Create: `src/lib/agent-control-plane/services/day-closeout/day-closeout-repository.ts`
- Create: `src/lib/agent-control-plane/services/day-closeout/day-closeout-service.ts`
- Test: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-metric.test.ts`
- Test: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-service.test.ts`
- Test: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-repository.test.ts`

Start with failing tests for tomorrow boundaries including DST, current permission variants, bounded pagination/partial coverage, outstanding balances by currency, stalled lead and work-due classification, correspondence readability failure, inert instruction-like content, deterministic ordering, and same-key replay/conflict. Compose existing authorized schedule/readiness/work-queue/sales-document/company reads, then persist one canonical run/change set through the repository.

## Task 4 — Add inactive v3 prepare exposure without widening v2

**Files:**

- Modify: `src/lib/agent-control-plane/services/read-catalogue-service.ts` (rename/generalize only where required)
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/mcp/server-factory.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Test: `src/lib/agent-control-plane/mcp/__tests__/day-closeout-transport.test.ts`
- Test: `src/lib/agent-control-plane/mcp/__tests__/grant-pinned-exposure.test.ts`
- Test: `src/lib/agent-control-plane/registry/__tests__/mcp-exposure-catalog.test.ts`

Write failing tests proving v1/v2 tool lists/scopes remain exact, active exposure remains v2, v3 is resolvable but inactive, only v3 registers `prepare_day_closeout`, annotations say prepare/non-destructive/idempotent, the handler closes over actor/grant facts, and audit records the real prepare operation. Generalize the registration path to support available non-read capabilities without weakening read-only exposure invariants.

## Task 5 — Exact authenticated queue confirmation and truthful receipt

**Files:**

- Modify: `src/lib/types/approval-queue.ts`
- Modify: `src/lib/api/services/approval-queue-service.ts`
- Modify: `src/app/api/agent/queue/[actionId]/route.ts`
- Modify: `src/components/agent/action-card.tsx`
- Modify: `src/app/(dashboard)/agent/queue/page.tsx`
- Modify: `src/i18n/dictionaries/*/agent-queue.json` (every shipped locale)
- Test: `src/lib/api/services/__tests__/day-closeout-approval.test.ts`
- Test: `src/components/agent/__tests__/day-closeout-action-card.test.tsx`
- Test: route test beside the queue API tests

Add the non-editable `file_day_closeout` action type and hide it from bulk approval. Render the exact immutable preview and the explicit truth boundary before approval. Route approval through the closeout commit RPC and return the stored receipt. Prove cross-company, cross-actor, expired, edited, digest-mismatch, consumed, permission-revoked, and replay cases. Routine configuration is intentionally excluded until its owner-approved product experience exists; this phase adds no `configure_day_closeout_routine` action.

## Task 6 — OPS-owned routine worker and failure visibility

**Implemented locally, activation intentionally withheld:** the worker service,
service-role RPC boundary, failure notifications, and guarded route are present.
Routine rows default disabled and the route requires a separate activation flag.
The planned `vercel.json` registration was deliberately omitted so merging this
code cannot silently create a paid scheduled invocation before Jackson approves
activation and its measured cost. No configuration RPC or UI enables routines.

**Files:**

- Create: `src/lib/agent-control-plane/services/day-closeout/day-closeout-routine-service.ts`
- Create: `src/app/api/cron/day-closeout-routines/route.ts`
- Deliberately do not modify: `vercel.json`
- Test: `src/lib/agent-control-plane/services/day-closeout/__tests__/day-closeout-routine-service.test.ts`
- Test: `src/app/api/cron/day-closeout-routines/__tests__/route.test.ts`

Write failing tests for one-at-a-time lease exclusion, database-owned actor/grant/client reauthorization every run, revocation and scope loss, committed-response-loss recovery, defensive fourth-claim recovery, hard execution budgeting, DST-safe next-run calculation, quiet clear runs, schema-valid partial results, separate blocked/failed records, truthful persistent notifications, bounded retries, and no model/provider call. The 240-second worker budget admits a new claim only with 60 seconds remaining, cancels work at 210 seconds, and reserves the final 30 seconds for truthful finalization; work-budget expiry uses the bounded retry ladder. Implement a small worker using existing cron workload controls. Do not deploy or activate the schedule.

## Task 7 — Bible/API documentation and acceptance evidence

**Files:**

- Modify in Bible worktree: `04_API_AND_INTEGRATION.md`
- Modify in Bible worktree: `07_SPECIALIZED_FEATURES.md`
- Modify in Bible worktree: `03_DATA_ARCHITECTURE.md`
- Modify in Bible worktree: this phase spec

Document v2 as the only active read-only exposure, v3 as local/inactive, exact scope and action ladders, routine ownership, correspondence coverage behavior, cost boundary, and the host acceptance matrix. Do not claim live host compatibility.

## Task 8 — Verification and local commits

Run focused contract/service/transport/route/UI tests, migration contract checks, typecheck, lint for touched files, design-system hardcode audit on the diff, and the full agent-control-plane suite. Re-run the known baseline schedule-instant failures under the repo-supported Node runtime if available; otherwise report them separately with exact counts. Review the diff for tenant identifiers, unrestricted grants, send/payment paths, v2 drift, and unrelated workspace changes. Commit the web implementation and Bible updates atomically on their isolated branches. Keep both branches/worktrees local; no push, merge, deploy, migration apply, or host/customer-live action.
