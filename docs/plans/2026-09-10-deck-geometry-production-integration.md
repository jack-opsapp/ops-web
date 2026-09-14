# Deck geometry full-connection integration plan

**Goal:** Enroll new connections into result v2 while retaining the exact V14 tool/scope set and every old connection pin.
**Architecture:** Promote the unpublished V23 reservation to one complete V14-equivalent exposure. Reuse existing V14 actor manifest and V9 consent; keep P2 v8 policies and old deck results unchanged. The baseline/ACL-guarded migration extends access resolution, exact customer-update authority, queued reauthorization and its limiter. A service-only wrapper derives exposure from the immutable grant and delegates to the unchanged original preparation RPC; refresh, consent and immutable snapshots remain untouched.
**Tech stack:** TypeScript, Zod, Vitest, PostgreSQL 17, Supabase MCP read-only introspection.
**Design system:** N/A; no UI, no new consent wording.
**Skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:test-driven-development, superpowers:requesting-code-review, superpowers:verification-before-completion, supabase:supabase, ops-copywriter:ops-copywriter.
**Authority:** Local merge/implementation/migration authoring/tests/commits/Bible only. Parent owns production application/deployment and target host consent/acceptance. No live rows or confidential identities in fixtures/docs. No new exposure/manifest/consent allocation. No runtime or package changes.
**Base:** Production c217c3bc4ff83976068d66c6ab6fcfb35b07e4db merged as 7a73abe404b7d57d8b6a6d191547ee10a27cad64; newly released Canpro OAuth ab42b042613d487413f3d9f36f535cbe27a40504 then merged as 0b864057c. The current registration function was recaptured read-only and its exact callback/read ceiling tested on V23.

## 1. Capture and guard live custody
- Supabase MCP reads verify exact OAuth table columns, RLS/ACLs, function bodies/hashes and immutable triggers.
- Persist only schema/function fixtures, no business rows, credentials or identities.
- Create migration via cached CLI; fail closed for unexpected body/owner/ACL/search-path or immutable-custody drift.

## 2. Full successor selection, test first
- Add failing tests that V23 tools/scopes exactly equal V14, old pins remain v1, normal V23 supplies v2, and no sibling candidates enter discovery.
- Define V23 after V14 in the catalog to avoid import cycles; preserve existing candidate module as an explicit re-export only.
- Route V23 through the existing V14 manifest/labels/server instructions and V9 consent; select deck v2 only for V23.
- Make normal new registration select V23. Preserve V14 consent enrollment independently of the active pin. Retain exact V1/V2 and existing V3/V17/V19 trial gates.

## 3. Narrow database integration, test first
- Run actual captured OAuth routines in an isolated PostgreSQL17 fixture.
- Exercise new and old pins, exact consent/scopes, missing/invalid tokens, issuer/resource, expired/revoked/disabled state, current trial binding requirements and immutable snapshot rejection.
- Extend access resolution for active V23 and exact V23/V9 grants. Reuse the existing customer-update manifest and V9 consent through exact grant-derived preparation, queued reauthorization and rate limiting. Preserve canonical company-first locks; the wrapper reads the immutable pin without an early row lock.
- Lock both trial binding tables in SHARE mode and refuse migration while any enabled, unexpired V17 or V19 binding exists. Their global function hashes will change; do not reseal policy or change binding rows. Preserve customer-update business effect hash and policy rows, including a stale policy.
- Prove refresh/code/consent flow, spent-family revocation, ACLs, baseline rejection and zero-change replay; never weaken immutable triggers or copy live grants.

## 4. Verification and local handoff
- Bounded protocol/OAuth/registry suites, actual PostgreSQL tests, type checks and lint. Determine actual available runtime and label evidence accurately.
- Independent review, fix findings, atomic commits. Update numbered Bible chapters and release handoff with the exact migration, enrollment/rollback checks and remaining live canary gates.

## Completed proof and rollout
- 860 post-merge Node22 tests; 316 real PostgreSQL17 assertions including overlapping binding insertion, old V14 pending approval across migration, exact limiter binding, stale-policy/no-change refusal, and Canpro V23 code/refresh custody.
- Migration must precede active-V23 code. Once V23 grants exist, rollback must retain V23 resolution/representation while separately stopping new V23 registration, or repair forward. A preintegration deployment rejects V23 and is not a universal rollback.
- Exact commands, logs, checksum and live acceptance limits are in `docs/artifacts/deck-geometry-2026-09-10/HANDOFF.md`.

Production SQL checkpoint from parent: exact reviewed bytes applied under actual ledger `20260910233314`; local migration filename and runner mirror that version. No SQL reapplication or resealing. Original connection/binding/customer-policy invariants independently read back by parent before code deployment.
