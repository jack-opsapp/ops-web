# Calendar UI Fixes — Group B

> **Bugs covered**
> - `a5a4cb75-7459-443e-a102-fead3883527c` — Calendar event bars: left-edge line looks funny (2026-04-16)
> - `592b7296-595b-4cf8-9722-2c01a3d9f222` — Calendar events not using task type colors (2026-04-16)
> - `10ed5e3f-c7f9-4b36-91fb-dc841d0fa740` — Hover popovers on events are clipped to calendar container (2026-04-16)

## Skills to load

- `interface-design` + `.interface-design/system.md` (visual tokens)
- `animation-studio:animation-architect` (gateway for any motion work)
- `frontend-design`
- `ops-copywriter` (only if changing visible text — likely none here)

## Source of truth

- **Design system**: `/Users/jacksonsweet/Projects/OPS/OPS-Web/.interface-design/system.md`
- **V2 canonical bundle**: `/Users/jacksonsweet/Projects/OPS/ops-design-system-v2/project/colors_and_type.css`
- **Project CLAUDE.md**: `/Users/jacksonsweet/Projects/OPS/OPS-Web/CLAUDE.md`
- **Tailwind tokens**: `OPS-Web/tailwind.config.ts` lines 110–118 (spec v2 `tasktype` tokens)

## Files touched

| File | Purpose |
|------|---------|
| `OPS-Web/src/lib/utils/calendar-constants.ts` | Replace `TASK_TYPE_COLORS` map with spec v2 values |
| `OPS-Web/src/app/(dashboard)/calendar/_components/month/month-event-bar.tsx` | Fix left-edge line; portal tooltip to escape overflow clip |
| `OPS-Web/src/app/(dashboard)/calendar/_components/calendar-grid-month.tsx` | No code changes — retains `overflow-hidden` on day cells because tooltip now portals |

**No changes** to `dashboard-layout.tsx`. Fully isolated from Groups A, C, D, E1, E2.

## Diagnosis

### Bug 1 — Left-edge line looks funny
`month-event-bar.tsx:153, 189, 222` apply `borderLeft: \`2px solid ${colors.border}\`` on top of `borderRadius: "3px"`. Two issues:
1. **Radius is off-spec.** `3px` is not in the spec ladder. Event bars are chip-like → must use `rounded-chip` = **4px**.
2. **Border width feels weak.** Spec v2's accent-stripe pattern uses `border-l-4` (see `globals.css:250` `.ops-card-accent`). A 2px left stripe on a 14px bar reads as a hairline, not an accent.

### Bug 2 — Events not using task type colors
`calendar-constants.ts:29-60` `TASK_TYPE_COLORS` uses the **old palette** (pre-spec-v2):

| Task type | Current (calendar) | Spec v2 (tailwind.config.ts `tasktype`) |
|-----------|--------------------|-----------------------------------------|
| installation | `#931A32` | `#B58289` (rose) |
| material | `#C4A868` | `#C4A868` (tan) ✓ |
| estimate | `#A5B368` | `#9DB582` (olive) |
| inspection | `#7B68A6` | `#A69AB5` (lilac) |
| quote | `#59779F` | `#6F94B0` (steel/accent) |
| completion | `#4A4A4A` | `#9C938A` (stone) |

Calendar is the only remaining consumer of the old palette. Update it.

### Bug 3 — Popovers clipped to container
`calendar-grid-month.tsx:129` applies `overflow-hidden` on `MonthDayCell`. The `EventTooltip` (inside `month-event-bar.tsx`) renders as a DOM child of the event bar inside the day cell, so the `overflow-hidden` clips it at the cell edge (top/bottom/left/right).

`overflow-hidden` on the day cell is load-bearing — it clips the hover border at `group-hover:border-[rgba(111, 148, 176,0.2)]`, the drop indicator, and keeps event bars that extend past the cell visually contained.

**Fix:** portal the tooltip to `document.body` via `createPortal`. Position it with `getBoundingClientRect()` on mouse enter.

