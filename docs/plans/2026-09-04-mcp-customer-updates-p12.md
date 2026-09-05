# Phase 12 customer and opportunity update implementation plan

**Goal:** One exact, evidence-backed approval updates an existing lead and optionally its linked customer's notes, with atomic effects and an independently checked receipt.
**Architecture:** Extend the existing host-neutral capability service, versioned manifest/exposure/consent, actor authorization, durable proposal pattern, and OPS approval queue. No external messaging, financial, lifecycle, scheduling, bulk or activation authority.
**Tech stack:** TypeScript, Zod, PostgreSQL 17, existing React approval queue.
**Design system:** OPS project/DESIGN.md; reuse current approval components and tokens.
**Skills:** custom-skills:executing-plans, supabase:supabase, superpowers:test-driven-development, superpowers:requesting-code-review, ops-copywriter:ops-copywriter; OPS UI skills before queue work.

## 1. Reconcile truth
- Start web at 4cfa65ef6 and Bible at 06a5188 in isolated worktrees; retain all unrelated work.
- Production Phase11 ledger 20260904222406, zero runs/confirmations/receipts; grants only v1/v2. Confirm HTTP and host acceptance separately.
- Live schemas/triggers establish safe allowlist: opportunity title, description, assigned_to, next_follow_up_at; linked customer notes only, reject active outbound accounting connections under a concurrency fence.
- Next follow-up is an existing reminder timestamp; no stage, handled state, schedule or send change. Reject ambiguous/missing entity links.
- Preserve assignment core/version/history; suppress this vertical's provider draft enqueue durably and assignment push deliveries transactionally. Document revision/projection and internal lifecycle effects.

## 2. Contract and source proof
- Add strict bounded customer-update schemas and immutable v20 manifest/v14 dormant exposure/v9 consent. Active v2 unchanged.
- Explicit UUIDs only; trusted tenant from ActorContext. Bounded evidence references and verbatim excerpts; actor statements visibly lower-assurance, never stored as verified correspondence. Refuse missing/conflicting support.
- Before/after payload binds exact actor/grant/permissions, policy revision, source record versions, evidence digest, effect list and expiry. Exact request-key reuse only.
- Write failing contract tests, then domain/repository integration; reauthorize on every call including receipt replay.

## 3. Transaction and approval
- New domain persistence extends current run/change-set/confirmation/receipt pattern and existing agent_actions queue; no separate control plane.
- Service-role-only RPCs, private table ACL denial/RLS, current entity permission checks, row/authority locks, explicit allowlist updates.
- Atomic approval + commit + source readback + audit + notification resolution. Failure rolls all effects back. No blind receipt replay after revocation.
- UI shows readable before/after, evidence provenance, effects and expiry. Any edit requires a fresh proposal. Disable auto/bulk approval paths.

## 4. Verification and review
- Focused contracts, service/adapter/queue tests and disposable local PostgreSQL tests: wrong tenant/record, inactive/revoked actor, permission/policy/source drift, injection, evidence conflict/missing, stale/duplicate/racing commit, changed-key inputs, receipt tamper and rollback.
- Independent review; fix every relevant finding; typecheck/build with bounded baseline separation.

## 5. Documentation and dormant release
- Update Bible API/data/workflow sections and migration copy in same session.
- Publish/deploy dormant code under standing release permission; respect separately enforced production migration authorization. Never create tenant write policies, grants, business mutations, canaries or routine schedules. The proposed migration includes one technical effect fingerprint only.
- Read back migration ACLs, zero rows and unchanged public read-only metadata; report READY source independently from host acceptance and activation.

## Execution status

Implementation, independent review, visual inspection, 52 PostgreSQL checks, 396 integrated application tests and full type-check are complete. Dormant application release proceeds under standing permission. Production migration was rejected by automatic approval review and remains unapplied pending exact user authorization; no activation or host acceptance is claimed. See `docs/artifacts/phase12/release-proof.md`.

## Approved activation — 2026-09-04 Vancouver

Jackson approved the exact production migration and enabling write access. Apply and verify exact migration; activate only v14 prepare plus existing OPS exact approval. Keep old client/grant authority pinned and require normal signed-in OAuth consent for new scope. Fix the live bearer resolver's v2-only gate with preserved v1/v2 and canary behavior. Switch active exposure/consent together, recognize exact v14 subjects, and update consent/public reference copy and types. Prove OAuth registration/consent/code/refresh/revocation locally using real database functions, plus route and UI tests. Independently review before applying activation SQL and publishing. Verify live discovery has21scopes, unauthenticated requests are denied, ACLs remain restricted, and no business action was performed. Archive exact applied SQL and document that existing connectors require a new consent connection. Skills: custom-skills:writing-plans, custom-skills:executing-plans, supabase:supabase, ops-copywriter:ops-copywriter, superpowers:requesting-code-review. Existing UI layout/tokens are reused. No new paid service or tier.
