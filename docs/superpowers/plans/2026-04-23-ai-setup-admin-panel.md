# AI Setup Page Polish — Group D (scoped)

> **Superseded 2026-04-24 by CALIBRATION** — see `2026-04-23-calibration-implementation.md`. The stopgap target (`/settings/integrations/ai-setup`) has been deleted; the route 308-redirects to `/calibration`.
>
> **Scope note:** This plan covers two surgical fixes on the existing `/settings/integrations/ai-setup` page. The original Group D also surfaced a major rework — promoting AI setup into a new top-level CALIBRATION destination holding all Phase C + AI backend knowledge. That rework is **out of scope here** and will be run in its own brainstorming / spec / plan session (handoff prompt at `docs/superpowers/specs/2026-04-23-calibration-handoff.md`).
>
> These two fixes kept the current page usable until CALIBRATION landed.

> **Bugs covered**
> - `8b09f663-266e-4642-9dc7-56add5f3f29d` — Ops admin panel: need to remove scrollview from page (2026-04-15)
> - `fcac6fcf-6f12-41b2-90da-55f0661dd8e8` — When on inbox tab, user cannot click to another tab (2026-04-15)
>
> **Bugs deferred to CALIBRATION:**
> - `702ed262-bc12-4962-9615-5220bc021e01` — Consolidate tabs — subsumed by the CALIBRATION IA redesign
> - `7c52b799-9e5b-4f5b-bd62-0009c892a960` — Split integrations tab AI/non-AI — subsumed by CALIBRATION (integrations parent page stops holding AI once CALIBRATION is a top-level destination)

## Skills to load

- `interface-design` + `.interface-design/system.md`
- `frontend-design`
- **Read first**: `OPS-Web/docs/superpowers/plans/2026-04-21-full-height-pages.md` — the pattern we're extending

## Source of truth

- `OPS-Web/.interface-design/system.md`
- `OPS-Web/CLAUDE.md` — spec v2 consolidation
- `OPS-Web/docs/superpowers/plans/2026-04-21-full-height-pages.md` — layout pattern

## Files touched

| File | Purpose |
|------|---------|
| `OPS-Web/src/components/layouts/dashboard-layout.tsx` | Add `/settings/integrations/ai-setup` to `FULL_HEIGHT_ROUTES` |
| `OPS-Web/src/app/(dashboard)/settings/integrations/ai-setup/page.tsx` | Drop `min-h-[400px]` from the inner card; fix skip-path step-nav trap |

**Coordination required:** `dashboard-layout.tsx` may also be touched by Group A (notification rail session) and is **declined** for Group E1 (per user decision to hold E1). Check with the Group A session whether they've shipped changes to that file before this plan runs. If both have landed modifications, rebase accordingly.

## Diagnosis

### Bug 8b09f663 — Remove scrollview
Current `ai-setup/page.tsx:317` wraps content in `<div className="space-y-3">`. With no explicit scroll container, the page relies on the default scroll layout from `dashboard-layout.tsx:145` (`<div className="flex-1 min-h-0 pt-[68px] pb-32 px-3 space-y-3 overflow-y-auto overflow-x-auto">`). Results in:
- Page-level scroll when content grows
- `pb-32` creating 128px dead space at bottom
- The inner `glass-surface` card at line 394 with `min-h-[400px]` guaranteeing at least 400px even when empty

The existing full-height infrastructure from the 2026-04-21 plan already handles this — `/inbox`, `/map`, `/calendar` are in `FULL_HEIGHT_ROUTES`. Add `/settings/integrations/ai-setup` to the list as `"padded"` mode and strip the fixed min-height.

### Bug fcac6fcf — Skip traps user on email_scan step
At `ai-setup/page.tsx:366`:
```tsx
disabled={!isPast && !isActive}
```
`isPast` is defined at lines 355–358:
```tsx
const isPast =
  (step.key === "interview" && interviewPhase === "completed") ||
  (step.key === "email_scan" && emailScanDone) ||
  (step.key === "mining" && miningDone);
```

`handleEmailScanSkip` at line 290 only calls `setActivePhase("mining")` — it does not set `emailScanDone = true`. Result: after skipping, `email_scan` is neither active nor past → step button disabled → user cannot navigate back to email_scan to actually run it.