## Tasks

### Task B.1 — Update `TASK_TYPE_COLORS` to spec v2 palette (3 min)

Replace the entire `TASK_TYPE_COLORS` + `DEFAULT_TASK_TYPE_COLORS` block in `calendar-constants.ts`.

**File:** `OPS-Web/src/lib/utils/calendar-constants.ts`

**Replace lines 21–63 with:**

```ts
// ─── Task Type Colors ────────────────────────────────────────────────────────

export interface TaskTypeColors {
  bg: string;
  border: string;
  text: string;
}

/**
 * Spec v2 task type palette. Hexes mirror tailwind.config.ts `tasktype` tokens.
 * `bg` = 0.18 alpha fill (calm, readable over #000); `text` = lighter shade for
 * contrast on the fill. Update both together if the base hex ever shifts.
 */
export const TASK_TYPE_COLORS: Record<string, TaskTypeColors> = {
  installation: {
    bg: "rgba(181, 130, 137, 0.18)",
    border: "#B58289",
    text: "#D9B0B5",
  },
  material: {
    bg: "rgba(196, 168, 104, 0.18)",
    border: "#C4A868",
    text: "#E8D9A8",
  },
  estimate: {
    bg: "rgba(157, 181, 130, 0.18)",
    border: "#9DB582",
    text: "#C8D6B4",
  },
  inspection: {
    bg: "rgba(166, 154, 181, 0.18)",
    border: "#A69AB5",
    text: "#CDC3D6",
  },
  quote: {
    bg: "rgba(111, 148, 176, 0.18)",
    border: "#6F94B0",
    text: "#A8C0D8",
  },
  completion: {
    bg: "rgba(156, 147, 138, 0.18)",
    border: "#9C938A",
    text: "#C9C1B7",
  },
};

/** Default fallback — stone (completion) — for unmapped task types. */
export const DEFAULT_TASK_TYPE_COLORS = TASK_TYPE_COLORS.completion;
```

**Also update the color-map in `calendar-utils.ts:51-58`** (the `deriveTaskType` fallback) to use spec v2 hexes:

**File:** `OPS-Web/src/lib/utils/calendar-utils.ts` lines 51–58, replace with:

```ts
  const colorMap: Record<string, string> = {
    "#B58289": "installation",
    "#C4A868": "material",
    "#9DB582": "estimate",
    "#A69AB5": "inspection",
    "#6F94B0": "quote",
    "#9C938A": "completion",
    // Legacy hexes (pre-spec-v2) — kept for existing ProjectTask rows stored
    // with the old palette so derivation still works during data migration.
    "#931A32": "installation",
    "#A5B368": "estimate",
    "#7B68A6": "inspection",
    "#59779F": "quote",
    "#4A4A4A": "completion",
  };
```

**Commit:**
```sh
git add src/lib/utils/calendar-constants.ts src/lib/utils/calendar-utils.ts
git commit -m "feat(calendar): migrate task type colors to spec v2 palette

Bug 592b7296 — calendar was still using pre-spec-v2 hexes (installation
#931A32, estimate #A5B368, inspection #7B68A6, quote #59779F, completion
#4A4A4A). Align with tailwind tasktype tokens (B58289, 9DB582, A69AB5,
6F94B0, 9C938A). deriveTaskType keeps legacy hexes in its color map for
rows still storing old values."
```

### Task B.2 — Fix event bar left-edge (radius + stripe weight) (4 min)

Three call sites in `month-event-bar.tsx` each compute `borderRadius` with a magic `"3px"` and apply `borderLeft: \`2px solid ${colors.border}\``. Replace with a stripe pseudo-style using spec-v2 radii (`rounded-chip` = 4px) and a 3px visible stripe so it reads as an accent, not a hairline.

**File:** `OPS-Web/src/app/(dashboard)/calendar/_components/month/month-event-bar.tsx`

**Replace lines 110–116 (the `borderRadius` IIFE) with:**

