# Lead Assignment — Audit Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or execute as a dispatched subagent track) task-by-task. Load `ops-design`, `custom-skills:audit-design-system`, and `ops-copywriter:ops-copywriter` before any UI/copy task. iOS track additionally loads `custom-skills:mobile-ux-design`.

**Goal:** Fix every defect found by the 2026-07-16 Lead Assignment UI/UX audit (2 P0, 5 P1, 9 P2, plus mechanical P3 polish) across ops-web `feat/lead-assignment` and ops-ios lead-assignment worktrees, without weakening the feature's fail-closed security posture.

**Architecture:** Three agent tracks. Track A (web correctness) and Track C (iOS) run in parallel — separate repos, zero shared files. Track B (web polish) runs strictly after Track A because it touches the same files. Final visual verification is a separate pass by the orchestrator (Playwright probes + iOS snapshot renders).

**Tech stack:** Next.js 15 / TypeScript / Tailwind tokens / TanStack Query / Zustand / Radix+cmdk; SwiftUI + OPSStyle tokens.

**Design system:** `ops-design-system/project/DESIGN.md` (+ `mobile/MOBILE.md` for iOS). Every value must trace to a token.

**Worktrees (work here, never the primary checkouts):**
- Web: `/Users/jacksonsweet/Projects/OPS/ops-web/.worktrees/lead-assignment` (branch `feat/lead-assignment`)
- iOS: `/Users/jacksonsweet/Projects/OPS/ops-ios/.worktrees/lead-assignment`

**Ground rules (all tracks):**
- Commit per task, conventional style (`fix(leads): …`), **no AI attribution of any kind**, stage by name. **Never push.**
- Keep the full web suite green: `npx vitest run --silent` (722 tests) and `npx tsc --noEmit` before every commit that touches web `src/`.
- iOS: build via `xcodebuild build-for-testing -scheme OPS -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -clonedSourcePackagesDirPath .spm-local -derivedDataPath .dd`; run lead suites via `test-without-building … -only-testing:OPSTests/<Class>`. `Secrets.xcconfig` is already in the worktree. `.spm-local`/`.dd` are local caches — never stage them.
- iOS line endings: `RealtimeProcessor.swift`, `InboundProcessor.swift`, `SyncEngine.swift`, `ProjectDetailsView.swift` are CRLF/mixed — none are in scope; if any CRLF file must be touched, use line-scoped perl/python edits and verify `git diff` == `git diff --ignore-all-space`.
- i18n: every new user-facing string lands in BOTH `src/i18n/dictionaries/en/*.json` and `es/*.json` (translate properly, keep registers: product copy = terse, sentence case for content, UPPERCASE for authority).
- Runtime caveat: the feature's DB migrations are NOT applied to the dev database (delivery tables + 3 RPCs 404). Verify via unit tests + tsc; the orchestrator does the browser pass afterward.

---

## TRACK A — Web correctness (P0s + P1s). Agent: `LEAD ASSIGNMENT - P1-1`

### A1. Un-break the detail window's interaction layer (audit P0-1, P0-2, P2-9)

**Files:**
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-focused-detail-window.tsx:114-120` (window subscription), `:185-194` (focus effect), `:167-183` (Escape handler)
- Modify: `src/app/(dashboard)/pipeline/_components/lead-field-editors.tsx:218` (EditPopover z) and its docstring `:22-23`

**Verified root causes (from the audit — trust these):**
1. `useWindowStore((s) => s.windows.find(...))` returns a new object identity on EVERY store write. The focus effect depends on that `win` object, so any bring-to-front write (which fires on pointerdown anywhere in the window) re-runs it, rAF-focuses the window's first focusable ("Show map"), and the non-modal Radix assignee popover dismisses on focus-out within the same frame. Result: the picker cannot be opened by mouse.
2. `EditPopover` is `fixed z-[1000]`; the floating window sits at z-2000+ (measured 2010). All band/overview `EditPopover` editors (value, source, priority, close date, attach client) render occluded behind the window.
3. The window's capture-phase Escape handler only spares `[data-pipeline-detail-modal]`, so Escape meant for an open picker closes the whole window.

**Steps:**
1. Replace the `win` subscription with narrow, stable selectors (subscribe separately to `position`, `size`, `zIndex`, `isMinimized`, and window existence by id — or one selector with a shallow comparator over exactly those fields). No consumer may receive a fresh object per store write.
2. Re-scope the focus-into-body effect: it must run only when the window transitions closed→open (or `opportunity.id` changes), never on position/z churn. Track "focused for this open" in a ref keyed by `opportunity.id` + open state.
3. Escape handler: also return early when `document.querySelector('[data-radix-popper-content-wrapper]')` exists — Radix owns that Escape and closes the popover.
4. `EditPopover`: `z-[1000]` → `z-modal` (the token class used by `EntityPicker` two functions away). Update the file-header token note (`--shadow-dropdown` line) to say `z-modal`.
5. Add a regression test (vitest, jsdom): render the window, write to the window store (position bump), assert the body's first focusable does NOT receive focus and the component tree does not remount (spy on the effect or on `focus`). Keep it cheap; if jsdom fights the rAF, test the selector stability contract instead (same store write → referentially stable subscription results).
6. Run `npx vitest run --silent` + `npx tsc --noEmit`; commit `fix(leads): stabilize detail-window focus + lift field editors above the window`.

### A2. Make authority rechecks non-destructive; keep fail-closed for confirmed revocations (audit P1-3, P3-22)

**Files:**
- Modify: `src/lib/store/permissions-store.ts:115-126`
- Modify: `src/lib/hooks/use-lead-assignment-realtime.ts:335-374` (backlog replay), `:393-411` (permission backlog), `:474-487` (channel status)
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-focused-shell.tsx:467-505` and `src/app/(dashboard)/pipeline/page.tsx:523-527` (close-on-missing effects)
- Test: `tests/unit/` — new specs alongside existing realtime/permission tests (find them with `rg -l "reconcileLeadAssignment|fetchPermissions" tests/`)

