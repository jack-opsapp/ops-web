# OPS MCP Recurring Price Preview — Phase 7 Implementation Plan

**Goal:** Ship a dormant, fail-closed price-change preview capability that performs golden task 14 without sending or changing anything.

**Lineage:** OPS-Web `50bd43bcaee080de310eee9ad7d18325b37d0738`; Bible `c791ac1ce14ef2b19da8204b9a43520b2c58f42e`.

**Safety boundary:** Active production exposure remains v2. Phase 7 adds only dormant manifest v15/exposure v9 and a local migration. No push, deploy, migration application, client/grant/canary creation, activation, send, confirm, or customer-operation commit. Local Git commits require a separate explicit release handoff.

### Task 1: Lock contracts and safety invariants with failing tests

- Add strict three-field input, authoritative snapshot, preview result, evidence, completeness, and risk schemas.
- Prove unknown fields, invalid/unsafe selectors, invalid decimals and real calendar months, unsafe amounts, duplicate IDs/evidence namespaces, incomplete evidence, false definitive risk, and result overflow fail.
- Prove there is no send/change/commit input or output field.

### Task 2: Add a fail-closed PostgreSQL authority boundary

- Add private price-policy rows and a stable security-definer read RPC.
- Bind actor, tenant, grant, scope ceiling, permission revision, manifest v15, and exposure v9.
- Read one bounded recurrence catalog, prove finite histories that ended before the requested month in the service, then read the selected details together with a fresh catalog under one PostgreSQL statement snapshot. Reject any catalog, selection, identity, or recurrence-evidence drift.
- Resolve exact service/account/pricing/contact/correspondence/tax/recurrence facts with deterministic UTF-8 order, two-row ambiguity sentinels, one result row per client/service identity, a 101-account overflow sentinel, a 10,001 catalog-row sentinel, one 100,000-unit recurrence-classification work budget shared across both catalog passes, and server-side UTF-8 transport bounds. Reject any RRULE outside the non-expanding canonical uppercase alphabet before estimating or building JSON.
- Revoke direct access and function execution from public roles; grant only the read RPC to `service_role`.
- Add exact partial/composite/expression indexes plus migration postflight assertions for index shape/order/readiness, RLS, policies, table ACLs, and arbitrary function grants.

### Task 3: Build the deterministic domain service

- Reauthorize before the bounded reads and after their same-snapshot validation, then run one exact SQL authority assertion immediately before return; classify authority or selected-source races as stale, not unavailable.
- Expand bounded RFC 5545 date rules and exact exceptions for the requested month, fast-forward old series, support sparse century-old COUNT rules, and fail closed before dense COUNT histories exceed the aggregate work budget. Invalid or overflowing target-month exceptions stay conservatively in scope; a recurrence is removed only when its end before the month is proven.
- Perform BigInt percentage and ISO minor-unit rounding.
- Apply notice/grandfather/eligibility gates, produce exact exclusions, and generate OPS copywriter-approved notices.
- Classify churn only from narrowly noun-bound, source-referenced evidence inside a disclosed 8,760-elapsed-hour window; use `unknown` whenever coverage is insufficient and never infer `low` from silence.
- Create stable preview IDs and one canonical plan hash while excluding observation/window timestamps from identity; persist no preview,
  draft, calculated price, or other business content. The shared MCP transport
  still records ordinary rate-limit and audit metadata such as an input digest
  and result byte count.

### Task 4: Wire dormant manifest v15 and exposure v9

- Register `prepare_recurring_service_price_change` in the capability manifest, domain dispatch, runtime, and server factory.
- Make v9 additive to v8 and `read + prepare` only.
- Bridge each inherited v8 tool through its historical manifest/exposure pair or the exact v15/v9 pair; v9 additionally requires the exact 16-scope registered client, serialized scope, v4 consent, and accepted labels.
- Keep `ACTIVE_MCP_EXPOSURE_REVISION` exactly v2.
- Add exact v9 16-scope client-ceiling, eight-scope grant/tool, historical v1/v2 consent compatibility, exact collections-v3 and price-v4 prepare labels, auth, tenant, annotation, operation, and no-commit regression tests.

### Task 5: Prove the real database contract

- Create synthetic setup/runtime SQL for disposable PostgreSQL 17.
- Cover eligible, blocked, grandfathered, stale price, document/line discount ambiguity, ambiguous recipient, unreadable correspondence, notice-too-short, long-distance and sparse-old recurrence rules, duplicate account identities with two supporting recurrence references, conflicting recurrence termination, exact tax-unavailable source shapes, rounding/currency precision, risk-resolution and malformed-payment counterexamples, cross-tenant, stale grant/selection, oversized batch/transport/shared work, escape-heavy RRULE rejection before catalog materialization, and zero-row cases.
- Prove large-table plans for selector, recurrence, exception, contact, provider, and invoice bounds; prove exact catalog guards and full-table content digests across every in-scope business source before/after the read.
- Run SQL contract and runtime suites without touching live data.

### Task 6: Verify, document, and review

- Run focused tests, legacy MCP regressions, typecheck, lint, format, and clean production build.
- Update the Software Bible with the exact dormant contract and truth boundaries.
- Run an independent reviewer, repair every finding, and rerun proof. After an explicit release handoff authorizes local Git commits, commit the Web and Bible worktrees atomically and leave them unpushed.
