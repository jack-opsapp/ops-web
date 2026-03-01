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

export const EDIT_MODE_GAP = 12;
export const NORMAL_GAP = 8;

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
