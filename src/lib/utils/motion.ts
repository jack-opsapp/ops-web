// ---------------------------------------------------------------------------
// Framer Motion constants for the dashboard widget system
// ---------------------------------------------------------------------------
import type { Variants, Easing } from "framer-motion";

export const EASE_SMOOTH: Easing = [0.22, 1, 0.36, 1];

// ── Edit-mode spring physics ──
export const SPRING_REORDER = { type: "spring" as const, stiffness: 500, damping: 35, mass: 0.8 };
export const SPRING_PLACEHOLDER = { type: "spring" as const, stiffness: 300, damping: 28 };

// ── Drag grabbed feedback ──
export const DRAG_GRABBED_SCALE = 1.04;
export const DRAG_GRABBED_SHADOW = "0 12px 40px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)";

// ── Edit mode visual constants ──
export const EDIT_MODE_SCALE = 0.97;
export const EDIT_MODE_OVERLAY_OPACITY = 0.2;

export const DRAG_SIBLING_SCALE = 0.95;
export const DRAG_SIBLING_SATURATION = 0.35;
export const DRAG_SIBLING_OPACITY = 0.7;

export const STAGGER_GRID = { staggerChildren: 0.06 };

/** Container variant — staggers children on mount */
export const gridVariants: Variants = {
  hidden: {},
  visible: {
    transition: STAGGER_GRID,
  },
};

/** Widget tray — slide up from bottom */
export const trayVariants: Variants = {
  hidden: { y: "100%", opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.35, ease: EASE_SMOOTH } },
  exit: { y: "100%", opacity: 0, transition: { duration: 0.25, ease: EASE_SMOOTH } },
};

/** Staggered entrance for tray cards */
export const trayCardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 12 },
  visible: (i: number) => ({
    opacity: 1, scale: 1, y: 0,
    transition: { delay: i * 0.03, duration: 0.25, ease: EASE_SMOOTH },
  }),
};

/** Dark overlay that fades over widget content during edit mode */
export const editModeOverlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: EDIT_MODE_OVERLAY_OPACITY, transition: { duration: 0.25, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

/** Placeholder cell entrance/exit — stagger index passed as custom prop */
export const placeholderCellVariants: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { ...SPRING_PLACEHOLDER, delay: i * 0.04 },
  }),
  exit: { opacity: 0, scale: 0.85, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

// ── FAB menu spring physics ──
export const SPRING_FAB = { type: "spring" as const, stiffness: 200, damping: 15 };

/** FAB overlay — right-edge gradient fade */
export const fabOverlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** FAB menu item — slides in from right, staggered bottom-up */
export const fabItemVariants: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { ...SPRING_FAB, delay: i * 0.06 },
  }),
  exit: (i: number) => ({
    opacity: 0,
    x: 40,
    transition: { ...SPRING_FAB, delay: i * 0.04 },
  }),
};

/** FAB edit mode — minus badge scale-in */
export const fabBadgeVariants: Variants = {
  hidden: { opacity: 0, scale: 0 },
  visible: { opacity: 1, scale: 1, transition: SPRING_FAB },
  exit: { opacity: 0, scale: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** FAB reduced-motion fallbacks — opacity only, no transforms */
export const fabItemVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { duration: 0.2, delay: i * 0.03 },
  }),
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const fabBadgeVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ── Action prompt toast — slide down from top ──
export const actionPromptVariants: Variants = {
  hidden: { opacity: 0, y: -20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: EASE_SMOOTH },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.97,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

export const actionPromptVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ── Calendar animations ──

/** Calendar drag spring physics */
export const SPRING_CALENDAR_DRAG = { type: "spring" as const, stiffness: 400, damping: 30 };

/** Calendar view switching — vertical fade */
export const calendarViewVariants: Variants = {
  enter: { opacity: 0, y: 8 },
  center: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

/** Calendar view switching — reduced motion (opacity only) */
export const calendarViewVariantsReduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Calendar event appear — scale + fade */
export const calendarEventVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.15, ease: EASE_SMOOTH },
  },
};