Same pattern would exist for mining if it had a skip path (currently it doesn't — handled by `AiDatabaseMining` internally). Fix by adding a `visitedPhases` Set that tracks every phase the user has ever been on, and using that instead of (or in addition to) the completion flags for nav-gating.

## Tasks

### Task D.1 — Opt `/settings/integrations/ai-setup` into padded full-height layout (2 min)

**File:** `OPS-Web/src/components/layouts/dashboard-layout.tsx`

Find `FULL_HEIGHT_ROUTES` (introduced by the 2026-04-21 plan). Current state after Task 4 of that plan:

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/map": "bleed",
  "/calendar": "padded",
};
```

**Extend to:**

```tsx
const FULL_HEIGHT_ROUTES: Record<string, FullHeightMode> = {
  "/inbox": "padded",
  "/map": "bleed",
  "/calendar": "padded",
  "/settings/integrations/ai-setup": "padded",
};
```

No other changes in this file.

### Task D.2 — Convert `ai-setup/page.tsx` outer wrapper for full-height (3 min)

**File:** `OPS-Web/src/app/(dashboard)/settings/integrations/ai-setup/page.tsx`

At line 317 the current shape is:

```tsx
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        ...
```

**Replace with a flex column matching the padded mode layout:**

```tsx
  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        ...
```

Rationale (mirrors the calendar migration at Task 4 Step 3 of the 2026-04-21 plan): padded mode's wrapper provides `flex-1 min-h-0 pt-[68px] pb-3 px-3 flex flex-col`. `h-full` fills the content box; `gap-3` preserves the 12px spacing that `space-y-3` provided.

**At line 394** the inner glass-surface card currently has:

```tsx
          <div className="glass-surface rounded-lg p-4 min-h-[400px]">
```

**Replace with:**

```tsx
          <div className="glass-surface rounded-panel p-4 flex-1 min-h-0 overflow-y-auto">
```

Changes:
- `rounded-lg` → `rounded-panel` (spec v2 — panels are 10px, `rounded-lg` is 8px in the tailwind config)
- `min-h-[400px]` → `flex-1 min-h-0` so the card fills remaining vertical space below the header/subtitle/step-indicator row
- Add `overflow-y-auto` so long section content (e.g., email-scan progress table) scrolls *inside the card*, not the whole page

**Also check that the `AnimatePresence` wrapper and its children at lines 395–426 don't assume a fixed height.** They don't — the motion wrappers use `animate="animate"` / `exit="exit"` without explicit height constraints. No change needed there.

### Task D.3 — Fix skip-trap in step navigation (5 min)

**File:** `OPS-Web/src/app/(dashboard)/settings/integrations/ai-setup/page.tsx`

**Add a `visitedPhases` state** to track every phase the user has been on. Insert after line 265 (after the existing `useState` for `emailScanDone` / `miningDone`):

```tsx
  // Track which phases the user has visited — separate from *Done flags so
  // "Skip" paths still unlock nav back to the skipped phase. Bug fcac6fcf.
  const [visitedPhases, setVisitedPhases] = useState<Set<SetupPhase>>(
    () => new Set<SetupPhase>(["interview"])
  );

  // Keep visitedPhases in sync whenever activePhase changes.
  useEffect(() => {
    setVisitedPhases((prev) => {
      if (prev.has(activePhase)) return prev;
      const next = new Set(prev);
      next.add(activePhase);
      return next;
    });
  }, [activePhase]);
```

**Update the `isPast` calculation** at lines 354–358. Replace:

```tsx
              const isPast =
                (step.key === "interview" && interviewPhase === "completed") ||
                (step.key === "email_scan" && emailScanDone) ||
                (step.key === "mining" && miningDone);
```

**With:**

```tsx
              // A phase is navigable if either (a) the user has visited it
              // before (including via skip), or (b) it's been completed. The
              // visited check keeps skip paths from trapping the user on a
              // downstream tab. Bug fcac6fcf.
              const isCompleted =
                (step.key === "interview" && interviewPhase === "completed") ||
                (step.key === "email_scan" && emailScanDone) ||
                (step.key === "mining" && miningDone);
              const isPast = isCompleted || visitedPhases.has(step.key);
```

**Also update the visual styling** at lines 371–373 so *completed* still renders with the olive success chip while *merely-visited* renders neutral. Replace lines 367–374:

```tsx
                    className={cn(
                      "w-[24px] h-[24px] rounded-full flex items-center justify-center font-mohave text-[12px] font-semibold transition-colors",
                      isActive
                        ? "bg-text-2 text-background"
                        : isPast
                          ? "bg-[rgba(157,181,130,0.2)] text-[#9DB582] cursor-pointer"
                          : "bg-[rgba(255,255,255,0.06)] text-text-mute cursor-not-allowed"
                    )}
