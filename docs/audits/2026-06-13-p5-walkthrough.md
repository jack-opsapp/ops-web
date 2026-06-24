# P5 — Final Pre-Merge Gate · OPS-Web Overhaul

**Phase:** WEB OVERHAUL — P5 (the gate that protects 179 commits before `feat/web-overhaul` merges)
**Run date:** 2026-06-24 · **Branch:** `feat/web-overhaul` (tip `4f99ace0` → +4 gate commits) · **Worktree:** `ops-web-overhaul-p2-shell`
**Scope:** three jobs, then a flat verdict. This wave does **not** merge or push — it verdicts. Merging is Jackson's call.

> **Why this re-runs the 2026-06-23 pass:** the prior P5 walkthrough (`1ce4137b`, verdict PUSH) was followed by a **material shell redesign** (`904e175a`…`4f99ace0`): the right-edge tabs were replaced by a command-first **CreateCluster**, the **notifications drawer** was rebuilt as a no-card gradient, and the **top bar** became a gradient-scrim cluster with a notifications bell. That post-dates the prior verdict, so the shell is re-verified here. The prior pass also never ran the **mechanical build gate** (Job 1) nor executed the **Job-2 cleanup** — it only flagged them. Those are done here.

---

## VERDICT — ✅ GO (ready to merge)

`feat/web-overhaul` introduces **zero** new build, test, or visual regressions. Every overhaul-introduced failure found by the build gate was fixed in-wave (4 atomic commits); the live walkthrough of all eight surfaces + shell + redirects at desktop (1440) and tablet (768) found **no blocking defect**. The residual red in the branch's own suite is fully accounted for and is **not** overhaul debt:

- **10 of 11 residual test failures are "branch-behind-main"** — `origin/main` fixed them in the 19 commits the branch diverged from (2026-06-11). The branch never touched those files (`branch-Δ=0`), so a merge cleanly adopts main's passing version. Proven: they **pass on `origin/main` in isolation** and **fail identically on the branch**.
- **The remaining failure + the 1 "failed suite" are pre-existing** (red on `origin/main` too): the QBO import-apply notification-url test and a Playwright visual spec that vitest collects but can't run.
- **`next lint` is red (70 errors) but does not gate the build** — `next.config.ts` sets `eslint.ignoreDuringBuilds: true`, and this is the documented "CI red on main, PRs merge through" baseline. The 2 lint errors the overhaul *did* introduce (empty prop interfaces) were removed in-wave.

Net effect of a merge on `main`'s test state: **no new reds.** The overhaul's own surface is green.

**One taste call for Jackson** (non-blocking): the ModePill `CREATING` olive-soft tint — sanction or neutralize (§5). **Recommendation: sanction.**

**Two merge-hygiene notes** (not blockers): (1) bring the branch current with `origin/main` (19 commits) as part of the merge — this auto-resolves the 10 branch-behind reds; (2) the pre-existing `origin/main` reds (QBO test, visual-spec collection, lint) remain the platform's baseline to clean up separately.

---

## JOB 1 — Full-branch build gate

Ran whole-branch (not just touched files): `npx tsc --noEmit`, `npx next lint`, `npx vitest run`.

| Gate | Result | Verdict |
|------|--------|---------|
| **tsc --noEmit** | **exit 0 — clean** | ✅ PASS |
| **next lint** | exit 1 — **70 errors / 394 warnings** | ⚪ pre-existing baseline (does not gate build; `ignoreDuringBuilds: true`) |
| **vitest** (before fixes) | 28 failed / 3909 passed (15 files) | — |
| **vitest** (after fixes) | **11 failed / 3922 passed** (4 files + 1 suite) | ✅ all residual classified non-overhaul |

### Classification method (authoritative)
Every failing file was run **in isolation against `origin/main`** (detached worktree, shared `node_modules`) and **in isolation against the branch**, and cross-referenced with merge-base deltas (`branch-Δ` = commits on the branch touching the file since the 2026-06-11 merge-base; `main-Δ` = commits on `origin/main` since). This separates three classes cleanly:

**A · Overhaul-introduced → FIXED in-wave (17 test failures + 2 lint errors):**

