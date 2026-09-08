# Phase 15 financial document approval

**Goal:** Prepare and save one exact operator-approved estimate or additional-scope change-order draft, preserving financial history and prohibiting delivery, acceptance, invoicing and accounting effects.
**Architecture:** Extend the host-neutral capability service and existing named-actor approval queue. PostgreSQL owns source validation, decimal arithmetic, private-draft custody, atomic numbering/line persistence and receipts. New contracts remain dormant; existing v20/v14/v9 activation is preserved.
**Design system:** `/Users/jacksonsweet/Projects/OPS/ops-design-system/project/DESIGN.md`; existing approval detail and dictionary patterns.
**Required skills:** brainstorming, custom-skills:writing-plans, custom-skills:executing-plans, using-git-worktrees, supabase, test-driven-development, requesting-code-review; OPS design/copy/interface/frontend/audit skills for the approval component.

## Verified baseline

- Web/Bible isolated at upstream `37da7dee3` / `4fb081c`.
- Live estimates have `version`, `parent_id`, draft status and generated numeric line totals. No canonical atomic draft-create RPC exists: the web service reserves a number, inserts a header, then separately inserts lines.
- Estimate and line triggers call `enqueue_accounting_sync` without a draft exclusion. Customer portal draft visibility needs an explicit boundary.
- The admin `spec_change_orders` table belongs to OPS's own spec-business surface and is not a tenant job change-order model. Do not reuse it.
- Phase 8 is ephemeral calculation only. Preserve its contract.
- Financial quantity storage is numeric(10,3), unit prices numeric(12,2), tax fraction numeric(6,4); generated line total rounds the discounted quantity extension/minimum floor to two decimals.

## Execution

1. Complete live schema/RLS/ACL, provider, portal and revision audit. Capture only schema/function evidence under docs/artifacts/phase15. Reconcile change-order document representation with existing product semantics.
2. Write failing strict request/preview tests: exact identities and source hashes, decimal strings, explicit adjustment base, complete content, dates/currency, prohibited hidden fields and unsupported transitions.
3. Add canonical transactional private draft persistence, immutable document-kind/currency/scope metadata and revisions using estimates/line_items. PostgreSQL validates complete inputs, source authority and totals. Preparation allocates no official number. Draft custody prevents provider and customer-portal effects.
4. Add private sealed proposal/approval ledger using existing actor/grant permission resolver, 30-minute expiry, exact action binding, deterministic commit key, source and effect-policy rechecks, atomic receipt/readback. Reject/replay reauthorize. No migration activation seeds or real business fixtures.
5. Wire dormant manifest v23 / exposure v17 (prospective consent v12 remains absent), typed service/repository/runtime and existing approval queue. Preserve earlier candidates and active catalogue.
6. Render the complete line-by-line document, pricing attribution, tax/discount/deposit calculations, source and revision differences, inclusions/exclusions and effects using existing tokens and dictionaries. Exact save only; no shortcut/bulk/autonomous approval.
7. Disposable PostgreSQL negative/positive/concurrency proof; focused app regressions, typecheck/build, independent boundary review, visual proof. Update Bible chapters/spec/migration mirror with exact limitations.
8. Release only verified dormant software under standing push/deployment permission. Production migration awaits its tool-enforced exact approval after tested SQL is concrete. Never activate financial scopes/grants or create a customer-document canary under this phase's software authorization.


## Resolved approval presentation

The existing action-detail panel stays the single review surface. Explored structures: (1) hierarchical document — identity → scope/terms → priced lines → total/effects → save; (2) comparison grid — previous/proposed columns; (3) sequential step flow — source → lines → approval; (4) hybrid inspector — full current proposal with previous document disclosure. Chosen: hierarchical proposal with a previous-revision disclosure. It fits the existing desk, keeps the complete document visible, and lets revisions expose every old value without adding a wizard. Existing Mohave/Cake/JetBrains typography, spacing, hairline and focus tokens are used; no new colors, radii, fonts or motion values were introduced.

Local implementation and bounded independent review are complete. Exact verification and fixture limitations are recorded in `docs/artifacts/phase15/README.md`. Production migration approval is the remaining release gate; financial exposure/consent/policy enrollment and real-document canary remain separately dormant.