/** Calendar event appear — reduced motion */
export const calendarEventVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.1 } },
};

// ── Lockout overlay animations ──

/** Lockout backdrop — full-screen frosted overlay fade */
export const lockoutBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.3, ease: EASE_SMOOTH } },
};

/** Lockout card — rises into view with slight scale */
export const lockoutCardVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: EASE_SMOOTH, delay: 0.1 },
  },
  exit: {
    opacity: 0,
    y: 20,
    scale: 0.97,
    transition: { duration: 0.3, ease: EASE_SMOOTH },
  },
};

/** Lockout reduced motion — opacity only, no transforms */
export const lockoutBackdropVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const lockoutCardVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, delay: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ── Pipeline card animations ──

/** Card content stagger (expanded state reveal) */
export const pipelineCardContentVariants: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.05, duration: 0.2, ease: EASE_SMOOTH },
  }),
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** Card slide-out (archive / advance swipe) */
export const pipelineCardSlideVariants: Variants = {
  center: { x: 0, opacity: 1 },
  exitRight: { x: "100%", opacity: 0, transition: { duration: 0.25, ease: EASE_SMOOTH } },
  exitLeft: { x: "-100%", opacity: 0, transition: { duration: 0.25, ease: EASE_SMOOTH } },
};

/** Mobile stage tab content transition */
export const pipelineTabVariants: Variants = {
  enter: { opacity: 0, x: 20 },
  center: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, x: -20, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

/** Pipeline card column stagger on initial mount */
export const pipelineColumnStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.03 } },
};

export const pipelineCardEntryVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

// Reduced motion variants
export const pipelineColumnStaggerReduced: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
};

export const pipelineCardContentVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.02, duration: 0.15 },
  }),
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

export const pipelineCardSlideVariantsReduced: Variants = {
  center: { opacity: 1 },
  exitRight: { opacity: 0, transition: { duration: 0.15 } },
  exitLeft: { opacity: 0, transition: { duration: 0.15 } },
};

export const pipelineTabVariantsReduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const pipelineCardEntryVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

// ── Spatial canvas animations ──

/** Card hover metrics — float in below card */
export const spatialHoverMetricsVariants: Variants = {
  hidden: { opacity: 0, y: -4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.15, ease: EASE_SMOOTH } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: EASE_SMOOTH } },
};

export const spatialHoverMetricsVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Archive tray — slide in from right */
export const spatialArchiveTrayVariants: Variants = {
  hidden: { x: 280 },
  visible: { x: 0, transition: { duration: 0.25, ease: EASE_SMOOTH } },
  exit: { x: 280, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

export const spatialArchiveTrayVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Context menu — scale in from click point */
export const spatialContextMenuVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.12, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.95, y: -4, transition: { duration: 0.08, ease: EASE_SMOOTH } },
};

export const spatialContextMenuVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.1 } },
  exit: { opacity: 0, transition: { duration: 0.08 } },
};

/** Floating toolbar — fade in */
export const spatialToolbarVariants: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

export const spatialToolbarVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

// ── Invite / Assign-role seat banner ──

/** Seat banner entry — drops in from above the modal content.
 *  Entry beat: sharp, decisive arrival. No overshoot. Lands and stops. */
export const fadeSlideDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: EASE_SMOOTH },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

/** Reduced-motion fallback — opacity only */
export const fadeSlideDownReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ── Notifications drawer (2026-04-23 redesign) ──

/** Drawer slide-in from the right edge */
export const drawerVariants: Variants = {
  hidden: { x: 360, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.26, ease: EASE_SMOOTH } },
  exit: { x: 360, opacity: 0, transition: { duration: 0.22, ease: EASE_SMOOTH } },
};

/** Drawer reduced-motion fallback — opacity only */
export const drawerVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Row mount animation — slight slide from left */
export const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_SMOOTH } },
  exit: { opacity: 0, x: -12, transition: { duration: 0.15, ease: EASE_SMOOTH } },
};

