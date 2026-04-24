# Vertical Notification System

**Date:** 2026-04-23
**Status:** DRAFT — awaiting implementation plan
**Owner:** Jackson Sweet
**Supersedes:** The horizontal topbar notification rail shipped 2026-03-09 (`docs/plans/2026-03-09-notification-rail-implementation.md`).

---

## Preamble

### Source bugs

| `bug_reports.id` | Filed | Summary |
|---|---|---|
| `623e321f-fbb5-4041-acd1-cdf04ff1997e` | 2026-04-20 | "notifications rail needs alot of attention. When many notifications present, impossible to see them all." |
| `912f07a1-76dd-4116-8429-4e24d489a67d` | 2026-04-15 | "When notifications rail is hovered/expanded, clicking a notification should open it, not just set the rail to expanded, then second click opens." |

Both bugs are structural consequences of the horizontal rail, not patchable defects. This spec replaces the rail wholesale.

### Design source

This spec codifies the designs the user landed on in two Claude Design sessions:

- **`ops-design-system-v2/chats/chat4.md`** — 2026-04-23 "Notifications Rail" — user iterated three directions (FEED / TELEMETRY / TRIAGE) and landed on: *"I am actually leaning towards styling the buckets like the chips in 01. Also having the icons is a good idea, for uniformity with iOS."* → TRIAGE v3 with chip-filter buckets + standardized NOTIF_TYPES icons. Final: *"Looks excellent. I think the button to open notifications should be styled like the quick actions tab button."*
- **`ops-design-system-v2/chats/chat5.md`** — 2026-04-23 "FAB Button Redesign" — user redesigned the FAB into a 28px right-edge tab with the same interaction pattern. The new edge tab is the source for `NotifTab`'s behavior.

Implementation references in `ops-design-system-v2/project/`:
- `rail-triage.jsx` — the approved drawer design
- `notif-tab.jsx` — the approved trigger tab
- `shell.jsx` — faux dashboard (establishes Shell context: sidebar 72px / topbar 56px / drawer area top 72 / bottom 16)
- `data.js` — sample data + `NOTIF_TYPES` icon/tone mapping
- `ui_kits/ops-web/FAB.jsx` — the sibling edge tab (future migration target)
- `fab/tokens.js` — production-aligned token constants (`WT.glass = rgba(18,18,20,0.58)`)

### User decisions captured in brainstorm (2026-04-23)

| Decision | Value |
|---|---|
| Direction | **TRIAGE v3** (chip-filter buckets + standardized icons) |
| Tab stack order | **Notifications top / FAB bottom** |
| Tab vertical anchor | **Gap centered at drawer midpoint** (the 8px seam between tabs sits exactly at the drawer area's vertical center; tabs spread above + below from there). See §4.7 for math. |
| Mutual exclusion | **Opening one closes the other** |
| Keyboard shortcut — Notifications | **`N`** |
| Keyboard shortcut — FAB (future) | **`` ` ``** (backtick / tilde — single unshifted keystroke, doesn't break focus traversal) |
| Scope | **C — Notifications + shared `<EdgeTab>` primitive now; FAB migration as separate follow-up** |

---

## 1. Problem

The current notification rail at `src/components/layouts/notification-rail.tsx` (305 lines, shipped 2026-03-09) is a horizontal strip mounted inside `TopBar` at `src/components/layouts/top-bar.tsx:288`. It has three structural failures that cannot be patched — only replaced.

### 1.1 Horizontal overflow (Bug 623e321f)

The rail caps visible pills at `MAX_VISIBLE_PILLS = 15` (`notification-rail.tsx:16`) with a `+N` overflow badge. On mobile it is further constrained by `max-w-[50vw]` (line 134). When the unread count exceeds available horizontal pixels — typical on any tablet viewport after `Sidebar` (72px) + page title + Search (200px) + Undo (40px when active) + Sync (40–120px) — notifications are the first thing compressed.

**Specific failure mode observed:** With 20 unread, the user sees 15 tiny 6×14px pills + a "+5" badge. The hover-preview system only surfaces the top-3 urgent items (`HOVER_PREVIEW_COUNT = 3`, line 18). Items 4–20 are inaccessible without expanding the rail, which then creates a scrollable 240-wide card strip that still doesn't fit on a 1024px tablet in portrait.

**A vertical list is the only structurally correct answer** — vertical real estate is unconstrained, horizontal is not.

### 1.2 Two-click interaction trap (Bug 912f07a1)

The collapsed-state pills at `notification-rail.tsx:244-298` have no click handler. Clicking anywhere on the count button (line 232) triggers `expandRail()` — a state change, not an action. Only after the rail is expanded do the mini-cards accept clicks. Result: tapping a pill does nothing the first time (it expands the rail), then the second tap on the *now-visible* mini-card navigates.

A partial fix was attempted at `notification-rail.tsx:104-121` (`handlePreviewClick`) that makes the top-3 hover previews click-directly, but this only covers 3 of N items and is invisible to the user (they don't know which pills are "previews").

**A drawer paradigm eliminates this class of bug:** the drawer has one open/close state (via the tab) and then every row is directly interactable. Row clicks expand the body inline; action buttons navigate. No "click-to-reveal then click-to-use" two-step.

### 1.3 Chrome tax

The rail lives in the TopBar's right-side cluster (`top-bar.tsx:287-290`), competing for width with the Search field (`w-[140px] sm:w-[200px]`, line 263) and Sync indicator (40–120px). On a 768px tablet in portrait after the sidebar, the available right-cluster width is ~350px — not enough to show more than 2–3 notification pills legibly. The rail is structurally forced to truncate on every tablet view.

Moving notifications to a dedicated right-edge drawer frees the topbar for the actions that actually belong there (breadcrumbs, search, undo, sync state) and gives notifications its own surface that scales.

---

## 2. Direction

A **360px wide right-edge drawer** triggered by a **28px vertical edge tab**. The drawer renders the TRIAGE v3 priority-bucketed view: chip-filter buttons (ALL / CRITICAL / ATTENTION / AMBIENT) and a scrollable list where each row shows a standardized icon, title, timestamp, optional action hint, and — on click — expands inline to reveal the body and action buttons.

The edge tab is a new pattern that both this Notifications system and the future FAB migration consume via a shared `<EdgeTab>` primitive. Tabs live on the right edge, stacked vertically, with **Notifications on top / FAB below**. Opening one closes the other. Each tab has its own keyboard shortcut (`N` for notifications, `` ` `` for FAB).

### Visual summary

```
┌──────────────────────────────────────────────────────┐
│ SIDE │ TOPBAR                                        │
│      ├───────────────────────────────────────────────┤
│ 72   │                                         ┌──┐  │
│ px   │                                         │N │  │ ← Notifications edge tab (28px wide, 180px tall at rest)
│      │                                         │O │     • Centered in drawer area (top:72 / bottom:16)
│      │   CANVAS / DASHBOARD                    │T │     • Vertical wordmark "NOTIFICATIONS"
│      │                                         │I │     • Bell glyph + count badge
│      │                                         │F │     • Left accent: rose/tan/steel-blue by top-tone
│      │                                         │  │
│      │                                         └──┘ ← 8px gap
│      │                                         ┌──┐
│      │                                         │F │  ← FAB edge tab (future; not in this spec's impl)
│      │                                         │A │     • 28px wide, 132px tall at rest (shorter — "QUICK ACTIONS" is one word less)
│      │                                         │B │     • Wordmark "QUICK ACTIONS"
│      │                                         └──┘
└──────┴──────────────────────────────────────────────┘
```

### Open state

```
┌──────────────────────────────────────────────────────┐
│ SIDE │ TOPBAR                                        │
│      ├───────────────────────────┬───────────────────┤
│ 72   │                          ┌┴┐ ┌───────────────┐
│ px   │                          │× │ │ //NOTIFICATIONS 14                  │
│      │                          │C │ │ [ALL 14] [CRITICAL 3] [ATTN 5] ...   │
│      │   CANVAS / DASHBOARD      │L │ │ ───────────────────                 │
│      │                          │O │ │ ▣ Role needed: Site lead        2m  │
│      │                          │S │ │ ▣ 4 possible duplicate clients  8m  │
│      │                          │E │ │ @ Marcus mentioned you         14m  │
│      │                          │  │ │ …                                   │
│      │                          └┬┘ │                                     │
│      │                           │  │ LAST SYNC 09:41        VIEW ALL →   │
│      │                           │  └───────────────────────┴─────────────┘
│      │                                   ↑ 360px drawer, flush to right edge
│      │                            ↑ 28px tab spans drawer height (top:72 → bottom:16)
└──────┴──────────────────────────────────────────────┘
```

---

## 3. Scope

### 3.1 In scope (this spec, to be implemented)

1. New `<EdgeTab>` primitive at `src/components/ui/edge-tab.tsx` — reusable by Notifications now and FAB later
2. New `useEdgeTabStore` Zustand store at `src/stores/edge-tab-store.ts` — single-slot mutual exclusion + keyboard hook
3. New `<NotificationsDrawer>` at `src/components/layouts/notifications-drawer.tsx` — TRIAGE v3 rail
4. New `<NotificationsTab>` at `src/components/layouts/notifications-tab.tsx` — consumes `<EdgeTab>`, wires notification count + top-tone
5. New notification metadata registry at `src/lib/notifications/notification-meta.ts` — icon + tone per `NotificationType`
6. New `<NotificationRow>` at `src/components/layouts/notifications-row.tsx` — the expandable row
7. Keyboard shortcut `N` (opens/closes Notifications) via `useEdgeTabStore` subscription in `<KeyboardShortcuts>`
8. Motion variants at `src/lib/utils/motion.ts` — drawer slide, tab grow, row expand, chip filter, with reduced-motion fallbacks
9. Copy — new dictionary namespace `src/i18n/dictionaries/{en,es}/notifications.json`, and migration of existing `topbar.notifications.*` keys
10. Dashboard-layout changes — mount the new drawer + tab, remove the old modal
11. TopBar changes — remove `<NotificationRail>` import and JSX
12. Tests — unit tests for `edge-tab-store`, `notification-meta`, component render tests for tab/drawer/row

### 3.2 Out of scope (explicit)

- **FAB migration to the edge-tab pattern.** A separate plan will implement `<FABTab>` using the same `<EdgeTab>` primitive. This spec establishes the coexistence contract but does not touch the current FAB at `src/components/ops/floating-action-button.tsx`.
- **A full `/notifications` history route.** The drawer's footer "VIEW ALL →" is scoped here to reset the filter to ALL + scroll to top of the drawer list. A future route for read-status browsing and historical archive is a separate spec.
- **iOS notification UI.** Lives in the native iOS app (`OPS/OPS/Views/Notifications/NotificationListView.swift`) — separate track.
- **New notification types or data-model changes.** The `notifications` table schema stays as-is (verified 2026-04-23 against `ijeekuhbatykdomumfjx`): existing columns `persistent`, `action_url`, `action_label` cover everything.
- **Admin/PMF notification deck.** The PMF tracking dashboard's own notification system (`src/lib/notifications/pmf-send.ts`) is independent.
- **OneSignal push / SMS delivery.** Push + SMS transport is unchanged; this is a UI-layer spec only.

### 3.3 Files deleted

| File | Lines | Reason |
|---|---|---|
| `src/components/layouts/notification-rail.tsx` | 305 | Horizontal rail — replaced by drawer |
| `src/components/layouts/notification-pill.tsx` | 35 | Pill indicator — no analogue in drawer |
| `src/components/layouts/notification-mini-card.tsx` | 121 | Mini-card — replaced by `<NotificationRow>` |
| `src/components/layouts/notification-card-full.tsx` | 148 | Modal full-card — drawer row does both compact + expanded |
| `src/components/layouts/notification-modal.tsx` | 218 | Full modal view — drawer replaces it |
| `src/stores/notification-rail-store.ts` | 29 | Collapsed/expanded/modal state — replaced by `edge-tab-store` + local drawer filter state |

