# Table Unification — PRODUCTION PASS (P6 · REWORK 7) — Implementation Plan

> **For Claude (executor):** REQUIRED SUB-SKILL: load `custom-skills:executing-plans` before starting, plus `ops-design` (read `ops-design-system/project/DESIGN.md`) before any UI task and `custom-skills:audit-design-system` for Task 13. `ops-copywriter` for Task 7 copy. `superpowers:verification-before-completion` before every "done" claim.

**Goal:** Take branch `claude/amazing-raman-14024d` (REWORK 5+6, 10 commits, all live-verified) from "gates green" to "prod-ready": fix the three real defects found in the planning pass, settle the four Jackson taste calls, retire the picker-doctrine debt on the touched surfaces, run the formal audit + e2e, and stage the gated integration.

**Where to work:** IN the existing worktree `/Users/jacksonsweet/Projects/OPS/ops-web/.claude/worktrees/amazing-raman-14024d` (branch `claude/amazing-raman-14024d` is checked out there; a fresh worktree cannot check it out twice). Planning-pass state: that worktree is clean except an untracked `.claude/launch.json` (harmless dev artifact). Confirm with `git status -sb` before touching anything.

**This plan file** lives on the planning scratch branch `claude/keen-dubinsky-654b24` at `docs/design/2026-06-29-table-unification/PRODUCTION-PLAN.md`. First action in the executor worktree:
```bash
git show claude/keen-dubinsky-654b24:docs/design/2026-06-29-table-unification/PRODUCTION-PLAN.md \
  > docs/design/2026-06-29-table-unification/PRODUCTION-PLAN.md
git add docs/design/2026-06-29-table-unification/PRODUCTION-PLAN.md
git commit -m "docs(web-overhaul): adopt the production-pass plan (REWORK 7)"
```

**Hard rules (root + repo CLAUDE.md):** atomic conventional commits, stage by name (never `git add -A`), NO AI attribution in commits, commit freely but **NEVER push / merge / rebase-and-push without Jackson's explicit go** (merging `ops-web` main auto-deploys to customers). All styling traces to design-system tokens. All user-facing copy through `ops-copywriter` + en/es dictionaries.

---

## Verified current state (planning pass, 2026-07-02 — trust these baselines)

Everything below was re-verified from scratch against the branch (fresh diff review of all 10 commits + live browser pass on Projects, Pipeline focused+table, Books @1040, Catalog stock @1440, workspace view/edit, pickers, search):

| Gate | Baseline |
|---|---|
| `npx tsc --noEmit` | **exactly 7 pre-existing errors**: `src/lib/catalog-setup/xlsx-parse.ts` ×2, `tests/e2e/catalog-setup-wizard.spec.ts` ×1, `tests/unit/catalog-setup/{upload-stage,xlsx-parse}.test.ts` ×2, `tests/unit/api/services/notification-service.test.ts` ×2 (xlsx not installed locally + known test debt). Zero from the branch. |
| `npx eslint` (all branch-touched files) | 0 errors, **exactly 3 warnings** — the Task 3 targets. |
| `npx vitest run tests/unit src/lib/hooks` | **3116/3117 pass.** 1 real failure: `tests/unit/navigation/route-registry.test.ts` `/pipeline → padded` (Task 1 — pre-existing on origin/main too). 2 files fail at collect: `tests/unit/catalog-setup/{upload-stage,xlsx-parse}.test.ts` (xlsx missing — environmental, ignore). |
| Browser console (all surfaces) | **One error class only:** duplicate-key `""` on workspace-window open (Task 2). All warnings environmental (webpack `async_hooks`, Babel-in-browser, Next scroll-behavior deprecation) — pre-existing, not from the branch. |
| `origin/main` drift | main advanced past `bd01705a` by exactly 3 commits (`cdbd6d00`, `572708b1`, `095c4d1e`) — **all decks-zoning API/tests/migration; zero file overlap with the branch. Rebase will be conflict-free.** |
| Live REWORK 5/6 behaviors | Re-confirmed: search keeps focus through a 0-match settle; closed-deal table rows open the detail window and stay open (`activeOpportunities` = `!deletedAt && !archivedAt`, includes won/lost); picker panel 256×322, 32px search, 33px rows, z-3000 over the window; SHOW CLOSED 7→21 deals; Workbar single-line right cluster at 1040. |

