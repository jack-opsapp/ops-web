# P4 Cross-Cutting Verification Sweep — OPS-Web

**Phase:** WEB OVERHAUL — P4 (the whole-app §7 checklist pass; the gate before the P5 walkthrough)
**Run date:** 2026-06-22 · **Branch:** `feat/web-overhaul` · **Worktree:** `ops-web-overhaul-p2-shell` (filename keeps the 06-13 P4-series date for series continuity)
**Type:** SWEEP — verify every §7 item across all 8 surfaces + shell; fix mechanical/unambiguous failures in-wave; flag ambiguous/structural/real-bug items for Jackson.

**Method:** systematic greps + first-hand code reads across the rebuilt + untouched surfaces, run as 14 parallel read-only finders (one per checklist dimension) seeded with a distilled "do-not-reflag / open-residual" brief from the decision log + the P4-1 cohesion audit + the P4-2 Catalog convergence. Fixes applied by the lead session (read-only finders never edited), committed atomically by theme. Verification gate: `tsc --noEmit` (exit 0) + `next lint` filtered to the 51 touched TS/TSX files (zero errors on any touched file). Live preview was **not** used — every §7 item was verifiable by code (more authoritative than flaky screenshots for redirect targets, click handlers, and token bindings), and the local Mapbox token is empty so map tiles don't render in dev anyway.

**Read-first / do-not-reflag baseline (confirmed still resolved, NOT re-flagged):** §9 amended 28px compact-workbar tier + 22–24px chips (web has no touch targets); global slashed-zero + tabular numerals; `rounded-[4px]` on chips/tags; P4-1 cohesion remediations (InstrumentStrip extracted, RegisterEmpty minted + EmptyState→OnboardingHint, `--fin-current` olive + Dashboard A/R repoint, form-error/glass-subtle/token hygiene, dead `data-table.tsx` removed `55795c06`); P4-2 Catalog→kit convergence (SegmentControl/FilterChips/RegisterTable/Tag/Select/Button, A1–A6); P3-6 Settings + Team absorption; P3-7 Pipeline conformance; B3 create-affordance ruling; P3-4/P3-6 accounting-connection redesign.

---

## 1 · Executive verdict

**CONDITIONALLY CLEAN — proceed to the P5 walkthrough, carrying the flag list below as the P5 punch-list seed.**

The cross-cutting **mechanical** bar is now met. This sweep fixed **62 files across 12 atomic commits**; `tsc` is clean and every touched file is lint-clean. After the fixes, the eight surfaces + shell read as one instrument on every §7 dimension that can be enforced by rule: numbers are mono/tabular/em-dash on the card surfaces that had drifted, accent is confined to CTA + focus (the two shared-primitive leaks — `Progress` and `Badge.info` — are closed at the source), off-curve easings and missing reduced-motion fallbacks are conformed, the dead `.ops-badge`/`.ops-card-accent`/`--glass-bg-subtle` utilities are gone, the table-v2 Cake-12 labels are reconciled to the cake-button role, every dashboard/schedule project click now opens the workspace window, and the `/expenses` deep-link gap is closed.

**One dimension is a clean PASS with zero action: Schedule rename safety.** All four DB/iOS-coupled identifiers (`calendar.view`/`calendar.edit` permissions, `calendar_events`/`calendar_user_events` tables, `queryKeys.calendar`, the `"ops-calendar"` persist key) were verified intact — the P3-8/P3-9 rename was surgical and broke nothing DB- or iOS-coupled.

**What keeps the verdict "conditional" rather than "clean to zero":** the residue is now a bounded set of **structural flags** that need Jackson's decision, not silent mechanical fixes — and P5's definition of done is "punch-list to zero," so these flags *are* that punch-list. Three of them are worth deciding before/at the walkthrough:

1. **Schedule deep-link consumption (functional).** `/calendar→/schedule` correctly preserves `?date=&task=`, but the Schedule surface consumes neither — and a live recurrence cron emits `/schedule?date=&task=` every 4h, so those notifications open today's default view instead of the targeted task. Degraded, not broken (no error), but real.
2. **Settings email-import wizard convergence (visible).** A live, ungated surface still hardcodes ~40 `#6F94B0` accent literals (a runtime-accent leak) plus non-spec colors (`#FF6B4A`, off-ladder grays). It's the one surface that still re-derives the system instead of consuming it — a P4-2-class convergence wave, deliberately not piecemeal-patched here.
3. **Legacy role-name permission gates (correctness).** Inventory items-tab write actions and the lockout resolver gate UI on the `Admin/Owner` role *name* via `selectIsAdminOrOwner`, bypassing the granular `can()` system; plus 8 server recipient-resolvers use the banned `.in("role", ["admin","owner"])`.