```ts
  // Spec v2: event bars follow chip radii (4px). Multi-day bars square off
  // the interior corners so consecutive weeks read as one continuous strip.
  const borderRadius = (() => {
    if (span.isSingleDay) return "4px";
    const left = span.isFirstSegment ? "4px" : "0px";
    const right = span.isLastSegment ? "4px" : "0px";
    return `${left} ${right} ${right} ${left}`;
  })();
```

**Standard bar — replace lines 146–176 with:**

```ts
  // ── Level 2: Standard — short bar with single-line title ──
  if (displayLevel === "standard") {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate relative"
        style={{
          height: 14,
          backgroundColor: colors.bg,
          boxShadow:
            span.isFirstSegment || span.isSingleDay
              ? `inset 3px 0 0 0 ${colors.border}`
              : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: span.isFirstSegment || span.isSingleDay ? 7 : 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
        <AnimatePresence>
          {isHovered && <EventTooltip event={event} />}
        </AnimatePresence>
      </div>
    );
  }
```

Rationale: `inset box-shadow` for the left stripe instead of `borderLeft`. This
respects `borderRadius` on the top-left/bottom-left corners (border-left does
not; it makes the corner appear "clipped" against the rounded edge — the
"funny" look). `paddingLeft: 7` bumps the text off the stripe. 3px stripe is
visible at 14px height without overwhelming the bar.

**Multi-day expanded bar — replace lines 182–213 with:**

```ts
  // Multi-day events stay 14px even at expanded level
  if (!span.isSingleDay) {
    return (
      <div
        className="cursor-pointer transition-all duration-100 hover:brightness-125 truncate relative"
        style={{
          height: 14,
          backgroundColor: colors.bg,
          boxShadow: span.isFirstSegment
            ? `inset 3px 0 0 0 ${colors.border}`
            : undefined,
          borderRadius,
          color: colors.text,
          paddingLeft: span.isFirstSegment ? 7 : 4,
          paddingRight: 4,
          display: "flex",
          alignItems: "center",
          overflow: "visible",
        }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className="font-mohave truncate"
          style={{ fontSize: 11, lineHeight: "14px" }}
        >
          {event.project || event.title}
        </span>
        <AnimatePresence>
          {isHovered && <EventTooltip event={event} />}
        </AnimatePresence>
      </div>
    );
  }
```

**Single-day expanded (42px) — replace lines 216–254 with:**

```ts
  // Single-day expanded: 42px tall, 2 lines (project name + task type)
  return (
    <div
      className="cursor-pointer transition-all duration-100 hover:brightness-125 relative"
      style={{
        height: 42,
        backgroundColor: colors.bg,
        boxShadow: `inset 3px 0 0 0 ${colors.border}`,
        borderRadius: "4px",
        color: colors.text,
        paddingLeft: 7,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: "visible",
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className="font-mohave truncate"
        style={{ fontSize: 11, lineHeight: "14px" }}
      >
        {event.project || event.title}
      </span>
      <span
        className="font-mono uppercase truncate"
        style={{
          fontSize: 9,
          lineHeight: "12px",
          color: "var(--text-3)",
          letterSpacing: "0.08em",
        }}
      >
        {event.taskType}
      </span>
      <AnimatePresence>
        {isHovered && <EventTooltip event={event} />}
      </AnimatePresence>
    </div>
  );
```

Also replace the hardcoded `"#999999"` at line 246 with `var(--text-3)` (already in the replacement above).

**Commit:**
```sh
git add src/app/\(dashboard\)/calendar/_components/month/month-event-bar.tsx
git commit -m "fix(calendar): event bar left stripe + spec v2 radii

Bug a5a4cb75 — left-edge line looked funny because a 2px borderLeft on a
14px bar with a 3px non-spec radius clipped against the rounded corner.
Replace with inset box-shadow stripe (respects border-radius) at 3px
weight, bump radius to rounded-chip (4px), and pad text 7px inward so the
stripe reads as an accent. Also replace hardcoded #999999 with
var(--text-3) in the expanded single-day bar's task-type sublabel."
```