| Area | Root cause (overhaul changed the source/behaviour; test was stale) | Fix |
|------|-------------------------------------------------------------------|-----|
| Workspace atoms ×6 (`btn`, `icon-btn`, `segmented`, `select`, `text-input`, `text-area`) | P4 radius-token codemod standardized `rounded-[5px]` → bare `rounded`; tests still asserted the old arbitrary value | assert `rounded` |
| `mode-pill` | CREATING ships **olive** (`--olive-soft`), not the accent; test asserted `--ops-accent-soft` | assert olive |
| `pipeline-filter-row` | New Lead is the single **filled-primary** accent CTA in every variant; test expected a retired "restrained ghost" | assert the fill |
| `route-registry` ×5 | `/map`, `/products`, `/inventory`, `/team` were **absorbed** (middleware redirects); test asserted old standalone perms / full-height | move to "retired/unregistered" assertions |
| `project-lifecycle-timeline` | admin resolver now uses `getCompanyManagerUserIds` (the role-name-free P4-5 path) reading via `.maybeSingle()`; hand-rolled stub only had `.single()` → threw on the omitted-actor path | add `maybeSingle` to the stub |
| `books-sync-segment` ×2 | component imports `use-accounting` directly (not the barrel the test mocked) **and** was redesigned to one-CONNECT; test asserted removed keys against an empty-connections fixture | retarget the mock + exercise the real branches (connect CTA / importer) |
| `text-input.tsx`, `text-area.tsx` (lint) | net-new empty prop **interfaces** (`no-empty-object-type`) | convert to `type` aliases |

**B · Branch-behind-`origin/main` → resolves on merge (10 failures, NOT touched):**

| File | branch-Δ / main-Δ | Evidence |
|------|-------------------|----------|
| `uploads-presign.test.ts` (8) | 0 / 1 | passes on `origin/main` isolated; main fixed it post-divergence; merge adopts main's version |
| `company-service-images.test.ts` (2) | 0 / 1 | same — branch carries the older copy (`profiles` vs `profiles/co-uuid`) |

**C · Pre-existing (red on `origin/main` too — document, do not block):**

| File | Evidence |
|------|----------|
| `qbo-import-apply-route.test.ts` (1) | fails identically on `origin/main` isolated (`/books?segment=sync&view=import` vs `/accounting`) |
| `tests/visual/project-workspace.spec.ts` (failed *suite*) | a Playwright spec vitest collects but can't execute; `0/0` deltas — unchanged on both sides; matches `vitest.config` include leak |

> Note: the known-flaky `tests/unit/inbox/ai-draft-provenance.test.ts` **passed** this run (13/13).

**Gate commits (this wave):** `f5d6b7fd` (atom type aliases) · `81707a53` (radius assertions) · `fa86bd33` (mode-pill / pipeline / route-registry) · `393e9164` (lifecycle + books-sync harness). tsc clean after; the 6 fixed test files + the 2 source files lint clean; full vitest residual = B+C only.

---

## JOB 2 — Mechanical punch-list

**Already closed by prior sessions — verified, nothing to change.**