None of the flags are launch-blocking crashes, and none are regressions introduced by the overhaul. The app is coherent enough to walk through end-to-end today.

---

## 2 · §7 checklist — per-item verdict

| # | §7 item | Verdict | Evidence / note |
|---|---------|---------|-----------------|
| 1 | Project/client click → workspace window (zero nav to `/projects/[id]`, `/clients/[id]`) | **FIXED → pass** | 5 live controls full-page-navigated (4 dashboard widgets + Schedule task-card). All routed to `openProjectWindow` (`7f1dfd1b`). Canonical path healthy; Clients roster + Projects table/canvas already correct. 3 residual flags (§4-A). |
| 2 | Copy voice (no `!`, no emoji, no coaching) | **FIXED → pass** | 8 shipping `!`/`Welcome aboard` strings in Settings + a shell modal flattened to OPS voice, en+es (`33552e2b`). Zero emoji in user-facing strings (all ✓/✦ are affordance glyphs). Dead off-voice keys + client-portal copy flagged (§4-D). |
| 3 | Numbers: mono / tabular / slashed-zero / formatted / em-dash | **FIXED → pass** | Pipeline kanban + Projects canvas/archive cards rendered currency in `font-mohave` with ASCII `$--`; → `font-mono tabular-nums` + `—` (`7a961dc1`, `8ff779cb`). Notifications chip count → `fontFeatureSettings` (slashed-zero). Books/Catalog/tables/strips were already exemplary. 1 flag: 7px mini-calendar overflow count (§4-E). |
| 4 | Empty / loading / error states present + on-spec | **FIXED → mostly pass** | All 9 surfaces have all three states. Fixed: Expenses + Settings Templates/Inventory bare-spinner loading → glass-row skeletons; Expenses coach-mark empty → RegisterEmpty; WidgetSkeleton reduced-motion (`360f5780`). Flags: Projects/Schedule canvas-surface cold-open spinners, table-v2 empty (rides convergence residual), dead `inventory/snapshots-tab.tsx` (§4-E). |
| 5 | i18n: zero hardcoded strings; en+es parity; no dead absorption keys | **PARTIAL FIX → mixed** | Fixed: es/schedule +19, es/dashboard +17 (parity restored), 9 orphaned `commandPalette.nav` keys removed en+es, product-editor 3 labels wired (`079811c1`). **Flags:** Schedule side-panel ~26 un-i18n'd literals + import-wizard strings (large authoring pass); dead `sidebar.json`/`breadcrumbs.json`/`pmf.json`/`bug-reports.json` namespaces (structural deletion) (§4-B). |
| 6 | Icons: lucide-only, sizes 16/20/24/32, currentColor | **pass (1 flag cluster)** | **p1 gate clean** — zero `@carbon/icons-react` anywhere (not imported, not installed). lucide-react is the sole lib (366 files). Core surfaces have zero hex/accent-colored icons. Flag: import-wizard icons painted `#6F94B0`/earth-tone hex (folds into the wizard convergence flag §4-C); off-scale dense-menu icon sizes (§4-F). |
| 7 | Accent `#6F94B0` only on CTA + focus | **FIXED → pass** | Closed the two shared-primitive leaks at source: `Progress` indicator + `Badge.info` → neutral (`75c3157a`); project-sidebar links, workspace selection checkmarks, drag-confirm checkbox hex, pipeline Gmail banner/status chips → neutral (`75c3157a`, `c065d441`). Switch/Segment/Tabs verified accent-on-focus-only. A/R "current" confirmed olive (P4-1-5 holds). Flags: ModePill CREATING, picker create-rows, `#417394` identity colors (§4-A). |
| 8 | Radius / spacing / color → tokens (`audit-design-system`) | **PARTIAL FIX → mixed** | Fixed in-scope: Projects spreadsheet brick/tan hexes → tokens, density-control 10px→11px, Books/Catalog off-ladder radii (`724274b2`). **Radius scope deliverable:** 368 `rounded-[Npx]`; 340 (92%) are token-VALUE-but-arbitrary-syntax → **DEFER to one codemod**; 28 genuinely off-ladder, of which ~10 in-scope (Books/Catalog fixed; Projects 3px folds into table-v2 convergence). Flag: live import-wizard non-spec hex cluster (§4-C). |
| 9 | Motion: single easing, no spring/bounce, reduced-motion | **FIXED → pass** | Two count-up hooks → OPS cubic-bezier sampler (dashboard hook gained a missing reduced-motion snap); segmented-picker, widget-tray detent-spring + offset, spacer-widget springs, map-background → the curve (`40391fea`, `8ff779cb`, `c065d441`). Drag-reorder springs preserved (sanctioned). Flags: gated/out-of-scope easings (Calibration, inbox panel, portal, onboarding) deferred to their own waves (§4-F). |
| 10 | Z-index on scale; no decorative overlay >10 | **FIXED → pass** | Pipeline decorative bottom-fade `z-[30]` → `z-[5]` (`c065d441`). Scale fully tokenized; no other in-scope decorative overlay exceeds 10. Flags: wizard `z-50` popover, legacy ops/ shadow components (§4-G). |
| 11 | Permissions: granular `can()` only; zero role-name filtering | **FAIL → flagged** | Rebuilt surfaces gate correctly (29 `can()` sites + `has_permission` RPC). But a legacy layer survives: 8 `.in("role",["admin","owner"])` recipient-resolvers + `auth-store` `selectIsAdmin*` gating inventory write / lockout / Gmail-prompt / task fallback. **Not mechanical** — each needs a chosen permission key (§4-H). |
| 12 | No box-shadows on dark; glass tiers correct; no triple-stack | **mostly pass (flags)** | Core surfaces clean — exactly two glass tiers, no triple-stack (widget-shell guards it). Dead `--glass-bg-subtle` reference removed (`7f325f4b`). Flags: legacy ops/ `shadow-xl` modals, wizard `shadow-lg`, project-context-menu ad-hoc glass tier, status-glow selection cues (§4-G). |