**Environment recipe (already proven in the planning worktree):**
```bash
ln -s /Users/jacksonsweet/Projects/OPS/ops-web/node_modules node_modules   # if missing
cp /Users/jacksonsweet/Projects/OPS/ops-web-table-rework/.env.local .env.local
npm run dev:webpack -- -p <free port>   # turbopack PANICS on symlinked node_modules — always webpack
# Login screen → "// DEV BYPASS" → demo company Maverick as Pete Mitchell (ADMIN)
```
Preview-browser quirk: rAF + timers pause when the tab is occluded — virtualized tables render 0 rows and `AnimatePresence mode="wait"` swaps look frozen until you take a screenshot (forces frames). Not an app bug. `NEXT_PUBLIC_MAPBOX_TOKEN` is absent in this env copy → workspace map shows its fallback; also not a bug.

---

## Task 0 — The Jackson batch (send FIRST, then keep working)

Five product/taste calls. Send Jackson ONE plain-language message up front (no jargon, no file paths), then execute Tasks 1–3 and 9–11 while waiting — none of those depend on his answers. Recommended framing per item, with my recommendation first:

1. **Edit-form field height** — "The edit forms (project details, client details, deal overview) have input boxes twice the height they should be — same sizing bug we just fixed in the pickers. The design spec and every other form in the app use the compact size. I want to fix them all to match. Before/after screenshots attached." **Recommend: fix to 36px (Task 4).** This is a proven authoring bug, not a design choice — the spec (`DESIGN.md` § Inputs) literally says `min-height: 36px`.
2. **Books toolbar stats** — "On smaller windows the invoice toolbar stacks five lines of stats, and two of those numbers already appear in the big metrics bar right above it. I want to move the unique ones (collected, collection rate, avg days to pay) up into the metrics bar and drop the duplicate line." **Recommend: yes (Task 5).**
3. **Count readouts** — "Each tab shows its row count in a different spot (Projects top-right, Books/Catalog floating mid-toolbar). I want to give counts one fixed home in the shared toolbar so it's identical everywhere." **Recommend: yes (Task 6).**
4. **Clients search placeholder** — "The Clients search hint text is too long and gets cut off. Shorten to 'Search clients…' to match the other tabs?" **Recommend: yes (Task 7).**
5. **"+ New client" inside pickers** — "The deal cards let you create a brand-new client right from the client picker. The other client pickers (project form, table cells) don't. I want to add the same one-tap create everywhere." **Recommend: yes (Task 8).**

If any answer is "leave it", skip that task and note it in the DECISION.md entry (Task 15).

---

## P0 — Correctness (no approval needed; start immediately)

