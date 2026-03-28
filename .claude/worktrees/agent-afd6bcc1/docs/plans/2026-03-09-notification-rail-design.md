# Header Notification Rail — Design Document

## Goal

Replace the left-side page action buttons in the TopBar with a notification rail that gives users ambient awareness of pending notifications. Notifications stack left-to-right, can be collapsed (pills) or expanded (mini cards), and can open a full modal for detailed review. The system is built as reusable primitives — persistent and dismissible notification types — populated as features come online.

## Architecture

The notification rail lives in the left zone of the existing 56px TopBar. It reads from the existing `notifications` Supabase table via a new TanStack Query hook. A small Zustand store manages UI state (collapsed/expanded/modal). The bell icon on the right becomes the "view all" modal trigger. Page action buttons are removed entirely (FAB covers those actions).

## Tech Stack

- Framer Motion (layout animations, AnimatePresence for dismiss/enter)
- TanStack Query (data fetching, auto-refetch)
- Zustand (rail UI state)
- Existing Supabase `notifications` table + `notification-service.ts`
- Lucide icons (minimal — only X for dismiss)

---

## Design System Alignment

All decisions below trace to `.interface-design/system.md`:

- **Surfaces:** Frosted glass — `rgba(10,10,10,0.70)`, `backdrop-blur(20px) saturate(1.2)`, border `rgba(255,255,255,0.08)`
- **Colors:** Monochromatic. Standard pills use `rgba(255,255,255,0.20)`. Persistent pills use `#597794` (accent, sparingly). No other colors.
- **Typography:** Card titles in Mohave Regular `text-body-sm`. Count label in `font-mono text-[10px]`. Action buttons in Kosugi uppercase `text-[9px]` tracked.
- **Border radius:** 2px on cards, full-rounded on pills (they're small enough to be dots)
- **Depth:** Borders-only on dark. No shadows. Surface elevation via lightness shifts only.
- **Text alignment:** Left-aligned. Never centered.
- **Accent usage:** Only on persistent notification indicators — a 2px left border on expanded cards, and the pill color in collapsed state.

---

## Data Model Changes

Extend `AppNotification` and Supabase `notifications` table:

```typescript
interface AppNotification {
  // ... existing fields ...
  persistent: boolean;       // true = cannot be dismissed, stays until resolved
  actionUrl: string | null;  // optional deep-link (e.g. "/projects/abc")
  actionLabel: string | null; // optional button label (e.g. "View Results")
}
```

New columns on `notifications` table:
- `persistent` BOOLEAN DEFAULT false
- `action_url` TEXT DEFAULT NULL
- `action_label` TEXT DEFAULT NULL

---

## Component Architecture

### 1. NotificationRail (container)

Lives in TopBar left zone, replacing the page actions div.

**Collapsed state (default):**
- Horizontal row of pills, left-to-right, oldest first
- Each pill: 6px wide, 14px tall, rounded-full, `gap-[3px]`
- Standard: `bg-[rgba(255,255,255,0.20)]`
- Persistent: `bg-[#597794]`
- Count label after pills: `font-mono text-[10px] text-text-disabled ml-[6px]`
- Max ~15 pills visible before `+N` overflow (prevents rail from eating into right-side controls)
- Click anywhere on rail to expand
- If 0 notifications: empty, no placeholder

**Expanded state:**
- Pills animate into mini cards via Framer Motion `layout` + `AnimatePresence`
- Horizontal scroll with `snap-x snap-mandatory`, `scrollbar-hide`
- Collapse chevron (ChevronLeft) at far left, or click outside rail to collapse
- "View all" text button at far right of scroll → opens modal

**Transitions:**
- Collapse → Expand: pills scale + fade into cards, staggered 30ms per card, duration 250ms, `EASE_SMOOTH`
- Expand → Collapse: cards scale down + fade into pills, 200ms, `EASE_SMOOTH`
- New notification arrives: pill enters from right with `opacity: 0, scale: 0.8` → `opacity: 1, scale: 1`, 200ms
- Dismiss: card fades out `opacity: 0, x: -12`, 150ms, remaining cards slide left via `layout` animation

### 2. NotificationPill (collapsed indicator)

- `width: 6px`, `height: 14px`, `border-radius: 9999px`
- Color determined by `persistent` flag
- `layout` prop for smooth position transitions when neighbors dismiss
- Hover on entire rail: pills subtly brighten (`rgba(255,255,255,0.30)`)

### 3. NotificationMiniCard (expanded inline card)

- Fixed width: `180px`, constrained to header: `h-[36px]`
- Frosted glass surface (same tokens as all overlays)
- Border: `1px solid rgba(255,255,255,0.08)`
- Border-radius: `2px`
- Inner padding: `px-[8px] py-[4px]`
- Content layout (single row, vertically centered):
  - Title text: `font-mohave text-[12px] text-text-primary truncate`, flex-1
  - If `actionLabel`: text button, `font-kosugi text-[9px] uppercase tracking-wider text-[#597794] hover:text-text-primary`, shrink-0
  - If dismissible: X button, `w-[14px] h-[14px] text-text-disabled hover:text-text-secondary`, shrink-0
- Persistent cards: left border accent — `border-l-2 border-l-[#597794]`
- Dismissible cards: no left accent, shows X button
- `snap-start` for scroll snapping
- `layout` + `layoutId` for position animation on dismiss

### 4. NotificationModal (full expansion)

Triggered by: bell icon click OR "View all" button in expanded rail.

- Centered dialog overlay
- Backdrop: `rgba(0,0,0,0.5)` with `backdrop-blur(8px)`
- Modal surface: frosted glass, `max-w-[480px]`, `max-h-[70vh]`
- Border-radius: `4px`
- Border: `1px solid rgba(255,255,255,0.08)`

**Modal header:**
- Title: "Notifications" — `font-mohave text-body-lg text-text-primary font-medium`
- Right: "Dismiss all" text button — `font-kosugi text-[10px] uppercase text-text-disabled hover:text-text-secondary`
- Close X button

**Modal body:**
- Scrollable list, `overflow-y-auto scrollbar-hide`
- Grouped by: Today, Yesterday, Earlier — group labels in `font-kosugi text-[10px] uppercase tracking-widest text-text-tertiary`
- Full-size notification cards (see below)

**Entrance:** `opacity: 0, scale: 0.97, y: -8` → `opacity: 1, scale: 1, y: 0`, 300ms, `EASE_SMOOTH`
**Exit:** reverse, 200ms

### 5. NotificationCardFull (modal card)

- Full width within modal, `min-h-[64px]`, `py-[10px] px-[12px]`
- No background (sits on modal surface), separated by `1px` border-bottom `rgba(255,255,255,0.06)`
- Persistent: left accent border `2px #597794`
- Layout:
  - Row 1: Title `font-mohave text-body-sm text-text-primary` + timestamp `font-mono text-[10px] text-text-disabled ml-auto`
  - Row 2: Body `font-mohave text-[12px] text-text-secondary line-clamp-2`
  - Row 3 (if action): Action button `font-kosugi text-[10px] uppercase tracking-wider text-[#597794] hover:text-text-primary mt-[4px]`
- Dismiss: X button top-right, only on non-persistent
- Dismiss animation: `opacity: 0, height: 0, marginTop: 0, marginBottom: 0`, 200ms — remaining cards slide up via layout

---

## State Management

### NotificationRailStore (Zustand, non-persisted)

```typescript
interface NotificationRailState {
  railState: "collapsed" | "expanded";
  modalOpen: boolean;
  expand: () => void;
  collapse: () => void;
  openModal: () => void;
  closeModal: () => void;
}
```

### TanStack Query Hook

```typescript
function useNotifications() {
  // Fetches unread notifications for current user/company
  // Stale time: 30s, refetch on window focus
  // Returns: { data: AppNotification[], isLoading, refetch }
}
```

### Dismiss Flow

1. User clicks X on card → optimistic removal from query cache
2. Calls `NotificationService.markAsRead(id)` in background
3. On error: roll back (re-insert into cache), show error toast
4. Framer Motion `AnimatePresence` handles exit animation

---

## TopBar Layout Changes

**Before:**
```
[Page Actions (left)]                    [Search | Sync | Bell (right)]
```

**After:**
```
[Notification Rail (left)]               [Search | Sync | Bell (right)]
```

- Remove `usePageActionsStore` import and all page action rendering
- Replace left div with `<NotificationRail />`
- Bell button gets `onClick` → `openModal()`
- Bell gets unread count badge: small `6px` red dot (using `ops-error` / `#93321A`) positioned top-right when count > 0

---

## Animation Variants (added to motion.ts)

```typescript
// Notification pill enter/exit
export const notifPillVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6, width: 0 },
  visible: { opacity: 1, scale: 1, width: 6, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.6, width: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

// Mini card enter/exit (expanded rail)
export const notifCardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, x: -8 },
  visible: (i: number) => ({
    opacity: 1, scale: 1, x: 0,
    transition: { delay: i * 0.03, duration: 0.25, ease: EASE_SMOOTH },
  }),
  exit: { opacity: 0, x: -12, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

// Full card dismiss (modal)
export const notifCardFullExitVariants: Variants = {
  hidden: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0 },
  visible: { opacity: 1, height: "auto", transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

// Modal entrance
export const notifModalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: -8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.97, y: -8, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};
```

All animations use `EASE_SMOOTH` (`[0.22, 1, 0.36, 1]`). No spring/bounce per design system. Reduced-motion variants for all (opacity-only fallbacks).

---

## i18n Keys (en/es)

Added to `topbar.json`:
```json
{
  "notifications.viewAll": "View all",
  "notifications.dismissAll": "Dismiss all",
  "notifications.title": "Notifications",
  "notifications.empty": "No notifications",
  "notifications.today": "Today",
  "notifications.yesterday": "Yesterday",
  "notifications.earlier": "Earlier",
  "notifications.persistent": "Action required",
  "notifications.dismissed": "Dismissed"
}
```

---

## File Inventory

| Action | File |
|--------|------|
| Create | `src/components/layouts/notification-rail.tsx` |
| Create | `src/components/layouts/notification-pill.tsx` |
| Create | `src/components/layouts/notification-mini-card.tsx` |
| Create | `src/components/layouts/notification-modal.tsx` |
| Create | `src/components/layouts/notification-card-full.tsx` |
| Create | `src/stores/notification-rail-store.ts` |
| Create | `src/lib/hooks/use-notifications.ts` |
| Modify | `src/components/layouts/top-bar.tsx` — remove page actions, add rail + bell handler |
| Modify | `src/lib/api/services/notification-service.ts` — extend types + fetch logic |
| Modify | `src/lib/utils/motion.ts` — add notification animation variants |
| Modify | `src/i18n/dictionaries/en/topbar.json` — add notification keys |
| Modify | `src/i18n/dictionaries/es/topbar.json` — add notification keys |
| Migration | Add `persistent`, `action_url`, `action_label` columns to `notifications` table |

---

## Out of Scope (Built Later)

- Specific notification triggers (task completion, expense approval, etc.)
- Push notifications / service workers
- Supabase realtime subscriptions (polling is sufficient for now)
- Notification sound effects
- Per-notification-type icons or colors beyond persistent/standard