**Behavioral contract (this is the security-sensitive task — implement exactly):**
- `fetchPermissions(userId, { mode })` gains `mode: "revoke-first" | "hold"`.
  - `revoke-first` (current behavior — synchronous grant drop) remains for: permission-change deliveries (`reconcilePermissionChangeDelivery`) and explicit sign-in/user-switch.
  - `hold` (new) keeps current grants while the canonical refresh is in flight; on failure it fails closed (clears grants) exactly as today. Used for: auth-provider boot rehydrate and the realtime reconnect path.
- Backlog replay failure (`replayBacklog`, `replayPermissionBacklog`): retry with backoff 1s/3s/9s before treating as failure. On final failure: invalidate access-sensitive queries (background refetch under RLS — server remains authoritative) but do NOT `query.reset()`, do NOT remove caches, do NOT close windows. Start a **verification deadline** (module-level timer, 3 minutes): if no successful replay or channel `SUBSCRIBED` occurs before it fires, run the current destructive `clearAccessSensitiveCaches` + `fetchPermissions(revoke-first)` fallback. Any success cancels the deadline.
- Channel `CHANNEL_ERROR`/`TIMED_OUT`: same treatment (invalidate + deadline), not immediate wipe. `SUBSCRIBED` cancels the deadline and triggers replay as today.
- `purgeRevokedLead` and delivery-confirmed revocations stay EXACTLY as destructive as today — do not weaken them.
- Close-on-missing effects (shell `:473-477`, page `:523-527`): do not close the panel while the opportunities query is fetching/loading — only when a settled result lacks the lead. Thread the existing `opportunitiesLoading`/`isFetching` you already have in scope (page has `oppsLoading`; shell receives `opportunitiesLoading`).
- Tests (TDD — write each failing first): (1) backlog failure ×3 then success → no reset/close called; (2) failure past deadline → destructive fallback fires once; (3) `hold` mode keeps grants during in-flight refresh and fails closed on error; (4) delivery-confirmed revocation still purges + closes synchronously; (5) shell effect does not close during `opportunitiesLoading`.

Commit: `fix(leads): hold-last-good authority rechecks with fail-closed deadline`.

### A3. Honest loading/error states for the guarded context (audit P1-5)

**Files:**
- Modify: `src/lib/hooks/use-opportunity-assigned-context.ts:66-75`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-panel.tsx:57-116`
- Modify: `src/app/(dashboard)/pipeline/_components/pipeline-detail-overview-tab.tsx` (accept/present the new states)
- Dictionaries: `pipeline.json` en+es

**Contract:**
- Hook: `placeholderData: keepPreviousData`; `retry: (count, err) => !(err instanceof OpportunityAssignedContextError && err.code === "access_denied") && count < 2`.
- Panel: `assignedContext` stays populated during background refetches. Null only when: settled `access_denied` (current redaction behavior — keep) or no data yet.
- New presentation: first-load → skeleton rows in the tab body (reuse the pulse pattern from `PipelineSkeleton`, tokens only); settled non-denied error → one inline row `// ERROR — COULDN'T LOAD LEAD CONTEXT` + `RETRY` ghost button wired to `refetch()` (voice: DESIGN.md error pattern; keys `detail.contextError`, `detail.contextRetry`).
- The Contact/Linked sections must no longer render "[ no contact ]"/"[ no estimates ]" when the truth is "failed to load."