### Task B.3 — Portal `EventTooltip` out of the overflow-hidden cell (6 min)

Replace the inline `absolute` tooltip with a portal positioned via
`getBoundingClientRect()`. Tooltip is `pointer-events-none`, so hover state
stays on the bar — no hover-loss from DOM reparenting.

**File:** `OPS-Web/src/app/(dashboard)/calendar/_components/month/month-event-bar.tsx`

**Replace the import section (lines 1–6) with:**

```ts
"use client";

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { type InternalCalendarEvent, getEventColors } from "@/lib/utils/calendar-utils";
```

**Replace the `EventTooltip` function (lines 27–97) with:**

```ts
// ─── Tooltip ─────────────────────────────────────────────────────────────────

const tooltipVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

interface EventTooltipProps {
  event: InternalCalendarEvent;
  anchorRect: DOMRect;
}

/**
 * Rendered to document.body via portal so it escapes the calendar cell's
 * `overflow: hidden` (which is load-bearing for the drop indicator and hover
 * border on day cells). Bug 10ed5e3f.
 *
 * Position strategy: above the anchor by default; if there's not enough
 * viewport above, flip below. `fixed` positioning so scroll doesn't displace.
 */
function EventTooltip({ event, anchorRect }: EventTooltipProps) {
  const colors = getEventColors(event.taskType);
  const dateRangeStr = `${format(event.startDate, "MMM d")} - ${format(event.endDate, "MMM d, yyyy")}`;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number }>({
    top: anchorRect.top - 8,
    left: anchorRect.left,
  });

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 6;
    const above = anchorRect.top - tooltipRect.height - margin;
    const below = anchorRect.bottom + margin;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = above >= 8 ? above : below;
    let left = anchorRect.left;

    // Clamp horizontally so the tooltip doesn't run off-screen
    if (left + tooltipRect.width > viewportW - 8) {
      left = viewportW - tooltipRect.width - 8;
    }
    if (left < 8) left = 8;

    // If below also overflows, pin to bottom and accept the clip
    if (below + tooltipRect.height > viewportH - 8 && above < 8) {
      top = viewportH - tooltipRect.height - 8;
    }

    setPlacement({ top, left });
  }, [anchorRect]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      ref={tooltipRef}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={tooltipVariants}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none"
      style={{
        position: "fixed",
        top: placement.top,
        left: placement.left,
        zIndex: 1000, // dropdown layer per spec v2 z-index scale
        minWidth: 180,
        maxWidth: 240,
        background: "var(--glass-bg-dense)",
        backdropFilter: "blur(28px) saturate(1.3)",
        WebkitBackdropFilter: "blur(28px) saturate(1.3)",
        border: "1px solid var(--glass-border)",
        borderRadius: 12, // rounded-modal per spec v2 (popover/dropdown tier)
        padding: "8px 10px",
      }}
    >
      {/* Project name */}
      <div
        className="font-mohave font-semibold text-[12px] leading-tight truncate"
        style={{ color: "var(--color-ops-accent, #EDEDED)" }}
      >
        {event.project || event.title}
      </div>

      {/* Divider */}
      <div
        className="my-[4px]"
        style={{ height: 1, background: "var(--glass-border)" }}
      />

      {/* Task type */}
      <div className="flex items-center gap-[6px]">
        <div
          className="w-[6px] h-[6px] rounded-[1px] shrink-0"
          style={{ background: colors.border }}
        />
        <span
          className="font-mono text-micro uppercase tracking-wider leading-tight"
          style={{ color: colors.text }}
        >
          {event.taskType.toUpperCase()}
        </span>
      </div>

      {/* Date range */}
      <div
        className="font-mono text-micro uppercase tracking-wider leading-tight mt-[3px]"
        style={{ color: "var(--text-3)" }}
      >
        {dateRangeStr}
      </div>
    </motion.div>,
    document.body
  );
}
```

