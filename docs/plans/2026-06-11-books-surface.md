# Books Surface (P3.1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `/books` — the unified financial hub (Direction A "Instrument Strip", approved by Jackson 2026-06-11) — absorbing Estimates, Invoices, Accounting, the cashflow placeholder, and the expense review hub, at 100% capability parity.

**Architecture:** One client page at `src/app/(dashboard)/books/page.tsx` driven by URL params (`?segment=invoices|estimates|expenses|sync`, `?view=`, `?action=`, `?status=`). A global period-scoped **ledger strip** (4 instrument tiles fed by a new `BooksService`) sits above a segmented working area that reuses the absorbed pages' hooks/modals restyled to the approved pixels. Registry swap + middleware redirects land in one atomic commit (master plan §6 transition rule).

**Tech Stack:** Next.js 14 app router, TanStack Query, Zustand stores (auth/permissions), Supabase, lucide-react, Framer Motion (EASE_SMOOTH only), `useDictionary` i18n (en+es).

**Design System:** `ops-design-system/project/DESIGN.md` + `colors_and_type.css` tokens via the project Tailwind theme. Approved mockup: `docs/design/2026-06-11-books-mockups/direction-a-instrument-strip.html` (+ `books-direction-a.png`).

**Required Skills:** `frontend-design`, `interface-design`, `animation-studio:animation-architect` + `web-animations` (strip count-ups/bar-grows), `animation-studio:data-visualization` (tile viz), `ops-copywriter` (any new copy), `audit-design-system` (pre-commit check).

**Authoritative inputs:** `docs/specs/2026-06-11-books-capability-inventory.md` (capability IDs E1…, I1…, A1…, R1… referenced below), master plan §2/§4/§6.

---

## Decisions locked in this plan

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Segments: `INVOICES \| ESTIMATES \| EXPENSES \| SYNC`; default `invoices` | iOS order + SYNC home for A6/A7 (gated, invisible to most users) |
| D2 | A/R view lives at `?segment=invoices&view=aging` | Master plan §2 row 5 mapping |
| D3 | Permission model per inventory §7 (`anyOfPermissions` added to registry type) | iOS any-of pattern; never role filtering |
| D4 | BOOKS nav icon = lucide `Calculator` | Traceable to `OPS-ICON-SET-BRIEF.md` `nav-finance` concept |
| D5 | Old per-tab MetricsHeader (E1/I1/A1) parity → compact mono **segment stat line** above each table (e.g. estimates: `PENDING $46,900 · APPROVAL 64% · CONVERT 78%`), reusing `MetricsService` per-tab fetchers | Direction A drops the heavy header; data parity preserved in strip + stat line |
| D6 | Ledger strip tiles: NET (period), CASH FLOW (weekly nets, period), A/R (all-open, scope badge), JOBS (period) — permission-filtered per inventory §7; strip hidden entirely without `accounting.view` | iOS card semantics adapted; research (P3-1-1) confirms A/R + per-job profit are the loved surfaces |
| D7 | Period selector: 8 options (30D/90D/6M/1Y/THIS MONTH/LAST MONTH/THIS QUARTER/YTD), persisted `localStorage("books.period")`; segment persisted `localStorage("books.segment")` only as default when no `?segment=` | iOS PeriodPill parity |
| D8 | Drill mechanic: NET `OUT`→expenses; A/R tile→invoices+`status=past_due` drill chip; strip drills set `?segment=&status=` and render a dismissible rose chip | iOS drill-chip parity |
| D9 | Redirects implemented in `src/middleware.ts` (param-aware map, 308), per inventory §6, incl. `/books/cashflow` and `/money/cashflow` | Middleware already hosts CALIBRATION precedent; works for stored action_urls |
| D10 | `?status=` URL param now honored by invoices/estimates segments (old pages ignored it; dashboard widgets already emit it) | Free parity upgrade, kills a latent dead-link class |
| D11 | Nothing auto-sends; all sends remain explicit user actions | Research P3-1-1 (QB auto-reminder rage) + inbox posture |

---

## Task 0: Docs commit (inventory + mockups + plan)

**Files:** `docs/specs/2026-06-11-books-capability-inventory.md`, `docs/design/2026-06-11-books-mockups/*`, `docs/plans/2026-06-11-books-surface.md`
**Step:** `git add` by name → `docs(books): P3.1 capability inventory, approved direction-A mockups, implementation plan`

