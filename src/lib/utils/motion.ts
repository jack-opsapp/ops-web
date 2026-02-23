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
