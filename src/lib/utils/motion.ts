// ---------------------------------------------------------------------------
// Framer Motion constants for the dashboard widget system
// ---------------------------------------------------------------------------
import type { Variants, Easing } from "framer-motion";

export const EASE_SMOOTH: Easing = [0.22, 1, 0.36, 1];

export const SPRING_LAYOUT = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
};

export const STAGGER_GRID = { staggerChildren: 0.06 };

/** Container variant — staggers children on mount */
export const gridVariants: Variants = {
  hidden: {},
  visible: {
    transition: STAGGER_GRID,
  },
};

/** Per-widget enter/exit variants */
export const widgetVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: EASE_SMOOTH,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: {
      duration: 0.2,
      ease: EASE_SMOOTH,
    },
  },
};

/** Widget drag inactive state (siblings shrink/desaturate) */
export const widgetDragInactiveVariants: Variants = {
  idle: {
    scale: 1,
    opacity: 1,
    filter: "saturate(1)",
  },
  dragging: {
    scale: 0.96,
    opacity: 0.7,
    filter: "saturate(0.3)",
    transition: { duration: 0.2, ease: EASE_SMOOTH },
  },
};

/** Widget drop target highlight */
export const widgetDropTargetVariants: Variants = {
  idle: {
    scale: 1,
    opacity: 1,
  },
  active: {
    scale: 1,
    opacity: 1,
    transition: { duration: 0.15, ease: EASE_SMOOTH },
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