Commit: `fix(leads): guarded context keeps last-good data; real loading and error states`.

### A4. Tell the loser when a lead is reassigned away (audit P1-6)

**Files:** `src/lib/hooks/use-lead-assignment-realtime.ts` (`reconcileLeadAssignmentDelivery` / `purgeRevokedLead` caller), `src/components/ui/toast` usage, dictionaries en+es.

**Contract:** on `accessAfter: false`, capture the lead title from cache BEFORE purge (`queryClient.getQueriesData` over `opportunities.lists()`); after purge show `toast.info` — en: `Lead reassigned` + description `{title} is no longer yours.` (fallback title: `A lead`). Never name the new assignee. Keys `toast.leadReassignedAway`, `toast.leadReassignedAwayDesc`. Unit test: delivery with `accessAfter:false` fires exactly one toast with the cached title.

Commit: `feat(leads): visible notice when assignment moves a lead away from you`.

### A5. Confirm the one destructive-for-the-actor tap (audit P1-7)

**Files:** `src/app/(dashboard)/pipeline/_components/lead-field-editors.tsx` (AssigneeField), `src/lib/permissions/lead-access-policy.ts` (helper), shared `Dialog`, dictionaries en+es.

**Contract:** in `AssigneeField.changeAssignee`, when the actor's effective `pipeline.view` scope is `"assigned"` AND the current assignee is the actor AND `newAssignedTo !== actor` → interpose the shared confirm dialog before mutating: title `Hand off this lead?`, body `It moves to {name} and leaves your list.`, confirm `HAND OFF`, cancel `KEEP`. All-scope actors and unassign-capable admins are never prompted. Add `actorLosesAccessOnAssign(state, actorId, opportunity, newAssignedTo)` to lead-access-policy with unit tests (assigned-scope self-transfer → true; all-scope → false; assigned-scope lead not currently theirs → false).

Commit: `feat(leads): confirm assigned-scope hand-offs that remove your own access`.

### A6. Mobile web gets a real lead surface (audit P1-4)

**Files:**
- Create: `src/app/(dashboard)/pipeline/_components/pipeline-mobile-detail-drawer.tsx`
- Modify: `src/app/(dashboard)/pipeline/page.tsx` (mobile branch + banner block `:1285-1341`), `src/app/(dashboard)/pipeline/_components/pipeline-mobile.tsx` (thread nothing new — handlers already exist)
- Dictionaries if any new label.

**Contract:**
- Below the 900px breakpoint, when `detailPanelOpportunityId` resolves to an accessible lead, render a full-screen drawer (fixed inset-0, `glass-dense`, `z-modal`) hosting the existing `PipelineDetailBody` with a slim header: back chevron + lead display name (Cake Mono uppercase) + the same `PipelineDetailActionMenu` gating as desktop. Close = back button, Escape, and history back if cheap. Body is already surface-agnostic — do not fork it.
- Focus: move focus into the drawer on open, restore to the card on close.
- Banner: on mobile render it IN FLOW below the stage tab bar (not in the absolute HUD), compact single-column layout, full-width, dismiss preserved. It must never overlay cards or intercept their taps.
- Notification-rail tap interception (aside role=complementary swallowing card taps at 390px): investigate `src/components/layouts/` rail styles; if the fix is a contained pointer-events/positioning correction on the rail's collapsed state, make it; if it risks other pages, leave it and record the finding in the commit body as shell-scoped follow-up.
- Verification: vitest+tsc; a small render test that the drawer mounts at mobile width when the store id is set (jsdom `matchMedia`/innerWidth stub) — the orchestrator does the visual pass.

Commit: `feat(leads): full-screen lead drawer on mobile web; banner back into flow`.

---

## TRACK B — Web polish (P2/P3). Agent: `LEAD ASSIGNMENT - P1-3`. **Starts only after Track A commits land** (same files).

### B1. Won-gating parity (P2-8)
`pipeline-focused-card.tsx` (QuickStageButton targets + FocusedStageMenuPortal list) and the mobile swipe (`pipeline-mobile.tsx` handleAdvance/`SwipeableCard`): thread `canConvert`; when the target stage is Won and `!canConvert`, HIDE the affordance (arrow renders next-eligible or nothing; menu omits Won; swipe treats Won as no-next). Mirrors the menus' existing correct gating. Test the resolver logic.
Commit: `fix(leads): hide Move-to-Won affordances without convert access`.