### Task 1 — Fix the stale route-registry parity test
**Files:** `tests/unit/navigation/route-registry.test.ts:178`
**Context:** REWORK 1 flipped `/pipeline` fullHeight `padded → bleed` (shipped to prod in PR #107); the parity table still expects `padded`. It fails on origin/main today — nobody saw it because prior sessions ran targeted suites and main CI is perpetually red on unrelated lint. It's this initiative's debt.
**Steps:**
1. Change line 178 `["/pipeline", "padded"],` → `["/pipeline", "bleed"],`.
2. `npx vitest run tests/unit/navigation/route-registry.test.ts` → expect all pass.
3. Commit: `test(navigation): align route parity spec with pipeline's shipped bleed mode`

### Task 2 — Fix the duplicate-key error in the workspace window (weather rows)
**Files:** `src/components/ops/projects/workspace/viewing/project-sidebar.tsx:431`
**Root cause (live-confirmed, not the activity list):** `src/lib/api/services/weather-service.ts:104,125` builds forecast rows with `id: ""` ("assigned by DB on upsert") and the fresh-fetch path serves those un-id'd rows to the client. The sidebar renders `<WeatherRow key={f.id} …/>` over 5 rows → five `key=""` siblings → the exact 4-per-render "Encountered two children with the same key" errors seen on every window open. The activity list (`key={entry.id}`) is innocent.
**Steps:**
1. Line 431: `key={f.id}` → `key={f.forecastDate}` (unique per daily row, stable across refetches — better than a DB uuid for render identity).
2. Grep `key={f.id}`/weather keys elsewhere: `grep -rn "key={f\.\|key={forecast" src/` — fix any sibling render the same way (expected: none).
3. Verify live: dev server → open a project window (Charlie's Home Office Remodel) → console shows ZERO "same key" errors (baseline was 4–8 per open). Force a frame with a screenshot first (rAF quirk).
4. Commit: `fix(workspace): key weather rows by forecast date — service rows ship with empty ids`

### Task 3 — Zero the 3 eslint warnings in touched files
**Files:** `src/app/(dashboard)/pipeline/page.tsx:46`, `src/app/(dashboard)/pipeline/_components/table/pipeline-table-shell.tsx:249`, `src/app/(dashboard)/projects/_components/table-v2/projects-table-shell.tsx:201`
**Steps:**
1. `page.tsx:46` — delete `previousOpportunityStage` from the `@/lib/types/pipeline` import (orphaned by the drawer excision).
2. Both shells — the effect `useEffect(() => { setSorting(activeView?.sort ?? []) }, [activeView?.id, activeViewSortKey])` is CORRECT as written: `activeViewSortKey` is the stable-keyed encoding of `activeView?.sort` (see the `useMemo` directly above each); adding the raw object would re-seed sorting on referential churn. Do NOT add the dep. Add above the dep array, in both files:
   ```ts
   // eslint-disable-next-line react-hooks/exhaustive-deps -- activeViewSortKey IS activeView?.sort, stable-keyed above; the raw object would re-seed on referential churn
   ```
3. `git diff --name-only bd01705a..HEAD | grep -E '\.(ts|tsx)$' | while read -r f; do [ -f "$f" ] && printf '%s ' "$f"; done | xargs npx eslint` → **0 errors, 0 warnings**.
4. Commit: `chore(tables): zero out lint debt in touched surfaces`

---

## P1 — Jackson-gated fixes (execute as approvals land)

### Task 4 — [NEEDS JACKSON #1] Compact the shared form atoms to spec height
**Files:** `src/components/ops/projects/workspace/atoms/text-input.tsx:21`, `src/components/ops/projects/workspace/atoms/select.tsx:51` (trigger), `src/components/ops/projects/workspace/edit-create/identity-tab.tsx` (ClientPicker trigger `h-8`), plus a sweep.
**Evidence (planning pass):** repo Tailwind spacing is doubled (`tailwind.config.ts:250` — `"8": "64px"`); live-measured PROJECT NAME input + client trigger = **64.0px, class `h-8`**. `ops-design-system/project/DESIGN.md` § Inputs specs **`min-height: 36px`**; the app-wide standard is 36px (`src/components/ui/input.tsx` `min-h-[36px]`, settings, setup, books forms all 36px). Same authored-in-default-units bug class the Picker kit had (`b2389fb9`).
**Blast radius — the atoms are shared beyond the project workspace (this is a feature: one fix heals all):** `pipeline-detail-overview-tab.tsx`, `pipeline-focused-detail-window.tsx`, `lead-field-editors.tsx`, `src/components/ops/clients/workspace/viewing/money-tab.tsx`, `src/components/ops/clients/workspace/edit-create/client-edit-create-body.tsx`.
**Steps:**
1. `text-input.tsx:21` and `select.tsx:51`: `h-8` → `min-h-[36px]` (match `ui/input.tsx` convention; real px per the picker-kit precedent — do NOT use scale tokens for control heights).
2. `identity-tab.tsx` ClientPicker trigger: `h-8` → `min-h-[36px]`.
3. Sweep for stragglers: `grep -rn '\bh-8\b' src/components/ops/projects/workspace/ src/components/ops/clients/workspace/ "src/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab.tsx" "src/app/(dashboard)/pipeline/_components/lead-field-editors.tsx"` — convert form-control heights only (leave non-control layout uses alone; `text-area.tsx` `min-h-[80px]` is already correct).
4. Check vertical rhythm after the shrink: labels/hints/gaps in `field.tsx` need no change (gaps are scale-tokens, intentional), but eyeball the identity + schedule tabs for orphaned spacing.
5. Verify: `npx vitest run` the identity-tab suite (expect 27/27 unchanged — testids untouched); live EDIT a project (measure input `getBoundingClientRect().height` = 36), open a client edit form + a deal window overview tab; screenshots of all three for Jackson.
6. Commit: `fix(forms): compact shared form atoms to the 36px spec height (doubled-scale authoring bug)`

### Task 5 — [NEEDS JACKSON #2] Books workbar statline → metrics strip
**Files:** `src/components/books/segments/invoices-segment.tsx` (~:568 `<SegmentStatLine items={statItems} />` and the `statItems` builder above it), `src/components/books/segments/estimates-segment.tsx` (same pattern), the Books MetricsStrip config (locate: `grep -rn "MetricsStrip\|fromMetricColumns" src/app/(dashboard)/books src/components/books | head`).
**Evidence @1040 (live):** the invoices filters cell stacks ~5–6 lines — status chips wrap to 2, then `44 TOTAL`, then the 3-line statline. `A/R` and `OVERDUE` in the statline duplicate the MetricsStrip cells directly above; `COLLECTED $209,266`, `COLLECTION 85%`, `AVG DAYS TO PAY 163D` are unique.
**Steps (on approval):**
1. Move the unique stats into the strip: `COLLECTION %` + `AVG DAYS TO PAY` as the `sub` line of the `// A/R` cell (MetricsStrip anatomy already supports `sub`), `COLLECTED` as the `// NET` or `// CASH FLOW` sub if it reads well — judgment call, keep each cell to one sub line.
2. Remove `<SegmentStatLine …/>` from the invoices AND estimates workbars (keep the component itself — `ar-aging-view.tsx` and `segment-toolbar.tsx` still consume it).
3. Keep the `44 TOTAL` count where it is (Task 6 gives it a permanent home; if Task 6 is approved, land that first or together).
4. Verify @1040: workbar = chips (≤2 lines) + count, band height materially reduced from the ~151px baseline; strip shows the migrated stats; `es` dictionary keys for any new sub labels.
5. Commit: `feat(books): fold statline metrics into the strip — single-band workbar at 1040`

### Task 6 — [NEEDS JACKSON #3] Pinned `meta` slot in the Workbar grammar
**Files:** `src/components/ui/table-shell/table-shell.tsx` (the `Workbar` component + its grammar docstring), then per-surface: `src/components/books/segments/invoices-segment.tsx` (+ estimates), `src/components/catalog/segments/stock-segment.tsx` (`67 SKUS`), `src/components/catalog/segments/products-segment.tsx` (count if present), `src/app/(dashboard)/projects/_components/table-v2/projects-toolbar.tsx` (`9 / 9 ROWS`).
**Evidence (live):** counts have no consistent home — Projects renders `9/9 ROWS` in the right tools cluster, Books/Stock float counts inside the wrapping filters cell. REWORK 4's own doctrine: "anything used consistently across tabs must be in the same place."
**Steps (on approval):**
1. Add a `meta?: ReactNode` slot to `Workbar`: a fourth grid track between filters and the right cluster — template becomes `auto · minmax(min-content,1fr) · auto · auto` (meta track only rendered when filled, same collapse rule as the others). `whitespace-nowrap`, mono micro, right-aligned. Update the grammar docstring (Row 1: `[search][filters]──[meta][tools][create]`).
2. Migrate each surface's count readout into `meta`. Pipeline table keeps none (the grand-total footer owns its count — REWORK 4 decision, unchanged).
3. Verify @1040 and @1440 on all five surfaces: counts identical position; right cluster still single-line at 1040 (re-run the REWORK 5 wrap checks: Catalog 2 toolbar bands, no orphaned cluster row); the meta track must yield BEFORE search/cluster compress (it participates as `auto` — confirm no new overflow at 1024).
4. Commit: `feat(tables): pinned meta slot in the Workbar grammar — counts get one home`

### Task 7 — [NEEDS JACKSON #4] Clients search placeholder
**Files:** `src/i18n/dictionaries/en/clients.json` + `es/clients.json` (the search placeholder key — `grep -n "Search clients" src/i18n/dictionaries/en/clients.json`).
**Context:** REWORK 3 leftover — "Search clients, companies, contacts…" clips in the canonical 240px field.
**Steps (on approval):** ops-copywriter register: en `"Search clients…"`, es `"Buscar clientes…"` (mirrors Catalog's `"Search products…"`). Verify live at 240px — no clipping. Commit: `fix(clients): terse search placeholder — no clipping at canonical width`

### Task 8 — [NEEDS JACKSON #5] Query-aware `createAction` + "+ New client" in the unified pickers
**Files:** `src/components/ui/entity-picker.tsx`, `src/components/ops/projects/workspace/edit-create/identity-tab.tsx` (ClientPicker), `src/app/(dashboard)/pipeline/_components/table/cells/editable-cell-client.tsx`, `src/app/(dashboard)/pipeline/page.tsx` (`handleCreateAndLinkClient` ~:1104 — the reusable name-only create+link path the board card already uses).
**Steps (on approval):**
1. Extend `EntityPicker` (backwards-compatible): `createAction.onCreate: () => void` → `(query: string) => void` (existing callers ignore the arg) and `createAction.label: ReactNode | ((query: string) => ReactNode)` so the footer can read `+ New client "Foo"` while typing. Search state already lives inside EntityPicker — pass it at the call site of `PickerFooterAction`.
2. Wire the workspace ClientPicker: createAction → create client (name = query) via the same service path `handleCreateAndLinkClient` uses (find the mutation: `grep -n "handleCreateAndLinkClient" "src/app/(dashboard)/pipeline/page.tsx"` and reuse its service call through the clients hooks) → `onChange(newId)`; clients query invalidates so the linked name resolves.
3. Wire the pipeline table client cell identically (create → `onCommit(newId)` → undo toast covers it).
4. New en/es `picker`/surface dictionary keys for the create label.
5. Verify: entity-picker + identity-tab suites green (add a createAction case to the entity-picker suite); live — type an unknown name in each picker → create → linked; `// CHANGE SAVED` toast in the table.
6. Commits: `feat(picker): query-aware create action in EntityPicker` then `feat(pipeline,workspace): one-tap client create in the unified pickers`

---

## P2 — Picker-doctrine debt on the briefed surfaces (no approval; doctrine)

> Sweep result for context: the app has ~11 MORE hand-rolled pickers beyond these (task-form ×3, create-task-modal ×3, item-form-dialog, portal-project-switcher, SetupIdentityStep industry multi-select, task-types-tab CrewPicker, projects `editable-cell-status`, pipeline `cell-stage-action` — the last two are status/stage ACTION menus, deliberately not entity pickers). Those are OUTSIDE the table-unification initiative. Do NOT migrate them here — Task 15 files the follow-up initiative.

### Task 9 — PipelineFilterRow stage + assignee dropdowns → Picker kit
**Files:** `src/app/(dashboard)/pipeline/_components/pipeline-filter-row.tsx` (StageDropdown :62–194, AssigneeDropdown :200–322, `DROPDOWN_SURFACE` :49), then the Workbar docstring in `src/components/ui/table-shell/table-shell.tsx`.
**Context:** both are hand-rolled non-portaled `absolute z-50` listboxes (no search, no keyboard nav) — the exact idiom the Picker kit docstring forbids, and the stated reason the Workbar filters cell must reflow instead of scroll.
**Steps:**
1. Rebuild both on `EntityPicker` single-select: items = stages (static config) / active team members; map the `"all"` sentinel through `noneOption` (`value === "all" ? null : value`, `onChange(null) → "all"`, `noneLabel` = "All stages" / "Everyone" from the existing dictionary keys). Triggers keep the current chip look (28–30px real-px). Assignee gains search for free; stage list is 6 items — `searchable={false}`.
2. Portal is default (z-dropdown 1000 — fine, the toolbar isn't inside a floating window).
3. Update the Workbar overflow-contract docstring: the "filter slots host non-portaled dropdowns" rationale line is now stale — the reflow contract STAYS (chips still wrap), but rewrite the justification honestly (chips are the unwrappable floor).
4. Verify live in BOTH modes (the core is shared): focused — stage "New Lead" filters the board; table — same filter constrains rows + `// N deals`; keyboard: open with Enter, arrow, select; @1040 no clipping while open. `npx vitest run` pipeline suites.
5. Commit: `refactor(pipeline): stage/assignee filters on the canonical Picker kit`

### Task 10 — create-lead-modal ClientSelector → EntityPicker
**Files:** `src/components/ops/create-lead-modal.tsx` (ClientSelector :77–158).
**Bonus:** kills that file's raw colors (`bg-[rgba(13,13,13,0.9)]`, `border-[rgba(255,255,255,0.2)]`) — audit findings pre-empted.
**Steps:** swap the hand-rolled absolute dropdown for `EntityPicker` (single-select, searchable, `noneOption` for "no client"); the modal sits at z-modal — pass `contentClassName="z-modal"` if the panel must clear it (verify stacking live). Verify: pipeline → NEW LEAD → pick client → create; keyboard nav. Commit: `refactor(pipeline): create-lead client select on the canonical picker`

### Task 11 — projects/new ClientSelector → EntityPicker (route STAYS)
**Files:** `src/app/(dashboard)/projects/new/page.tsx` (ClientSelector :54–146).
**Do NOT delete the route** (planning-pass finding): it is live-linked from `keyboard-shortcuts.tsx`, `client-list-widget.tsx` (`/projects/new?clientId=…`), onboarding drip emails (`Day1NoProject.tsx`, `onboarding-drip-service.ts`), and registered in `route-registry.ts` FULL_HEIGHT_EXCEPTIONS. Consolidating it onto the workspace-window create flow is a real question — but it's a deep-link/email contract change, its own initiative (Task 15 files it).
**Steps:** same swap as Task 10 (preserve the `?clientId=` preselect behavior). Verify: `/projects/new` renders, picker works, create works, `?clientId=` preselects. Commit: `refactor(projects): legacy create-form client select on the canonical picker`

### Task 12 — ClientLinkControl → EntityPicker (the board card's create-and-link)
**Files:** `src/app/(dashboard)/pipeline/_components/pipeline-card-content.tsx` (ClientLinkControl :451–824).
**Depends on Task 8's** query-aware `createAction` (build that extension even if Jackson declines the *new* affordances — here it preserves an EXISTING one).
**Context:** the last bespoke client picker — portaled with manual anchor math, own keyboard cursor, and the query-driven `Create client "<typed>"` row calling `onCreateAndLinkClient(opportunity, name)`. Highest-risk migration in this plan; it is also the doctrine's last holdout on these surfaces.
**Steps:**
1. Replace the manual portal/anchor/keyboard machinery with `EntityPicker`: current-client row → `noneOption`/selected state; create row → `createAction` with `label: (q) => q ? `Create client "${q}"` : "New client"` and `onCreate: (q) => createAndLink(q)`; Radix handles collision (the old code hand-rolled it); cmdk provides keyboard nav.
2. Preserve every testid the pipeline suites reference (`grep -rn "client-link\|ClientLink" tests/ src/` first) and the card's stopPropagation so opening the picker doesn't trigger card drag/click.
3. Verify live on the focused board: open from card → search → keyboard select → link; unlink; type new name → create-and-link (client appears, card updates); Escape restores focus; picker clears the card (portaled, not clipped). `npx vitest run` pipeline + card suites.
4. If the migration genuinely degrades the card UX (drag conflicts, anchor within scroll containers): STOP, keep the bespoke control, and document the exception in the Picker kit docstring + DECISION.md instead of shipping a worse interaction. Report which way it went.
5. Commit: `refactor(pipeline): board client link control on the canonical picker`

---

## P3 — Audit, e2e, docs, integration

### Task 13 — Formal design-system audit over the full branch diff
**Skill:** `custom-skills:audit-design-system`.
**Scope:** every file in `git diff --name-only bd01705a..HEAD` plus files this pass touches.
**Known findings to resolve (from the planning review):**
1. `src/components/ui/picker/picker-search.tsx` — `focus-within:ring-ops-accent` on the kit's search input violates Inputs § 340 ("Focus: border brightens … **no accent**"). REWORK 2 already corrected the Workbar SearchInput for exactly this; match it (border-brighten via `focus-within:border-line-hi`-equivalent token, drop the accent ring). Note: accent rings on BUTTONS (WorkbarButton, cell triggers) are sanctioned — the accent rule allows "primary CTA and focus ring"; the inputs spec governs text fields only.
2. Dead i18n keys: `stock.newItem` in `en/catalog.json` + `es/catalog.json` (`"+ NEW ITEM"` / `"+ NUEVO ÍTEM"`) — zero consumers (planning-pass grep). Delete both.
3. Whatever else the audit surfaces in touched files — fix to zero high-severity findings; document accepted low-severity (pre-existing out-of-scope files) in the report.
**Verify:** re-run the audit clean; live-check picker search focus (border brightens, no steel-blue ring, `boxShadow: none`).
**Commit:** `style(picker): spec §340 focus treatment on kit search; drop dead catalog keys`

### Task 14 — E2E over the touched surfaces
**Env:** playwright's `webServer` runs `npm run dev -- --port 3000` = **turbopack, which panics on the symlinked node_modules**. Pre-start webpack instead — `reuseExistingServer: !CI` picks it up:
```bash
npm run dev:webpack -- -p 3000 &   # wait for ready
npx playwright install chromium     # if browsers missing
npx playwright test tests/e2e/pipeline-table.spec.ts \
  tests/e2e/projects-table-v2-phase4.spec.ts tests/e2e/projects-table-v2-phase5.spec.ts \
  tests/e2e/projects.spec.ts tests/e2e/project-workspace.spec.ts tests/e2e/won-conversion.spec.ts
```
**Excluded + why:** `catalog-setup-wizard.spec.ts` (imports xlsx — absent locally, known-environmental); `pmf-*.spec.ts` (need `E2E_ADMIN_*` creds, untouched surface); inbox/email/auth specs (untouched surfaces).
**Judging:** main CI is perpetually red on pre-existing `jsx-no-comment-textnodes` lint — judge ONLY by these suites and your own changes' signals. Fix any failure the branch/pass caused; report (don't chase) pre-existing failures with evidence they exist at `bd01705a` (`git stash` the pass, or `git worktree` a throwaway at the base, if attribution is unclear).
**Commit** (only if fixes were needed): scoped `fix(...)` per finding.

### Task 15 — Documentation
**Files:** `docs/design/2026-06-29-table-unification/DECISION.md`, `/Users/jacksonsweet/Projects/OPS/ops-software-bible/05_DESIGN_SYSTEM.md`.
**Steps:**
1. Append a `## PRODUCTION PASS (REWORK 7) — <date>` entry to DECISION.md: the three P0 fixes (route parity, weather keys, lint), Jackson's five decisions + outcomes, picker migrations (incl. the Task 12 outcome either way), audit + e2e results, gates. Same register as REWORK 5/6 entries.
2. Bible: in `05_DESIGN_SYSTEM.md`, add/refresh a short "OPS-Web list surfaces" pointer — TableShell / Workbar grammar / MetricsStrip / Picker kit are canonical, with a reference to this DECISION.md as the design log. (The bible is a separate repo at the OPS root — commit there separately, same message discipline.)
3. File the follow-up initiative as a spawned task chip (per the spawned-task naming convention, this is P6 spawn #1 of this session): title `WEB OVERHAUL - P6-1`, prompt = migrate the remaining ~11 hand-rolled pickers (list from this plan's P2 preamble, with file paths) onto the Picker kit + decide the `/projects/new` route consolidation (deep-link/email contract). Jackson triggers it when he wants it.
4. Commit (ops-web): `docs(web-overhaul): log the production pass (REWORK 7)`

### Task 16 — Integration gate [JACKSON-GATED — hard stop before push]
**Pre-flight (all in the amazing-raman worktree):**
1. Full gates: `npx tsc --noEmit` (expect exactly the 7 pre-existing), eslint on all touched files (0/0), `npx vitest run tests/unit src/lib/hooks` (expect: 2 xlsx collect failures ONLY — route-registry now green), the e2e set from Task 14 green.
2. Quick live sweep: all five surfaces render; workspace open → console clean; pipeline focused↔table switch; one picker of each kind.
3. `git fetch origin` → re-check overlap: `git diff --name-only $(git merge-base origin/main HEAD)..origin/main` vs branch files. Planning-pass state: 3 decks-only commits, zero overlap.
4. Rebase (safe: branch never pushed; you are the only session in this worktree — re-confirm `git worktree list` + clean `git status` first): `git rebase origin/main`. Expect zero conflicts. Re-run tsc + the pipeline/projects vitest suites post-rebase.
**Then STOP.** Report to Jackson in plain language: what shipped in this pass, the before/after screenshots (form density, books toolbar, counts), test results, and that the branch is staged. **Push, PR, and merge happen only on his explicit go** — merging main deploys to customers. On go: `git push -u origin claude/amazing-raman-14024d`, open the PR with a body summarizing REWORK 5–7 (cite DECISION.md), then merge per his instruction.

---

## Execution order

```
Task 0 (send Jackson batch) ─┐
P0:  1 → 2 → 3               │ immediately, no waits
P2:  9 → 10 → 11             │ doctrine, no approval needed
     (Task 8 ext) → 12       │ 12 needs 8's API extension only — build the
                             │ extension regardless; the NEW affordances wait
P1:  4, 5, 6, 7, 8-adoption  │ as approvals land (6 before/with 5 if both yes)
P3:  13 → 14 → 15 → 16       │ audit after ALL code tasks; 16 is the hard gate
```
Single-session execution assumed. Commit after every task (atomic, by-name staging). If context runs long, the DECISION.md entry + this plan are the recovery map.
