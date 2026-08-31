# OPS MCP Collections Vertical Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an inactive, locally complete `prepare_collections` MCP vertical that returns exact receivables aging and creates one immutable, non-sending approval draft per eligible debtor.

**Architecture:** A transport-neutral collections service reauthorizes the MCP actor, reads the bounded trusted invoice and customer catalogues, computes aging and deterministic copy, obtains recipient-specific correspondence coverage through a narrow service-role repository, and atomically persists an idempotent run plus per-debtor change sets. The authenticated approval queue commits or rejects each immutable change set inside OPS only. A new v10 manifest and inactive v4 exposure isolate the work from active v2 and externally owned v3 OAuth canary state.

**Tech Stack:** Next.js 15, TypeScript 5.9, Zod v4, Vitest, React 19, Supabase/Postgres 17, Tailwind token classes.

**Design System:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`; reuse the existing action-card structure and tokens, with no new styling primitives.

**Required Skills:** `custom-skills:executing-plans`, `superpowers:test-driven-development`, `supabase:supabase`, `ops-copywriter:ops-copywriter`, `custom-skills:ops-design`, `custom-skills:interface-design`, `frontend-design:frontend-design`, `custom-skills:ui-ux-pro-max`, `custom-skills:audit-design-system`, `superpowers:verification-before-completion`, `superpowers:finishing-a-development-branch`.

---

## Task 1: Lock the collections contract and copy policy

**Files:**

- Create: `src/lib/agent-control-plane/contracts/collections.ts`
- Create: `src/lib/agent-control-plane/contracts/__tests__/collections.test.ts`

**Step 1: Write failing contract tests**

Cover canonical input, every aging boundary, exact currency-separated totals, deterministic debtor/invoice order, approval-ready and blocked debtor unions, immutable preview identity, copy bounds, evidence coupling, and truthful prepare/approval receipt fields.

**Step 2: Run the focused test and observe RED**

Run:

```bash
node node_modules/vitest/vitest.mjs run src/lib/agent-control-plane/contracts/__tests__/collections.test.ts
```

Expected: fail because the collections contract does not exist.

**Step 3: Implement the strict Zod contract**

Define the closed schemas and exported types for:

- `PrepareCollectionsInput`
- invoice facts and five aging buckets
- currency-separated debtor and portfolio balances
- recipient/correspondence readiness and exact block reasons
- deterministic subject/body preview
- per-debtor approval binding
- prepare result and approval receipt

Use canonical date, UUID, money, timestamp, SHA-256, and untrusted-content schemas already established in the agent control plane.

**Step 4: Run GREEN**

Run the focused contract test and confirm every named behavior passes.

**Step 5: Commit**

```bash
git add src/lib/agent-control-plane/contracts/collections.ts src/lib/agent-control-plane/contracts/__tests__/collections.test.ts
git commit -m "feat(mcp): define collections preparation contract"
```

## Task 2: Build server-owned aging, recipient choice, and deterministic drafts

**Files:**

- Create: `src/lib/agent-control-plane/services/collections/collections-service.ts`
- Create: `src/lib/agent-control-plane/services/collections/collections-repository.ts`
- Create: `src/lib/agent-control-plane/services/collections/__tests__/collections-service.test.ts`
- Modify: `src/lib/agent-control-plane/services/capability-service.ts`
- Modify: `src/lib/agent-control-plane/mcp/runtime.ts`

**Step 1: Write failing service tests**

Use hand-derived fixtures to catch:

- exact 0/1/30/31/60/61/90/91-day bucket edges;
- positive-balance collectible-status filtering;
- per-currency aggregation without cross-currency arithmetic;
- oldest-first invoice order and most-overdue debtor order;
- complete pagination and failure when a fifth page exists;
- current actor reauthorization before reads and persistence;
- primary-recipient preference, blocked-primary fence, single-sub-client fallback, multiple-recipient ambiguity, duplicate-customer fence, and bounded-contact fence;
- unreadable/shared/recent correspondence blocking;
- one consolidated deterministic draft per ready debtor with no legal/threat language;
- exact idempotency hash and replay preservation;
- no persistence when authority or source completeness fails.

**Step 2: Run RED**

Run the new service test and confirm it fails for the missing implementation.

**Step 3: Implement the repository boundary**

Create a trusted repository adapter for:

- company timezone resolution;
- recipient-bound correspondence inspection;
- idempotent prepare persistence and exact reconciliation.

Every call must carry the v10 manifest, v4 exposure, exact OAuth binding, current permission snapshot, optional abort signal, and strict result parsing.

**Step 4: Implement the service**

Reauthorize once for the v10 policy, authorize `prepare_collections`, resolve the server business date, read all invoice pages, fetch canonical customer contexts with bounded concurrency, compute facts and copy, inspect correspondence, construct the exact result, persist it, and return the frozen stored snapshot.

**Step 5: Wire the trusted service into runtime**

Extend the capability service and runtime constructor without changing the existing read or day-closeout service contracts.

**Step 6: Run GREEN and existing closeout regression tests**

Run the collections service suite plus the 36-test closeout baseline.

**Step 7: Commit**

```bash
git add src/lib/agent-control-plane/services/collections src/lib/agent-control-plane/services/capability-service.ts src/lib/agent-control-plane/mcp/runtime.ts
git commit -m "feat(mcp): prepare exact debtor collection drafts"
```

## Task 3: Add the isolated inactive v4 manifest and dispatch

**Files:**

- Create: `src/lib/agent-control-plane/registry/collections-capability.ts`
- Create: `src/lib/agent-control-plane/registry/__tests__/collections-capability.test.ts`
- Modify: `src/lib/agent-control-plane/registry/capability-manifest.ts`
- Modify: `src/lib/agent-control-plane/registry/mcp-exposure-catalog.ts`
- Modify: `src/lib/agent-control-plane/mcp/domain-dispatch.ts`
- Modify: `src/lib/agent-control-plane/mcp/durable-rate-limit.ts`
- Modify tests under: `src/lib/agent-control-plane/registry/__tests__/`
- Modify tests under: `src/lib/agent-control-plane/mcp/__tests__/`

**Step 1: Write failing isolation tests**

Assert exact unchanged v2 and v3 revision/tool/scope bytes, active revision v2, new inactive v4 containing only `prepare_collections`, v10 policy scopes and permissions, dispatch to `prepareCollections`, and a collections-specific durable prepare-rate RPC. Assert unknown or mismatched revisions fail closed.

**Step 2: Run RED**

Run the focused registry/dispatch/rate-limit tests and confirm the missing v4 behavior fails.

**Step 3: Implement v10 and v4**

Remint the v9 manifest into v10, add prepare/commit collections definitions, add v4 to the immutable catalogue, and keep `ACTIVE_MCP_EXPOSURE_REVISION` on v2. Do not edit OAuth config, consent revisions, host-acceptance scripts, migration activation mechanics, or any v3 constant/value.

**Step 4: Implement dispatch and rate limiting**

Map `prepare_collections` to the trusted service and route its prepare bucket to a dedicated database consume RPC. Preserve the day-closeout rate-limit function and policy unchanged.

**Step 5: Run GREEN plus all registry/MCP tests**

Run focused tests, then all `registry/__tests__` and `mcp/__tests__` suites.

**Step 6: Commit**

```bash
git add src/lib/agent-control-plane/registry src/lib/agent-control-plane/mcp src/lib/agent-control-plane/services/capability-service.ts src/lib/agent-control-plane/mcp/runtime.ts
git commit -m "feat(mcp): register inactive collections v4 exposure"
```

## Task 4: Add private persistence and exact approval SQL

**Files:**

- Create: `supabase/migrations/20260831140000_agent_collections_vertical.sql`
- Create: `src/lib/agent-control-plane/services/collections/__tests__/collections-sql-contract.test.ts`

**Step 1: Write failing SQL behavior-contract tests**

Read the migration as an artifact and validate executable SQL boundaries rather than prose. Cover:

- prerequisite checks;
- private run/change-set/confirmation/receipt tables with RLS and no policies;
- revoked table privileges;
- tenant paired keys/indexes;
- pinned search paths and service-only functions;
- v10/v4/grant/client/scope/current-permission binding;
- exact recipient ownership and shared-identity detection;
- unreadable and recent-correspondence states;
- run idempotency and argument-hash conflict;
- one action per ready debtor and zero actions for blocked debtors;
- canonical preview digest and expiry;
- single-use exact approval, replay, and receipt digest;
- coherent rejection;
- truthful zero send/payment/document effects;
- no writes to email, send-intent, payment, invoice, estimate, or legal tables;
- collections-specific atomic prepare rate limit.

**Step 2: Run RED**

Confirm the SQL test fails because the migration is absent.

**Step 3: Implement the migration**

Use one transaction, prerequisite preflight, RLS, explicit privilege revocation, narrow grants, immutable ledgers, exact JSON validation, and `SECURITY DEFINER SET search_path = pg_catalog, public, private, extensions, pg_temp`.

Public functions:

- `resolve_agent_collections_timezone_as_system`
- `inspect_agent_collections_correspondence_as_system`
- `persist_agent_collections_as_system`
- `commit_agent_collections_draft_as_actor`
- `reject_agent_collections_draft_as_actor`
- `consume_agent_collections_prepare_rate_limit_as_system`

**Step 4: Run GREEN and static SQL checks**

Run the focused SQL suite. If a local disposable database is available, apply the migration there only; never apply to the linked/live Supabase project.

**Step 5: Commit**

```bash
git add supabase/migrations/20260831140000_agent_collections_vertical.sql src/lib/agent-control-plane/services/collections/__tests__/collections-sql-contract.test.ts
git commit -m "feat(mcp): persist immutable collection approvals"
```

## Task 5: Integrate non-sending approval and rejection into the queue

**Files:**

- Modify: `src/lib/types/approval-queue.ts`
- Modify: `src/lib/api/services/approval-queue-service.ts`
- Create: `src/lib/api/services/__tests__/collections-draft-approval.test.ts`
- Modify: `src/app/api/agent/queue/[actionId]/route.ts` only if the existing route contract requires a typed error mapping
- Modify: `src/components/agent/action-card.tsx`
- Create: `src/components/agent/collections-draft-preview.tsx`
- Create: `src/components/agent/__tests__/collections-draft-preview.test.tsx`
- Modify: `src/i18n/dictionaries/en/agent-queue.json`
- Modify: `src/i18n/dictionaries/es/agent-queue.json`

**Step 1: Write failing queue-service tests**

Prove that approval:

- rejects edits;
- calls only `commit_agent_collections_draft_as_actor` with the exact action-derived idempotency key;
- reconciles one ambiguous response by replaying the same RPC arguments;
- validates the truthful receipt;
- never invokes approved-email transport or a generic action executor;
- is forbidden from autonomous and bulk execution.

Prove rejection calls only the exact collections rejection RPC and returns the stored queue row.

**Step 2: Write failing preview tests**

Render a real preview and assert exact debtor, recipient, invoices, aging, balance by currency, subject, complete body, immutable digest label, and `NOT SENT` boundary are visible. Assert no editor or send control exists.

**Step 3: Run RED**

Run both focused suites and confirm the missing paths fail.

**Step 4: Implement the queue boundary**

Add `approve_collections_draft` as a first-class non-email action. Parse and validate the database receipt with Zod. Block edits, bulk approval, and autonomous execution. Use the narrow rejection RPC for coherent state.

**Step 5: Implement the token-only preview**

Reuse the existing action-card shell. The child preview uses only existing Tailwind design tokens and current typography classes. The parent labels the buttons `APPROVE DRAFT` and `LEAVE OPEN`. The preview is read-only and all numeric values use the mono formatter.

**Step 6: Run GREEN and queue regressions**

Run the two focused suites plus existing queue/email-approval tests.

**Step 7: Run the design-system audit**

Scan only changed UI files for hardcoded hex, arbitrary spacing/radius/font values, sub-11px text, semantic-color-only meaning, missing focus behavior, and new motion. Fix every violation before proceeding.

**Step 8: Commit**

```bash
git add src/lib/types/approval-queue.ts src/lib/api/services/approval-queue-service.ts src/lib/api/services/__tests__/collections-draft-approval.test.ts src/components/agent src/i18n/dictionaries/en/agent-queue.json src/i18n/dictionaries/es/agent-queue.json
git commit -m "feat(agent): review collection drafts without sending"
```

## Task 6: Update generated database types if required

**Files:**

- Modify only if compilation requires it: `src/lib/types/database.ts` or the repository’s current generated Supabase type file

**Step 1: Run type-check**

Run the repository type-check with the existing locked dependencies.

**Step 2: Add only exact new RPC/action types**

Do not regenerate unrelated schema or absorb live drift. Add the narrow function signatures required by this local migration only when the typed client cannot compile without them.

**Step 3: Re-run type-check and commit if changed**

```bash
git add <exact-generated-type-file>
git commit -m "chore(types): describe collections approval RPCs"
```

## Task 7: Update the Software Bible in its isolated worktree

**Files:**

- Modify: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-collections-bible-p2/04_API_AND_INTEGRATION.md`
- Modify: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-collections-bible-p2/07_SPECIALIZED_FEATURES.md`
- Create: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-collections-bible-p2/specs/2026-08-31-ops-mcp-collections-vertical.md`
- Mirror migration: `/Users/jacksonsweet/Projects/OPS/.worktrees/ops-mcp-collections-bible-p2/supabase/migrations/20260831140000_agent_collections_vertical.sql`