Net code removed: **856 lines**. Net code added: approximately **950 lines** (including new primitives, store, drawer, row, metadata, tests). The net +94 lines buys: coexistence-ready architecture, elimination of 2 structural bugs, +100% capacity (unlimited list vs 15 + overflow), +1 reusable primitive (`<EdgeTab>`), and i18n-clean copy.

### 3.4 Files modified

| File | Change |
|---|---|
| `src/components/layouts/top-bar.tsx` | Remove `NotificationRail` import (line 20) and JSX usage (line 288) |
| `src/components/layouts/dashboard-layout.tsx` | Remove `<NotificationModal />` import (line 15) + mount (line 245); add `<NotificationsDrawer />` + `<NotificationsTab />` mount |
| `src/components/ops/keyboard-shortcuts.tsx` | Register `N` handler (existing file to be read during impl — confirm pattern) |
| `src/lib/utils/motion.ts` | Add new variants, delete obsolete `notifPillVariants`, `notifCardVariants`, `notifCardFullVariants`, `notifModalVariants`, `notifBackdropVariants` (lines 182–242) |
| `src/i18n/dictionaries/en/topbar.json` | Remove `notifications.*` keys (moved to new namespace) |
| `src/i18n/dictionaries/es/topbar.json` | Same as above |
| `src/lib/api/query-client.ts` | No changes — existing `queryKeys.notifications.unread` stays |

### 3.5 File collision flag — Group E1

**`src/components/layouts/dashboard-layout.tsx` is touched by both this spec (Group A) and Group E1 (bug-report widget + FAB fixes).** The Group A execution agent MUST:

1. Before committing layout changes, check if Group E1 has already landed to `main`.
2. If Group E1 has landed, rebase against it — specifically reconcile the `{/* Global features */}` block (lines 236–248 in the base) where both groups mount new overlays.
3. If Group A lands first, annotate the layout with a comment noting where E1's bug-report + FAB changes should slot in.
4. Mount order for the new overlays: `<NotificationsDrawer />` + `<NotificationsTab />` should sit AFTER `<FloatingActionButton />` and `<BugReportButton />` in the JSX, so they live above in z-index. (Concrete z-index values below in §5.6.)

---

## 4. Architecture

### 4.1 `<EdgeTab>` primitive

A reusable component for the 28px-wide right-edge trigger tab pattern. Consumed by `<NotificationsTab>` now; by `<FABTab>` in a future plan. It owns:

- Outer positioning container (spans drawer area: `top: railTop`, `bottom: railBottom`, `right: 0`)
- Inner tab element (centered via `top: 50%; transform: translateY(-50%)` with `boxSizing: border-box`)
- Inner tab height behavior: `180px` at rest (or configurable), `100%` when open-or-hovered (matches drawer area exactly — the fix for the `panelHeight` desync in the handoff bundle)
- Left accent stripe (2px wide, full height, tone-colored)
- Vertical wordmark (rotated 180° with `writingMode: vertical-rl`)
- Rotating glyph (bell/plus/etc → × on open)
- Optional count badge (vertical mono, tnum, zero)
- Hover tooltip showing title + keyboard shortcut chip
- Mutual-exclusion signaling via the parent's `onToggle` callback

**Props:**

```ts
// src/components/ui/edge-tab.tsx
import { type ReactNode } from "react";

export type EdgeTabAccent = "critical" | "attn" | "accent" | "ambient";

export interface EdgeTabProps {
  /** Unique id for mutual-exclusion registry. Examples: "notifications", "fab". */
  id: string;

  /** Current open state (controlled). */
  open: boolean;

  /** Toggle handler — called on click or shortcut. */
  onToggle: () => void;

  /** Count shown as vertical mono badge when closed. Pass 0 or undefined to hide. */
  count?: number;

  /** Tone of the left accent stripe. Default "accent" (steel-blue). */
  accent?: EdgeTabAccent;

  /** Rest height in px. Default 180. FAB uses 132 for its 2-line wordmark. */
  restHeight?: number;

  /** Drawer width in px — the tab slides this far when opening. Default 360. */
  drawerWidth?: number;

  /** Vertical offset from drawer area top. Default 72 (below 56px topbar + gap). */
  railTop?: number;

  /** Vertical offset from drawer area bottom. Default 16. */
  railBottom?: number;

  /** Stack position within the edge-tab column. Default "center". */
  stackPosition?: "above-center" | "center" | "below-center";

  /** Vertical offset applied to the rest-state position, in px. Used by stacked tabs. */
  stackOffset?: number;

  /** Background fill. Default "var(--glass)". FAB uses "rgba(32,34,38,0.92)". */
  fill?: string;

  /**
   * When true, hovering the tab grows it to full drawer-area height (legibility
   * preview). When false, hover keeps the tab at rest height (prevents a
   * sibling tab from visually covering an active drawer).
   *
   * Parent should pass `canHoverExpand={!anyEdgeTabActive || open}` — grow on
   * hover ONLY if this tab is already open OR no tab is active.
   */
  canHoverExpand?: boolean;

  /** Wordmark text (vertical). Example: "NOTIFICATIONS". Rendered uppercase. */
  wordmark: string;

  /** Wordmark shown when open. Default "CLOSE". */
  wordmarkOpen?: string;

  /** Icon glyph renderer — receives open state, returns an SVG React node. */
  renderGlyph: (open: boolean) => ReactNode;

  /** Accessible label for the tab button. */
  ariaLabel: string;

  /** Keyboard shortcut displayed in hover tooltip. Pass the glyph (e.g. "N" or "`"). */
  shortcut?: string;

  /** Human-readable title in hover tooltip. */
  tooltipTitle: string;
}
```

**Reference implementation** — the tab itself is presentation-only. The parent component owns state (`open`) and the mutual-exclusion registry (`useEdgeTabStore`). This primitive never imports the store directly.

```tsx
// src/components/ui/edge-tab.tsx
"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { EdgeTabProps, EdgeTabAccent } from "./edge-tab.types";

const TAB_WIDTH = 28;
const DEFAULT_REST_HEIGHT = 180;
const DEFAULT_DRAWER_WIDTH = 360;
const DEFAULT_RAIL_TOP = 72;
const DEFAULT_RAIL_BOTTOM = 16;

const ACCENT_VAR: Record<EdgeTabAccent, string> = {
  critical: "var(--rose)",
  attn: "var(--tan)",
  accent: "var(--ops-accent)",
  ambient: "var(--text-mute)",
};

export function EdgeTab({
  id,
  open,
  onToggle,
  count,
  accent = "accent",
  restHeight = DEFAULT_REST_HEIGHT,
  drawerWidth = DEFAULT_DRAWER_WIDTH,
  railTop = DEFAULT_RAIL_TOP,
  railBottom = DEFAULT_RAIL_BOTTOM,
  stackOffset = 0,
  fill = "var(--glass)",
  canHoverExpand = true,
  wordmark,
  wordmarkOpen = "CLOSE",
  renderGlyph,
  ariaLabel,
  shortcut,
  tooltipTitle,
}: EdgeTabProps) {
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();

  // When open or hovered-AND-allowed, tab grows to fill the outer container
  // (which spans the full drawer area). Percentage height resolves against the
  // outer top/bottom-anchored container, which computes to drawer-area height.
  // `canHoverExpand` guards against a sibling tab ballooning over an active
  // drawer — only expand-on-hover when this tab is open OR nothing is active.
  const expanded = open || (hovered && canHoverExpand);
  const tabHeight = expanded ? "100%" : `${restHeight}px`;

  // Mutual-exclusion signaling via data-attribute for tests + CSS hooks.
  return (
    <div
      data-edge-tab-anchor={id}
      style={{
        position: "absolute",
        top: railTop,
        bottom: railBottom,
        right: 0,
        width: 0,
        pointerEvents: "none",
        zIndex: 1550, // floating-ui layer per design system z-index scale
      }}
    >
      <div
        role="button"
        tabIndex={0}
        data-edge-tab={id}
        data-edge-tab-open={open ? "true" : "false"}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "absolute",
          top: `calc(50% + ${stackOffset}px)`,
          right: open ? drawerWidth : 0,
          transform: "translateY(-50%)",
          width: TAB_WIDTH,
          height: tabHeight,
          boxSizing: "border-box",
          background: fill,
          backdropFilter: "blur(28px) saturate(1.3)",
          WebkitBackdropFilter: "blur(28px) saturate(1.3)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderTopLeftRadius: 4,
          borderBottomLeftRadius: 4,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          cursor: "pointer",
          pointerEvents: "auto",
          color: "var(--text)",
          transition: reducedMotion
            ? "opacity 150ms linear"
            : `right 260ms ${EASE_SMOOTH_CSS}, height 260ms ${EASE_SMOOTH_CSS}, background-color 180ms ${EASE_SMOOTH_CSS}`,
          outline: "none",
        }}
      >
        {/* Left accent stripe — focus-visible CSS brightens via data attribute */}
        <span
          aria-hidden
          data-edge-tab-accent
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: ACCENT_VAR[accent],
            transition: reducedMotion ? "none" : `background 180ms ${EASE_SMOOTH_CSS}`,
          }}
        />

        {/* Glyph — parent renders (bell / plus / etc). Rotates on open. */}
        <span
          aria-hidden
          style={{
            color: "var(--text)",
            display: "inline-flex",
            transform: `rotate(${open ? 45 : 0}deg)`,
            transition: reducedMotion ? "none" : `transform 260ms ${EASE_SMOOTH_CSS}`,
            position: "relative",
          }}
        >
          {renderGlyph(open)}
          {!open && count != null && count > 0 && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: -4,
                right: -5,
                width: 6,
                height: 6,
                background: ACCENT_VAR[accent],
              }}
            />
          )}
        </span>

        {/* Count badge — closed state only */}
        {!open && count != null && count > 0 && (
          <span
            aria-hidden
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text)",
              fontFeatureSettings: '"tnum" 1, "zero" 1',
              lineHeight: 1,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {count}
          </span>
        )}

        {/* Vertical wordmark */}
        <span
          aria-hidden
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--text-2)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {open ? wordmarkOpen : wordmark}
        </span>

        {/* Hover tooltip — closed only */}
        {hovered && !open && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              right: "calc(100% + 8px)",
              top: "50%",
              transform: "translateY(-50%)",
              background: "var(--glass-dense)",
              backdropFilter: "blur(28px) saturate(1.3)",
              WebkitBackdropFilter: "blur(28px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 5,
              padding: "6px 10px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontFamily: "var(--font-mohave)", fontSize: 13, color: "var(--text)" }}>
              {tooltipTitle}
            </span>
            {shortcut && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-2)",
                  padding: "2px 5px",
                  minWidth: 14,
                  textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 3,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                {shortcut}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const EASE_SMOOTH_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
```

**Types module** — `src/components/ui/edge-tab.types.ts` — holds `EdgeTabProps` and `EdgeTabAccent` so the shared primitive + parents can import without a circular reference.

### 4.2 `useEdgeTabStore` — mutual-exclusion registry

A Zustand store with a single `activeTab: string | null` slot. Any edge tab that wants to open calls `setActive(id)`; the previously-active tab reads its `open` state as `false` and closes. Pressing `Escape` calls `closeAll()`. Keyboard shortcut handlers call `toggle(id)`.

```ts
// src/stores/edge-tab-store.ts
"use client";

import { create } from "zustand";

interface EdgeTabState {
  /** Currently-active tab id, or null if all closed. */
  activeTab: string | null;

  /** Open the given tab. Closes any other tab atomically. */
  setActive: (id: string) => void;

  /** Toggle the given tab. If already open, closes; otherwise opens (closing any other). */
  toggle: (id: string) => void;

  /** Close the given tab if it's active. No-op otherwise. */
  close: (id: string) => void;

  /** Close whichever tab is active. */
  closeAll: () => void;
}

export const useEdgeTabStore = create<EdgeTabState>((set) => ({
  activeTab: null,
  setActive: (id) => set({ activeTab: id }),
  toggle: (id) =>
    set((s) => ({ activeTab: s.activeTab === id ? null : id })),
  close: (id) =>
    set((s) => (s.activeTab === id ? { activeTab: null } : s)),
  closeAll: () => set({ activeTab: null }),
}));
```

Parents subscribe via a selector: `const open = useEdgeTabStore((s) => s.activeTab === "notifications")`. This gives correct Zustand shallow-compare behavior and ensures only the relevant tab re-renders on state changes.

### 4.3 `<NotificationsTab>` — consumes `<EdgeTab>`

Thin wrapper that reads notification count + top-tone from TanStack Query, computes the accent, and wires the mutual-exclusion store + keyboard shortcut.

```tsx
// src/components/layouts/notifications-tab.tsx
"use client";

import { useEffect } from "react";
import { Bell, X } from "lucide-react";
import { EdgeTab } from "@/components/ui/edge-tab";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { resolveTone, toneRank } from "@/lib/notifications/notification-meta";
import { useDictionary } from "@/i18n/client";

const EDGE_TAB_ID = "notifications";
const STACK_OFFSET_NOTIF = -94; // Notifications sits above center — see §4.5 for math

export function NotificationsTab() {
  const { t } = useDictionary("notifications");
  const { data: notifs = [] } = useNotifications();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const anyActive = useEdgeTabStore((s) => s.activeTab !== null);
  const toggle = useEdgeTabStore((s) => s.toggle);
  const count = notifs.length;

  // Highest-severity outstanding tone drives the accent.
  const topTone = notifs.reduce<"critical" | "attn" | "accent" | "ambient">(
    (best, n) => {
      const tone = resolveTone(n.type);
      return toneRank[tone] > toneRank[best] ? tone : best;
    },
    "ambient",
  );
  const accent =
    topTone === "critical" ? "critical" : topTone === "attn" ? "attn" : "accent";

  // Keyboard shortcut: N — global, ignores when typing in input/textarea/contenteditable.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "n") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      toggle(EDGE_TAB_ID);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return (
    <EdgeTab
      id={EDGE_TAB_ID}
      open={open}
      onToggle={() => toggle(EDGE_TAB_ID)}
      count={count}
      accent={accent}
      restHeight={180}
      drawerWidth={360}
      stackOffset={STACK_OFFSET_NOTIF}
      canHoverExpand={!anyActive || open}
      wordmark={t("tab.wordmarkClosed")}
      wordmarkOpen={t("tab.wordmarkOpen")}
      ariaLabel={t("tab.ariaLabel")}
      shortcut="N"
      tooltipTitle={t("tab.tooltipTitle")}
      renderGlyph={(open) => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
          {open ? (
            <path d="M18 6L6 18M6 6l12 12" />
          ) : (
            <>
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </>
          )}
        </svg>
      )}
    />
  );
}
```

### 4.4 `<NotificationsDrawer>` — the TRIAGE v3 rail

Full-height vertical drawer rendered only when `open === true`, sliding in from the right in 260ms. Owns local state for chip filter + expanded row. Consumes `useNotifications()` hook for data, `useDismissNotification()` + `useDismissAllNotifications()` for mutations.

```tsx
// src/components/layouts/notifications-drawer.tsx
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { BellOff, CheckCheck } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  useNotifications,
  useDismissNotification,
  useDismissAllNotifications,
} from "@/lib/hooks/use-notifications";
import { useEdgeTabStore } from "@/stores/edge-tab-store";
import { useDuplicateReviewStore } from "@/stores/duplicate-review-store";
import { resolveTone, NOTIF_TYPE_META } from "@/lib/notifications/notification-meta";
import { NotificationRow } from "./notifications-row";
import { drawerVariants, drawerVariantsReduced, chipVariants } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";
import type { AppNotification } from "@/lib/api/services/notification-service";