```

**With:**

```tsx
                    className={cn(
                      "w-[24px] h-[24px] rounded-full flex items-center justify-center font-mohave text-[12px] font-semibold transition-colors",
                      isActive
                        ? "bg-text-2 text-background"
                        : isCompleted
                          ? "bg-[rgba(157,181,130,0.2)] text-[#9DB582] cursor-pointer"
                          : isPast
                            ? "bg-[rgba(255,255,255,0.08)] text-text-2 cursor-pointer"
                            : "bg-[rgba(255,255,255,0.06)] text-text-mute cursor-not-allowed"
                    )}
```

The new middle branch (visited but not completed) uses `surface-active` background and `text-2` — visually distinct from both the completed olive chip and the locked-future-step muted chip.

**Also update the connector line** at lines 380–385 to use the same `isCompleted` signal (currently uses `isPast` which now admits skipped steps; connector should only show green between completed steps):

```tsx
                  {i < 3 && (
                    <div
                      className={cn(
                        "w-[20px] h-[1px]",
                        isCompleted
                          ? "bg-[rgba(157,181,130,0.3)]"
                          : "bg-[rgba(255,255,255,0.06)]"
                      )}
                    />
                  )}
```

### Task D.4 — Commit D.1–D.3 as one atomic change (1 min)

```sh
cd /Users/jacksonsweet/Projects/OPS/OPS-Web
git add src/components/layouts/dashboard-layout.tsx src/app/\(dashboard\)/settings/integrations/ai-setup/page.tsx
git commit -m "fix(ai-setup): full-height layout + unblock skip-trap nav

Bug 8b09f663 — opt /settings/integrations/ai-setup into the padded
full-height layout mode (from 2026-04-21 full-height-pages plan). Drop
min-h-[400px] on the inner card; use flex-1 min-h-0 + overflow-y-auto so
long section content scrolls inside the card, not the page.

Bug fcac6fcf — handleEmailScanSkip set activePhase without flagging the
phase as visited, so isPast stayed false and the step button stayed
disabled — trapping the user on the downstream tab with no way back.
Track visitedPhases in a Set that accumulates on every activePhase
change; isPast now admits visited-but-not-completed phases. Step chip
styling distinguishes completed (olive) from merely-visited (neutral)."
```

### Task D.5 — Browser verify (5 min)

1. `cd OPS-Web && npm run dev`
2. **Verify D.1 + D.2** — navigate to `/settings/integrations/ai-setup`. Feature flag `phase_c` must be on; if not, the "Coming Soon" state renders and there's nothing to test.
   - No page-level scrollbar. Any overflow scrolls inside the glass-surface card.
   - Bottom gap is ~12px (not 128px).
   - Card fills remaining vertical space below the header + subtitle + step indicators.
   - Resize the window — card continuously adapts.
3. **Verify D.3** — complete the interview step, land on email_scan. Click **Skip** — advances to mining. Then click the `2` step chip (email_scan). It should:
   - Be clickable (not disabled).
   - Render in the neutral "visited" style (white-ish chip, not olive).
   - Navigate back to email_scan on click.
4. **Run email_scan to completion** — the `2` chip flips to olive (`bg-[rgba(157,181,130,0.2)]`), connector line between 1→2 flips to olive.
5. **Regression**: existing completed-step olive styling still shows for `interview` once it's completed.

**If anything fails:** do not commit. Debug and fix.

**Commit (verification):**
```sh
git commit --allow-empty -m "chore(ai-setup): browser-verified group D fixes"
```

## Acceptance criteria

- [ ] Both in-scope `bug_reports` rows (`8b09f663`, `fcac6fcf`) manually resolved on review
- [ ] `702ed262` + `7c52b799` kept open in `bug_reports`, reassigned to the CALIBRATION initiative
- [ ] Zero TypeScript errors, lint clean
- [ ] Full-height layout active — no outer scrollbar on `/settings/integrations/ai-setup`
- [ ] Skip path on email_scan no longer traps the user
- [ ] Completed vs visited step chips are visually distinct

## Non-goals / out of scope

- The CALIBRATION rebuild (separate session — see handoff prompt)
- Any changes to `AiIntakeInterview`, `AiDatabaseMining`, or `AiSetupDashboard` components
- Touching the parent `/settings/integrations` page (deferred to CALIBRATION scope)
- Modifications to `FULL_HEIGHT_ROUTES` beyond adding this one entry
- Renaming the route to `/calibration` (part of CALIBRATION rebuild)