### B2. Grid semantics (P2-10)
Table header row (`table/pipeline-table.tsx` header cells): `role="columnheader"` (+ `aria-sort` where sortable). Assert via a render test counting columnheaders.
Commit: `fix(leads): expose table column headers to assistive tech`.

### B3. Bulk-assign rebuilt on the canonical picker (P2-11)
`pipeline-bulk-bar.tsx`: replace the native assignee `<select>` popover with `EntityPicker` (portal, `z-modal` content), sentence-case Mohave names, Unassign as `noneOption` gated on `canOfferUnassign`; keep the guarded candidates query. Bar overflow: let action clusters wrap to a second row within the rail instead of clipping (or reduce to icon+label priorities) — no horizontal clip at 1280/1440. Add the missing `border border-border` to the popover panel. Banner z `z-[9997]`→`z-[1500]` and its sibling `z-[9999]` likewise (floating-ui band), in `page.tsx`.
Commit: `fix(leads): bulk reassign on the canonical picker; bar wraps instead of clipping`.

### B4. Window title stutter (P2-12)
`pipeline-focused-detail-window.tsx getOpportunityTitle`: when `title` case-insensitively starts with `displayName`, render `title` alone. Unit test the three shapes (distinct, prefix-duplicate, title-less).
Commit: `fix(leads): de-duplicate window title for auto-named leads`.

### B5. Token compliance sweep (P2-15, audit compliance items)
In the audited feature files only: 16× sub-11px text (`text-[9px]`, `text-[10px]`) → `text-micro`; 11× `rounded-[5px]` → `rounded`; `rounded-[3px]` → `rounded-chip` (4px) and `rounded-[1px]` → `rounded-bar` (2px) unless visibly wrong in context — judge each; `text-white` on the band hero (`lead-map-band.tsx:343`) → `text-text`. `// ASSIGNEE` FactLabel gets `whitespace-nowrap`. Re-run `custom-skills:audit-design-system` scans to confirm zero regressions; screenshot-free — tsc+vitest+scan output is the proof.
Commit: `style(leads): lift type floor to 11px and trace radii/colors to tokens`.

### B6. Delete gets a guard (P2-16)
Detail action menu Delete (`pipeline-detail-panel.tsx:205-210`): interpose the shared confirm dialog, destructive voice (`DELETE LEAD` / `This removes {name} from the pipeline. DESTRUCTIVE. NO UNDO.` / confirm `DELETE`), en+es.
Commit: `fix(leads): confirm one-click lead deletion`.

### B7. Copy + i18n batch (P3-20, P3-24)
- `actions.markWon`→`Mark won`, `actions.markLost`→`Mark lost`; settings `roles.scopeAssignedOnly`→`Assigned only`, `roles.scopeOwn`→`Own only`, `roles.dataScope`→`Data scope` (en; es equivalents already sentence-cased — verify).
- `page.tsx:280/328` window title `"New Lead"` → `t("newLead")`-derived constant; archive undo label `"Deal"/"→ Archived"` → dictionary template.
- `pipeline-card.tsx` correspondence strings (`{n} emails`, `in / out`, `last {t}`, `formatTimeAgo`, `formatShortDay` en-US) → dictionary + current-locale date; reuse existing relative-time util if one exists (`rg "formatTimeAgo|timeAgo" src/lib`).
- Band Mapbox failure copy → `// MAP UNAVAILABLE` pattern (find the string source — likely `ProjectMap`/`MapHero` — change only if pipeline-scoped; if shared, override presentation in the band).
- `cell-assignee.tsx` stale "Phase 4" comment → describe the shipped design (assignment lives in the detail window by design).
- Workbar create button `aria-label` → `t("newLeadCreate")` ("Create new lead") to stop colliding with the stage-filter chip's name.
Commit: `fix(leads): copy casing, i18n escapes, and stale annotations`.

### B8. Ownership scannability + assign entry (P3-17, P3-18)
- Focused cards: when the viewer has company-wide lead view, show a quiet assignee marker in the card meta row — initials chip (UserAvatar `size="xs"` if it exists, else 16px initials circle), `text-text-3`, no accent, nothing when unassigned. Judge placement against card density; it must not add a line at `comfortable` density.
- "Assign to" (card menu + context menu): after `openDetailPanel`, set a one-shot `pipeline-mode-store` flag (`assignIntentOpportunityId`) that `AssigneeField` consumes to auto-open its picker once mounted.
Commit: `feat(leads): scannable ownership on the board; Assign to lands in the picker`.

