# Phase 16 financial readiness implementation plan

**Goal:** Make exact held estimate/change-order preparation ready for separately authorized company enrollment and host acceptance.
**Architecture:** Extend the Phase15 private policy ledger with owner-bound preview/enrollment/revocation and readiness. Reuse the financial source, authority, exact OPS approval and durable receipt contracts. Recognize only a three-tool v17/v12/v23 trial bound to exact company/actor/client, approved policy hash, reviewed effect hash and at most two hours. Public defaults stay v14/v9; no business seeds or effect-fingerprint renewal.
**Tech stack:** PostgreSQL 17, Next.js, TypeScript, Zod, Vitest.
**Design system:** OPS design-system/project/DESIGN.md; existing Tailwind tokens and review components.
**Required skills:** superpowers:brainstorming; custom-skills:writing-plans; custom-skills:executing-plans; supabase:supabase; superpowers:test-driven-development; superpowers:verification-before-completion; custom-skills:ops-design; ops-copywriter:ops-copywriter; interface-design; frontend-design; ui-ux-pro-max; audit-design-system.

## 1. Verify baseline and source evidence

- Fetch exact main; isolated web/Bible worktrees. Read Phase15 contract and local proof, live schema/RLS/functions and exact relevant company records.
- Record current gates and separately label authenticated connector read evidence.
- Run focused existing financial contract/service baseline.

## 2. Owner policy setup and readiness

- Write failing SQL cases for exact owner identity plus current granular settings.company and financial permissions, source mismatch/cross-tenant/null, immutable revisions, concurrent enrollment, changed company/tax/source, revoked policy and same-key replay.
- Add a generated migration with private force-RLS preview/audit tables, source/current authority checks, bounded exact owner preview/enroll/revoke/readiness RPCs, service-only ACLs. Reuse private.financial_document_policies; never populate business data in migration.
- Enrollment binds exact source note row/hash, fields, owner, company, current policy, current currency/tax and expiry. Retirement preserves content. Policy lifecycle participates in financial source staleness.
- Do not update financial_document_effect_policy; new functions must leave the vertical closed pending explicit reviewed graph installation.

## 3. Application review and candidate consent

- Write strict Zod/repository/API tests before implementation; tenant/actor from authenticated OPS session only, no tool-supplied identity.
- Bounded OPS owner policy review page uses existing tokens/components and dictionaries, inert note content, exact read-only preview and explicit enroll/revoke controls. No automatic enrollment or setup on page visit.
- Add immutable v12 consent with exact preparation-only description and a restricted financial v17 exposure. Keep public active v14/v9. Recheck exact subject binding at consent preview/decision, code exchange, bearer, refresh and financial dispatch.
- Extend the existing canary binding ledger with immutable approved-policy/effect hashes and two-hour expiry. Keep v3 compatibility, service-only provisioning, exact revocation and financial holds. Reject scope expansion, stale policy/source/tax/owner/effect, disabled/expired binding and changed consent.

## 4. Repeatable acceptance

- Extend isolated PostgreSQL harness to run the owner enrollment path and golden historical quote +8%, baseline/revision and adversarial controls. Use fictional companies only, no production connections/credentials.
- Run focused financial contracts/services, approval, custody and consent tests; typecheck changed integration. Review SQL privileges and mutation paths, tokens/accessibility, stale/replay and effect gates.
- Keep Claude and ChatGPT authenticated acceptance as separate unproven gates until exact approval and matching account access exist.
- Run a fresh loopback financial protocol through actual HTTP route handlers, production MCP runtime composition, real OAuth/financial SQL, named OPS approval service, exact arithmetic/receipt/readback, expiry and racing revocation. Only the external signed-in identity provider and local database transport are adapted.
- Build production with inert credentials and no synchronization against real accounts.

## 5. Closeout

- Record concise company/actor/source/policy/canary proposal or exact missing business inputs, durable records expected and stop/revocation rules.
- Update Bible API, architecture and financial chapters, Phase16 spec and useful proof under docs/artifacts/phase16.
- Commit only this work. No push, migration application, deployment, enrollment, grant/exposure activation or real financial trial without direct exact Phase16 authority.
