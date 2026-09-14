# Site visits Phase 19 implementation plan

**Goal:** Book, reschedule, cancel, configure reusable checklists, select visit snapshots, and prepare/save evidence-backed answers through one host-neutral OPS domain service.

**Architecture:** A typed domain compiler returns exact effects and missing information. OPS-owned durable proposals bind actor/company/client/grant, source versions, effect hashes, expiry, and exact transaction approval. Database transactions reauthorize and lock the relevant source graph, invoke canonical booking primitives, save only approved checklist fields, independently read back results, and persist atomic receipts. Phone outboxes retain their original edit base; all database writers enforce conflicts for enabled companies.

**Tech stack:** TypeScript/Zod, existing MCP/control plane, PostgreSQL 17, SwiftData/Supabase iOS outbox.
**Design system:** Existing recovery and approval surfaces; no new visual treatment unless needed to expose an actionable conflict.
**Required skills:** superpowers:brainstorming; custom-skills:writing-plans; custom-skills:executing-plans; superpowers:test-driven-development; supabase:supabase; ops-copywriter:ops-copywriter; superpowers:verification-before-completion; superpowers:requesting-code-review.

The scope and implementation are already approved. Technical plan review is owned by engineering. No proposal/spec approval checkpoint is required from Jackson.

## Baselines and ownership

- Web isolated worktree: `../ops-mcp-site-visits-web-p19`, base `c44cf655e` (fresh origin/main fetch).
- Bible isolated worktree: `../ops-mcp-site-visits-bible-p19`, base `5da52c9` local main.
- iOS isolated worktree: `../ops-mcp-site-visits-ios-p19`, base `8553b1b4` local main.
- Approved brief read from parent Bible at `ceb1e85`; never edit sibling worktrees.
- Reserved candidates: `2026-09-10.capability-manifest.v27`, `2026-09-10.mcp-exposure.v22`, `2026-09-10.mcp-consent-catalog.v17`. Active discovery and selectable consent remain unchanged. Parent owns integration and release.
- SwiftData V28 is reserved for this phase by the parent and active iOS bug coordinator. Preserve the exact V1–V27 model shapes and fingerprint entries; add only the adjacent V27→V28 stage and update the existing current-schema alias. This numbering is independent of MCP candidate revisions.
- Production diagnostics are read-only. Captured schema, RLS, grants, indexes, function definitions and triggers live under `docs/artifacts/phase19/`. No production migration or fixture write.

## Task 1: Typed definitions and evidence compiler

Create `src/lib/agent-control-plane/contracts/site-visit-workflow.ts` and `services/site-visit-workflow/` with focused `__tests__`. First write failing tests for all eight actual field kinds, hidden/required fields, duplicate identities, exact value semantics, evidence attribution, unsupported files, and missing required fields. Implement strict bounded inputs with no raw CRUD or capture start/complete. Preserve existing camel-case field/value JSON wire keys. Measurement values remain original text because that is the current field model; unsupported conversions, choice sets, signatures and invented media are rejected.

## Task 2: Cross-writer concurrency protocol

Create separate additive migration(s), local SQL fixtures and concurrency scenarios under `tests/sql/site-visit-workflow-*`. First demonstrate the legacy overwrite race in a local fixture. Add guarded revision/base protocol for templates and answers with company activation disabled by default. Existing snapshots cannot change silently. Stale writes fail without acknowledging outbox success, leaving the local proposed version and authoritative server version recoverable. Guard booked scheduling fields against delayed capture upserts. Resolve conflicts through explicit review of current and pending values; never auto-rebase a dirty edit onto new authority.

Inspect and change all relevant iOS model/DTO/outbound/inbound/recovery paths in the iOS worktree. Original bases must survive queue coalescing, retry, process restart, account switch, and in-flight edits. A save echo may advance the base only for the exact acknowledged payload. Gate activation on compatible signed-client release; legacy clients must fail safely even after activation. Test phone-before-MCP, MCP-before-phone, two phones, two hosts, duplicate replay and completed-record denial using the real local database plus focused Swift tests.

Freeze the exact pre-phase `SyncOperation`, `SiteVisitType` and `SiteVisitChecklistAnswer` stored shapes for released schemas before registering their new metadata in V28. Prove every released checksum unchanged, then migrate and independently reopen a populated V27 store with templates, answer snapshots and queued work intact. Historical fixtures must use historical model classes; changing an expected old checksum is not a migration repair.

## Task 3: Canonical appointment and checklist transaction

Use live-verified booking function bodies and extract an explicit-actor private primitive only where needed, retaining the public app wrapper and identical business semantics. No impersonated JWT settings. Keep stage movement, timeline, reminder override and calendar enqueue canonical. Resolve civil time with company timezone, require DST disambiguation, check task/visit/time-off/hold conflicts and report unknown external coverage.

Add bounded template discovery/inspect and exact form context. Compile create/edit/default templates, additive checklist selection, and typed answer changes. Lock complete source graphs, including insertion phantoms, and compare versions at commit. Prepare persists only declared proposal/review state. Commit records atomic business effect, activity, notification and truthful receipt. Supersession invalidates old approvals. Replays reauthorize first and return the original receipt without duplicating effects. Exact idempotency-key reuse with different arguments fails.

## Task 4: Domain facade, dormant candidate dispatch and approval

Integrate through existing capability-service/runtime and MCP server factory. Reuse the existing booking tool names. Add domain-specific template/answer tool families, read schemas, permission policies and dedicated dormant v27/v22/v17 candidates. Keep shared integration edits in identifiable commits. Exact host-neutral actor binding applies to humans and durable agents; no Canpro path or separate agent tools. Map actual review/confirm/commit to existing OPS approval infrastructure and preserve an independently readable receipt.

## Task 5: Acceptance and adversarial verification

Run focused failing-first unit, actual local PostgreSQL contract/concurrency, and local MCP protocol dispatch tests. Verify every numbered case in the approved brief, including all tenant and revocation boundaries, stale/expired/hash-altered approvals, source injection, identity ambiguity, DST, booking races, missing coverage, historical snapshots, false/zero/unknown/clear, no physical completion and crash-after-save retry. Map conversational examples to the 30 existing personas. Do not call protocol fixtures native host acceptance or simulator tests signed-device proof. Run heavy iOS validation serially after checking running builds, with isolated DerivedData and SPM.

## Task 6: Review, documentation and handoff

Use requesting-code-review for an independent review while completing local proof. Fix actionable findings and rerun affected checks. Update Bible chapters 03/04/07 and implementation spec, mirror exact migration bytes, record hashes and unapplied status. Commit code by repository then Bible, with test evidence in `docs/artifacts/phase19/`. Final handoff distinguishes local implementation, dormant candidates, compatibility activation, public exposure, consent, exact live authority, native host acceptance, signed-device distribution and customer-live status.