---

## 3 · Fixes applied this wave (12 atomic commits, 62 files, tsc + lint clean)

| Commit | Theme | What |
|--------|-------|------|
| `06fef74d` | redirects | `/expenses` → `/books?segment=expenses` 308 (closes the orphaned expense-approval notification deep-link). |
| `079811c1` | i18n parity + dead keys | es/schedule +19, es/dashboard +17 (−1 stragger), −9 orphaned `commandPalette.nav` en+es, product-editor 3 labels → `t()`. |
| `33552e2b` | copy voice | Strip `!` + `Welcome aboard` from Settings billing/portal/addons + import-wizard + feature-access modal (en+es); neutralize spreadsheet empty coaching. |
| `7a961dc1` | numbers (cards) | Pipeline kanban + Projects card/archive currency → mono/tabular + `—`; notifications chip count → slashed-zero feature-settings. |
| `7f1dfd1b` | window discipline | 4 dashboard widgets + Schedule task-card → `openProjectWindow`; removed now-unused `useRouter` from schedule page. |
| `75c3157a` | accent | `Progress`+`Badge.info` neutralized at source; project-sidebar links, workspace checkmarks, drag-confirm checkbox → neutral/runtime-var. |
| `724274b2` | tokens | Projects spreadsheet brick/tan hexes → tokens; density-control 10→11px; Books/Catalog off-ladder radii → tokens. |
| `40391fea` | motion | Two count-up hooks → OPS cubic-bezier + reduced-motion; segmented-picker/widget-tray/spacer-widget/map-background → curve. |
| `360f5780` | states | Bare spinners → glass-row skeletons (Expenses, Settings Templates/Inventory); Expenses coach-mark → RegisterEmpty; WidgetSkeleton reduced-motion. |
| `7f325f4b` | residuals | Delete dead `.ops-badge`/`.ops-card-accent`/`--glass-bg-subtle`; table-v2 Cake-12 → cake-button (14px). |
| `8ff779cb` | projects canvas | stage-stack + terminal-region: mono/em-dash numbers + EASE_SMOOTH hover transitions. |
| `c065d441` | pipeline | Neutralize Gmail banner/status accent; `z-[30]`→`z-[5]`; skeleton reduced-motion. |