---

## TRACK C — iOS. Agent: `LEAD ASSIGNMENT - P1-2`. Parallel with Track A.

### C1. The ✕ that means Lost (P2-13)
`OPS/Views/Leads/Components/StickyActionBar.swift:61-70`: replace the icon-only rose ✕ with a labeled control — keep the rose `-M` fill/tone, label `LOST` (Cake Mono via the bar's existing label style), min 44pt, keep width proportions sane next to EDIT / MARK WON. Update any snapshot expectations.
Commit: `fix(leads): label the Mark Lost action — no bare close glyph`.

### C2. Names are content (P2-14)
- `Sheets/LeadAssignmentSheet.swift:315`: stop uppercasing (`displayName` verbatim; fallback `"Team member"`).
- `Components/DetailHero.swift:96-99`: remove `.textCase(.uppercase)` from the value line only (label keeps its case); default fallback `"Unassigned"`; `LeadDetailView.currentAssigneeName` fallbacks → `"Unassigned"` / `"Unknown"` (match web vocabulary).
- Search placeholder → `"Search team"`.
Commit: `fix(leads): sentence-case assignee names; unify fallback vocabulary with web`.

### C3. Feedback on failure (P3-21)
`LeadDetailView.handleAssignmentMutation`: `UINotificationFeedbackGenerator().notificationOccurred(.error)` for `.conflict`, `.failed`, `.accessLost` dispositions (success haptic unchanged). One haptic per outcome — no spam.
Commit: `fix(leads): error haptics on assignment conflict and failure`.

### C4. Copy accuracy (P3-20)
- Stranded-leads dialog copy (`RoleDetailView.swift:805`): align with web semantics — the operator keeps responsibility but loses access; e.g. `This access change leaves active leads assigned to someone who can no longer open them. Choose where each lead goes before saving.`
- `LeadAssignmentViewModel` offline strings: `Connect to the internet to reassign this lead.`
Commit: `fix(leads): accurate stranded-lead copy and offline phrasing`.

### C5. Token pass — exact equivalents only (compliance)
`DetailHero.swift` / `LeadDetailView.swift`: replace raw values that have EXACT OPSStyle equivalents (e.g. `.frame(height: 48)` → the input/button-height token if it equals 48; paddings equal to `spacing*` tokens). Do NOT re-derive the documented-deliberate 9.5/10pt typography — visual output must be pixel-identical; use the snapshot renders to confirm. Anything without an exact token stays and remains covered by the file-header rationale.
Commit: `style(leads): trace exact-match spacing/size literals to OPSStyle tokens`.

### C6. Prove the sheet (audit gap)
Add `OPSTests/Views/LeadAssignmentSheetSnapshotTests.swift` on the existing harness (`LeadDetailAdditionsSnapshotTests` pattern — UIHostingController + UIWindow + drawHierarchy, PNG attachments): render (a) candidates+Unassign, (b) empty "NO ELIGIBLE TEAM MEMBERS", (c) error+RETRY. Use a stubbed `LeadAssignmentViewModel` state (see `LeadAssignmentViewModelTests` mocks). All suites green:
`xcodebuild test-without-building … -only-testing:OPSTests/LeadAssignmentFoundationTests -only-testing:OPSTests/LeadAssignmentViewModelTests -only-testing:OPSTests/LeadDetailAdditionsSnapshotTests -only-testing:OPSTests/LeadAssignmentSheetSnapshotTests`
Commit: `test(leads): snapshot coverage for the assignment sheet states`.

---

## Explicitly deferred (decision or scope beyond this remediation)
1. **Assignee at creation** (create-lead form) — changes the intake flow; product call for Jackson.
2. **iOS double-accent screen** (START VISIT band vs MARK WON) — taste call; touches the site-visit initiative's surface.
3. **`button.tsx` filled-at-rest primary vs DESIGN.md outlined-at-rest** — ecosystem-wide kit/spec drift, predates this branch; ratify or migrate globally, not here.
4. **Resolution-dialog bulk destination shortcut** — rare-N convenience.
5. **Notification-rail overlay** — fixed in A6 only if contained to the rail; otherwise documented as shell follow-up.

## Final verification (orchestrator, after all tracks land)
Playwright probe re-run (mouse-open picker, editor occlusion, Escape scoping, mobile drawer, refocus-no-blank, revocation toast via delivery shim), full `vitest`+`tsc`, iOS `build-for-testing` + all lead suites + PNG export. Then plain-English summary to Jackson. **No pushes, no deploys, no migrations.**
