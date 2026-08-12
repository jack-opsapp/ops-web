# Web Catalog Bulk Variant Expansion — Implementation Plan

**Goal:** Ship the approved Catalog STOCK `Bulk Add Variants` workflow locally, with a migration ready for later approval but no deployment or live mutation.

**Architecture:** A pure TypeScript planner owns normalization, family eligibility, preview math, fingerprints, and request construction. A catalog bulk-variant service owns fixed-count snapshot reads plus the single RPC. A TanStack hook owns mutation recovery and awaited cache refresh. One Radix dialog owns the company-scoped draft and the three-stage interface. PostgreSQL repeats every validation under deterministic locks and records idempotent receipts.

**Stack:** Next.js 15, React 19, TypeScript, TanStack Query, Radix Dialog/Checkbox, Supabase/PostgreSQL, Vitest, Testing Library, Playwright.

---

## 1. Lock the behavioral contract with failing tests

- Add pure planner fixtures covering new-axis expansion, existing-axis source filtering, safe-setting copies, duplicate/no-op values, incomplete assignments, duplicate axes/values/signatures, missing source values, and already-present combinations.
- Add snapshot/service tests for exact source payloads, company scope, RPC arguments, typed server rejections, and request retries.
- Add migration contract tests for authorization, public-role compatibility, deterministic locks, preflight-before-write, stale equality, receipt replay/conflict, preservation, safe clone fields, and forbidden inventory/history writes.
- Run the focused files and capture the expected RED state before implementation.

## 2. Implement the pure planner and service boundary

- Add the bulk snapshot, preview, blocker, combination, request, and response types.
- Implement whitespace/case normalization, structural eligibility, deterministic ordering, signatures, source fingerprints, and preview construction.
- Add a fixed-query family snapshot read and the `catalog_bulk_expand_variants` RPC wrapper to the catalog service layer.
- Add a TanStack family query and mutation that await stock/family refetch on success and refresh stale/conflict state.
- Re-run focused planner/service tests to GREEN.

## 3. Add the atomic migration

- Add the receipt table, RLS policies, least-privilege grants, and normalized active-axis/value indexes.
- Adapt the approved iOS RPC to the live web schema and Firebase bridge.
- Require the active company plus `catalog.manage:all`, grant execute only to `anon, authenticated`, and keep `SECURITY INVOKER`.
- Validate all selected families before the first write; preserve existing variant rows and every inventory/history relationship.
- Run the focused migration contract tests to GREEN. Do not apply the migration.

## 4. Build the guided dialog test-first

- Add component tests for permission visibility, family search, unsafe-row reasons, select-visible safety, stage navigation, field validation, draft restore/isolation, offline apply gating, review expansion, apply-once behavior, stale/error recovery, completion, and exact awaited refresh.
- Add the kebab entry behind `catalog.manage` and mount the dialog only from STOCK.
- Build the three stages with dictionary copy, neutral step chrome, one primary CTA, fixed footer, focus-safe Radix semantics, reduced motion, and narrow-width wrapping.
- Add English and Spanish dictionary keys and dictionary parity assertions.
- Run the focused component/i18n tests to GREEN.

## 5. Update the source of truth and audit the work

- Document the web workflow, planner/RPC contract, receipt table, preservation rules, and unapplied migration in the OPS Software Bible without staging `.DS_Store`.
- Run the wizard failure-mode audit across FAMILIES, CHANGE, and REVIEW.
- Run the OPS design-system audit for hardcoded colors, spacing/radii/type, accent misuse, motion, responsive geometry, keyboard flow, focus, and copy.
- Run the interface-design critique and repair any craft or hierarchy gap.

## 6. Verify and finish the branch

- Run focused unit/integration/migration/component tests.
- Run TypeScript and production build.
- Start `npm run dev:webpack`, verify desktop and narrow widths, keyboard/focus, offline state, reduced motion, and capture screenshots/bounding boxes under `docs/artifacts/` when feasible.
- Re-run the relevant full test suite and distinguish any fresh-origin baseline failures from feature regressions.
- Commit implementation and Bible documentation atomically. Do not push, deploy, merge, apply migrations, or touch live catalog data.

