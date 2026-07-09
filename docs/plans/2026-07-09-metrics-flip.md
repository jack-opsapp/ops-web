# Metrics Flip Restoration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Read `2026-07-09-web-polish-README.md` in this directory FIRST.

**Goal:** Clicking a metric does exactly one thing, everywhere: the cell flips to reveal the formula behind the number. No metric navigates. The catalog strip loses its `// SUPPLY` label.

**Why:** The old `MetricColumn` flip (`src/components/metrics/MetricColumn.tsx:50-90`) was orphaned by table unification. The live `MetricsStrip` never flips: its adapter drops the `breakdown` field and some cells `router.push` on click (Catalog/Books/Clients) while others are inert (Projects/Pipeline) — Jackson's "unpredictable results."

**Architecture:** Add `breakdown?: string` to `MetricCell`; implement flip inside `MetricsStrip`'s `Cell`; delete the `onClick` drill API and every drill call site; thread `breakdown` through the adapter and per-surface cell builders. The legacy flip components stay untouched this pass except where noted (MetricsHeader `variant="compact"` is still live on Projects/Schedule pages).

**Tech Stack:** React 19 / Next 15, CSS 3D transform (no Framer needed — match `WidgetCardFlip` precedent), vitest.

**Design System:** Card flip = 350ms `EASE_SMOOTH` (DESIGN.md §8), reduced-motion → crossfade (`.interface-design/system.md` § Card Flip). Back-face text: `font-mono text-data-sm text-text-2`.

**Required Skills:** `ops-design`, `frontend-design:frontend-design`, `animation-studio:animation-architect` + `animation-studio:web-animations` (the flip), `animation-studio:data-visualization`, `custom-skills:audit-design-system`.

---

### Task 1: `MetricCell.breakdown` + flip in the strip

**Files:**
- Modify: `src/components/ui/metrics-strip/metrics-strip.tsx`
- Test: add unit test per repo test conventions (grep `tests/` for existing component tests to colocate correctly)

**Step 1 (failing test):** Cell with `breakdown` renders `role="button"`, `aria-pressed=false`, and after click shows the breakdown text; cell without `breakdown` renders `role="group"` and no button semantics.

**Step 2:** Implement. In `metrics-strip.tsx`:
- `MetricCell`: **remove `onClick?: () => void`**, add:
  ```ts
  /** Formula behind the number (e.g. "12 won ÷ 15 decided"). Click flips the cell to reveal it. */
  breakdown?: string;
  ```
- Rewrite `Cell` (currently :100-145). Shape:
  ```tsx
  function Cell({ cell }: { cell: MetricCell }) {
    const [flipped, setFlipped] = useState(false);
    const reduced = useReducedMotion(); // framer-motion hook, already used app-wide
    const canFlip = !!cell.breakdown;
    // front = existing `inner`; back = label row + breakdown line
    const back = (
      <>
        <div className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span aria-hidden className="text-text-mute">{"// "}</span>
          {cell.label}
        </div>
        <div className="font-mono text-data-sm leading-snug text-text-2">{cell.breakdown}</div>
      </>
    );
    ...
  }
  ```
  Mechanics (mirror `MetricColumn.tsx:74-137`, fixing its known positioning bug):
  - Outer wrapper (`base` classes, minus interactivity) gets `style={{ perspective: canFlip ? 600 : undefined }}`.
  - Inner rotator: **`relative`** (this is the fix — the legacy back face anchored to the wrong ancestor), `transformStyle: "preserve-3d"`, `transform: flipped ? "rotateY(180deg)" : "rotateY(0)"`, `transition: "transform 350ms cubic-bezier(0.22, 1, 0.36, 1)"`.
  - Front face: `backfaceVisibility: "hidden"`; back face: `absolute inset-0 flex flex-col gap-[3px]` + `backfaceVisibility: "hidden"; transform: rotateY(180deg)`.
  - Reduced motion: no rotation — swap faces with a 150ms opacity crossfade (`transition-opacity`), same click contract.
  - Interactivity ONLY when `canFlip`: render as `<button type="button">` with `aria-pressed={flipped}`, `aria-label={`${label}. Show formula.`}`, hover `bg-surface-hover`, focus ring `ring-ops-accent ring-inset` (reuse the exact focus classes from the old drill button at :134). Without `breakdown`: the current static `<div role="group">`.
  - Delete the `if (cell.onClick)` drill branch entirely.
- Height integrity: the back face is `absolute`, so the front face keeps defining cell height — verify a flipped cell doesn't collapse or grow (the strip row is `items-stretch`).

**Step 3:** Test passes; tsc clean **except** the expected breakages at drill call sites — those are Task 2's job (list them from the tsc output; they are your worklist).