- **Dead i18n namespaces** (`sidebar.json`, `breadcrumbs.json`, `pmf.json`, `bug-reports.json`): **deleted** in `be088c9c`. Verified: files absent everywhere, the `Namespace` union (`src/i18n/types.ts`) lists none of them, zero `useDictionary` consumers, no SSR/`server-render` resolution path. ✅
- **Dead `selectIsAdmin*` selectors** (`selectIsAdminOrOwner` / `selectIsAdmin` / `selectIsFieldRole`): **removed** (P4-4/P4-5). Only an explanatory comment remains at `auth-store.ts:219` documenting the migration to granular `can()` — kept (it's documentation, not dead code). ✅
- **Un-i18n'd Schedule side-panel literals** (P4 sweep §4-B): **wired** — `task-detail-panel.tsx` (74 `t()` calls) + `repeat-picker.tsx` (19) both consume `useDictionary`. ✅
- **Deferred (large, secondary-locale — correctly *not* rushed):** the shared `MetricsHeader` English-under-`es` gap + date-fns weekday localization (prior P5 §4-A). Systemic, `es`-only, flagged for a focused i18n pass — not gating the en product.

---

## JOB 3 — Live walkthrough

**Method:** isolated dev server (`dev:webpack`, port **3042**, dev-bypass as **Pete Mitchell** / **Maverick Projects Ltd**, real prod data) driven via the preview tools at **1440×900** + a **768** tablet spot-check. Verification by accessibility snapshot + **computed-style probes** (the reliable path for colour/accent — accent is user-customizable; **Pete's runtime accent = `rgb(65,115,148)` / `#417394`**, so static-hex reads disagree with rendered pixels) + live interaction. Console checked per surface. Mapbox token is empty locally → map tiles don't render (verified the chrome/fallback by code + live fallback string; **not** failed for missing tiles).

### Per-surface result

| # | Surface | Result | Key live evidence |
|---|---------|--------|-------------------|
| — | **Shell** | ✅ PASS | 8-item rail (DASHBOARD→SETTINGS, **SCHEDULE** not Calendar); top bar = search · notifications bell · `// CREATE`; **CreateCluster** opens a 9-action popover (Add expense·X … New item·N) with keycaps; **notifications drawer** = no-card gradient, real DB rows, `ALL 15 / CRIT 4 / ATTN 3 / INFO 8`, mono timestamps, `SYS :: SYNC` / `CLEAR ALL`; operator menu present (`Open menu`) |
| 1 | **Dashboard** | ✅ PASS | `// OPERATOR :: PETE` · `SYS :: TODAY DECK LIVE`; `// REVENUE/RECEIVABLES/PROFIT/EXPENSES`; **A/R "current" bar = `rgb(157,181,130)` = olive `#9DB582`, ≠ accent** — full ramp olive→tan→rose→brick; mono/em-dash numbers |
| 2 | **Projects** | ✅ PASS | instrument strip (`24 ACTIVE · $115K · 27% · 24 OVERDUE · 21d`); spreadsheet with earth-tone STATUS tags, **100% bars olive**, em-dash empties; **row click → workspace window** (path stays `/projects`), VIEWING pill neutral, map fallback string graceful |
| 3 | **Schedule** | ✅ PASS | `// DAY/WEEK/MONTH/CREW`; `Jun 22-28, 2026 · [TODAY]`; instrument strip; **task-card strips + today-tick are inline status-hex (`PROJECT_STATUS_COLORS`), not the accent token** — verified (§4-S) |
| 4 | **Pipeline** | ✅ PASS | kanban (NEW LEAD 4·$68K, QUOTED 2, NEGOTIATION 1, WON 12, LOST 2); metrics grammar; **exactly 1 accent CTA = "New Lead"** (filled-primary); per-card ACTIONS overflow |
| 5 | **Books** | ✅ PASS | `// LEDGER` (NET $4,410 / CASH FLOW +$2,205 / A/R); INVOICES·ESTIMATES·EXPENSES·SYNC; **exactly 1 accent CTA = "New Invoice"**; **SYNC = one-CONNECT** (`● QUICKBOOKS · LIVE ▾` badge + `↻ SYNC NOW` + `// RECENT SYNCS`, **no** side-by-side provider cards) |
| 6 | **Catalog** | ✅ PASS | `// SUPPLY` strip (STOCK HEALTH NOMINAL · 67 UNTRACKED · ON-HAND $500); PRODUCTS/STOCK segments; COST/PRICE/MARGIN columns; 1 accent CTA (`+ ADD`) |
| 7 | **Clients** | ✅ PASS | rose A/R banner (`// 11 CLIENTS OWE $38,174.88 — OLDEST 126D · CHASE →`); 68-client roster; ALL/WITH PROJECTS/OWES/NEW chips; 1 accent CTA (New Client); **client click → window** (path stays `/clients`, 4 tabs CONTACT/PROJECTS/MONEY/ACTIVITY) |
| 8 | **Settings** | ✅ PASS | 6-domain grouped IA (YOU/TEAM/COMPANY/FINANCIAL/COMMS/ADVANCED); YOU sub-tabs; **zero shelved/Phase-C tabs leaked** for non-flagged Maverick (Client Comms / Autonomy / Calibration / Agent Queue all absent) |
| — | **Redirects** | ✅ PASS | all 8 tested → redirected with **param preservation** (see §4-R) |
| — | **Tablet 768** | ✅ PASS | fixed rail persists, widgets reflow, **no horizontal overflow** (scrollWidth == 768) |

### §4 · Defects & observations

**No blocking defects found.** The full punch-list:

- **§4-S · Schedule "accent" is sanctioned, not a leak (resolved, informational).** The week-view task-card left strips (4px) + today-tick (2px) render in `rgb(65,115,148)`, which *equals Pete's runtime accent* — the classic runtime-accent-override trap. Verified the colour is applied **inline** (`style="background-color: rgb(65,115,148)"`) by `PROJECT_STATUS_COLORS` (the sanctioned map-pin/today-tick/active-task pattern), **not** the `--ops-accent` token. One project status hex (`#417394`) coincidentally matches the demo accent. **Not a defect.**
- **§4-E · Environmental (dev-only, not a code defect).** The only console error on every surface is `[NotificationService.create] Failed: permission denied for function create_notification_if_new` — the demo/anon role lacks the DB grant on the notification RPC; it also drives the Next.js dev "N Issues" badge (bottom-left, dev-only, absent in production). **Prod should confirm the `create_notification_if_new` grant exists for the authenticated role.** Not an overhaul defect.
- **§4-M · Map tiles (expected, not a defect).** Empty local `NEXT_PUBLIC_MAPBOX_TOKEN` → the workspace map shows `// MAP UNAVAILABLE — NEXT_PUBLIC_MAPBOX_TOKEN MISSING`; address + chrome render. Tiles are prod-only.
- **§4-R · Redirects (all param-preserving):** `/calendar?date=2026-06-16`→`/schedule?date=2026-06-16` · `/invoices`→`/books?segment=invoices` · `/products`→`/catalog?segment=products` · `/map?foo=bar`→`/projects?foo=bar&view=map` · `/team?action=invite`→`/settings?action=invite&section=team` · `/inventory`→`/catalog?segment=stock` · `/estimates`→`/books?segment=estimates` · `/accounting`→`/books?segment=invoices&view=aging`.

### Gallery
`docs/audits/2026-06-13-p5-walkthrough/gallery/` — see `PROVENANCE.md`. This session's `preview_screenshot` returns images **inline only** (not persistable to disk), so the walkthrough record is the live snapshot/inspect evidence above; the prior **2026-06-23** pass holds crisp full-res surface captures (`../2026-06-23-p5-walkthrough/gallery/`, 2880×1800) and the **surfaces are visually unchanged since** — only the shell changed, and the shell is documented here via live evidence.

---

## 5 · TASTE CALL FOR JACKSON — ModePill `CREATING` tint

The P4 sweep flagged the ModePill CREATING as an **accent-tint**. That has since been resolved to **olive** — so the live state is no longer an accent question. Verified computed style of the CREATING pill (in a live new-project window):

```
background : rgba(157,181,130, 0.12)   // olive #9DB582 @ 12% (--olive-soft)
text       : rgb(157,181,130)          // olive
border     : rgba(157,181,130, 0.30)   // olive (--olive-line)
dot        : rgb(157,181,130)          // olive
```

Zero accent. The pill family is a coherent earth-tone state ladder: **VIEWING = neutral · EDITING = tan-soft · CREATING = olive-soft.** The open question is narrower than the original flag:

> Is the **olive-soft fill** on the CREATING pill a sanctioned mode-state, or should the mode pills be neutralized to pure neutral chrome (colour only the dot/label)?

- **Option A — sanction (recommended).** Olive is the "go"/generative earth tone (the component comment says so), it mirrors the EDITING=tan-soft sibling, and a 12% soft tint on a tiny status pill is the same sanctioned soft-chip tier already used app-wide for status tags. It is *not* an accent leak. It gives at-a-glance mode awareness. The design system's "earth tones are border-only" rule is about not filling large surfaces — a micro-pill soft tint is the established exception.
- **Option B — neutralize.** Make all three pills neutral chrome; distinguish mode by the dot colour + label only. Maximally austere; loses the emotional state-coding the EDITING/CREATING pulse + tint was designed to carry.

**Recommendation: Option A (sanction).** Decisive, on-system, verified non-accent. *Not changed silently — awaiting Jackson's call.*

---

## 6 · Bottom line

The overhaul reads as **one instrument** across all eight surfaces + the redesigned shell, on real data, at desktop and tablet: 8-item nav, command-first create, gradient notifications, uniform `//` tactical voice, mono/tabular/em-dash numbers, **accent confined to exactly one filled CTA per screen** (with the olive financial-current token + sanctioned inline status-hex elsewhere), the one-CONNECT Books pattern, window-not-nav entity opens, and param-preserving redirects. The build gate is green on everything the overhaul touches; the residual suite red is branch-behind-main (resolves on merge) or pre-existing platform baseline.

**GO — `feat/web-overhaul` is ready to merge.** Carry the two merge-hygiene notes; decide the ModePill tint.
