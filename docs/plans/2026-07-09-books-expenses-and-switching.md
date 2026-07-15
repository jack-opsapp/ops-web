# Books — Expenses Redesign + Segment Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Switching between INVOICES / ESTIMATES / EXPENSES / SYNC is calm: constant-height chrome, constant-width tabs, animated body swap. Expenses is one list (needs-review above history), denser cards, small floating approve/reject, months newest-at-right.

**Architecture (verified in code):** `books-page.tsx` conditionally hard-mounts one of four segments (`:263-311`); each segment owns a `TableShell` whose toolbar height differs (invoices/estimates: 2-row Workbar; expenses/sync: row-2-only), so the pinned `--shell-header-top` jumps on every switch. The fix: (1) give expenses a real Row 1 (its month chips + count belong there anyway), keep sync's single row but reserve consistent chrome, (2) animate the segment swap with the existing motion variants, (3) the expenses redesign below. The toolbar plan's central tabStrip fix (already landed — verify `git log`) solves tab width jumps.

**Tech Stack:** React/Next 15, TanStack Query (no query changes needed — verified: `useExpenseBatches()` returns all statuses; the toggle is a client-side gate), Framer Motion.

**Design System:** Compact tier (28px/22-24px). Motion: `scheduleViewVariants`/`...Reduced` in `src/lib/utils/motion.ts:145-164` (vertical fade, EASE_SMOOTH) for segment bodies. Status colors semantic only.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `custom-skills:interface-design`, `animation-studio:animation-architect` + `web-animations`, `ops-copywriter` (any label changes), `custom-skills:audit-design-system`.

---

### Task 1: Expenses — one list, review above history

**Files:**
- Modify: `src/components/expenses/expense-review-dashboard.tsx`
- Modify: `src/components/expenses/expense-filters.tsx`

**Step 1:** In `expense-review-dashboard.tsx`: delete `activeTab` state (:30) and the `activeTab` gates on the four section blocks (:188, :206, :224, :242) so all four sections render unconditionally in order: `N NEED REVIEW` → `AUTO-APPROVED` → `APPROVED` → `REJECTED`. Update `displayBatches` (:87-90) — it becomes the keyboard-nav list: `[...reviewBatches, ...autoApprovedBatches, ...approvedBatches, ...rejectedBatches]` (arrow-key order = visual order, verified handler at :103-134).
**Step 2:** In `expense-filters.tsx`: remove the tab toggle block (:35-64) + `ExpenseFilterTab` type + `activeTab/onTabChange/reviewCount` props; the component becomes the month-chip strip alone (Task 3 moves counts into the Workbar). Remove the now-unused import of `ExpenseFilterTab` in the dashboard.
**Step 3:** Visual separation between the review block and history: keep the existing section headers (mono micro uppercase, `border-b border-border`) — they already carry the split; add `border-t border-line pt-0` spacing only if the preview shows the APPROVED header colliding with the last review card. History sections stay scannable, review stays on top.
**Step 4:** tsc; preview `/books?segment=expenses`: all sections in one scroll, keyboard ↑/↓ walks across section boundaries, Esc clears selection. Screenshot.
**Step 5:** Commit: `feat(expenses): one list — needs-review above history, toggle retired`

### Task 2: Expense card density

**Files:**
- Modify: `src/components/expenses/invoice-card.tsx`

**Step 1:** Collapse the 4-row card (verified :48-119: 32px avatar+name / number / large amount / pills) into a 2-row row-card, target ≤56px:
```
[avatar 20px] NAME                    $1,234.56
              INV-0042 · STATUS · +A1
```
- Row 1: avatar `h-[20px] w-[20px]` + name `font-mohave text-body-sm text-text truncate` + amount right-aligned `font-mono text-data text-text tabular-nums` (mono for numbers — the current Mohave amount violates the numbers rule; fix it here).
- Row 2 (indented under name, `pl-[26px]`): `font-mono text-micro text-text-3 uppercase tracking-wider` — batch number · status · amendment. Status: keep `BATCH_STATUS_COLOR` for the status text color only, `rounded-chip` (4px) if it stays a chip — **the current `rounded-full` pills are banned; replace with `rounded-chip` or plain colored text** (prefer plain colored text: label already carries meaning, less chrome).
- Container: `px-3 py-1.5 gap-0.5`; keep selection ring (`border-ops-accent` — NOTE: accent on selection border violates "accent = CTA/focus only"… it IS a focus-analog for the master-detail selection; keep the existing `isSelected` treatment unchanged this pass, flag in report) and hover.
- Kill `bg-glass glass-surface` per-card if the list reads better as flat rows with hairline separators inside the bordered list panel (match the register-row look used elsewhere in Books — check `register-table.tsx` rows); decide in preview, keep whichever is visually calmer, note the choice.
**Step 2:** Fix the loading skeleton height to match the new card (`expense-review-dashboard.tsx:178` `h-[48px]` → measured height).
**Step 3:** Preview with the list populated: ≥8 cards visible in the 380px column at 900px height (vs ~4 today). Screenshot before-height comparison via `main`-branch reference numbers in the report.
**Step 4:** Commit: `refactor(expenses): dense two-row expense cards — mono amounts, no pills`

