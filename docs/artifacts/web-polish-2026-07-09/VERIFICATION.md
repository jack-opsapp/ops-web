# Whole-batch adversarial verification — web polish (feat/web-polish-batch)

**Date:** 2026-07-13
**Branch:** `feat/web-polish-batch` (~35 commits ahead of `main`)
**Verifier:** independent agent (did not author the code)
**Scope:** 268 files, +5,163 / −6,733 (net −1,570 — the batch deletes more than it adds; large dead-code retirement of the old expense-batch UI, orphaned metrics viz, and bespoke undo-toast components).

## Verdict

**SHIP-READY.** All 8 workstreams PASS. No batch-introduced regression found — static, test, and live evidence all clean. Every "failure" surfaced during the sweep traced back to the environment (shared-`node_modules` churn from a sibling `npm install`, dev-bypass session TTL, webpack dev OOM), never to the batch's code. Two items are intentionally deferred to founder taste review (below); a handful of low-severity design-system findings are inherited pre-existing convention, not new breakage.

## Per-workstream results

| # | Workstream | Result | Evidence |
|---|------------|--------|----------|
| 1 | Toast unification | **PASS** | Tests (`toast-undo`, `oauth-return`, 3 inbox files) + live connectivity cycle: OFFLINE / BACK ONLINE unified toasts fire |
| 2 | Metrics flip | **PASS** | Live: catalog metrics click-to-flip reveals formulas ("0 below min ÷ 0 tracked", "3 costed ÷ 67 items"); `metrics-strip-flip` test passes |
| 3 | Toolbar cohesion | **PASS** | Live: books workbar constant 96–97px across all 4 segments; pipeline toolbar uses shared chip idiom; `pipeline-filter-chips` test passes |
| 4 | Catalog fixes | **PASS** | Live: + ADD → "NEW PRODUCT" modal, **no doubled plus**; SUPPLY→PRODUCTS relabel; setup scroll fix (`min-h-screen`→`min-h-0`) + breadcrumb `CATALOG // SETUP` (route-registry test, 42 pass) |
| 5 | Books expenses + switching | **PASS** | Live: all 4 segments switch cleanly, constant chrome, sync `QUICKBOOKS · LIVE` badge pinned in Row 1, zero console errors during switching |
| 6 | Pipeline polish | **PASS** | Live: dense cards, connect-email menu shows **both** Gmail + Outlook, FOCUSED↔TABLE mode switch works, `pipeline-focused-mode` test passes |
| 7 | Clients quick actions | **PASS** | Live: window footer NEW ESTIMATE/PROJECT/INVOICE unclipped; NEW ESTIMATE opens **seeded with the client** (Abercrombie pre-filled) |
| 8 | Projects default view | **PASS** | Live: lands ALL/31 with stored view cleared; chip round-trip ALL 31→My Active Work 9→ALL 31; settings menu shows "Set as default" |

Verification screenshots: `docs/artifacts/web-polish-2026-07-09/_verify/` (working-state evidence, not committed).

## 1. Static sweep

**Scope** — `git diff main..HEAD --stat`: 268 files. Heavy deletions (batch-detail-panel/batch-list/batch-line-table, expense-buckets/expense-metrics utils, MetricColumn + Mini* viz, bespoke pipeline/projects undo-toast divs, inbox undo-toast) replaced by the canonical toast + one-list expenses console.

**Typecheck** (`npx tsc --noEmit`) — **no NEW errors.**
- 296 total errors, but 285 are the pre-existing `@playwright/test` module-resolution failures in `tests/e2e/**` and `tests/visual/project-workspace.spec.ts` (test scaffolding, not shipped code).
- Non-e2e: only the 2 known-pre-existing `notification-service.test.ts` type errors + 9 Playwright-import errors in the visual spec.
- **`xlsx` now RESOLVES** (v0.20.3 present in the shared `node_modules`, `require.resolve` succeeds). The "5 xlsx tsc errors" noted in the brief are **not present in the current environment** — `catalog-setup` typechecks clean and its route will not 500 on the xlsx import.

