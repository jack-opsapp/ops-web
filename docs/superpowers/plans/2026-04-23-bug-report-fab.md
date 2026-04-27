# Bug Report Widget + FAB — Group E1

> **Bugs covered**
> - `016b5df1-3b82-4786-a034-9768b9e71230` — Bug-report "attach screenshot" toggle does not look right (2026-04-20)
> - `30c49212-bb91-4328-a503-a96b227391aa` — Bug-reports toggle button does not work. Use the toggle element used throughout the app (2026-04-15)
> - `59a204ea-d4e0-48aa-9df9-58150e01b8ec` — Make FAB button hide at page edge, style like a tab with a plus, round edge tangent to screen edge (2026-04-18)

## Decision required before dispatch (FAB)

The FAB bug (`59a204ea`) says *"style like a tab with a plus, and round edge tangent to screen edge."* **One interpretation is locked in below — confirm or adjust before the implementing agent runs.**

**Interpretation:** replace the 52px free-floating circle at `right-4/6` with a
**half-pill dock tab** anchored flush against the right edge of the viewport:

```
              │ viewport
              │  ┌─────────┐
              │  │ ⌐─┐     │
              │  │ │+│     │  ← tab shape protrudes ~44px from edge
              │  │ └─┘     │  ← right side flush with edge
              │  │         │  ← left side rounded (tangent to inner content area)
              │  └─────────┘
              │
```

- Right edge of the tab sits at `right: 0` (flush).
- Left side rounded with a radius such that the curve is tangent to the content margin — translated to Tailwind: `rounded-l-[22px] rounded-r-none`.
- 44×52px tab (slightly taller than wide). 44px protrusion from edge, 52px vertical.
- Single glass-surface, `+` icon centered, rotates 225° on open (existing behavior preserved).
- Menu items still slide out as labeled pills but now emerge from the tab's left edge (not from below a circle).

**Alternate interpretations the user might have meant:**

A. **"Pop-out tab"** — the tab sits mostly off-screen (e.g., `right: -22px`), showing only a sliver (~22px visible) with the `+` icon. On hover, slides in to show the full tab. More aggressive hide-at-edge behavior.
B. **"Gutter tab"** — the tab's position is vertically centered on the right edge (not bottom), matching common sidebar-toggle UX patterns. Implies moving from bottom-right to middle-right.
C. **Existing circle, just stuck to the edge** — keep `rounded-full`, move from `right-4` to `right-0` so half the circle is off-screen. Minimal change interpretation.

Ping the user for:
1. **Shape:** half-pill dock (my default) vs. pop-out tab (A) vs. gutter tab (B) vs. edge-clipped circle (C)
2. **Vertical position:** keep current `bottom-[80px]/md:bottom-[120px]` or move to viewport vertical center?
3. **Protrusion size:** 44px wide feels right for a 52px FAB, but if the tab is mostly hidden (option A), the protrusion shrinks to ~22px and icon stays visible.

Until confirmed, **stop at E1.2** (bug-report toggle fix). Do not implement E1.3 (FAB reshape) without an answer.

## Skills to load

- `interface-design` + `.interface-design/system.md`
- `animation-studio:animation-architect` (FAB involves motion, triggers gateway)
- `animation-studio:web-animations`
- `frontend-design`
- `ops-copywriter` (labels are already in i18n — no new copy, but verify nothing hardcoded)

## Source of truth

- `OPS-Web/.interface-design/system.md` — §Toggles, §Z-Index Scale, §Component Primitives
- V2 bundle: `/Users/jacksonsweet/Projects/OPS/ops-design-system-v2/project/colors_and_type.css`
- Canonical toggle: `OPS-Web/src/components/ui/switch.tsx` (Radix-based, 44×24)
- FAB motion: `OPS-Web/src/lib/utils/motion.ts` → `SPRING_FAB`, `fabOverlayVariants`, `fabItemVariants`, `fabBadgeVariants`

## Files touched

| File | Purpose |
|------|---------|
| `OPS-Web/src/components/ops/bug-report-button.tsx` | Replace hand-rolled attach-screenshot toggle with canonical `<Switch>`. |
| `OPS-Web/src/components/ops/floating-action-button.tsx` | Reshape FAB into edge-docked tab (pending decision confirmation). |
| `OPS-Web/src/components/layouts/dashboard-layout.tsx` | **No changes expected.** Both widgets are mounted here (lines 243–244) but their internal reshape/restyle doesn't touch the mount. Flag to Group A's separate session to coordinate if it ends up moving the FAB/bug-report mount. |