## Task 1: Books data layer

**Files:** Create `src/lib/api/services/books-service.ts`, `src/lib/hooks/use-books.ts`; Modify `src/lib/api/query-client.ts` (query keys), `src/lib/hooks/index.ts`.
**Pre-step (mandatory):** verify `payments`, `expenses`, `invoices`, `expense_project_allocations` column names/types via Supabase MCP `list_tables` before writing queries — never guess.
**Contract:** `BooksService.fetchLedger(companyId, period): Promise<BooksLedger>` where `BooksLedger = { net, paymentsIn, expensesOut, marginPct, weeklyNets: {weekStart, net}[], avgPerWeek, lowWeek, ar: {total, buckets: {b0_30, b31_60, b61_90, b90p}, topChase: {clientName, amount} | null, overdueTotal, overdueCount}, jobs: {profitable, losers, avgMarginPct, bars: {projectId, title, net}[]} }`. Period windows mirror iOS (Mon-start weeks). A/R ignores period (all open, non-draft/void, balance>0). Jobs: revenue = in-period payments on project-linked invoices; cost = in-period `expense_project_allocations` (amount fallback `expense.amount × percentage/100`); join is string-on-string (allocations.project_id is text).
**Test:** `tests/unit/services/books-service.test.ts` — bucket boundary math (due today→current; 30/31, 60/61, 90/91), weekly net aggregation across month boundary, jobs fallback math, empty-data shape (zeros + null topChase). Run `npx vitest run tests/unit/services/books-service.test.ts` → green.
**Commit:** `feat(books): period-scoped ledger service + hooks`

## Task 2: Page shell, params, dictionaries

**Files:** Create `src/app/(dashboard)/books/page.tsx`, `src/components/books/books-page.tsx`, `src/i18n/dictionaries/en/books.json`, `src/i18n/dictionaries/es/books.json`; Modify dictionary registry if namespaces are enumerated.
**Behavior:** read `segment/view/action/status` via `useSearchParams`; invalid → defaults (D1/D7); segment switch = `router.replace` (params preserved minus stale `view`); per-segment permission visibility (inventory §7); `usePageTitle` comes from registry post-swap (no hardcode).
**Copy:** all strings through `useDictionary("books")`, en+es complete, OPS voice (`// LEDGER`, `ALL OPEN`, `—` empties; no exclamation points).
**Commit:** `feat(books): /books shell with segment routing + i18n`

## Task 3: Ledger strip (instrument tiles)