/** Row reduced-motion fallback */
export const rowVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Filter chip mount/unmount animation */
export const chipVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.15, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.12, ease: EASE_SMOOTH } },
};

/** Filter chip reduced-motion fallback */
export const chipVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

// ── Quick Actions drawer (2026-04-25 — replaces bottom-right FAB) ──

/** Quick Actions drawer panel slide-in from the right (308px) */
export const quickActionsDrawerVariants: Variants = {
  hidden: { x: 308, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { duration: 0.26, ease: EASE_SMOOTH } },
  exit: { x: 308, opacity: 0, transition: { duration: 0.22, ease: EASE_SMOOTH } },
};

/** Quick Actions drawer reduced-motion fallback */
export const quickActionsDrawerVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Quick Actions row stagger entry — 30ms per item, 200ms duration */
export const quickActionsRowVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.03, duration: 0.2, ease: EASE_SMOOTH },
  }),
};

/** Quick Actions row reduced-motion fallback */
export const quickActionsRowVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.015, duration: 0.15 },
  }),
};

// ── Email Campaigns admin (PR 3 — 2026-04-27) ──

/** Campaign list row stagger — 60ms cascade, 320ms duration */
export const campaignRowVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.32, ease: EASE_SMOOTH },
  }),
  exit: { opacity: 0, y: -6, transition: { duration: 0.2, ease: EASE_SMOOTH } },
};

export const campaignRowVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { delay: i * 0.02, duration: 0.15 },
  }),
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

/** Status pill scale-in on mount or status flip */
export const statusPillVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.25, ease: EASE_SMOOTH } },
};

export const statusPillVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

/**
 * Campaign progress bar segment fill. Consumers pass `progress` (0-1) via
 * the `custom` prop and animate `width` directly — pathLength was the
 * original spec but progress bars on `<motion.div>` use width % so a 2px
 * tall rule still feels material.
 */
export const progressBarVariants: Variants = {
  hidden: { width: 0 },
  visible: (progress: number) => ({
    width: `${Math.max(0, Math.min(progress, 1)) * 100}%`,
    transition: { duration: 0.6, ease: EASE_SMOOTH },
  }),
};

export const progressBarVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

/** Counter cell entrance — small lift on every value change so the eye trusts the number */
export const counterVariants: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_SMOOTH } },
};

export const counterVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
};

// ── PR 4 — Email killswitches ──
// Switch toggle, sticky pause banner, and confirmation modal.
// All consumers must respect useReducedMotion() — pass `undefined` variants
// when reduced is true so framer-motion skips the transition.

export const switchToggleVariants: Variants = {
  off: { x: 0, transition: { duration: 0.22, ease: EASE_SMOOTH } },
  on: { x: 18, transition: { duration: 0.22, ease: EASE_SMOOTH } },
};

export const activePauseBannerVariants: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_SMOOTH } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: EASE_SMOOTH } },
};

export const confirmationModalVariants: Variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.24, ease: EASE_SMOOTH } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: EASE_SMOOTH } },
};

// ---------------------------------------------------------------------------
// Campaign analytics (PR 6) — metric grid, Sankey funnel, bounce chart
// ---------------------------------------------------------------------------

/** 8-card metric grid — 60ms stagger lifts each card in sequence. */
export const campaignMetricGridVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.32, ease: EASE_SMOOTH, delay: i * 0.06 },
  }),
};

/** Sankey link draw — `pathLength` 0→1 with 80ms stagger per link. */
export const sankeyLinkVariants: Variants = {
  initial: { pathLength: 0, opacity: 0.2 },
  animate: (i: number) => ({
    pathLength: 1,
    opacity: 0.85,
    transition: { duration: 0.42, ease: EASE_SMOOTH, delay: i * 0.08 },
  }),
};

/** Sankey node entrance — quiet pop after links anchor. */
export const sankeyNodeVariants: Variants = {
  initial: { opacity: 0, scale: 0.94 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.28, ease: EASE_SMOOTH },
  },
};

/** Single-value count entrance — used for animated number cells. */
export const animatedCountVariants: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_SMOOTH } },
};
