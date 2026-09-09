# Conversational Catalog Phase17 Implementation Plan

**Goal:** Prepare and atomically save an exact operator-reviewed catalog import or edit, with a separate inventory adjustment review.
**Architecture:** One domain service and strict contracts serve all MCP hosts and durable callers. Existing products, catalog families/options/variants, units/categories and recipes remain authoritative. Reuse the agent action review, notification, current-actor resolver and receipt conventions; add one catalog transaction participant and durable proposal storage because the deployed earlier stores are capability-specific. No new catalog model or pricing contract.
**Tech Stack:** TypeScript/Zod, Postgres17, existing MCP adapter, Next.js approval queue.
**Design System:** ops-design-system/project/DESIGN.md; existing queue tokens and controls.
**Required Skills:** superpowers:brainstorming, custom-skills:writing-plans, custom-skills:executing-plans, supabase:supabase, superpowers:test-driven-development, ops-copywriter:ops-copywriter, custom-skills:ops-design; UI implementation/audit skills for approval view.

Approved session brief delegates technical design and execution. No further technical-plan approval gate. Production migration, host write activation and business-record canary require separate exact authorization.

## 1. Capture actual contracts and effects

- Read live catalog columns, constraints, indexes, RLS and trigger bodies through Supabase MCP; archive schema-only evidence under docs/artifacts/phase17.
- Inspect web/iOS save, import and bulk expansion. Do not reuse the multi-call guided executor as the transaction coordinator.
- Trace reachable functions and queue sinks. Preserve price mirror, source revisions, catalog mapping notifications and physical-stock invariants.
- Refresh web/Bible origin/main; preserve shared WIP and Phase16 state. Work only in ops-mcp-catalog-{web,bible}-p17.

## 2. Strict source and change contracts

Files: src/lib/agent-control-plane/contracts/catalog-authoring.ts and tests.
- Write failing cases for price-with-stock rejection, duplicate source rows, unsupported fields, missing prices, invalid decimals and foreign references.
- Implement bounded discriminated domain rows: units, categories, products/services, stock families, variants with explicit option choices, fixed recipes, separately reviewed quantity adjustments.
- Explicit provenance includes source identity/content digest and source row. Supplier content is data, never approval. Unsupported/conflicting rows return needs_input and block saving the batch; explicitly skipped source rows remain visible.
- Existing IDs require exact current fingerprints. Automatic identity matching offers candidates; it never silently edits a match. New SKU/name collisions block until resolved.

## 3. Authoritative transaction and durable lifecycle

Files: new Supabase migration, tests/sql/catalog-authoring-*.
- Reuse private.resolve_agent_actor_authority and exact grant/client/consent checks, rechecking at prepare, commit and replay. Add dormant catalog write scopes without changing any existing grant.
- Compile server-owned before/after effects, preserving omitted fields and existing IDs/history. New variants start at zero. Existing family option identities remain stable; add explicit options/values only, never blanket-replace.
- Seal request, resolved changes, source versions, authority and expiry. Persist through agent_actions and private catalog proposal storage.
- Commit exact named-actor approval with deterministic locking, recompile/compare source, single transaction, readback, durable receipt and notification completion. Rejection/expiry cannot commit. Same commit replay returns original receipt only under current authority.
- Inventory adjustment is a separate operation with catalog.stock.adjust and separate write scope; reject physical-stock-unit-backed variants until the existing physical capture workflow is used. Write only quantity and its existing manual_adjustment audit, never purchases, receipts or accounting.
- Test transaction rollback at an injected late constraint/trigger failure, multi-row retry, changed permissions/grant, stale writes, identity phantoms, tenant denial and untouched provider/accounting sinks using disposable PostgreSQL.

## 4. Domain and dormant protocol integration

Files: services/catalog-authoring/*, services/capability-service.ts, registry/catalog-authoring-capability.ts, capability-manifest.ts, mcp/domain-dispatch.ts, mcp/runtime.ts, mcp/server-factory.ts, scope/exposure candidate definitions.
- Thin inspect/prepare adapters call domain service; no host arithmetic or SQL. Future scheduled callers use the same capabilities/actor binding.
- Keep candidate exposure absent from selectable production catalog and consent registration. Preserve all earlier manifest/exposure entries.
- Protocol tests prove strict schema validation, trusted service boundaries and current authority; no synthetic test is reported as native-host acceptance.

## 5. Exact operator approval

Files: existing approval queue service and action-detail component, isolated catalog review component, en/es agent-queue dictionaries, route as needed.
- Reuse existing exact-review handling; exclude catalog actions from bulk approval, generic status edits and unscoped payload reads.
- Show source, creates/updates/skips, explicit before/after money/units and separate quantities. Human-readable labels, formatted mono values, semantic tokens. No raw SQL/internal field names in the operator flow.
- Verify wrong actor, cost visibility, malformed preview, exact seal, replay and reject. Run design audit and focused component checks.

## 6. Verification, documentation and integration handoff

- Focused domain/schema/protocol/approval tests, real SQL synthetic cases, TypeScript and diff checks. Baseline unrelated failures separately.
- Independent review of authority, stale/identity locking, side effects and exact receipt; fix findings and repeat affected checks.
- Update Bible chapters 03,04,07,09 with actual contract, unactivated state and exact migration/activation plan. Do not archive an unapplied migration as applied.
- Commit code first, Bible second. Send parent exact commits, tests, shared-file list and release gates before integration. Do not mutate Phase16 policy/effect seal/grants/records.

## Approved release verification findings (2026-09-09)

- The production compiler rejected the review component's misplaced client directive. Restore the directive and add a real installed Next SWC boundary regression, because TypeScript/Vitest do not enforce that rule.
- Actual signed-in MAVERICK review returned 404: Phase C gated the shared queue. Do not enable the company's automation flag. Add a service-only read hint derived from a currently consented exact catalog trial; allow only `/agent/queue` under that hint, retaining independent `agent.review` RBAC and every queue/save authorization. Test absent/revoked/wrong-subject/effect-stale consent, failed API reads, actor switches and adjacent automation routes. No visual redesign or new business authority.
