# Deck geometry full-connection integration plan

**Goal:** Enroll new connections into result v2 while retaining the exact V14 tool/scope set and every old connection pin.
**Architecture:** Promote the unpublished V23 reservation to one complete V14-equivalent exposure. Reuse existing V14 actor manifest and V9 consent; keep P2 v8 policies and old deck results unchanged. Only an additive, baseline/ACL-guarded access-resolver migration is expected; refresh and immutable snapshots remain untouched.
**Tech stack:** TypeScript, Zod, Vitest, PostgreSQL 17, Supabase MCP read-only introspection.
**Design system:** N/A; no UI, no new consent wording.
**Skills:** custom-skills:writing-plans, custom-skills:executing-plans, superpowers:test-driven-development, superpowers:requesting-code-review, superpowers:verification-before-completion, supabase:supabase, ops-copywriter:ops-copywriter.
**Authority:** Local merge/implementation/migration authoring/tests/commits/Bible only. Parent owns production application/deployment and target host consent/acceptance. No live rows or confidential identities in fixtures/docs. No new exposure/manifest/consent allocation. No runtime or package changes.
**Base:** Current production source c217c3bc4ff83976068d66c6ab6fcfb35b07e4db merged safely as 7a73abe404b7d57d8b6a6d191547ee10a27cad64.

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
- Extend only the access resolver for active V23 and exact V23/V9 grants, keeping old active revisions and trial branches valid.
- Prove refresh/code/consent flow, spent-family revocation, ACLs, baseline rejection and zero-change replay; never weaken immutable triggers or copy live grants.

## 4. Verification and local handoff
- Bounded protocol/OAuth/registry suites, actual PostgreSQL tests, type checks and lint. Determine actual available runtime and label evidence accurately.
- Independent review, fix findings, atomic commits. Update numbered Bible chapters and release handoff with the exact migration, enrollment/rollback checks and remaining live canary gates.
