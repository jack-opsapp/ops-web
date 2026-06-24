# Edge rail → command-first create surface (WEB OVERHAUL P5)

Date: 2026-06-23
Branch: `feat/web-overhaul` (worktree `ops-web-overhaul-p2-shell`) — LOCAL, no push.
Status: approved direction (Jackson signed off on mock 01 + dim bug glyph 2026-06-23). Build in progress.

## Problem

The right-edge tab rail gave three affordances identical visual weight — Notifications,
Quick Actions, Bug Report — as ~140px stacked vertical tabs (416px of edge chrome). Opening a
tab slid it left and relabelled it `CLOSE` while a 360px drawer pushed in (a 200ms lateral
motion that reads clunky and fights the user's intent). Jackson: the strip treatment, the
open/close feel, AND the equal-weight problem all need rework; drawer *contents* are fine.

Two facts reframe the work:
1. **Notifications is moving to the top bar** (parallel session WEB OVERHAUL P5-1-1). Leave it.
   That removes the only frequent scan surface from the rail, leaving one workhorse (Quick
   Actions — fast creation) and one rare utility (Bug Report).
2. **A `⌘K`/`\` command palette already exists** (`command-palette.tsx`, mounted) with entity
   search + nav + settings + system groups. Its "Quick Actions" group is **stale/divergent** —
   only *New Project / New Client / Sync* on the legacy `/projects/new` & `/clients/new` routes,
   while the edge tab carries the **real 9** window-based creation actions
   (`fab-actions.ts ALL_ACTIONS`, permission + feature filtered, user-reorderable).

## Decision — "Command-first" (mock 01)

Prominence tracks frequency. Replace the rail with:

- **One create trigger, bottom-right** — the single steel-blue accent element on the screen
  (filled `bg-ops-accent`, the primary-button treatment). Click or `Q` opens a compact
  `// CREATE` popover listing the real 9 Quick Actions. The brightest pixel = the most frequent
  action.
- **A dim bug glyph beside it** (monochrome, ghost) — visibly subordinate. Click or `` ` ``
  captures a screenshot then opens the existing bug-report drawer (re-anchored bottom-right).
  Also surfaced as a `Report a bug` row in the palette.
- **`⌘K`/`\`** opens the existing full command palette (search everything). Its create group is
  unified to the real 9 actions so the two creation lists can never drift again.
- The 3-tab rail and its slide-and-relabel motion are deleted (for Quick Actions + Bug Report).

This is the Linear / Superhuman / Raycast pattern (visible quick trigger fronting a keyboard
command surface; feedback/bug demoted to a help row) — and it reuses the surface OPS already
half-built.

## Architecture

New:
- `src/components/ops/create-menu/create-cluster.tsx` — fixed bottom-right cluster (`z` floating-ui
  1500). Renders the create trigger (Radix `PopoverAnchor` + `Button variant="primary" size="icon"`)
  and the dim bug glyph (`Button variant="ghost"`). Owns the `Q` (create) and `` ` `` (bug, with
  pre-open `requestScreenshot()`) keyboard handlers — re-homed from the deleted tabs, same
  input/textarea/contenteditable guards. Visibility = `useQuickActionsVisible()`. Open state via
  the existing `useEdgeTabStore` mutex (`activeTab` `"quick-actions"` / `"bug-report"`), so only one
  bottom-right surface is open at once. Carries `data-bug-report-ignore="true"` so it's excluded
  from bug screenshots.
- `src/components/ops/create-menu/create-menu.tsx` — `PopoverContent` body: `// CREATE` header + `Q`
  chip, rows from `useQuickActions()` (icon + label + 3-letter `hintCode`, hover steps text to
  `--text`), footer `[ CUSTOMIZE ]` (→ `/settings?tab=quick-actions`) + a `⌘K SEARCH` hint that
  opens the palette. Renders the setup-gate (`useSetupGate` + `SetupInterceptionModal`) ported
  from the old drawer.
- `src/lib/quick-actions/dispatch.ts` — pure `dispatchQuickAction(action, deps)` (the window vs
  route switch, incl. `project-workspace` / `client-workspace` openers). Shared by CreateMenu
  (wrapped in the setup gate) and CommandPalette (direct). Single source of truth for "run a
  quick action".

Modified:
- `bug-report-drawer.tsx` — re-anchor from edge-center to bottom-right (rises above the cluster);
  inline `EDGE_TAB_ID_BUG` (was imported from the deleted tab), drop `STACK_OFFSET_BUG`; teach its
  outside-click handler to skip `data-bug-report-ignore` (the cluster). Form internals unchanged.
- `dashboard-layout.tsx` — drop `<QuickActionsTab/>`, `<QuickActionsDrawer/>`, `<BugReportTab/>` +
  imports; add `<CreateCluster/>`. Keep `<BugReportDrawer/>`. **Leave `<NotificationsTab/>` /
  `<NotificationsDrawer/>` untouched** (sibling owns their removal).
- `command-palette.tsx` — replace the stale 3-item quick actions with the real catalog via
  `useQuickActions()` + `dispatchQuickAction`; add `Report a bug` to the System group
  (`requestScreenshot()` → open bug drawer).
- `command.tsx` — add `data-bug-report-ignore="true"` to `CommandDialog` content so a
  palette-initiated bug report never screenshots the palette.
- `window-dock.tsx` — raise `bottom-3` → `bottom-[68px]` so the minimized-window dock stacks
  *above* the create cluster instead of behind it (shared bottom-right corner).
- i18n `quick-actions.json` (en/es) — add `menu.title`, `menu.searchHint`, `trigger.ariaLabel`,
  `trigger.tooltip`. Bug aria/tooltip reuse `common.bugReport.title`.

Retired (deleted): `quick-actions-tab.tsx`, `quick-actions-drawer.tsx`, `bug-report-tab.tsx`.

Left in place (still consumed by Notifications until the sibling removes it; cleanup follow-up):
`edge-tab.tsx`, `edge-tab.types.ts`, `edge-rail-layout.ts`, `edge-tab-store.ts` (still used as the
mutex), `edge-tab-outside-dismiss.tsx` (already dead/unmounted).

## Motion (Discovery beat — reward exploration, near-instant)

Create popover: Radix `animate-anchored-in` (fade + scale from the trigger origin) at the panel
token, single curve `cubic-bezier(0.22,1,0.36,1)`, ≤150ms. Rows reuse `quickActionsRowVariants`
stagger. Bug drawer keeps its existing slide-in (`drawerVariants`-style). Every path honors
`prefers-reduced-motion` (opacity-only fallbacks already exist). No accent glow, no spring.

## Voice

Create trigger aria `Create`, tooltip `CREATE` + `Q`. Popover `// CREATE`. Footer `[ CUSTOMIZE ]`
+ `⌘K SEARCH`. Bug aria/tooltip `Report a bug` + `` ` ``. Numbers/codes JetBrains Mono.

## Accent invariant

Exactly one accent element on screen at all times: the create trigger. Its open popover and the
palette's selected row also carry accent, but only one of {popover, palette} is open at once and
the trigger is the only persistent accented chrome. Bug glyph + all rows stay monochrome.
(Runtime accent is per-operator via `--ops-accent-rgb`; always use the CSS var, never `#6F94B0`.)

## Visibility / gating

Cluster follows `useQuickActionsVisible()` (hidden on `/intel`, dashboard customize, wizard,
duplicate-review sheet). Net change: Bug Report becomes available on `/dashboard` (previously
hidden there) via the bottom-right cluster — an improvement, since it no longer competes with
edge map controls. Verify no bottom-right collision with map zoom controls on `/dashboard`;
offset if needed.

## Concurrency

Shared file is `dashboard-layout.tsx` (sibling P5-1-1 also edits it for the top bar). `git diff`
before every `git add`; stage by name; if the sibling has uncommitted lines at commit time,
hunk-stage only the edge-tab/create-cluster lines. Do not touch the Notifications mount or any
top-bar file.

## Verify + done-gate

`npm run dev:webpack -- -p <free>`; exercise open/close/dismiss/escape for the create popover and
bug drawer + the `Q` / `` ` `` / `⌘K` shortcuts; screenshot 1440×900 + 375×812. `audit-design-system`
over every touched file (fix high findings); `tsc --noEmit` + `next lint` clean on touched files.
No push until Jackson authorizes.