**Coordination note:** Group A (notification rail redesign) is happening in a
separate session and may touch `dashboard-layout.tsx`. The agent working E1
should **not** edit `dashboard-layout.tsx` unless strictly necessary; if a
layout change is required, stop and surface it to the main session.

## Diagnosis

### Bugs 016b5df1 + 30c49212 — attach-screenshot toggle (SAME BUG, two reports)

`bug-report-button.tsx:370-387` hand-rolls a 24×12px custom toggle with a
10×10px thumb. Uses `ops-accent` for checked — which **violates spec v2**:
> Accent does NOT appear on: ghost buttons, links, **toggles**, sidebar active state, tags…

Canonical toggle at `OPS-Web/src/components/ui/switch.tsx`:
- 44×24px outer (twice the size of the hand-rolled one)
- 20×20px thumb
- `data-[state=checked]:bg-text-2` (no accent)
- `data-[state=unchecked]:bg-fill-neutral-dim`

Both bug reports refer to this same toggle — one says "does not look right"
(016b5df1, 2026-04-20), the other says "use the toggle element we have built
that is used throughout the app" (30c49212, 2026-04-15). Fix one, close both.

### Bug 59a204ea — FAB edge-dock tab

`floating-action-button.tsx:326-344` renders a 52×52px `rounded-full` circle
at `bottom-[80px] right-4 md:bottom-[120px] md:right-6`. The bug asks for a
"tab" shape flush with the screen edge. Requires:
- Drop `rounded-full`.
- Replace with `rounded-l-[22px] rounded-r-none` (half-pill) or tab variant
  per decision above.
- Move from `right-4 md:right-6` to `right-0`.
- Adjust menu-items origin so they slide out from the tab's left edge.

## Tasks

### Task E1.1 — Swap hand-rolled attach-screenshot toggle for `<Switch>` (5 min)

**File:** `OPS-Web/src/components/ops/bug-report-button.tsx`

**Add import** at the top alongside the existing imports (insert after line 16):

```ts
import { Switch } from "@/components/ui/switch";
```

**Replace lines 349–388** (the entire `screenshotBlob && (...)` button block) **with:**

```tsx
                    {screenshotBlob && (
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)]">
                        <div className="flex flex-col gap-[2px] min-w-0">
                          <label
                            htmlFor="bug-report-include-screenshot"
                            className="font-mono text-micro uppercase tracking-wider text-text-2 cursor-pointer select-none"
                          >
                            {t("bugReport.attachScreenshot")}
                          </label>
                          <span className="font-mono text-micro text-text-mute tracking-wider">
                            {`[${Math.round(screenshotBlob.size / 1024)}KB]`}
                          </span>
                        </div>
                        <Switch
                          id="bug-report-include-screenshot"
                          checked={includeScreenshot}
                          onCheckedChange={setIncludeScreenshot}
                          aria-label={t("bugReport.attachScreenshot")}
                        />
                      </div>
                    )}
```

Behavioral changes vs original:
- Toggle is now the canonical `<Switch>` (Radix-based, 44×24 with `text-2`
  checked state, no accent).
- The label is a proper `<label htmlFor>` so clicking it toggles the switch
  (previously the whole row was a button).
- Layout: `justify-between` with label on the left, file size as a secondary
  line below, switch on the right. Matches spec v2 row pattern for settings
  toggles.
- Size-in-KB is in `[brackets]` per spec v2 tactical voice (`§Tactical
  Character`).

### Task E1.1a — Verify / add i18n keys (2 min)

The original used three i18n keys in this block: a formatted string with
`[ATTACH SCREENSHOT · XKB]` and `[SCREENSHOT OFF]`. The new design uses a
plain label plus a bracketed filesize, which needs one new key.

**File:** `OPS-Web/src/i18n/dictionaries/en/common.json`

Find the `bugReport` object and add/verify:

```json
  "bugReport": {
    "...": "existing keys unchanged",
    "attachScreenshot": "Attach screenshot"
  },
```

**Mirror** the same key in `OPS-Web/src/i18n/dictionaries/es/common.json`:

```json
  "bugReport": {
    "...": "existing keys unchanged",
    "attachScreenshot": "Adjuntar captura de pantalla"
  },
```

If any of the old keys (`bugReport.attachScreenshotKB`, `bugReport.screenshotOff`, or whatever they were named — grep to confirm) are now unreferenced, remove them from both dictionaries.

**Commit (E1.1 + E1.1a together):**
```sh
git add src/components/ops/bug-report-button.tsx src/i18n/dictionaries/en/common.json src/i18n/dictionaries/es/common.json
git commit -m "fix(bug-report): replace hand-rolled toggle with canonical Switch

Bugs 016b5df1 + 30c49212 — the attach-screenshot toggle was hand-rolled
at 24x12px with ops-accent checked color, which violates spec v2 (no
accent on toggles). Swap for the Radix-based <Switch> at /components/ui
(44x24, text-2 checked, fill-neutral-dim unchecked). Restructure the row
to label-left / switch-right with filesize in [brackets] per spec v2
tactical voice."
```

### Task E1.2 — Browser verify bug-report toggle (3 min)

1. `cd OPS-Web && npm run dev`
2. Navigate anywhere **except** `/dashboard` or `/intel` (bug-report-button
   hides there — see `bug-report-button.tsx:244`).
3. Click the bug-report glass pill in the bottom-left. Wait for screenshot
   capture to complete, form opens.
4. Find the "Attach screenshot" row. Verify:
   - Toggle is the full 44×24 `<Switch>` (same as settings pages use).
   - Checked state is `text-2` grey, unchecked is `fill-neutral-dim`. No
     steel-blue accent anywhere on the toggle.
   - Clicking the label toggles the switch (not just the switch itself).
   - Filesize displays in `[KB]` brackets below the label.
5. Submit the bug report with the toggle in both states. Confirm the
   screenshot upload behavior matches (on = uploads, off = skipped).

**If anything fails:** do not commit. Fix before proceeding.

**Commit (verification):**
```sh
git commit --allow-empty -m "chore(bug-report): browser-verified E1 toggle fix"
```

### 🛑 STOP HERE pending FAB design confirmation

Tasks E1.3–E1.5 below implement the default half-pill interpretation. **DO
NOT** run them without user confirmation. If the user picks a different
option from the "Decision required" section above, the code in E1.3 changes
accordingly.

---

### Task E1.3 — Reshape FAB into edge-docked half-pill tab (8 min)

> Default interpretation. Change before running if user picked A/B/C.

**File:** `OPS-Web/src/components/ops/floating-action-button.tsx`

**Replace lines 209–216** (the FAB container div) **with:**

```tsx
      {/* ── FAB container — edge-docked tab (half-pill, flush right) ── */}
      <div
        ref={containerRef}
        className={cn(
          "fixed bottom-[80px] right-0 md:bottom-[120px] z-[95] transition-all duration-200",
          dashboardCustomizing && "opacity-0 pointer-events-none translate-y-2"
        )}
      >
```

Key change: `right-4 md:right-6` → `right-0`. Tab is flush with viewport edge.

**Replace lines 327–344** (the button itself) **with:**

```tsx
        {/* ── FAB button — 44×52 edge-docked tab with + icon ── */}
        <motion.button
          onClick={() => !editMode && setOpen((prev) => !prev)}
          onPointerDown={startLongPress}
          onPointerUp={cancelLongPress}
          onPointerLeave={cancelLongPress}
          onPointerCancel={cancelLongPress}
          className={cn(
            "w-[44px] h-[52px] flex items-center justify-center",
            "rounded-l-[22px] rounded-r-none", // tangent half-pill tab
            "glass-surface !border-2 !border-[rgba(255,255,255,0.20)]",
            "hover:!border-[rgba(255,255,255,0.30)]",
            "transition-colors duration-150"
          )}
          animate={{ rotate: open || editMode ? 225 : 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : SPRING_FAB}
          title="Quick actions"
        >
          <Plus className="w-5 h-5 text-text" />
        </motion.button>
```

Changes:
- `w-[52px] h-[52px] rounded-full` → `w-[44px] h-[52px] rounded-l-[22px] rounded-r-none`
- The `!border-2 !border-[rgba(255,255,255,0.20)]` stays — critical for
  distinguishing the FAB from the dashboard background.
- `glass-surface` already applies top-edge gradient; that gradient now
  visually anchors the tab to the edge.