**Tests** (vitest, batch-touched files) — **181 pass, 1 known-pre-existing fail:**
- PASS (11 files / 134 tests): `gmail-oauth-callback-return`, `pipeline-focused-mode`, `projects-table-v2-edit-core`, `projects-table-v2-phase5`, `metrics-strip-flip`, `use-project-view-actions`, `route-registry` (42), `pipeline-filter-chips`, `pipeline-focused-card`, `toast-undo`, `oauth-return`.
- PASS (3 inbox files / 47 tests): `inbox-route-navigation`, `recategorize-menu`, `snooze-picker`.
- **FAIL (1):** `projects-table-v2-phase4.test.tsx` → "uses Cmd/Ctrl+A for visible rows only…" — the **known pre-existing** jsdom keyboard-selection limitation. Confirmed NOT caused by the batch: the batch's edits to this file (undo-toast mock migration, `t()` interpolation) do not touch the failing test region, and the "// 1 SELECTED" label is interpolated via `formatText`, not the mocked `t()`, so the mock change is irrelevant to the failure.

## 2. Design audit (production code, added lines only)

No novel egregious violation. Findings are inherited pre-existing convention:

| Severity | Finding | Location | Notes |
|----------|---------|----------|-------|
| Low–Med (DS compliance) | Hardcoded earth-tone hex (`#C4A868`/`#9DB582`/`#93321A`/`#6F94B0`) instead of the existing tokens (`text-status-warning`/`success`/`error`, `text-ops-amber`, `bg-olive`/`tan`, `text-brick`) | new/reworked expense components: `expense-line-item-table.tsx` (10), `auto-approve-rule-form.tsx` (6), `reject-confirmation-modal.tsx` (5), `invoice-detail-panel.tsx` (2), `invoice-card.tsx` (2), `expense-filters.tsx` (1) — ~26 added lines | **Systemic:** 107 files codebase-wide already hardcode `#C4A868` alone. The new components followed the established (non-ideal) pattern. Not a functional bug; a token-migration candidate, not a batch blocker. |
| Low | `rounded-full` on non-avatar status pills | `expense-line-item-table.tsx` (3 badge spans), `invoice-detail-panel.tsx` (1) | 16 pre-existing files use the same pill idiom; avatars (20px/36px `rounded-full`) are correct. |
| Low | Selected-state border uses hardcoded `border-[#6F94B0]` instead of `border-ops-accent` | `auto-approve-rule-form.tsx` | Inconsistent with the newer `invoice-card.tsx` which correctly uses the token. |
| Info | Catalog metrics region keeps `ariaLabel="SUPPLY"` after the visible "SUPPLY" label was dropped in favor of "PRODUCTS" | `catalog/supply-strip.tsx:154` | Not a bug — a region needs an accessible name; arguably could be re-worded to match the new framing. |

**Accent usage is correct.** Steel-blue (`ops-accent`) appears only on primary CTAs (NEW INVOICE / NEW PRODUCT / NEW LEAD / EDIT) and focus rings. No accent leak on data bars — projects progress bars render olive-green (verified live). The `invoice-card.tsx` selected-row accent rail is properly tokenized (`border-l-ops-accent bg-ops-accent/[0.06]`) — this is a founder-review item, not a violation.

**Numerals** — mono/tabular throughout (verified live: `$` amounts, `%`, counts all JetBrains Mono).

## 3. Live cross-workstream sweep (Playwright MCP, dev-bypass, 1440×900)

The built-in preview renderer wedged on this heavy authenticated app; drove the sweep via Playwright MCP instead. Real seeded tenant (operator PETE, 44 invoices / 26 estimates / 31 projects / 68 clients / 6 pipeline deals).

