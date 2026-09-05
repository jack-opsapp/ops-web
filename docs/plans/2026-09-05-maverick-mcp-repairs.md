# Maverick MCP repairs implementation plan

**Goal:** Repair the four findings from the September 5 authenticated Maverick calls without changing business records or weakening authority.

**Architecture:** Keep strict database authority and evidence contracts. Canonicalize validated scope and harmless read-input representations before persistence; repair SQL projections in new migrations created with the Supabase CLI. Use company-local inclusive dates to derive exclusive task end instants.

**Tech Stack:** TypeScript, Zod, Vitest, PostgreSQL 17, Supabase CLI/MCP.

**Design System:** N/A; no visual changes.

**Required Skills:** systematic-debugging, custom-skills:writing-plans, custom-skills:executing-plans, test-driven-development, supabase, ops-copywriter, verification-before-completion.

## 1. Validated grant scope order
- Add a full 21-scope regression in `src/lib/agent-control-plane/services/customer-update/__tests__/customer-update.test.ts` using the existing real principal constructor, actor resolver, service and repository.
- Observe failure, replace locale-dependent sorting in `actor/principal-boundary.ts` with ASCII canonical ordering, and rerun grant/actor/customer-update security tests.

## 2. Conversation projection repair
- Read the complete live v3 implementation and wrappers; map every provider-backed projection to downstream references.
- Create a new corrective migration using `supabase migration new`; preserve grants, security attributes, predicates, authoritative provider data, and redaction.
- Reproduce failure and prove the public compatibility chain in a disposable PostgreSQL 17 database with empty, populated, evidence, redacted and denied fixtures. Test migration replay and drift protection.

## 3. Task schedule consistency
- Inspect canonical schedule SQL, Bible and live task dates. Cover context, list filtering, overdue/work queue and project summary paths that consume task boundaries.
- Add fixtures for single/multiple all-day dates, spring/fall DST, timed and incomplete dates.
- Correct read projections without business-row edits and prove cross-tool agreement.

## 4. Read input contracts
- Normalize ordering only on harmless user selections; retain duplicate, unknown-value, identity and authority rejection.
- Accept documented UTC timestamp precision at read input boundaries; retain strict canonical evidence/output schemas.
- Advertise conditional financial components, job kinds and opportunity/project section requirements in emitted tool schemas/descriptions.
- Exercise the advertised schema and service boundary with original failed inputs plus negative security cases.

## 5. Closeout
- Run focused regression suites, type-check and lint. Record baseline failures separately.
- Commit only owned paths; update Bible API/data chapters and repair spec with exact migration and proof.
- Request approval for the exact production migration and push/deploy. After approval, rerun authenticated Maverick read/no-change workflows and independently verify no unintended effects.

## Completion evidence

Steps 1–4 are implemented and locally verified. Step 5 verification is complete: 892 application tests, 60 SQL assertions, two reproduced SQL failures, replay/drift checks, full type-check and focused lint. Bible updates and atomic local commits accompany the repair. Production migration/push and authenticated post-release replay remain approval-gated. The verification report records the separate existing B.C. timezone-data mismatch without claiming this repair updates platform timezone data.