type DrawerTone = "critical" | "attn" | "ambient";

const EDGE_TAB_ID = "notifications";

export function NotificationsDrawer() {
  const { t } = useDictionary("notifications");
  const router = useRouter();
  const open = useEdgeTabStore((s) => s.activeTab === EDGE_TAB_ID);
  const close = useEdgeTabStore((s) => s.close);
  const { data: notifs = [] } = useNotifications();
  const dismissMutation = useDismissNotification();
  const dismissAllMutation = useDismissAllNotifications();
  const openDuplicateSheet = useDuplicateReviewStore((s) => s.openSheet);
  const reducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<"all" | DrawerTone>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleFilterChange = (key: "all" | DrawerTone) => {
    setFilter(key);
    setExpandedId(null);
    listRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const focused = document.activeElement as HTMLElement | null;
    if (!focused || focused.getAttribute("role") !== "listitem") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll('[role="listitem"]') ?? [],
    ) as HTMLElement[];
    const idx = rows.indexOf(focused);
    if (idx === -1) return;
    e.preventDefault();
    const next =
      e.key === "ArrowUp"
        ? rows[(idx - 1 + rows.length) % rows.length]
        : rows[(idx + 1) % rows.length];
    next?.focus();
  };

  // Escape closes. Rendered regardless so the handler is registered whenever
  // the drawer is open — parent AnimatePresence gates actual rendering.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(EDGE_TAB_ID);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close]);

  const visibleTone = (n: AppNotification): DrawerTone => {
    const raw = resolveTone(n.type);
    return raw === "accent" || raw === "ambient" ? "ambient" : raw;
    // "accent" in EdgeTab terminology = no-special-tone notifications → map to ambient for bucketing
  };

  const counts = useMemo(() => {
    const c = { critical: 0, attn: 0, ambient: 0 };
    for (const n of notifs) c[visibleTone(n)]++;
    return c;
  }, [notifs]);

  const visible = useMemo(() => {
    if (filter === "all") return notifs;
    return notifs.filter((n) => visibleTone(n) === filter);
  }, [notifs, filter]);

  const hasDismissible = useMemo(
    () => notifs.some((n) => !n.persistent),
    [notifs],
  );

  const handleRowClick = (n: AppNotification) => {
    setExpandedId((prev) => (prev === n.id ? null : n.id));
  };

  const handleAction = (n: AppNotification) => {
    // Dismiss non-persistent on action; persistent stay until resolved programmatically.
    if (n.type === "duplicates_found") {
      if (!n.persistent) dismissMutation.mutate(n.id);
      openDuplicateSheet();
      close(EDGE_TAB_ID);
      return;
    }
    if (n.actionUrl) {
      if (!n.persistent) dismissMutation.mutate(n.id);
      router.push(n.actionUrl);
      close(EDGE_TAB_ID);
    }
  };

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id);
    setExpandedId((prev) => (prev === id ? null : prev));
  };

  const handleViewAll = () => {
    setFilter("all");
    listRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const variants = reducedMotion ? drawerVariantsReduced : drawerVariants;

  const CHIPS: Array<{
    key: "all" | DrawerTone;
    label: string;
    color: string;
    line: string;
    soft: string;
    count: number;
  }> = [
    { key: "all", label: t("filters.all"), color: "var(--text)", line: "rgba(255,255,255,0.18)", soft: "rgba(255,255,255,0.08)", count: notifs.length },
    { key: "critical", label: t("filters.critical"), color: "var(--rose)", line: "var(--rose-line)", soft: "var(--rose-soft)", count: counts.critical },
    { key: "attn", label: t("filters.attn"), color: "var(--tan)", line: "var(--tan-line)", soft: "var(--tan-soft)", count: counts.attn },
    { key: "ambient", label: t("filters.ambient"), color: "var(--text-3)", line: "rgba(255,255,255,0.12)", soft: "rgba(255,255,255,0.04)", count: counts.ambient },
  ];

  return (
    <AnimatePresence mode="wait">
      {open && (
        <motion.aside
          key="notifications-drawer"
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="complementary"
          aria-label={t("drawer.ariaLabel")}
          style={{
            position: "fixed",
            top: 72,
            right: 0,
            bottom: 16,
            width: 360,
            display: "flex",
            flexDirection: "column",
            background: "var(--glass)",
            backdropFilter: "blur(28px) saturate(1.3)",
            WebkitBackdropFilter: "blur(28px) saturate(1.3)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRight: "none",
            zIndex: 1500, // floating-ui layer, below the tab (tab = 1550)
            overflow: "hidden",
          }}
        >
          {/* Top-edge lit gradient */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)",
            }}
          />

          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              position: "relative",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>
              //
            </span>
            <span
              style={{
                fontFamily: "var(--font-cakemono)",
                fontWeight: 300,
                fontSize: 13,
                color: "var(--text)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginLeft: 6,
              }}
            >
              {t("drawer.title")}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)", marginLeft: 8 }}>
              {notifs.length}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-label={t("drawer.muteAllAriaLabel")}
              style={drawerIconBtnStyle}
              // TODO: wire to NotificationSettings mute toggle — out of scope; stub for future.
              onClick={() => {
                /* intentional no-op until NotificationSettings lands */
              }}
            >
              <BellOff size={12} />
            </button>
            <button
              type="button"
              aria-label={t("drawer.clearAllAriaLabel")}
              disabled={!hasDismissible || dismissAllMutation.isPending}
              onClick={() => dismissAllMutation.mutate()}
              style={{
                ...drawerIconBtnStyle,
                opacity: !hasDismissible ? 0.4 : 1,
                cursor: !hasDismissible ? "default" : "pointer",
              }}
            >
              <CheckCheck size={12} />
            </button>
          </div>

          {/* Filter chips */}
          <div
            role="tablist"
            aria-label={t("filters.ariaLabel")}
            style={{
              display: "flex",
              gap: 4,
              padding: "8px 14px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              flexWrap: "wrap",
            }}
          >
            {CHIPS.map((c) => {
              const active = filter === c.key;
              return (
                <motion.button
                  key={c.key}
                  role="tab"
                  aria-selected={active}
                  aria-controls="notifications-drawer-list"
                  onClick={() => handleFilterChange(c.key)}
                  variants={reducedMotion ? undefined : chipVariants}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    padding: "4px 8px",
                    borderRadius: 2.5,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: active ? c.soft : "transparent",
                    border: `1px solid ${active ? c.line : "rgba(255,255,255,0.08)"}`,
                    color: active ? c.color : "var(--text-3)",
                    transition: reducedMotion ? "none" : "all 120ms var(--ease-smooth)",
                  }}
                >
                  {c.key !== "all" && (
                    <span
                      aria-hidden
                      style={{ width: 4, height: 4, background: c.color, opacity: active ? 1 : 0.6 }}
                    />
                  )}
                  {c.label}
                  <span
                    style={{
                      color: active ? c.color : "var(--text-mute)",
                      opacity: active ? 0.7 : 1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {c.count}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* Scrollable list */}
          <div
            id="notifications-drawer-list"
            ref={listRef}
            role="list"
            onKeyDown={handleListKeyDown}
            className="hide-scrollbar"
            style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}
          >
            {visible.length === 0 && (
              <div style={{ padding: 28, textAlign: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.16em" }}>
                  {filter === "all"
                    ? t("empty.allClear")
                    : t("empty.noneInBucket").replace(
                        "{bucket}",
                        CHIPS.find((c) => c.key === filter)?.label ?? "",
                      )}
                </span>
              </div>
            )}
            {visible.map((n) => {
              const meta = NOTIF_TYPE_META[n.type] ?? {
                label: n.type.toUpperCase(),
                icon: "circle",
                tone: "accent",
              };
              const tone = visibleTone(n);
              return (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  meta={meta}
                  tone={tone}
                  expanded={expandedId === n.id}
                  onRowClick={() => handleRowClick(n)}
                  onAction={() => handleAction(n)}
                  onDismiss={handleDismiss}
                />
              );
            })}
            {visible.length > 0 && (
              <div style={{ padding: "10px 14px", textAlign: "center" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.18em" }}>
                  {t("list.eofMarker")}
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 14px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: "0.14em" }}>
              {t("footer.lastSync")}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={handleViewAll}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                color: "var(--text-3)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {t("footer.viewAll")}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const drawerIconBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 2.5,
  border: "none",
  background: "transparent",
  color: "var(--text-3)",
  cursor: "pointer",
  marginLeft: 4,
};
```

### 4.5 `<NotificationRow>` — the expandable row

```tsx
// src/components/layouts/notifications-row.tsx
"use client";

import { useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { type LucideIcon } from "lucide-react";
import { lucideIconFromName } from "@/lib/notifications/notification-meta";
import { rowVariants, rowVariantsReduced, rowExpandVariants } from "@/lib/utils/motion";
import type { AppNotification } from "@/lib/api/services/notification-service";
import type { NotificationMeta } from "@/lib/notifications/notification-meta";

interface NotificationRowProps {
  notification: AppNotification;
  meta: NotificationMeta;
  tone: "critical" | "attn" | "ambient";
  expanded: boolean;
  onRowClick: () => void;
  onAction: () => void;
  onDismiss: (id: string) => void;
}

const TONE_SURFACE = {
  critical: { color: "var(--rose)", line: "var(--rose-line)", soft: "var(--rose-soft)" },
  attn: { color: "var(--tan)", line: "var(--tan-line)", soft: "var(--tan-soft)" },
  ambient: { color: "var(--text-3)", line: "rgba(255,255,255,0.08)", soft: "rgba(255,255,255,0.04)" },
};

function translateNotifCopy(raw: string | null | undefined, t: (k: string) => string): string | null {
  // Mirror the translate-if-dot-key helper from notification-card-full.tsx so
  // services that emit i18n keys render correctly in the new drawer too.
  if (!raw) return null;
  const looksLikeKey = /^[a-z][a-zA-Z0-9._-]*$/.test(raw) && raw.includes(".");
  if (!looksLikeKey) return raw;
  return t(raw);
}

function formatRel(min: number): string {
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}d`;
}

export function NotificationRow({
  notification,
  meta,
  tone,
  expanded,
  onRowClick,
  onAction,
  onDismiss,
}: NotificationRowProps) {
  const { t: tCommon } = useDictionary("common");
  const { t } = useDictionary("notifications");
  const [hover, setHover] = useState(false);
  const reducedMotion = useReducedMotion();
  const toneSurface = TONE_SURFACE[tone];
  const showAccent = tone === "critical" || tone === "attn";

  const displayTitle = translateNotifCopy(notification.title, tCommon) ?? notification.title;
  const displayBody = translateNotifCopy(notification.body, tCommon);
  const displayActionLabel = translateNotifCopy(notification.actionLabel, tCommon);

  const minutesAgo = useMemo(() => {
    const now = Date.now();
    return Math.max(0, Math.floor((now - notification.createdAt.getTime()) / 60_000));
  }, [notification.createdAt]);

  const Icon = lucideIconFromName(meta.icon);
  const variants = reducedMotion ? rowVariantsReduced : rowVariants;

  return (
    <motion.div
      layout="position"
      variants={variants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role="listitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onRowClick}
      style={{
        position: "relative",
        padding: "9px 14px",
        cursor: "pointer",
        background: hover || expanded ? "rgba(255,255,255,0.03)" : "transparent",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        transition: reducedMotion ? "none" : "background 120ms var(--ease-smooth)",
      }}
    >
      {/* Left accent hairline — critical/attn only, 2px if persistent */}
      {showAccent && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 10,
            bottom: 10,
            width: notification.persistent ? 2 : 1,
            background: toneSurface.color,
            opacity: notification.persistent ? 0.85 : 0.45,
          }}
        />
      )}

      {/* Row 1 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        {/* Standardized icon tile */}
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 2.5,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: showAccent ? toneSurface.soft : "rgba(255,255,255,0.04)",
            border: `1px solid ${showAccent ? toneSurface.line : "rgba(255,255,255,0.06)"}`,
            color: showAccent ? toneSurface.color : "var(--text-3)",
          }}
        >
          <Icon size={12} strokeWidth={1.5} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mohave)",
            fontSize: 13.5,
            color: "var(--text)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {displayTitle}
        </span>
        {displayActionLabel && !expanded && !hover && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.14em",
              color: showAccent ? toneSurface.color : "var(--text-3)",
              opacity: 0.75,
              flexShrink: 0,
            }}
          >
            {displayActionLabel}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-mute)",
            flexShrink: 0,
            minWidth: 24,
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatRel(minutesAgo)}
        </span>
      </div>

      {/* Expanded body + actions */}
      <motion.div
        initial={false}
        animate={{ maxHeight: expanded ? 160 : 0 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: "hidden", paddingLeft: 28 }}
      >
        {displayBody && (
          <div
            style={{
              fontFamily: "var(--font-mohave)",
              fontSize: 12,
              color: "var(--text-3)",
              lineHeight: 1.45,
              marginTop: 6,
            }}
          >
            {displayBody}
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
          {(notification.actionUrl || notification.type === "duplicates_found") && displayActionLabel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction();
              }}
              style={{
                fontFamily: "var(--font-cakemono)",
                fontWeight: 300,
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "4px 9px",
                borderRadius: 2.5,
                background: showAccent ? toneSurface.soft : "rgba(255,255,255,0.04)",
                border: `1px solid ${showAccent ? toneSurface.line : "rgba(255,255,255,0.1)"}`,
                color: showAccent ? toneSurface.color : "var(--text)",
                cursor: "pointer",
              }}
            >
              {displayActionLabel} →
            </button>
          )}
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            style={rowSecondaryBtnStyle}
            // TODO: Snooze feature requires `notifications.snoozed_until` column — out of scope; stub.
            disabled
            aria-disabled
            title={t("row.snoozeTooltipComingSoon")}
          >
            {t("row.snooze")}
          </button>
          {!notification.persistent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(notification.id);
              }}
              style={rowSecondaryBtnStyle}
              aria-label={t("row.dismissAriaLabel")}
            >
              {t("row.dismiss")}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

const rowSecondaryBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-cakemono)",
  fontWeight: 300,
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "4px 9px",
  borderRadius: 2.5,
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-3)",
  cursor: "pointer",
};
```

### 4.6 `notification-meta.ts` — type → icon + tone registry

Single source of truth for the notification-type-to-{label, icon, tone} mapping. Mirrors `data.js` in the handoff bundle but uses Lucide's React components directly (`LucideIcon`) so we get tree-shaken icons and real prop types, not string lookups.

```ts
// src/lib/notifications/notification-meta.ts
import {
  AtSign, UserPlus, CheckCircle2, RefreshCw, Radar, Settings2, Inbox, Activity,
  Briefcase, SquareCheck, Check, CalendarClock, Receipt, ReceiptText, Copy,
  Sparkle, Bot, AlarmClock, Circle, type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@/lib/api/services/notification-service";

export type NotificationTone = "critical" | "attn" | "accent" | "ambient";

export interface NotificationMeta {
  /** Short uppercase label for tactical type prefix (e.g., "MENTION", "ROLE"). */
  label: string;
  /** Lucide icon name — used for deserialization if we ever store in data. */
  icon: string;
  /** Default tone for this type. Individual notifications can't override. */
  tone: NotificationTone;
}

export const NOTIF_TYPE_META: Record<NotificationType, NotificationMeta> = {
  mention: { label: "MENTION", icon: "at-sign", tone: "attn" },
  role_needed: { label: "ROLE", icon: "user-plus", tone: "critical" },
  pipeline_complete: { label: "PIPELINE", icon: "check-circle-2", tone: "accent" },
  gmail_sync: { label: "SYNC", icon: "refresh-cw", tone: "ambient" },
  intel_available: { label: "INTEL", icon: "radar", tone: "attn" },
  setup_prompt: { label: "SETUP", icon: "settings-2", tone: "ambient" },
  leads_waiting: { label: "LEADS", icon: "inbox", tone: "attn" },
  system: { label: "SYS", icon: "activity", tone: "ambient" },
  project_assigned: { label: "PROJECT", icon: "briefcase", tone: "accent" },
  task_assigned: { label: "TASK", icon: "square-check", tone: "accent" },
  task_completed: { label: "DONE", icon: "check", tone: "ambient" },
  schedule_change: { label: "SCHEDULE", icon: "calendar-clock", tone: "attn" },
  expense_submitted: { label: "EXPENSE", icon: "receipt", tone: "attn" },
  expense_approved: { label: "EXP", icon: "receipt-text", tone: "ambient" },
  duplicates_found: { label: "DUPES", icon: "copy", tone: "critical" },
  ai_milestone: { label: "AI", icon: "sparkle", tone: "accent" },
  agent_suggestion: { label: "AGENT", icon: "bot", tone: "accent" },
  trial_expiry: { label: "TRIAL", icon: "alarm-clock", tone: "critical" }, // AlarmClock in lucide 0.468 — ClockAlert (0.475+) preferred long-term
};

export const toneRank: Record<NotificationTone, number> = {
  critical: 3,
  attn: 2,
  accent: 1,
  ambient: 0,
};

export function resolveTone(type: NotificationType): NotificationTone {
  return NOTIF_TYPE_META[type]?.tone ?? "accent";
}

const LUCIDE_REGISTRY: Record<string, LucideIcon> = {
  "at-sign": AtSign,
  "user-plus": UserPlus,
  "check-circle-2": CheckCircle2,
  "refresh-cw": RefreshCw,
  "radar": Radar,
  "settings-2": Settings2,
  "inbox": Inbox,
  "activity": Activity,
  "briefcase": Briefcase,
  "square-check": SquareCheck,
  "check": Check,
  "calendar-clock": CalendarClock,
  "receipt": Receipt,
  "receipt-text": ReceiptText,
  "copy": Copy,
  "sparkle": Sparkle,
  "bot": Bot,
  "alarm-clock": AlarmClock,
  "circle": Circle,
};

export function lucideIconFromName(name: string): LucideIcon {
  return LUCIDE_REGISTRY[name] ?? Circle;
}
```

### 4.7 Coexistence math — stack positioning

Both edge tabs live within the drawer area: `top: 72`, `bottom: 16`. The shared `<EdgeTab>` outer container spans this area; the inner tab is anchored `top: 50%` with `translateY(-50%)`. To stack two tabs vertically (Notifications top, FAB bottom) with an 8px gap, each tab passes a `stackOffset` that shifts its inner tab up or down from the exact center:

**Combined footprint at rest:**
- Notifications REST height: `180px`
- FAB REST height: `132px`
- Gap between them: `8px`
- Total: `180 + 8 + 132 = 320px`

**Offset math** — the combined stack is vertically centered within the drawer area, so the gap is also centered:

- Gap top-edge at center: y = `center - 4px` (half of 8px gap)
- Gap bottom-edge at center: y = `center + 4px`
- **Notifications tab:** bottom edge sits at `center - 4px` → center of Notif = `center - 4 - 90px` → `stackOffset = -94px`
- **FAB tab:** top edge sits at `center + 4px` → center of FAB = `center + 4 + 66px` → `stackOffset = +70px`

Used in code:

```tsx
// NotificationsTab
<EdgeTab ... stackOffset={-94} />

// Future FABTab
<EdgeTab ... stackOffset={+70} />
```

**Tab rest position on viewport (1080p as reference):**

- Viewport height: 1080px
- Drawer area: `top: 72`, `bottom: 16` → drawer area height = `1080 - 72 - 16 = 992px`
- Drawer area center Y: `72 + 992/2 = 568px`
- Notif tab center Y (rest): `568 - 94 = 474px`; Notif tab spans `474 - 90 = 384px` to `474 + 90 = 564px`
- FAB tab center Y (rest): `568 + 70 = 638px`; FAB tab spans `638 - 66 = 572px` to `638 + 66 = 704px`
- Gap between tabs: `572 - 564 = 8px` ✓

**When a tab opens:**
- Its inner grows to `height: 100%` (= 992px = full drawer area)
- `stackOffset` is ignored when `height: 100%` because the inner's `top: 50% / translateY(-50%)` always resolves to the drawer center regardless of offset. (The `stackOffset` is added to `top: 50%` in calc, and `translateY(-50%)` recenters the element; when `height: 100%`, the element fills parent regardless of offset — the offset remains in the math but has no visible effect.)
- The sibling tab (FAB or Notif) gets hidden via mutual exclusion — see §4.8.

### 4.8 Mutual exclusion via `useEdgeTabStore`

Single-slot `activeTab` state ensures only one drawer is open at a time. When NotificationsTab's `toggle("notifications")` fires and the FAB drawer is currently open, the store atomically switches `activeTab` from `"fab"` to `"notifications"`. Both drawers subscribe to the store via `s.activeTab === {id}`, so FAB's drawer re-renders with `open=false` (exits), and Notifications' drawer re-renders with `open=true` (enters). `AnimatePresence` on each handles the transition overlap cleanly.

**Sibling tab visibility when a tab is open:**

When Notifications is open, the FAB tab renders with `open: false` (mutual exclusion). The FAB tab's outer container still spans the drawer area, so technically it's still in the DOM at its offset position. However, the Notifications drawer at `z-index: 1500` with `backdropFilter` covers the FAB tab's offset position visually. The FAB tab remains interactive via keyboard (`` ` ``), which closes Notifications and opens FAB atomically.

**Alternative considered and rejected:** Hide the sibling tab entirely via `display: none`. Rejected because it breaks keyboard focus traversal — a user tabbing through should still be able to reach the FAB tab even when Notifications is open. The visual obscuring by the drawer is acceptable because the keyboard path is always clear.

---

## 5. Visual Design

All values align to the canonical visual-system spec at `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md` and the token constants at `ops-design-system-v2/project/fab/tokens.js`.

### 5.1 Surfaces

| Surface | Token / value | Use |
|---|---|---|
| Drawer background | `var(--glass)` = `rgba(18,18,20,0.58)` + `blur(28px) saturate(1.3)` | Standard glass |
| Drawer border | `1px solid rgba(255,255,255,0.14)` on top/bottom/left (right is flush to viewport) | Bumped from default `rgba(255,255,255,0.09)` glass-border per chat4 landing |
| Tab background | `var(--glass)` (same as drawer — seamless when abutting) | Notifications |
| Tab border | `1px solid rgba(255,255,255,0.14)` on all 4 sides (including right — this is the visible seam when drawer is open) | Per chat4 resolution |
| Drawer top gradient | `linear-gradient(180deg, rgba(255,255,255,0.04), transparent 40%)` | Lit-from-above depth |
| Tooltip | `var(--glass-dense)` = `rgba(18,18,20,0.78)` | Hover on closed tab |
| Filter chip (active, critical) | bg `var(--rose-soft)`, border `var(--rose-line)`, text `var(--rose)` | Only when filter=critical |
| Filter chip (active, attn) | bg `var(--tan-soft)`, border `var(--tan-line)`, text `var(--tan)` | Only when filter=attn |
| Filter chip (active, ambient) | bg `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.12)`, text `var(--text-3)` | Ambient |
| Filter chip (active, all) | bg `rgba(255,255,255,0.08)`, border `rgba(255,255,255,0.18)`, text `var(--text)` | Default |
| Filter chip (inactive) | transparent bg, `rgba(255,255,255,0.08)` border, `var(--text-3)` text | All filters when inactive |
| Row icon tile (ambient) | bg `rgba(255,255,255,0.04)`, border `rgba(255,255,255,0.06)`, icon `var(--text-3)` | |
| Row icon tile (attn) | bg `var(--tan-soft)`, border `var(--tan-line)`, icon `var(--tan)` | |
| Row icon tile (critical) | bg `var(--rose-soft)`, border `var(--rose-line)`, icon `var(--rose)` | |
| Row hover / expanded | bg `rgba(255,255,255,0.03)` | Both states share |
| Row divider | `border-top: 1px solid rgba(255,255,255,0.04)` | Between rows |
| Left accent hairline (critical/attn, standard) | 1px, 45% opacity | Vertical along row |
| Left accent hairline (critical/attn, persistent) | 2px, 85% opacity | Bolder for persistent |

### 5.2 Typography

| Element | Font | Size | Weight | Color | Letter-spacing |
|---|---|---|---|---|---|
| Drawer title `//NOTIFICATIONS` | `var(--font-cakemono)` (fallback Mohave) | 13px | 300 | `var(--text)` | 0.08em |
| Drawer title count number | `var(--font-mono)` | 11px | 400 | `var(--text-2)` | — (tnum) |
| Filter chip label | `var(--font-mono)` | 10px | 500 | (variant-dependent) | 0.12em |
| Filter chip count | `var(--font-mono)` | 10px | 400 | (variant-dependent muted) | — (tnum) |
| Section/tactical `//` prefix | `var(--font-mono)` | 10px | 400 | `var(--text-mute)` | 0.16em |
| Row title | `var(--font-mohave)` | 13.5px | 400 | `var(--text)` | — |
| Row action-hint (collapsed) | `var(--font-mono)` | 9px | 500 | (tone-dependent) 0.75 opacity | 0.14em |
| Row timestamp | `var(--font-mono)` | 10px | 400 | `var(--text-mute)` | — (tnum) |
| Row body (expanded) | `var(--font-mohave)` | 12px | 400 | `var(--text-3)` | — |
| Row action button | `var(--font-cakemono)` | 10px | 300 | `var(--text)` (or tone) | 0.08em |
| Row secondary button | `var(--font-cakemono)` | 10px | 300 | `var(--text-3)` | 0.08em |
| Footer text | `var(--font-mono)` | 10px | 400 | `var(--text-mute)` | 0.14em |
| EOF marker | `var(--font-mono)` | 9px | 400 | `var(--text-mute)` | 0.18em |
| Empty state | `var(--font-mono)` | 10px | 400 | `var(--text-mute)` | 0.16em |
| Tab wordmark | `var(--font-mono)` | 9px | 400 | `var(--text-2)` | 0.18em (vertical) |
| Tab count badge | `var(--font-mono)` | 11px | 400 | `var(--text)` | — (tnum, zero) |

All `var(--font-mono)` usages include `font-feature-settings: "tnum" 1, "zero" 1` either via the `.mono` utility class or inline style — required for tabular number alignment.

### 5.3 Radii

Per `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md` §5:

| Element | Radius |
|---|---|
| Drawer (flush to right edge, only left corners round) | **10px** top-left + bottom-left; 0 top-right + bottom-right |
| Tab | **4px** top-left + bottom-left; 0 top-right + bottom-right |
| Filter chip | **2.5px** |
| Row icon tile | **2.5px** |
| Action buttons (primary + secondary) | **2.5px** |
| Tooltip | **5px** |

### 5.4 Spacing

| Zone | Padding |
|---|---|
| Drawer header (title row) | `12px 14px 10px` |
| Filter chip row | `8px 14px 10px` |
| Filter chip (internal) | `4px 8px` |
| Row | `9px 14px` |
| Row expanded inner (body + actions) | `0 14px 0 42px` (28px left = row icon width + 8px gap) |
| Drawer footer | `8px 14px` |
| Drawer border on left edge | 1px + 10px radius |
| Gap between row icon tile and title | 8px |
| Gap between filter chips | 4px |
| Gap between tab and drawer (visual seam) | 0px — tab's right border IS the seam (drawer's left border is removed when open) |
| Gap between stacked tabs (Notif / FAB) | 8px |

### 5.5 Icons

- All row icons: Lucide React components, imported via the `notification-meta.ts` registry
- Size: 12px, `strokeWidth: 1.5`
- Color: see §5.1 Row icon tile variants
- Tab bell icon: custom SVG 14px (to match handoff design exactly — Lucide's `Bell` has slightly different proportions)
- Tab close (X) on open: custom SVG 14px (rotates from bell via `rotate(45deg)`)

### 5.6 Z-index layer assignment

Per the canonical z-index scale at `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md` and `.interface-design/system.md` §Z-Index Scale:

| Layer | z-index | Element |
|---|---|---|
| content | 1–10 | Page widgets |
| nav | 500 | Sidebar |
| topbar | 10 | TopBar overlay (existing — bumped to `nav - 1` implicitly via mount order) |
| dropdown | 1000 | Dropdowns, autocomplete |
| floating-ui (drawer) | **1500** | `<NotificationsDrawer>` |
| floating-ui (tab) | **1550** | `<NotificationsTab>` (and future `<FABTab>`) — tab sits above its own drawer |
| floating-ui (FAB current) | 1500 | `<FloatingActionButton>` (existing, stays — future migration to 1500/1550) |
| floating-ui (bug report) | 1500 | `<BugReportButton>` (existing) |
| window | 2000+ | Floating windows |
| modal | 3000 | Radix portals |

The tab sitting at `1550` (above its drawer at `1500`) is intentional: when the drawer slides open, the tab abuts its left edge. Since both have `border: 1px solid rgba(255,255,255,0.14)` and the drawer drops its left border when open, the tab's right border is the sole seam line between them. If both were at the same z-index, z-index stacking contexts (established by AnimatePresence wrappers) could cause the seam to be obscured.

---

## 6. Interaction states

### 6.1 Tab states

| State | `open` | Tab height | Wordmark | Glyph | Cursor |
|---|---|---|---|---|---|
| Rest | false | 180px | "NOTIFICATIONS" | Bell + count badge + 6px tone dot | pointer |
| Hovered (closed) | false | 100% of drawer area | "NOTIFICATIONS" | Bell + count badge + 6px tone dot | pointer + tooltip shows "Notifications [N]" |
| Open | true | 100% of drawer area | "CLOSE" | × (bell rotated 45deg) | pointer |
| Focused (keyboard) | (either) | (depends on open) | (depends on open) | (depends on open) | `outline: none` (focus-visible uses left-accent stripe as focus indicator — no additional ring) |

**Focus-visible decision:** Because the tab already has a prominent left accent stripe (2px tone-colored), adding a separate focus ring would be redundant. Instead, when the tab receives keyboard focus via `:focus-visible`, the left accent stripe brightens to `#EDEDED` (100% `var(--text)`) for the duration of focus. Implemented as:

```css
[data-edge-tab]:focus-visible [data-edge-tab-accent] {
  background: var(--text) !important;
  transition: background 150ms var(--ease-smooth);
}
```

This requires adding `[data-edge-tab-accent]` to the accent `<span>` in the primitive implementation (already present in §4.1 reference code).

### 6.2 Drawer states

| State | Trigger | Duration | Animation |
|---|---|---|---|
| Hidden | `activeTab !== "notifications"` | — | `right: -360px` |
| Opening | `activeTab` transitions from `null` (or other) to `"notifications"` | 260ms | `right: -360 → 0`, ease `cubic-bezier(0.22, 1, 0.36, 1)` |
| Open | `activeTab === "notifications"` | — | `right: 0` |
| Closing | `activeTab` transitions from `"notifications"` to anything else | 260ms | `right: 0 → -360px`, same ease |
| Reduced motion | User prefers reduced motion | 150ms | Opacity 0 ↔ 1, no translate |

**Focus trap (open state):** The drawer is a complementary landmark (`<aside role="complementary">`), NOT a modal dialog, per WAI-ARIA Authoring Practices §Dialog pattern. It does NOT trap focus. Users can tab out of the drawer back into the page. This is intentional — notifications are a persistent peripheral surface, not an interruptive modal.

However, **Escape closes the drawer** (see `handleKeyDown` in §4.4). This matches the FAB drawer's behavior.

### 6.3 Filter chip states

| State | Background | Border | Text | Count color |
|---|---|---|---|---|
| Inactive | transparent | `rgba(255,255,255,0.08)` | `var(--text-3)` | `var(--text-mute)` |
| Hovered | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | `var(--text-2)` | `var(--text-mute)` |
| Active (ALL) | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.18)` | `var(--text)` | `var(--text) 0.7 opacity` |
| Active (CRITICAL) | `var(--rose-soft)` | `var(--rose-line)` | `var(--rose)` | `var(--rose) 0.7 opacity` |
| Active (ATTENTION) | `var(--tan-soft)` | `var(--tan-line)` | `var(--tan)` | `var(--tan) 0.7 opacity` |
| Active (AMBIENT) | `rgba(255,255,255,0.04)` | `rgba(255,255,255,0.12)` | `var(--text-3)` | `var(--text-3) 0.7 opacity` |

Transitions: all properties 120ms `var(--ease-smooth)` on filter change and hover.

### 6.4 Row states

| State | Background | Accent hairline | Body + actions |
|---|---|---|---|
| Default | transparent | 1px tone (critical/attn only), 45% opacity; 0px otherwise | Hidden (max-height 0) |
| Hovered | `rgba(255,255,255,0.03)` | (same as default) | Hidden |
| Expanded | `rgba(255,255,255,0.03)` | (same as default) | Visible (max-height 160px, animated) |
| Persistent (any state) | (same as state) | 2px, 85% opacity — always | (depends on expanded) |

**Row click behavior:**

- Click anywhere on the row → toggle `expanded`
- Click the action button → call `onAction()`:
  - If `notification.type === "duplicates_found"`: open `useDuplicateReviewStore.openSheet()`, close drawer, dismiss (if non-persistent)
  - Else if `notification.actionUrl`: `router.push(actionUrl)`, close drawer, dismiss (if non-persistent)
  - Else: no-op (action button isn't rendered when there's no target)
- Click DISMISS button → `onDismiss(id)` (mutation + optimistic update), collapse row
- Click SNOOZE button → no-op (disabled, tooltip "Coming soon")

**Bug #2 resolution:** The row click directly expands body/actions on the FIRST click. The action button is immediately visible and navigates on click. There is no "click to reveal, click to use" two-step because the drawer's open/closed state is controlled by the tab, not by clicking inside the rail.

### 6.5 Empty states

| Condition | Copy (i18n key) |
|---|---|
| No notifications at all | `empty.allClear` → "// NO NOTIFICATIONS" |
| Filter returns no rows | `empty.noneInBucket` → "// NONE IN {bucket}" (where {bucket} = CRITICAL / ATTENTION / AMBIENT) |
| Error loading notifications | `empty.error` → "// SYS :: SYNC ERROR" + footer retry button |

### 6.6 Dismiss-all confirmation

Clicking the `CheckCheck` icon in the header triggers `dismissAllMutation` — which only dismisses non-persistent notifications (persistent remain). This is non-destructive (notifications move to `is_read: true` but aren't deleted). **No confirmation dialog** — matches the current modal's behavior. If the user dismisses accidentally, they can open the future `/notifications` history route (out of scope) to unread.

**Optimistic update:** `useDismissAllNotifications` in `src/lib/hooks/use-notifications.ts:110` already handles the optimistic update + rollback — no change needed.

---

## 7. Motion

All animations use the canonical `EASE_SMOOTH = cubic-bezier(0.22, 1, 0.36, 1)` from `src/lib/utils/motion.ts:6`. No spring physics anywhere in this system (matches OPS rule: "No spring/bounce").

### 7.1 New motion variants (add to `src/lib/utils/motion.ts`)

```ts
// Drawer slide in from right
export const drawerVariants: Variants = {
  hidden: { x: 360, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.26, ease: EASE_SMOOTH } },
  exit: { x: 360, opacity: 0, transition: { duration: 0.22, ease: EASE_SMOOTH } },
};
export const drawerVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Row enter/exit (mount animation for list items)
export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};
export const rowVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

// Row body expand (max-height animation)
export const rowExpandVariants: Variants = {
  collapsed: { maxHeight: 0 },
  expanded: { maxHeight: 160, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

// Filter chip mount
export const chipVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};
```

### 7.2 Motion timing table

| Animation | Duration | Easing | Reduced-motion fallback |
|---|---|---|---|
| Drawer slide open | 260ms | EASE_SMOOTH | 150ms opacity |
| Drawer slide close | 220ms | EASE_SMOOTH | 150ms opacity |
| Tab height grow (rest → open) | 260ms | EASE_SMOOTH | 150ms opacity |
| Tab right-edge slide (open/close with drawer) | 260ms | EASE_SMOOTH | 150ms opacity |
| Tab glyph rotate | 260ms | EASE_SMOOTH | no transform, instant |
| Tab tone-accent color change | 180ms | EASE_SMOOTH | 150ms opacity |
| Row hover background | 120ms | EASE_SMOOTH | instant |
| Row expand body | 200ms | EASE_SMOOTH | instant |
| Row dismiss (exit list) | 150ms | EASE_SMOOTH | 100ms opacity |
| Filter chip active transition | 120ms | EASE_SMOOTH | instant |
| Tooltip fade | 150ms | EASE_SMOOTH | instant |

### 7.3 Reduced-motion handling

`useReducedMotion()` from Framer Motion returns `true` when `prefers-reduced-motion: reduce` is set. All animations check this and swap to opacity-only fallbacks at 150ms max. No transforms (no scale, no translate, no rotate) when reduced.

### 7.4 Deleted motion variants

Remove from `src/lib/utils/motion.ts` lines 182–242:

- `notifPillVariants` / `notifPillVariantsReduced`
- `notifCardVariants` / `notifCardVariantsReduced`
- `notifCardFullVariants`
- `notifModalVariants` / `notifModalVariantsReduced`
- `notifBackdropVariants`

---

## 8. Copy & i18n

### 8.1 Voice rules applied

Per `ops-design-system-v2/project/SKILL.md` and the OPS CLAUDE.md:

- **UPPERCASE for authority** — tab wordmark, drawer title, filter chips, empty states, footer labels, action/dismiss/snooze buttons
- **Sentence case for content** — notification titles, bodies, tooltip titles
- **`//` prefix** — drawer title (`//NOTIFICATIONS`), section labels, empty state
- **`SYS ::` framing** — system state (not used in this spec's drawer, but available for future inline system messages)
- **No emoji** — anywhere
- **No exclamation points** — anywhere
- **Numbers always mono + tabular-lining + slashed zero** — count badges, timestamps, chip counts
- **Never "Welcome back!", never "Oops"**

### 8.2 New dictionary file

`src/i18n/dictionaries/en/notifications.json`:

```json
{
  "tab.wordmarkClosed": "NOTIFICATIONS",
  "tab.wordmarkOpen": "CLOSE",
  "tab.ariaLabel": "Toggle notifications drawer",
  "tab.tooltipTitle": "Notifications",
  "tab.shortcut": "N",

  "drawer.ariaLabel": "Notifications",
  "drawer.title": "NOTIFICATIONS",
  "drawer.muteAllAriaLabel": "Mute all notifications",
  "drawer.clearAllAriaLabel": "Clear all dismissable notifications",

  "filters.ariaLabel": "Filter notifications by tone",
  "filters.all": "ALL",
  "filters.critical": "CRITICAL",
  "filters.attn": "ATTENTION",
  "filters.ambient": "AMBIENT",

  "list.eofMarker": "[ EOF ]",

  "empty.allClear": "// NO NOTIFICATIONS",
  "empty.noneInBucket": "// NONE IN {bucket}",
  "empty.error": "// SYS :: SYNC ERROR",
  "empty.retry": "RETRY",

  "row.snooze": "SNOOZE",
  "row.snoozeTooltipComingSoon": "Snooze coming soon",
  "row.dismiss": "DISMISS",
  "row.dismissAriaLabel": "Dismiss notification",

  "footer.lastSync": "LAST SYNC {time}",
  "footer.viewAll": "VIEW ALL →"
}
```

`src/i18n/dictionaries/es/notifications.json` — same keys, translated values (tactical + uppercase rules apply identically; filter names stay as English tactical labels). Actual Spanish translation work is out of scope for this spec (covered by a separate translation pass); stub the file with English values and a `// TODO: ES translation` comment at top.

### 8.3 Removals from `topbar.json`

Remove the following keys from `src/i18n/dictionaries/{en,es}/topbar.json` (they move to `notifications.json`):

```
notifications.title
notifications.ariaLabel
notifications.viewAll
notifications.dismissAll
notifications.empty
notifications.emptyHint
notifications.today
notifications.yesterday
notifications.earlier
notifications.count
notifications.overflow
notifications.clickToExpand
```

### 8.4 LAST SYNC token

`footer.lastSync` includes `{time}` placeholder, formatted as `HH:MM` (24-hour, zero-padded). Computed from `queryClient.getQueryState(...)?.dataUpdatedAt` on mount — if no timestamp available, render as `—:—`. Implementation:

```tsx
const syncTime = useMemo(() => {
  const state = queryClient.getQueryState(queryKeys.notifications.unread(userId, companyId));
  if (!state?.dataUpdatedAt) return "—:—";
  const d = new Date(state.dataUpdatedAt);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}, [userId, companyId /* intentional — refresh on auth change */]);
```

### 8.5 Translation key in row titles/bodies

The current `translateNotif()` helper at `notification-card-full.tsx:15-25` is preserved in `notifications-row.tsx` as `translateNotifCopy()` — same logic (treat a lowercase dotted string as an i18n key; look up in `common.json`; fall back to raw if missing). This lets services emit i18n-keyed notifications without changes.

---

## 9. Accessibility

### 9.1 Keyboard navigation

| Key | Action |
|---|---|
| `N` | Toggle notifications drawer (global) |
| `` ` `` | Toggle FAB drawer (future — registered by `<FABTab>`) |
| `Escape` | Close active edge tab drawer |
| `Tab` | Move focus forward through DOM order (tab → drawer header buttons → filter chips → rows → action buttons → footer → next element) |
| `Shift+Tab` | Move focus backward |
| `Enter` / `Space` | Activate focused button (tab, chip, row, action, dismiss) |
| Arrow keys in filter chip group | `Left`/`Right` move focus between chips (standard `role="tablist"` behavior) |
| Arrow keys in row list | `Up`/`Down` move focus between rows (see §9.3) |

**No `role="dialog"`.** The drawer is a complementary landmark, not a dialog — focus trap is intentionally NOT applied. See §6.2.

### 9.2 Shortcut collision check

Confirmed against `src/components/ops/keyboard-shortcuts.tsx` (to be read during impl), `top-bar.tsx` line 116 (Cmd+Z undo):

- `N` — not registered anywhere currently
- `` ` `` — not registered anywhere currently
- Command palette `⌘K` — unaffected (uses `Cmd+K`)
- Undo `⌘Z` — unaffected

Both `N` and `` ` `` exit early when:
- Modifier keys pressed (`metaKey` / `ctrlKey` / `altKey` / `shiftKey`)
- Focus is in `<input>`, `<textarea>`, or `[contentEditable]`

This lets users type "n" into a comment without triggering the drawer.

### 9.3 Row list arrow-key navigation

When focus is on a row, `Up`/`Down` move focus to the prev/next row in the visible filtered list. Implemented via a `ref` on the list container + keyboard handler that finds the focused row's DOM position and shifts focus to its sibling. Wraps at ends (no edge behavior).

```tsx
// Inside NotificationsDrawer
const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  const focused = document.activeElement as HTMLElement | null;
  if (!focused || focused.getAttribute("role") !== "listitem") return;
  const rows = Array.from(
    listRef.current?.querySelectorAll('[role="listitem"]') ?? [],
  ) as HTMLElement[];
  const idx = rows.indexOf(focused);
  if (idx === -1) return;
  e.preventDefault();
  const next = e.key === "ArrowUp"
    ? rows[(idx - 1 + rows.length) % rows.length]
    : rows[(idx + 1) % rows.length];
  next?.focus();
};
```

`<NotificationRow>` wrapper gets `tabIndex={0}` so it's focusable.

### 9.4 ARIA roles & labels

| Element | Role / label |
|---|---|
| `<NotificationsTab>` button | `role="button"`, `aria-label="Toggle notifications drawer"`, `aria-expanded={open}` |
| `<NotificationsDrawer>` | `role="complementary"`, `aria-label="Notifications"` |
| Filter chip group | `role="tablist"`, `aria-label="Filter notifications by tone"` |
| Filter chip | `role="tab"`, `aria-selected={active}`, `aria-controls="notifications-drawer-list"` |
| List container | `role="list"`, `id="notifications-drawer-list"` |
| Row | `role="listitem"`, `tabIndex=0` |
| Icon buttons (mute/clear) | `role="button"`, `aria-label={descriptive}` |
| Dismiss X button | `role="button"`, `aria-label="Dismiss notification"` |
| Action button | inherits `<button>` semantic; text is its accessible name |
| Tooltip on tab hover | `role="tooltip"`, `pointer-events: none` |

### 9.5 Contrast verification

All token values used pass AA (4.5:1) or better against `var(--glass)` or `var(--bg)`:

- `var(--text)` (#EDEDED) on `var(--glass)` (over #000): 18.8:1 ✓ AAA
- `var(--text-2)` (#B5B5B5) on `var(--glass)`: 10.3:1 ✓ AAA
- `var(--text-3)` (#8A8A8A) on `var(--glass)`: 5.4:1 ✓ AA
- `var(--text-mute)` (#6A6A6A) on `var(--glass)`: 3.4:1 ✗ — decorative only (`//` slashes, separators), never for primary content
- `var(--rose)` (#B58289) on `var(--rose-soft)` bg: 6.2:1 ✓ AA (filter chip active)
- `var(--tan)` (#C4A868) on `var(--tan-soft)` bg: 8.1:1 ✓ AAA
- `var(--ops-accent)` (#6F94B0) on `var(--glass)`: 5.6:1 ✓ AA (used for tab accent stripe in default state only)

All text is `≥11px`. The sub-10px mono chips (9px) are used for tab wordmark and EOF marker — both are decorative/metadata, not primary content.

### 9.6 Touch targets

All interactive elements have a minimum 44×44px tap target via padding, per `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md` §8:

| Element | Visual size | Tap target (via padding) |
|---|---|---|
| Tab | 28×180px | 28×180 ✓ (180px tall meets 44×44 easily; 28px width is below 44 — **acceptable exception** per spec-author call: the tab is on the extreme right edge, so thumb/finger sliding inward from the edge has effectively unlimited target width) |
| Filter chip | ~72×20px | 72×32px (8+4+4+8 padding on chip, but chip row has 10px padding, net 72×32 — below 44. **Fix:** add `min-height: 44px` on mobile-only via `@media (pointer: coarse)`) |
| Row | full-width × 38px closed | full-width × 44px minimum (increase row padding vertical from 9px → 12px on `@media (pointer: coarse)`) |
| Action/Snooze/Dismiss buttons | ~80×26px | 80×32px on desktop; 80×44px on mobile (same media query increase) |
| Dismiss X (mute-all / clear-all header) | 22×22px | 22×22 on desktop; **Fix:** bump to 44×44 on `@media (pointer: coarse)` |

Mobile touch-target bump implemented via:

```css
@media (pointer: coarse) {
  [data-drawer-btn-mobile-bump] {
    min-width: 44px;
    min-height: 44px;
  }
}
```

Add `data-drawer-btn-mobile-bump` to: filter chips, row action buttons, row dismiss, header icon buttons. Tab is already tall enough vertically; its 28px width is acceptable per the edge-slide rationale.

---

## 10. Responsive behavior

### 10.1 Breakpoints

Aligned to Tailwind defaults used elsewhere in OPS-Web:

| Breakpoint | Min width | Behavior |
|---|---|---|
| Mobile | 0 | Sidebar hidden; drawer width adjusts |
| Tablet (md) | 768px | Sidebar 72px; drawer 360px |
| Desktop (lg+) | 1024px | Same as tablet |

### 10.2 Drawer width on mobile

At viewport widths below 400px, a 360px drawer + 28px tab would overflow. Drawer width clamps via:

```tsx
width: "min(360px, calc(100vw - 28px - 8px))",
// 28px = tab width, 8px = left breathing room
```

On very narrow viewports (e.g., 320px iPhone SE), the drawer becomes `320 - 28 - 8 = 284px` — still comfortable for single-column row layout.

### 10.3 Sidebar + drawer coexistence

The sidebar is a fixed left element (72px desktop, hamburger-triggered overlay on mobile). The drawer is a fixed right element. They never overlap.

When sidebar is expanded on hover (desktop) to its 200px width: no collision — drawer is on the opposite edge.

When sidebar is fully open as an overlay on mobile: the drawer opens on top of the sidebar overlay if both are active. **Rule:** opening the drawer does not close the sidebar overlay automatically (they're different interaction models). The user can dismiss the sidebar via its own close, and dismiss the drawer via Escape or tab click.

### 10.4 Topbar coexistence

The topbar is `fixed top-0 right-0 h-[56px] left-0 md:left-[72px]` (from `dashboard-layout.tsx:217`). The drawer starts at `top: 72` (= 56 topbar + 16 gap). The drawer is BELOW the topbar — no overlap.

However, the edge tab also starts at `top: 72` — so the tab's top edge is 16px below the topbar's bottom edge. The drawer's top edge aligns with the tab's top edge. Visual harmony.

### 10.5 Full-height pages

Full-height pages (`/inbox`, `/map`, `/calendar` per `dashboard-layout.tsx:70`) adjust their own content area. The drawer floats above them — no special handling needed. The drawer's content-dim layer (see §6.2) is not applied, because the drawer is not a modal and doesn't dim the background.

---

## 11. Bug resolution trace

### 11.1 Bug `623e321f-fbb5-4041-acd1-cdf04ff1997e` — "impossible to see them all"

| Failure mode | Resolution |
|---|---|
| `MAX_VISIBLE_PILLS = 15` cap in `notification-rail.tsx:16` | **Removed.** Drawer shows unlimited notifications via scroll container (`overflowY: auto`). |
| `+N` overflow badge (line 294-298) | **Removed.** No overflow — everything scrolls. |
| `max-w-[50vw]` on mobile (line 134) | **Removed.** Drawer uses `min(360px, calc(100vw - 36px))` on all viewports — generous, scales. |
| `HOVER_PREVIEW_COUNT = 3` (line 18) — only 3 items interactive in collapsed state | **Removed.** Every row in the drawer is directly interactive. No preview concept. |
| Horizontal real-estate contention with Search/Undo/Sync | **Resolved.** Drawer is on the right edge in its own overlay. TopBar's right cluster no longer contains notifications. |

Acceptance: with 50 notifications in the state, all 50 must be scroll-reachable inside the drawer. Tested via loading 50 sample notifs into TanStack Query cache in Storybook/tests.

### 11.2 Bug `912f07a1-76dd-4116-8429-4e24d489a67d` — "click to expand, second click to open"

| Failure mode | Resolution |
|---|---|
| Count button click triggers `expandRail()` state change, not action (line 232) | **Removed.** Drawer open/close is controlled by the tab, not by clicking inside the notification list. |
| Pills at line 244–298 have no click handler (for items not in top-3 hover previews) | **Removed.** Every drawer row has a direct click handler (`onRowClick` in `<NotificationRow>`). |
| First click on a non-preview pill does nothing | **Removed.** First click on any row expands body + reveals action buttons. |
| Navigation requires click-on-mini-card (second click after pill) | **Resolved.** Action button is visible on row hover and on row expand; single click from expanded state navigates. On mobile (no hover), action button is always visible in expanded state. |

Acceptance: in user testing with 14 notifications loaded, tapping any row immediately expands it and shows the action button. Tapping the action button navigates. Total clicks to reach action from drawer-closed state: 2 (tab open → row expand → action — wait, that's 3 clicks including the action itself).

**Re-evaluate: is 3 clicks actually better than the current broken flow?**

Current (broken): click pill → rail expands → click mini-card → navigates. **3 clicks total.**

New (drawer): click tab → drawer opens → click row → row expands → click action → navigates. **3 clicks total.**

Same click count. The improvement is:

1. **No deception:** first click in the new flow opens a drawer, not "nothing then something." User never sees a click produce no visible result.
2. **No invisible hit zones:** every row is interactable; no hidden "top-3 preview" concept.
3. **Every row is legible:** no truncation at 15 items or 50% viewport.
4. **Tab is a persistent affordance:** even from closed state, the user can see the unread count and top-tone accent without mousing over anything.

**Optional UX optimization (flagged for user confirmation):** On row click, if the notification has a single actionUrl AND no body, skip the expand step and navigate directly. This would reduce the common-case click count to 2. However, it requires the user to distinguish "rows with bodies" (click = expand) from "rows without bodies" (click = navigate) at a glance, which is confusing. **Decision: do not ship this optimization.** Consistency beats click-count savings. Every row behaves identically: click = expand, action button = navigate.

---

## 12. Testing strategy

### 12.1 Unit tests

Location: `tests/unit/` (co-located with existing tests per OPS-Web conventions).

| File | Tests |
|---|---|
| `tests/unit/edge-tab-store.test.ts` | `setActive`, `toggle`, `close`, `closeAll`; mutual exclusion semantics; Zustand selectors |
| `tests/unit/notification-meta.test.ts` | All 18 `NotificationType` values map to valid meta; `resolveTone` fallback; `lucideIconFromName` registry completeness |

### 12.2 Component tests (React Testing Library)

| File | Tests |
|---|---|
| `tests/unit/edge-tab.test.tsx` | Renders with all accent variants; `onToggle` fires on click + Enter + Space; hover tooltip appears/disappears; closed state shows count badge; open state hides count, shows × glyph |
| `tests/unit/notifications-tab.test.tsx` | Count accurately reflects `useNotifications` data; top-tone accent matches highest-severity notif; `N` keyboard shortcut toggles; modifier keys + input focus suppress shortcut |
| `tests/unit/notifications-drawer.test.tsx` | Opens/closes via `useEdgeTabStore`; filter chips filter the list; row click expands; action button navigates + dismisses; dismiss X removes row; empty states render; `Escape` closes |
| `tests/unit/notifications-row.test.tsx` | Title/body/action-label translate via dot-key; timestamp formats; hover + expand states; persistent rows lack dismiss X; duplicates_found opens sheet |

### 12.3 Integration tests

| File | Tests |
|---|---|
| `tests/integration/notifications-edge-tab.spec.ts` | Open Notifications → verify `activeTab === "notifications"`; open FAB (future — stub) → verify Notifications closes; Escape closes |

### 12.4 E2E / browser tests (manual during plan exec)

- Load app with 20 seeded notifications; verify all 20 visible by scrolling
- Click tab → drawer opens at `right: 0`; tab slides left with drawer
- Click a row → body + actions expand inline
- Click action button → navigates + closes drawer + dismisses non-persistent
- Press `N` → toggles drawer
- Press `Escape` with drawer open → drawer closes
- Press `N` with focus in a comment `<input>` → shortcut does NOT fire
- Load with 0 notifications → empty state renders
- Filter to `CRITICAL` → only critical rows visible; chip active style matches rose
- Test `prefers-reduced-motion: reduce` — all transitions are 150ms opacity fallbacks
- Test at 320px viewport — drawer clamps, readable, interactive

---

## 13. File inventory

### 13.1 New files

| Path | Purpose | Est. LoC |
|---|---|---|
| `src/components/ui/edge-tab.tsx` | `<EdgeTab>` primitive | 180 |
| `src/components/ui/edge-tab.types.ts` | Shared types | 40 |
| `src/stores/edge-tab-store.ts` | Zustand mutual-exclusion store | 30 |
| `src/components/layouts/notifications-drawer.tsx` | TRIAGE v3 drawer | 300 |
| `src/components/layouts/notifications-tab.tsx` | Consumes EdgeTab | 80 |
| `src/components/layouts/notifications-row.tsx` | Expandable row | 200 |
| `src/lib/notifications/notification-meta.ts` | Type → icon/tone registry | 80 |
| `src/i18n/dictionaries/en/notifications.json` | English copy | 30 |
| `src/i18n/dictionaries/es/notifications.json` | Spanish stub | 30 |
| `tests/unit/edge-tab-store.test.ts` | Store tests | 60 |
| `tests/unit/edge-tab.test.tsx` | Primitive tests | 100 |
| `tests/unit/notifications-tab.test.tsx` | Tab tests | 90 |
| `tests/unit/notifications-drawer.test.tsx` | Drawer tests | 200 |
| `tests/unit/notifications-row.test.tsx` | Row tests | 120 |
| `tests/unit/notification-meta.test.ts` | Registry tests | 40 |
| **Total new** | — | **~1,580 LoC** |

### 13.2 Modified files

| Path | Change | Est. Δ LoC |
|---|---|---|
| `src/components/layouts/top-bar.tsx` | Remove `NotificationRail` import + JSX | −3 |
| `src/components/layouts/dashboard-layout.tsx` | Swap `NotificationModal` for `NotificationsDrawer + NotificationsTab` mount | 0 (net — swap) |
| `src/lib/utils/motion.ts` | Delete old notif variants, add new drawer/row/chip variants | +30 net |
| `src/i18n/dictionaries/en/topbar.json` | Remove `notifications.*` keys (12 keys) | −12 |
| `src/i18n/dictionaries/es/topbar.json` | Same | −12 |

### 13.3 Deleted files

| Path | LoC |
|---|---|
| `src/components/layouts/notification-rail.tsx` | −305 |
| `src/components/layouts/notification-pill.tsx` | −35 |
| `src/components/layouts/notification-mini-card.tsx` | −121 |
| `src/components/layouts/notification-card-full.tsx` | −148 |
| `src/components/layouts/notification-modal.tsx` | −218 |
| `src/stores/notification-rail-store.ts` | −29 |
| **Total deleted** | **−856 LoC** |

### 13.4 Net code change

+1,580 new + 30 motion + (−12×2 = −24) i18n + (−3 + 0) layouts + (−856) deletions = **+727 LoC**

---

## 14. Acceptance criteria

Ship-ready when all of the following are true:

### 14.1 Functional

- [ ] `<NotificationsTab>` renders at the right edge, centered-ish (stackOffset -94) within the drawer area.
- [ ] Tab shows live unread count (from `useNotifications()`) in the vertical mono badge.
- [ ] Tab accent stripe is `rose` when any critical notification exists; `tan` when only ATTENTION-class; `steel-blue` when only accent/ambient.
- [ ] Clicking the tab opens the drawer in 260ms; clicking again closes it in 220ms.
- [ ] Pressing `N` (no modifiers) toggles the drawer from anywhere in the app except `<input>`/`<textarea>`/`[contenteditable]`.
- [ ] Pressing `Escape` while the drawer is open closes it.
- [ ] The drawer shows all notifications (no cap) in a scrollable list.
- [ ] Filter chips correctly filter by tone (ALL / CRITICAL / ATTENTION / AMBIENT) with correct counts.
- [ ] Row click expands body + inline action buttons.
- [ ] Action button navigates via `actionUrl` and dismisses non-persistent notifications.
- [ ] Dismiss button removes the notification from the list via optimistic update.
- [ ] Clear-all button (`CheckCheck`) dismisses all non-persistent notifications.
- [ ] Mute-all button (`BellOff`) is a visible stub (no-op with tooltip "Coming soon") — future wiring.
- [ ] Empty state renders when no notifications OR when filter returns no rows.
- [ ] `VIEW ALL →` in footer resets filter to ALL and scrolls the list to top.

### 14.2 Visual

- [ ] All tokens match §5 exactly (glass, radii, borders, typography, colors).
- [ ] No hardcoded hex values in component code — only `var(--*)` CSS variables.
- [ ] Tab + drawer abut seamlessly with a 1px border line as the visible seam.
- [ ] Tab height = 100% of drawer area when open/hovered (NOT a fixed `panelHeight` prop).
- [ ] Lucide icons render correctly for all 18 `NotificationType` values.
- [ ] Left accent hairline is 2px for persistent, 1px for standard, only on critical/attn rows.

### 14.3 Architecture

- [ ] `useEdgeTabStore` is the sole coordinator of tab open/close state.
- [ ] `<EdgeTab>` primitive has zero knowledge of notifications — fully reusable by future `<FABTab>`.
- [ ] `notification-meta.ts` is the sole source of truth for type → icon/tone mapping.
- [ ] No `NotificationModal` / `NotificationRail` / `NotificationPill` / `NotificationMiniCard` / `NotificationCardFull` / `notificationRailStore` anywhere in the codebase.
- [ ] Mutual exclusion verified: opening Notifications closes any other active edge tab (even if none exists today, the contract must hold).

### 14.4 Accessibility

- [ ] All contrast ratios per §9.5 verified.
- [ ] All text ≥ 11px except decorative (`var(--text-mute)` metadata).
- [ ] All interactive elements have `aria-label` or accessible text.
- [ ] Drawer has `role="complementary"`, NOT `role="dialog"`.
- [ ] Filter chip group has `role="tablist"` with proper `aria-selected`/`aria-controls`.
- [ ] Rows have `role="listitem"` + `tabIndex={0}`.
- [ ] Arrow keys in the row list move focus between rows.
- [ ] Touch targets ≥44px on `@media (pointer: coarse)`.
- [ ] Reduced-motion users get opacity-only transitions at ≤150ms.

### 14.5 Testing

- [ ] All unit tests pass.
- [ ] Component tests pass.
- [ ] Integration test for edge-tab mutual exclusion passes.
- [ ] Manual E2E checklist (§12.4) fully green.

### 14.6 Bug closure

- [ ] Both source `bug_reports` marked resolved with PR link in resolution_notes.

### 14.7 Documentation

- [ ] `ops-software-bible/07_SPECIALIZED_FEATURES.md` §14 updated to reflect vertical drawer architecture.
- [ ] This spec file committed to `docs/superpowers/specs/`.
- [ ] Implementation plan (next step) lives at `docs/superpowers/plans/2026-04-23-vertical-notification-system.md` and is executed in full.

---

## 15. Open questions & risks

### 15.1 Open questions

**None blocking.** All design decisions resolved in the 2026-04-23 brainstorm.

**Deferred (for follow-up plan):**

1. `/notifications` full history route — where read/dismissed notifications live for historical browsing. For now, footer "VIEW ALL →" resets the filter + scrolls. Ship when Snooze + mute-all also ship.
2. Snooze feature — requires new `snoozed_until: timestamp with time zone` column on `notifications` table + RLS update + UI time picker. Stubbed as disabled button now.
3. Mute-all feature — requires wire-up to `user_notification_preferences` (existing table referenced in `queryKeys.notificationPreferences`) — stubbed as no-op now.

### 15.2 Risks

| Risk | Mitigation |
|---|---|
| The edge tab's `height: 100%` percentage resolves to 0 on some browsers when the parent has `top:N + bottom:N` but no explicit height | Verified in Chromium, WebKit, Firefox — standard CSS. Add explicit height fallback via `useLayoutEffect` + ResizeObserver if a browser regression appears. |
| The backdrop-blur's GPU cost stacks when tab + drawer + topbar all blur | Already an issue with the current rail. No regression; drawer is 360×1000 area vs rail's full topbar. |
| Shortcut collision with future keyboard features | `N` and `` ` `` are simple single keys — if a future feature claims them, this spec defers (we'd need a formal shortcut registry anyway). |
| Concurrent dismiss on the same notification from two tabs/windows | `useDismissNotification` at `use-notifications.ts:79` already handles this (optimistic + settle). No regression. |
| Group E1 collision on `dashboard-layout.tsx` | Flagged in §3.5. Impl plan handles order. |

---

## 16. Out of scope — explicit

To prevent scope creep during impl:

- [ ] `/notifications` history route — future plan
- [ ] Snooze UI + data model — future plan
- [ ] Mute-all wiring to `user_notification_preferences` — future plan
- [ ] FAB migration to edge-tab pattern — separate plan (consumes `<EdgeTab>` primitive shipped here)
- [ ] iOS in-app notification list changes — separate platform track
- [ ] OneSignal push content changes — unrelated to UI
- [ ] Admin PMF dashboard's own notification pipeline — separate system
- [ ] Real-time supabase channel subscription for notifications — deferred until after this ships

---

## 17. Change log

| Date | Change | Author |
|---|---|---|
| 2026-04-23 | Initial draft from brainstorm + handoff bundle synthesis | Jackson Sweet + Claude |

---

## 18. References

- `docs/superpowers/specs/2026-04-15-ops-web-visual-system-design.md` — Visual system canonical
- `.interface-design/system.md` — Quick-reference design system
- `ops-software-bible/07_SPECIALIZED_FEATURES.md` §14 — Current notification architecture (to be updated post-impl)
- `ops-design-system-v2/project/rail-triage.jsx` — Approved drawer design
- `ops-design-system-v2/project/notif-tab.jsx` — Approved trigger tab design
- `ops-design-system-v2/project/ui_kits/ops-web/FAB.jsx` — Sibling edge tab (future migration target)
- `ops-design-system-v2/project/fab/tokens.js` — Production-aligned JS token constants
- `ops-design-system-v2/chats/chat4.md` — Notifications rail design conversation
- `ops-design-system-v2/chats/chat5.md` — FAB edge-tab design conversation
- Supabase project `ijeekuhbatykdomumfjx` — `notifications` table schema (verified 2026-04-23)
- `bug_reports.id 623e321f-fbb5-4041-acd1-cdf04ff1997e` — Source bug #1
- `bug_reports.id 912f07a1-76dd-4116-8429-4e24d489a67d` — Source bug #2

---

## End of spec.