**Skills:** `web-animations` + `data-visualization` loaded before this task.
**Files:** Create `src/components/books/ledger-strip.tsx`, `src/components/books/tiles/{net-tile,cashflow-tile,ar-tile,jobs-tile}.tsx`, `src/components/books/period-pill.tsx`, shared `src/components/books/tile-shell.tsx`.
**Pixels:** match mockup — `glass-surface` tiles r-10, `// NET`-style mono-11 headers, mono-600-22 headline numbers (tnum+zero), margin meter (h-4px r-2 olive), sparkline SVG (white 0.45 stroke, rose dip dot), aging ramp (tan→#D4A574→rose→brick), diverging bars (olive/rose around hairline axis). Strip header: `// LEDGER` left, PeriodPill right.
**States:** per-tile skeleton; empty = `$0`/`—` + `// NO DATA` label; per-tile error w/ RETRY (fail-soft like iOS).
**Motion:** 800ms count-up + 400–600ms bar/ramp grow, EASE_SMOOTH, stagger 50ms; `prefers-reduced-motion` → instant values, 150ms opacity only.
**Drills:** D8.
**Commit:** `feat(books): ledger instrument strip with period-scoped tiles`

## Task 4: Invoices segment (+ A/R view)

**Files:** Create `src/components/books/segments/invoices-segment.tsx`, `src/components/books/segments/ar-aging-view.tsx`, shared `src/components/books/segment-toolbar.tsx` (seg control + search + primary CTA + chips + stat line + drill chip).
**Parity:** I1–I13 (table cols incl. PAID/BALANCE, rose due dates `MMM DD · ND`, PDF/send/record-payment/void/delete actions, form + payment modals reused from old page — extract modals to `src/components/books/modals/` unchanged in behavior), `?action=new` + setup gate, `?status=` (D10). A/R view: A2 aging bars, A3 top clients, A4 status breakdown, `LIST | AGING` toggle right-aligned in toolbar (only with `accounting.view`).
**Commit:** `feat(books): invoices segment with A/R aging view`

## Task 5: Estimates segment

**Files:** Create `src/components/books/segments/estimates-segment.tsx`; move/reuse estimate form modal + SendEstimateFlow.
**Parity:** E1–E14 (status filters, convert-to-invoice, PDF, send flow, setup gate; stat line per D5; FAB `create-estimate` window untouched — NEW ESTIMATE CTA opens the same window via `useWindowStore` (R1) instead of the legacy inline modal *if* window provides create parity; otherwise keep inline modal. Verify `CreateEstimateForm` capabilities before choosing; document outcome).
**Commit:** `feat(books): estimates segment`

## Task 6: Expenses segment

**Files:** Create `src/components/books/segments/expenses-segment.tsx` mounting `ExpenseReviewDashboard` (A5) unchanged behaviorally; restyle container chrome only to match toolbar.
**Commit:** `feat(books): expenses review segment`

## Task 7: Sync segment

**Files:** Create `src/components/books/segments/sync-segment.tsx` (connection cards + history + explainer from accounting page, A6) with `?view=import` mounting `QuickBooksImportTab` (A7); `CONNECTIONS | IMPORT` toggle.
**Commit:** `feat(books): sync segment (integrations + QuickBooks import)`

## Task 8: THE SWAP (single atomic commit — transition rule)

**Files:** Modify `src/lib/navigation/route-registry.ts` (remove estimates/invoices/accounting entries; add `books` order 6, icon Calculator, `labelKey:"nav.books"`, `anyOfPermissions` per D3; extend `RouteEntry` type + `getPermissionForPath`/sidebar/palette consumers — grep all `permission` readers), `src/i18n/dictionaries/{en,es}/navigation.json` (`nav.books`), `src/middleware.ts` (redirect map per inventory §6 + `/books` protected prefix), `src/lib/constants/fab-actions.ts` (R2), `src/app/api/integrations/quickbooks/import/apply/route.ts` (action_url → `/books?segment=sync&view=import`).
**Verify before commit:** every consumer of the registry handles `anyOfPermissions`; `getNumberShortcutRoutes` ordering still 1–9; no nav entry 404s.
**Commit:** `feat(books): swap nav registry to BOOKS + param-preserving redirects for retired financial routes`

## Task 9: Widget + internal link retarget

**Files:** Modify dashboard widgets per inventory R5 (~20 sites) to point at `/books?...` directly (single mechanical commit; redirects already guarantee correctness).
**Commit:** `refactor(books): retarget dashboard widget links to /books`

## Task 10: Retire old pages

**Only after Task 11 verification passes.** Delete `src/app/(dashboard)/estimates/`, `invoices/`, `accounting/`, `money/cashflow/` (middleware redirects own those paths now). Keep old prefixes in middleware protected list (redirects fire first).
**Commit:** `refactor(books): retire absorbed estimates/invoices/accounting/cashflow pages`

## Task 11: Live verification (before Task 10's commit)

Run via existing `overhaul-shell` launch entry (port 3017, dev:webpack). Viewport ≥768px. Exercise: every segment + view + drill chip + period change; `?action=new`; every redirect from inventory §6 (incl. param preservation `/invoices?action=new`, `/invoices?status=past_due`, `/accounting?tab=import`); permission gating via demo users (pete/tom/mike/nick); command palette + number shortcuts + top-bar title; FAB actions. Screenshot gallery → `docs/design/2026-06-11-books-mockups/verification/`. Console clean.

## Task 12: Bible + decision log (same session)

**Files:** `ops-software-bible/02_USER_EXPERIENCE_AND_WORKFLOWS.md` (web Books subsection near §15), `ops-software-bible/09_FINANCIAL_SYSTEM.md` (OPS-Web Books surface section), master plan `docs/specs/2026-06-11-web-overhaul-master-plan.md` §9 decision log append (direction A approval, D1–D11, wave outcome).
**Commits:** bible in ops-software-bible repo; master-plan append on this branch: `docs(books): record P3.1 wave outcome in master plan decision log`