**Step 4:** Commit after Task 2 (they're one logical change).

### Task 2: Remove every drill call site; thread `breakdown` on manual-cell surfaces

**Files (from recon; re-verify with `grep -rn "onClick" src/components/catalog/supply-strip.tsx src/components/books/ledger-strip.tsx src/app/(dashboard)/clients/page.tsx`):**
- `src/components/catalog/supply-strip.tsx` — delete `onClick` props (:89,:111,:136) and the `onDrillBelowThreshold/onOpenCounts/onFixCosts` prop plumbing; **also delete `label={t("supply.title", "SUPPLY")}` at :158-161 — keep `ariaLabel`** (the `// SUPPLY` removal). Add an honest `breakdown` per cell describing its formula from the values already in scope (e.g. STOCK HEALTH → `"${belowCount} below min ÷ ${trackedCount} tracked"`). Read the file to source exact variable names — never invent a formula the numbers don't support; if a cell has no meaningful formula, omit `breakdown` (cell stays static).
- `src/components/catalog/catalog-page.tsx` — remove handler defs (:137-147) + pass-through (:195-197). Check `drill=threshold|view=counts|filter=nocost` URL params: **the params still work** (deep links / other entry points may use them) — only the metric-cell entry point goes away. Verify nothing else references the removed handlers.
- `src/components/books/ledger-strip.tsx` — remove `onDrillOverdue` cell onClick (:134) + prop; add `breakdown` strings to ledger cells where the data supports them (read the file; e.g. A/R cell → `"${openCount} open · ${overdueCount} overdue"`).
- `src/components/books/books-page.tsx` — remove `onDrillOverdue={can("invoices.view") ? drillOverdue : undefined}` (:253) and the now-orphaned `drillOverdue` callback + `drilled` state **if** nothing else sets it. CHECK FIRST: `drilled` also feeds the invoices/estimates segments' rose DrillChip and `clearDrill`. The `status=overdue` URL filter must keep working from other entry points (dashboard widgets deep-link `/books?segment=invoices&status=overdue`). Keep the URL contract + chip behavior; delete only the strip-click path. If `drilled` becomes write-never, derive the chip from `statusParam === "overdue"` instead — read the segments' usage before deciding, and leave behavior identical from the URL side.
- `src/app/(dashboard)/clients/page.tsx:304` — remove the conditional `onClick: amt > 0 ? () => setFilter("owes") : undefined`; add `breakdown` where supportable. The "owes" filter chip on the page remains the way to filter.
- Adapter `src/components/ui/metrics-strip/from-metric-columns.ts:63-72` — add `breakdown: c.breakdown,` to the mapped cell.

`metrics-service.ts` already authors `breakdown` on ~30 metrics (projects `:308-338`, pipeline `:404-433`, invoices, estimates, accounting, inventory) — Projects + Pipeline strips get formulas with zero further work once the adapter passes them through.

**Step 1:** Make all edits; tsc fully clean now.
**Step 2:** Unit tests still green (`npx vitest run` on touched test dirs).
**Step 3:** Preview each surface at 1440×900: `/projects` (table mode), `/pipeline`, `/books`, `/catalog`, `/clients` —
  - click a metric with a formula → flips, formula readable, click again → flips back;
  - click a metric without a formula → nothing (no cursor change);
  - catalog strip starts at the left edge with NO `// SUPPLY` label;
  - no metric navigates (URL unchanged after clicks).
  Screenshot front + back of one flipped cell per surface → `docs/artifacts/web-polish-2026-07-09/metrics-flip/`.
**Step 4:** Commit: `feat(metrics): restore click-to-flip formula reveal as the one metric interaction; drop drill navigation + catalog SUPPLY label`

### Task 3: Legacy sweep

**Step 1:** `grep -rn "variant=\"full\"" src/` → should only hit docs. `MetricsHeader`'s `FullMetricsHeader`/`MetricColumn` path is dead code but **do not delete this pass** if `variant="compact"` shares internals — verify: if `MetricColumn` is imported ONLY by the `full` path, delete `MetricColumn.tsx` + the `full` branch and their exclusive helpers; if shared, leave with a one-line comment pointing at MetricsStrip. Decide from actual imports, not assumption.
**Step 2:** tsc + existing tests green.
**Step 3:** Commit (if deletions): `refactor(metrics): remove orphaned MetricsHeader full/flip path`

### Task 4: Audit + evidence

`custom-skills:audit-design-system` over touched files (the new back face must be fully tokenized). Evidence folder assembled. Report which cells on which surfaces now carry formulas and which are static (with the reason: no formula in the data).