- **(a) Books** — all four segments switch cleanly (invoices→estimates→expenses→sync); search placeholder tracks the segment ("Search invoices…"→"Search estimates…"), expenses/sync correctly drop the search; sync shows the `QUICKBOOKS · LIVE` badge pinned in Row 1 + `SYS :: LINKED` panel. Pinned workbar measured constant at **96–97px across all four** (matches the workstream's `measurements.txt`). **Zero console errors during repeated switching.**
- **(b) Catalog** — renders clean; metric relabeled `// PRODUCTS 45%` (SUPPLY dropped); + ADD → **"NEW PRODUCT" modal with no doubled plus**; metrics **click-to-flip** reveals formulas on the back face. `catalog/setup`: breadcrumb `CATALOG // SETUP` is route-registry-test-locked, scroll fix verified in code, xlsx resolves so no 500. (Live setup screenshot not captured — server crashed at end of sweep; covered by test + code + xlsx resolution.)
- **(c) Pipeline** — dense kanban cards render (narrow drag handle, merged meta lines, mono amounts); connect-email menu opens with **both** "Gmail / Google Workspace" and "Microsoft 365 / Outlook"; FOCUSED↔TABLE switch works (full table: DEAL/STAGE/CLIENT/VALUE/WIN%/WEIGHTED/AGE/LAST ACTIVITY/NEXT FOLLOW-UP, density toggle, saved-view chips, footer totals). Zero console errors.
- **(d) Clients** — client window opens with footer quick actions NEW ESTIMATE / NEW PROJECT / NEW INVOICE / EDIT, **fully visible/unclipped** (the async-dict stable-slot-id fix works); NEW ESTIMATE opens **seeded with the client**. Zero console errors.
- **(e) Projects** — with `ops_projects_table_v2_view_id` + stored default cleared, lands on **ALL / 31 rows**; chip round-trip ALL 31 → My Active Work 9 → ALL 31 (clean); saved-view "View actions" menu shows **"Set as default"** (+ Rename/Duplicate/Share/Reset). Zero console errors.
- **(f) Connectivity** — CDP offline → toast **"OFFLINE — Changes sync when connection is restored."**; online → toast **"BACK ONLINE"** (unified canonical toasts; the BACK-ONLINE clears the stale offline payload).

**Not fully live-verified (covered by other evidence):** drag-a-card-then-Escape-cancel (covered by `pipeline-focused-mode` test + the workstream's `03-drag-in-progress.png`/`04-drag-restored.png`); catalog/setup rendered page (test + code + xlsx resolution).

## 4. Console triage

**Zero persistent console errors** on any page after full hydration. Transient errors seen mid-sweep were all environment, all cleared on reload/re-auth:
- `Cannot resolve '@tanstack/react-query'` / `'@radix-ui/react-select'` (500 on /books + /dashboard) — a sibling session's `npm install` transiently pruned packages from the **shared** `ops-web/node_modules` (confirmed by concurrent `ENOENT rename` webpack-cache errors). Both imports are **pre-existing** (unchanged by the batch); both modules are present and `require.resolve` succeeds. Cleared after cache-clear + server restart.
- `feature-flags fetch 401` — dev-bypass token TTL expired after ~40 min; re-triggering `/api/dev/bypass-token` restored auth.
- Pipeline / estimate-form raw i18n keys on first paint (`mode.*`, `filter.*`, `email.*`, `ESTIMATES.FORM.*`) — a **transient hydration FOUC** from the app-wide client-side `useDictionary` async load; every key exists in the dictionary with a correct translation and resolves within ~1s. Pre-existing pattern, not batch-specific — noted as a caveat, not a bug.

## Founder-review items (taste, not correctness)

1. **Expenses selected-row accent rail** — `src/components/expenses/invoice-card.tsx:69` (`border-l-ops-accent bg-ops-accent/[0.06]`). Tokenized and intentional; queued for founder taste review per the batch's own note.
2. **Lead-detail window relayout** — proposals in `docs/artifacts/web-polish-2026-07-09/pipeline/lead-detail-audit.md`.

## Pre-existing environment issues (NOT from this batch)

- `@playwright/test` module-resolution errors across `tests/e2e/**` + `tests/visual/**` (285 tsc errors in test scaffolding).
- `notification-service.test.ts` — 2 type errors.
- `projects-table-v2-phase4` Cmd/Ctrl+A selection test — jsdom keyboard limitation.
- CI lint red since May (next lint gates vitest).
- Shared `ops-web/node_modules` churn hazard — a sibling `npm install` transiently prunes/re-adds packages, breaking in-flight webpack compiles (documented behavior).
- Webpack dev server is memory-heavy under sustained multi-route navigation; the preview server OOM-crashed at the end of this sweep (environment resource limit, not app behavior).