Note: the project-name color was hardcoded `#FFFFFF`. We swap to the `--text` ladder (via `var(--color-ops-accent, #EDEDED)` fallback); if a different color is preferred for project title, change the fallback. **Confirm with design lead before merge** — the original was pure white for emphasis; `#EDEDED` is spec v2 text but visually very similar.

**Now update `MonthEventBar` to capture anchor rect on hover and pass to tooltip.**

**Replace the compact-level render (lines 124–143) with:**

```ts
  // ── Level 1: Compact — color dot only ──
  if (displayLevel === "compact") {
    return (
      <div
        ref={anchorRef}
        className="cursor-pointer transition-opacity duration-100 hover:opacity-80 shrink-0 relative"
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: colors.border,
        }}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <AnimatePresence>
          {isHovered && anchorRect && (
            <EventTooltip event={event} anchorRect={anchorRect} />
          )}
        </AnimatePresence>
      </div>
    );
  }
```

**And repeat for the standard + expanded branches** — each uses the same
pattern: add `ref={anchorRef}`, replace `onMouseEnter/Leave` with
`handleEnter/handleLeave`, and conditionally render the portaled tooltip only
when `anchorRect` is set.

**Add at the top of the `MonthEventBar` function, before the existing
`const [isHovered, setIsHovered] = useState(false);` line:**

```ts
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handleEnter = () => {
    if (anchorRef.current) setAnchorRect(anchorRef.current.getBoundingClientRect());
    setIsHovered(true);
  };
  const handleLeave = () => {
    setIsHovered(false);
    // Keep anchorRect around one frame so the exit animation has a position;
    // cleared the next time the tooltip opens on a different bar.
  };
```

**Commit:**
```sh
git add src/app/\(dashboard\)/calendar/_components/month/month-event-bar.tsx
git commit -m "fix(calendar): portal hover tooltip so overflow-hidden cell doesn't clip it

Bug 10ed5e3f — day cells keep overflow-hidden (needed for drop indicator
+ hover border), so the absolute-positioned EventTooltip was clipped at
cell edges. Portal to document.body with fixed positioning; use
getBoundingClientRect + viewport-aware flip logic. Uses spec v2 glass-
dense surface, rounded-modal (12px) radius, z-1000 (dropdown layer)."
```

### Task B.4 — Browser verify all three fixes (5 min)

Per OPS-Web CLAUDE.md: *"For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."*

1. `cd OPS-Web && npm run dev`
2. Open `/calendar`, switch to month view
3. **Verify B.2** — event bars: the left stripe is 3px, flush with the rounded corner, and rounds to 4px on the far side. Multi-day runs should show the stripe on the first segment only.
4. **Verify B.1** — events of different task types render in the new v2 palette. Create/edit tasks with each type (estimate, quote, installation, inspection, material, completion) and confirm each renders in its spec color.
5. **Verify B.3** — hover an event near the top row; the tooltip should appear ABOVE the week row, not clipped. Hover an event in the bottom-right corner; tooltip should flip/clamp so it stays on-screen. Resize the window while hovering — placement updates.
6. **Reduced-motion test**: toggle system "Reduce motion" → tooltip still appears, no transforms (only opacity).

**If any check fails:** do NOT commit B.4. Debug and fix before claiming done.

**Commit (verification note only):**
```sh
git commit --allow-empty -m "chore(calendar): browser-verified group B fixes

Month view: event bars, task-type palette, portaled tooltips all render
per spec v2 at /calendar. Reduced-motion respected."
```

## Acceptance criteria

- [ ] All 3 bug_reports rows (`a5a4cb75`, `592b7296`, `10ed5e3f`) manually resolved on review
- [ ] No hardcoded hex values added (`#FFFFFF`, `#999999` swaps reviewed)
- [ ] Zero TypeScript errors (`npm run typecheck`)
- [ ] `npm run lint` clean on the three modified files
- [ ] No box-shadow on dark except the inset stripe pattern (permitted — it's part of the surface, not a drop shadow)
- [ ] Tooltip respects `prefers-reduced-motion`