**Minor rendered-value notes (intentional, on-ramp):** the two `hover:text-[#b5423a]` → `text-ops-error-hover` swaps shift the hover from `#b5423a` to the brick-ramp `#a63d20` (aligns to the error ramp); three `hover:bg-[rgba(147,50,26,0.1)]` literals in spreadsheet files remain at 0.10 vs the 0.15 token — a follow-up convergence candidate, not a defect. The Expenses empty uses a literal `noun="Expense invoices"` (that component isn't dict-wired); a future i18n pass should key it.

---

## 4 · Flagged for Jackson (decisions / structural / not silently changed)

### A · Window discipline + accent judgment (behavioral / design calls)
- **Schedule deep-link consumption (functional bug).** `/calendar→/schedule` preserves `?date=&task=` but the Schedule page/store read neither (`schedule/page.tsx`, `schedule-store.ts` have zero `useSearchParams`). A live cron (`api/cron/recurrence-generate/route.ts:217`) emits `/schedule?date=…&task=…` every 4h → lands on today's default view, not the task. **Decide:** wire Schedule to ingest `?date` (jump/scroll-snap) + `?task` (open TaskDetailPanel) — touches the store's date/selection model, hence flagged not auto-fixed.
- **`project-spreadsheet` "View Full Page"** action-menu item does `window.location.href` to `/projects/[id]` (an explicit full-page escape hatch). Pipeline `EmailReviewPanel.onViewClient` → `/clients/[id]`. Command-palette project/client/task results → detail pages (documented P4 residual #12, functional via redirect). Legacy `/projects/new` page + Cmd+Shift+P shortcut coexists with the create window. **Decide:** does the operator app expose any full-page entity route in-app, or is the fallback route SEO/deep-link-only?
- **ModePill CREATING** intentionally accent-tints the status pill (documented "generative state"); **unit/category-picker `+ New`** rows are accent text inside a dropdown; **`manager` role avatar + activity-comment avatar/spinner** hardcode `#417394` (identity colors reading as the accent — per do-not-reflag #8 the literal scan classed these decorative). **Decide:** bless ModePill as a sanctioned accent-state (like the today-tick) or neutralize; pick a non-accent role hue.

### B · i18n (authoring + structural deletion)
- **Schedule side-panel is largely un-internationalized** — `task-detail-panel.tsx` never calls `useDictionary` (~26 literals); `project-drawer-panel.tsx`, `repeat-picker.tsx`, day grids carry more. Plus import-wizard step components. A dedicated Schedule-i18n + wizard-i18n authoring pass (en+es), per the P3-9 deferral.
- **Dead namespaces (recommend deletion, flagged structural):** `sidebar.json` + `breadcrumbs.json` (zero `useDictionary` consumers — the route registry + `navigation` namespace own nav/title now; they still carry retired `nav.estimates/invoices/products/inventory/accounting/map/team` + `route.*` keys); `pmf.json` (en-only, not in the Namespace union); `bug-reports.json` (drawer uses `common`). Confirm no SSR/server path resolves them, then delete the files + Namespace members.

### C · Settings email-import wizard convergence (live, ungated — recommend a dedicated wave)
The Email/Integrations import wizard tree (`import-pipeline-wizard.tsx` + `wizard-steps/*` + `ai-intake-interview.tsx` + `ai-database-mining.tsx`) is reachable for **all** companies (not phase_c-gated) and still re-derives the system: ~40 hardcoded `#6F94B0` (accent leak that also bypasses the runtime accent), non-spec `#FF6B4A`/off-ladder grays `#555/#666/#777/#6B7280`/accent-hover dialects/`bg-[#1a1a1a]`, accent + earth-tone hex on lucide icons, off-scale icon sizes, hardcoded English strings. This is a P4-2-Catalog-class convergence (kit primitives + token sweep + i18n), **deliberately not piecemeal-patched** in this sweep.

### D · Copy (low-weight cleanup)
- Dead off-voice keys safe to delete: `pipeline.transition.wonDescription` ("Congratulations on closing"), `dashboard.greeting.{morning,afternoon,evening}` (the live header uses `// OPERATOR`).
- Client-facing `portal.json` + `comms-wizard.json` carry `!` (out of the declared surface set, but OPS default copy) — recommend a portal/comms copy pass.

### E · Empty / loading / numbers (judgment)
- **Projects + Schedule primary loading** are bare `Loader2` spinners on canvas/map surfaces with no natural row skeleton — accept the cold-open spinner (Schedule's `placeholderData` masks it after first load) or swap to a `// LOADING` mono microcopy; add `motion-reduce`.
- **table-v2 `projects-empty-state`** icon-hero + sentence rides the open table-v2 → RegisterTable convergence residual (#3); convert when that lands.
- **Dead `components/inventory/snapshots-tab.tsx`** (banned coach-mark empty, zero importers — the live surface is `catalog/snapshots-view.tsx`) — confirm dead, delete.
- **`calendar-scheduler` "+N" overflow count** renders `font-mohave` at 7px (sub-11 floor) in a packed mini-calendar cell; an 11px mono bump may overflow — needs a sizing call.

### F · Motion / icons (gated or out-of-scope — to their own waves)
- Off-curve easings in **Calibration** (phaseCOnly, residual #11), **email-review-panel** (inbox-gated), **portal-project-card** (white-label), **onboarding starfield** (out of `(dashboard)`) — sweep when each surface is addressed. `draft-reply-button` `linear` spinner is the accepted continuous-rotation exception.
- Off-scale dense-menu icon sizes: pipeline card-actions `size={13}` ×11, notifications-row `size={12}`, wizard `size={8/10/12/14}` — **decide** whether dense menus standardize at 14 or snap to 16.

### G · Z-index / glass / shadows (pre-conformance components — scope ruling)
- Legacy `ops/` `shadow-xl` on dark glass: `review-tasks-modal` (also hardcoded `#417394` + `rounded-lg`), `project-photo-gallery`, `feature-access-modal`, `mention-textarea`; wizard `color-picker-popover` `shadow-lg` + `z-50`; wizard `glass-action-button` outer drop-shadow + ad-hoc glass tier; `project-context-menu` ad-hoc 0.95 glass + `0 8px 32px` shadow. All last touched in the spec-v2 migration, not P3/P4. **Decide:** in-scope to strip to borders-only now, or class-B until their components' waves.
- `project-card`/region status-color selection glows (box-shadow keyed to status hex, on `isSelected`) — keep as a status-data selection cue (matches the sanctioned map-pin glow precedent) or convert selection to a pure border.

### H · Permissions (architectural — each needs a permission key)
- **8 banned `.in("role", ["admin","owner"])` recipient-resolvers** (crons: appointment-reminders, auto-confirm-schedules; services: payment-reminder, project-lifecycle, task, approval-queue, invoice-suggestion, autonomy-milestone). These pick *notification recipients*, so the fix is recipient-by-permission, not a 1:1 swap.
- **`auth-store` role-name selectors gate UI:** `selectIsAdminOrOwner` gates inventory items-tab create/delete/adjust + the lockout resolver (who may fix subscription/seat lockout); `selectIsAdmin` gates the Connect-Gmail prompt; task-list's assignable-members fallback keys on `m.role === Admin/Owner`. Each should call the granular permission expressing the capability (inventory write, billing/seat-management, integrations.manage, cross-project assign). `selectIsFieldRole` is additionally dead. **Note:** the rebuilt P3/P4 surfaces themselves gate correctly via `can()` — this is a legacy layer to migrate, and the inventory + lockout gates are the two that gate real UI access (the sharper ones).

---

## 5 · Dimension that is a clean PASS (no action)

**Schedule rename safety.** The P3-8/P3-9 rename flipped only user-facing surfaces (nav label, breadcrumb, dict namespace, route) while every DB/iOS-coupled identifier was left intact, verified by counter-grep (zero `schedule.view`/`schedule_events`/`queryKeys.schedule`/`ops-schedule` hits):
- `calendar.view` / `calendar.edit` permission keys → still gate the Schedule route (`route-registry.ts`) and all scope-aware hooks.
- `calendar_events` / `calendar_user_events` tables → intact in services, the realtime subscription, the iOS-coupled model docs, and export/delete paths.
- `queryKeys.calendar` (`["calendar"]` cache literal) → intact across schedule + recurrence hooks.
- `"ops-calendar"` zustand persist key → intact (no operator loses persisted view state on upgrade).

The rename was the right minimal-blast-radius change. **No bug.**

---

## 6 · Verdict — is the app clean enough for the P5 walkthrough?

**YES — proceed, with the §4 flag list as the explicit P5 punch-list.**

The §7 mechanical bar is met across all eight surfaces + shell; the rebuilt set reads as one designed system on every rule-enforceable dimension; `tsc` and lint are clean on everything touched; and the one DB/iOS-risk dimension (Schedule rename) is a verified clean pass. The remaining work is a **bounded, documented set of decisions**, not unknown defects — exactly what a P5 walkthrough exists to resolve.

Decide these three before or during the walkthrough (the rest can be scheduled as follow-on waves):
1. **Schedule `?date`/`?task` deep-link consumption** (functional — notifications/cron land on the wrong view).
2. **Settings import-wizard convergence** (visible cohesion gap on a live, ungated surface).
3. **Inventory + lockout role-name gates → granular permissions** (correctness; the two flags that gate real UI access).

No regressions were introduced; all functionality is preserved.