**Step 1: Record the local-only contract truthfully**

Document v10/v4 as implemented but inactive, active v2 unchanged, v3 externally gated, exact scopes/permissions/bounds, server-owned aging definitions, correspondence gates, deterministic copy policy, per-debtor approval, and zero-effect receipts.

**Step 2: Mirror the migration byte-for-byte**

Copy through `apply_patch` and compare SHA-256 digests between the web and Bible worktrees.

**Step 3: Verify documentation links and protected claims**

Ensure no text says deployed, activated, customer-live, or migration-applied.

**Step 4: Commit the Bible after the code commit**

```bash
git add 04_API_AND_INTEGRATION.md 07_SPECIALIZED_FEATURES.md specs/2026-08-31-ops-mcp-collections-vertical.md supabase/migrations/20260831140000_agent_collections_vertical.sql
git commit -m "docs(mcp): record collections approval vertical"
```

## Task 8: Verify the complete local vertical and protected state

**Files:**

- No intended source changes unless a test exposes a defect.

**Step 1: Run focused suites**

Run contracts, service, SQL, registry, dispatch, durable rate limit, queue service, and preview tests.

**Step 2: Run broad regression suites**

Run all agent-control-plane tests, relevant API service tests, and the project type-check. Report unrelated baseline/infrastructure failures separately.

**Step 3: Reverify immutable exposure boundaries**

Compare v2 and v3 contract constants and the protected v3/OAuth canary file digests to their base commit. Confirm active exposure remains v2 and no OAuth migration/config/activation file changed.

**Step 4: Reverify zero live impact**

Confirm no push, deployment, migration application, OAuth activation, or live data mutation occurred. Read live public metadata only if needed to prove the active revision remains v2.

**Step 5: Audit git state and commits**

Review both worktree diffs, ensure only intended files changed, confirm primary dirty checkouts are untouched, and record local commit hashes.

**Step 6: Apply `superpowers:finishing-a-development-branch`**

Because pushing/merging/releasing is out of scope, leave both isolated branches committed and ready for the separately authorized integration/release gate.

