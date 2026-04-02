import type { CSSProperties } from "react";

// ── Easing ───────────────────────────────────────────────────────────
export const WIDGET_EASE = [0.22, 1, 0.36, 1] as const;
export const WIDGET_EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

// ── Durations (ms) ──────────────────────────────────────────────────
export const WIDGET_DURATION_FAST = 150;
export const WIDGET_DURATION_NORMAL = 300;
export const WIDGET_DURATION_SLOW = 500;
export const WIDGET_STAGGER_DELAY = 50;
export const WIDGET_FLIP_DURATION = 350;
export const WIDGET_COLLAPSE_DURATION = 300;

// ── Style Helpers ────────────────────────────────────────────────────

/** Staggered entrance for list items: opacity + translateY(4px) */
export function widgetLineItemStyle(
  index: number,
  isVisible: boolean,
  reducedMotion: boolean | null
): CSSProperties {
  // SSR / null state — render visible immediately, no animation
  if (reducedMotion === null) return { opacity: 1 };

  if (reducedMotion) {
    return {
      opacity: isVisible ? 1 : 0,
      transition: `opacity ${WIDGET_DURATION_FAST}ms ease`,
    };
  }

  const delay = index * WIDGET_STAGGER_DELAY;
  return {
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? "translateY(0)" : "translateY(4px)",
    transition: `opacity ${WIDGET_DURATION_NORMAL}ms ${WIDGET_EASE_CSS} ${delay}ms, transform ${WIDGET_DURATION_NORMAL}ms ${WIDGET_EASE_CSS} ${delay}ms`,
  };
}

/** Card flip transform — rotateY with perspective */
export function widgetFlipStyle(
  isFlipped: boolean,
  reducedMotion: boolean | null
): CSSProperties {
  if (reducedMotion === null) return {};

  if (reducedMotion) {
    return {
      opacity: isFlipped ? 0 : 1,
      transition: `opacity ${WIDGET_DURATION_FAST}ms ease`,
    };
  }

  return {
    transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
    transition: `transform ${WIDGET_FLIP_DURATION}ms ${WIDGET_EASE_CSS}`,
  };
}