### Task 3: Expenses gets a real Workbar Row 1 (heights align across segments)

**Files:**
- Modify: `src/components/books/segments/expenses-segment.tsx` (currently tabStrip-only Workbar)
- Modify: `src/components/expenses/expense-review-dashboard.tsx` + `expense-filters.tsx` (chips relocate)
- Reference: `src/components/books/segments/invoices-segment.tsx:523-555` (slot usage)

**Step 1:** Read `expenses-segment.tsx` + how the dashboard nests inside it. Restructure so the Workbar carries: `filters` = month chips (from Task 4's re-ordered `ExpenseFilters`), `meta` = `WorkbarCount` with `{periodBatches.length} INVOICES · {formatCurrency(periodTotal)}` (mono, tabular — reuse the period summary data currently rendered inline at dashboard :160-172; the inline summary line then disappears), `tabStrip` = the existing `segmentControl`. This requires lifting period state from `ExpenseReviewDashboard` into `ExpensesSegment` (or exposing via props) — move `periods/activePeriod/effectivePeriod` up; the dashboard receives them as props. No query moves.
**Step 2:** Sync segment: verify its row-2-only Workbar (`sync-segment.tsx:305-312`) — give it a Row 1 with `meta` = the `ConnectionBadge` (moving it out of the tabStrip row) so all four segments have 2 rows. Read the file; keep the badge's behavior identical.
**Step 3:** tsc; preview: cycle all four segments — toolbar height does not change (measure with `preview_inspect` on the workbar container across segments; heights within 1px). Screenshot each segment's toolbar.
**Step 4:** Commit: `refactor(books): constant-height workbar across all four segments`

### Task 4: Month chips — newest at far right

**Files:**
- Modify: `src/components/expenses/expense-review-dashboard.tsx:41,45` (or the lifted location after Task 3)
- Modify: `src/components/expenses/expense-filters.tsx:67-84`

**Step 1:** Order ascending: `[...keys].sort()` (drop `.reverse()`); default period = newest = `periods[periods.length - 1]` (`effectivePeriod` fallback). Container: on mount and when `periods` changes, scroll to the right end (`ref.scrollLeft = ref.scrollWidth`) so the newest chip is visible at the far right; `flex` order stays natural (oldest left, newest right). Honor reduced-motion (no smooth-scroll animation; jump).
**Step 2:** Chip token fixes while in the file (verified violations): the count badge `bg-[rgba(129,149,181,0.2)] text-[#D99A3E] rounded-full` is dead after Task 1 (toggle removed) — confirm gone; the toggle's `rounded-lg` container likewise. Active chip classes stay (already tokenized).
**Step 3:** Preview: chips oldest→newest left→right, viewport starts at right end, newest selected by default; period switching still filters. Screenshot.
**Step 4:** Commit: `fix(expenses): month chips run oldest→newest with newest docked at the right`

### Task 5: Approve/reject — small floating cluster, bottom-right

**Files:**
- Modify: `src/components/expenses/invoice-detail-panel.tsx` (:188 root, :279-322 footer)

**Step 1:** Root (`:188`): `flex flex-col h-full` → `relative flex flex-col h-full`. Line-items scroller gets bottom padding (`pb-12`) so the last row never hides under the floating cluster.
**Step 2:** Replace the full-width footer bar (:279-322) with a floating cluster `absolute bottom-3 right-3 z-[5] flex items-center gap-1.5` (content z-tier), same conditional logic (`reviewable && canReview`; flags branch vs no-flags branch — handlers unchanged: `handleApprove`, `setShowRejectModal(true)`, `handleRemoveAllFlags`):
- APPROVE ALL: `h-[28px] rounded border border-olive-line bg-olive-soft px-2.5 font-mono text-micro uppercase tracking-wider text-olive hover:bg-olive-soft/80 transition-colors` (+ pending spinner at 12px). **Tokens, not the current hardcoded `rgba(157,181,130,…)`/`#9DB582`.** Verify `olive-soft`/`olive-line` exist as Tailwind tokens (grep the Tailwind config / globals for `olive-soft`); if the utility names differ, use the project's actual token classes.
- REJECT (flags > 0): `border-rose-line bg-rose-soft text-rose` same geometry, label `REJECT · {flagCount}` — replaces the hardcoded `#93321A` fill (brick is border-only per spec; a filled brick button violates it).
- REJECT (no flags, disabled): same geometry, `border-border text-text-mute cursor-not-allowed`, tooltip `title` = "Flag a line item to reject" (dictionary key, EN+ES).
- REMOVE ALL FLAGS: stays a text link but moves INTO the cluster row, left of the buttons, `font-mono text-micro text-text-3 hover:text-text-2 uppercase`.
- The cluster floats over the scroller on a `glass-dense rounded px-1.5 py-1` chip backing IF the preview shows text collision beneath; if the pb-12 padding keeps rows clear, no backing (calmer). Decide in preview, note the call.
**Step 3:** Both mobile (`lg:hidden` panel at dashboard :286-293) and desktop panels get the same treatment automatically (same component) — verify mobile at `preview_resize` 375×812: cluster doesn't cover content, still reachable.
**Step 4:** Keyboard/a11y: buttons remain real `<button>`s in DOM order after the table; focus order acceptable.
**Step 5:** Preview approve + reject flows end-to-end (approve one batch, reject-with-flags one batch if data allows; else exercise what data permits and state the gap). Screenshots.
**Step 6:** Commit: `refactor(expenses): floating compact approve/reject cluster — tokenized, bottom-right`

### Task 6: Animated segment switching

**Files:**
- Modify: `src/components/books/books-page.tsx:259-324`

**Step 1:** Wrap the four segment conditionals in `AnimatePresence mode="wait" initial={false}` with ONE `motion.div` keyed by `activeSegment`, using `scheduleViewVariants` / `scheduleViewVariantsReduced` (via `useReducedMotion()`); the div is `flex h-full min-h-0 flex-col` so TableShell height math survives. The four segment components render inside unchanged.
```tsx
<AnimatePresence mode="wait" initial={false}>
  <motion.div key={activeSegment ?? "none"} className="flex h-full min-h-0 flex-col"
    variants={reduced ? scheduleViewVariantsReduced : scheduleViewVariants}
    initial="hidden" animate="visible" exit="exit">
    {…segment…}
  </motion.div>
</AnimatePresence>
```
`mode="wait"` (~200ms out/in) is correct here — the segments share pinned chrome geometry after Task 3, so a wait-swap reads as one surface breathing, and it avoids double-mounting two TableShells (each with query subscriptions) during a crossfade.
**Step 2:** Verify no scroll-position artifacts: each segment's shell owns its scroll; switching resets to top (acceptable; matches current).
**Step 3:** Preview: cycle segments — body fades/slides 8px, tabs + metrics strip rock-steady, no layout pop. Confirm with `preview_inspect` that workbar height is constant through the transition. Reduced-motion check: `preview_resize` with `colorScheme` isn't it — use `preview_eval` `matchMedia('(prefers-reduced-motion: reduce)')` emulation if the tool supports it; else verify the variant wiring by code review and say so. Screenshots.
**Step 4:** Commit: `feat(books): animated segment switching — stable chrome, body-only transition`

### Task 7: Audit + evidence

`custom-skills:audit-design-system` on every touched file (this plan retires several hardcoded hexes — enumerate them in the report: `#93321A`, `rgba(157,181,130,…)`, `#D99A3E`, `rounded-full` pills). Evidence folder `docs/artifacts/web-polish-2026-07-09/books-expenses/`. Report the one intentionally-kept accent usage (selection border) for Jackson's taste review.