**Replace line 221** (menu items' container class):

Find:
```tsx
            <div className="absolute bottom-[60px] right-0 flex flex-col-reverse gap-2">
```

Replace with:
```tsx
            <div className="absolute bottom-[60px] right-[4px] flex flex-col-reverse gap-2 items-end">
```

Menu items need a small `4px` right offset so their right edges don't press
against the viewport edge (they're pills, not tabs). `items-end` keeps them
right-aligned.

### Task E1.4 — Adjust `SPRING_FAB` usage for reduced motion (0 changes expected — verify only) (2 min)

The `SPRING_FAB` constant from `motion.ts` is a spring — spec v2 says "No
spring physics. No bounce." BUT the existing code at line 340 says
`transition={prefersReducedMotion ? { duration: 0 } : SPRING_FAB}`. This is
**pre-existing** behavior and an exception baked into the FAB rotate
animation.

**Do not change this** as part of this bug — out of scope. Flag as a separate
follow-up if the user wants spring physics fully eliminated from the FAB.

### Task E1.5 — Browser verify FAB reshape (5 min)

1. `cd OPS-Web && npm run dev`
2. Navigate to any page with the FAB (e.g., `/projects`, `/clients`, `/calendar`). FAB is hidden on `/intel` — confirm.
3. **Shape check**: FAB is a half-pill 44×52, flush with right edge. `+` icon centered. Border visible on left, top, bottom — no border on the (invisible, off-screen) right side.
4. **Open**: click → `+` rotates 225°, menu items fan out to the left. Each menu pill's right edge aligns ~4px from the viewport edge.
5. **Long-press** (1s pointerDown) → enters edit mode, minus badges appear on items. Existing behavior preserved.
6. **Outside click** → closes.
7. **Page without FAB**: navigate to `/intel` → FAB unmounts. Navigate to `/dashboard` with the customize panel open → FAB fades to `opacity: 0`.
8. **Mobile viewport** (resize to <768px) — `bottom-[80px]` takes over (vs `md:bottom-[120px]` on desktop). Tab still flush right. Finger-tappable target remains ≥44×44px.
9. **Compare side-by-side with bug-report button** (bottom-left). Bug-report is a small glass pill with icon + label; FAB is a large tab. Intentional visual weight difference — FAB is the primary action surface, bug-report is a utility.
10. **Reduced motion**: system setting "Reduce motion" on → `+` rotation goes instant instead of spring.

**If the menu overlay animation (`fabOverlayVariants` gradient) no longer
covers properly:** check that the gradient in `floating-action-button.tsx:195`
(`"linear-gradient(to left, var(--surface-glass-dense), transparent)"`) still
reaches the tab. Should still work because the overlay is `fixed inset-0`.

**Commit (E1.3 → E1.5):**
```sh
git add src/components/ops/floating-action-button.tsx
git commit -m "feat(fab): reshape FAB into edge-docked half-pill tab

Bug 59a204ea — the previous free-floating 52x52 circle at right-4/6 is
now a 44x52 half-pill tab flush with the viewport right edge. Keeps
glass-surface + 2px border + 225deg rotate-on-open behavior, but the
shape now reads as a dock tab tangent to the screen edge (rounded-l at
22px / flat right). Menu items fan left from the tab's left edge with a
4px inset."
```

**Commit (final verification):**
```sh
git commit --allow-empty -m "chore(fab): browser-verified group E1 reshape"
```

## Acceptance criteria

- [ ] All 3 bug_reports rows (`016b5df1`, `30c49212`, `59a204ea`) manually resolved on review
- [ ] Zero TypeScript errors on both modified files
- [ ] `npm run lint` clean
- [ ] Bug-report attach toggle visually matches other `<Switch>` usages in the app (e.g., settings tabs)
- [ ] FAB tab is flush-right with tangent rounded left edge, no visible gap
- [ ] Reduced-motion path tested for both widgets
- [ ] No unauthorized edits to `dashboard-layout.tsx`

## Non-goals / out of scope

- Migrating `SPRING_FAB` to `EASE_SMOOTH` (separate cleanup)
- Changing bug-report submit flow, screenshot capture library, or screenshot-upload endpoint
- FAB action configuration (`fab-actions.ts`) or long-press edit-mode logic
- Any changes to the bug-report's trigger position / z-index / route gating
