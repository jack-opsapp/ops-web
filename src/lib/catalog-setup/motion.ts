// Motion foundation for the catalog-setup live-building wizard.
//
// Three downstream surfaces (the card grid, the module rail, the running-totals
// header) read their motion from this single module so the wizard's choreography
// is defined once and never drifts between surfaces. Every variant here is mapped
// to a deliberate emotional beat (animation-architect) and a single token-traced
// motion language (military tactical minimalist — EASE_SMOOTH, no spring, no
// bounce):
//
//   cardAccept  → ACHIEVEMENT  — a clean "stamp": the state dot fills olive and
//                                the card border pulses once (200–300ms). A stamp,
//                                not a parade. (animation-architect §3 Achievement)
//   cardEnter   → ENTRY        — a new proposal arrives with precision: y:+8 →
//                                0 + opacity, crisp ease-out, 50ms stagger-ready.
//   railAdvance → TRANSITION   — the rail's active-step track grows (2px bar,
//                                250ms) as the operator moves between modules.
//   useCountUp  → ACHIEVEMENT  — running totals tick up over 800ms on a quadratic
//                                ease-out (deliberate deceleration, no spring ring).
//
// REDUCED MOTION: every variant ships a paired opacity-only fallback (150ms) that
// serves the SAME beat through fade alone — never a disabled no-op
// (animation-architect §4, root CLAUDE.md motion law). Resolve via
// `useCatalogSetupMotion()` so call sites never re-implement the branch.
//
// EASE_SMOOTH is the canonical OPS curve and is REUSED from
// `src/lib/utils/motion.ts` — never redefine cubic-bezier(0.22,1,0.36,1) here.

"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion, type Variants } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// ── Durations (seconds) ──────────────────────────────────────────────────────
// Named so downstream timelines and tests share one source of truth.
/** ACHIEVEMENT stamp — quick, decisive (animation-architect: 200–300ms). */
export const CARD_ACCEPT_DURATION = 0.26;
/** ENTRY arrival — fast, crisp. */
export const CARD_ENTER_DURATION = 0.28;
/** TRANSITION rail track growth. */
export const RAIL_ADVANCE_DURATION = 0.25;
/** ENTRY stagger step between sequential proposals. */
export const CARD_STAGGER = 0.05;
/** Reduced-motion fallback — opacity-only, uniform 150ms for every beat. */
export const REDUCED_DURATION = 0.15;
/** Count-up run length for running totals (ms — consumed by rAF, not Framer). */
export const COUNT_UP_DURATION_MS = 800;

// ── CARD ACCEPT — Achievement "stamp" ────────────────────────────────────────
// The card does not move. Acceptance is communicated by a single border-color
// pulse (hairline → olive line → settle on olive) timed like a stamp pressing
// down and lifting. `borderColor` keyframes use the earth-tone olive tokens
// (positive/accepted) so the moment reads as "locked in", never as the steel
// accent (reserved for the one primary CTA).
export const cardAcceptVariants: Variants = {
  idle: {
    borderColor: "rgba(255,255,255,0.10)",
  },
  accepted: {
    // Pulse: brighten to a solid olive line at the peak, then settle to the
    // resting accepted line. The peak is the "press"; the settle is the "lift".
    borderColor: [
      "rgba(255,255,255,0.10)",
      "rgba(157,181,130,0.85)",
      "rgba(157,181,130,0.45)",
    ],
    transition: {
      duration: CARD_ACCEPT_DURATION,
      ease: EASE_SMOOTH,
      times: [0, 0.55, 1],
    },
  },
};

// The state dot fills from hollow to solid olive at the stamp's peak — the
// micro-element that carries the "accepted" meaning at a glance.
export const cardAcceptDotVariants: Variants = {
  idle: { scale: 1, backgroundColor: "rgba(255,255,255,0.10)" },
  accepted: {
    scale: [1, 1.18, 1],
    backgroundColor: "#9DB582", // olive — accepted/positive token
    transition: {
      duration: CARD_ACCEPT_DURATION,
      ease: EASE_SMOOTH,
      times: [0, 0.5, 1],
    },
  },
};

export const cardAcceptVariantsReduced: Variants = {
  idle: { borderColor: "rgba(255,255,255,0.10)" },
  accepted: {
    borderColor: "rgba(157,181,130,0.45)",
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
};

export const cardAcceptDotVariantsReduced: Variants = {
  idle: { backgroundColor: "rgba(255,255,255,0.10)" },
  accepted: {
    backgroundColor: "#9DB582",
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
};

// ── CARD ENTER — Entry beat, stagger-ready ───────────────────────────────────
// A new staged card arrives from 8px below with a fade. `custom` is the card's
// index in its batch so the consumer can drive a 50ms cascade:
//   <motion.li custom={i} variants={cardEnterVariants} initial="hidden" animate="visible" />
// The container should also carry `cardEnterContainerVariants` for orchestration.
export const cardEnterVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: typeof i === "number" ? i * CARD_STAGGER : 0,
      duration: CARD_ENTER_DURATION,
      ease: EASE_SMOOTH,
    },
  }),
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
};

/** Parent orchestrator — staggers children when used with variant propagation. */
export const cardEnterContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: CARD_STAGGER } },
};

export const cardEnterVariantsReduced: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
  exit: {
    opacity: 0,
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
};

export const cardEnterContainerVariantsReduced: Variants = {
  hidden: {},
  // No per-child stagger under reduced motion — the cascade itself is motion.
  visible: { transition: { staggerChildren: 0 } },
};

// ── RAIL ADVANCE — Transition beat ───────────────────────────────────────────
// The active-step indicator is a 2px track (bar radius) that grows from zero to
// full width as the rail moves to a step. `scaleX` from 0→1 with a left
// transform-origin keeps it GPU-only (no layout). Color is intentionally NOT the
// steel accent — the rail uses a neutral hairline-strength fill so the accent
// stays exclusive to the single primary CTA.
export const railAdvanceVariants: Variants = {
  inactive: { scaleX: 0, opacity: 0 },
  active: {
    scaleX: 1,
    opacity: 1,
    transition: { duration: RAIL_ADVANCE_DURATION, ease: EASE_SMOOTH },
  },
};

export const railAdvanceVariantsReduced: Variants = {
  inactive: { scaleX: 1, opacity: 0 },
  active: {
    scaleX: 1,
    opacity: 1,
    transition: { duration: REDUCED_DURATION, ease: EASE_SMOOTH },
  },
};

// ── COUNT-UP — running totals (Achievement, deliberate) ──────────────────────
/** Quadratic ease-out: 1 - (1 - t)^2. Deliberate deceleration, no spring ring. */
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export interface UseCountUpOptions {
  /** Run length in ms. Defaults to the 800ms running-totals beat. */
  durationMs?: number;
  /** Honor prefers-reduced-motion: snap instantly to `value` (no tween). */
  reduced?: boolean;
}

/**
 * Animate a running total toward `value` over `durationMs` on a quadratic
 * ease-out, driven by requestAnimationFrame (never setTimeout — frame pacing
 * law). Returns the current interpolated number, rounded to an integer so the
 * tabular-mono readout never flickers fractional digits.
 *
 * Re-targets mid-flight: if `value` changes during a run, the tween restarts
 * from the currently-displayed number toward the new target. Under reduced
 * motion (or `reduced: true`) it snaps immediately — same end state, no motion.
 *
 * Cleanup: cancels its rAF on unmount and on every re-target, so no orphaned
 * loops survive (animation-architect §6 — no fire-and-forget).
 */
export function useCountUp(
  value: number,
  options: UseCountUpOptions = {},
): number {
  const systemReduced = useReducedMotion();
  const reduced = options.reduced ?? !!systemReduced;
  const durationMs = options.durationMs ?? COUNT_UP_DURATION_MS;

  const [display, setDisplay] = useState(value);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  // Track the latest rendered value across frames without re-subscribing.
  const displayRef = useRef(value);
  displayRef.current = display;

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }

    // rAF is paused in hidden/throttled tabs, which would otherwise freeze the
    // tween on a stale number. Snap to the target when the document is hidden —
    // same end state, no orphaned loop; it animates normally while visible, so a
    // returning operator always sees the correct count, never a frozen one.
    if (typeof document !== "undefined" && document.hidden) {
      setDisplay(value);
      return;
    }

    // Re-target: tween from whatever is currently on screen → new value.
    fromRef.current = displayRef.current;
    startRef.current = null;
    const from = fromRef.current;
    const delta = value - from;

    if (delta === 0) {
      setDisplay(value);
      return;
    }

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutQuad(t);
      const next = from + delta * eased;
      setDisplay(t >= 1 ? value : Math.round(next));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [value, durationMs, reduced]);

  return Math.round(display);
}

/**
 * Imperative count-up for non-React call sites (e.g. canvas readouts). Invokes
 * `onUpdate` with each interpolated integer over `durationMs` on the same
 * quadratic ease-out and resolves when complete. Returns a `cancel()` to abort
 * (cancels the rAF — no orphaned loop). `reduced` snaps to `to` in one call.
 */
export function countUp(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  options: { durationMs?: number; reduced?: boolean; onComplete?: () => void } = {},
): { cancel: () => void } {
  const durationMs = options.durationMs ?? COUNT_UP_DURATION_MS;

  if (options.reduced || from === to) {
    onUpdate(to);
    options.onComplete?.();
    return { cancel: () => {} };
  }

  let frame: number | null = null;
  let start: number | null = null;
  const delta = to - from;

  const tick = (now: number) => {
    if (start === null) start = now;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const eased = easeOutQuad(t);
    onUpdate(t >= 1 ? to : Math.round(from + delta * eased));
    if (t < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = null;
      options.onComplete?.();
    }
  };

  frame = requestAnimationFrame(tick);

  return {
    cancel: () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
    },
  };
}

// ── Resolver — one branch, every surface ─────────────────────────────────────
export interface CatalogSetupMotion {
  reduced: boolean;
  cardAccept: Variants;
  cardAcceptDot: Variants;
  cardEnter: Variants;
  cardEnterContainer: Variants;
  railAdvance: Variants;
}

/**
 * Returns the catalog-setup motion variants matching the operator's
 * `prefers-reduced-motion`, so the rail, the grid, and the header all read
 * motion from one place without re-implementing the reduced-motion branch.
 *
 * Example:
 *   const m = useCatalogSetupMotion();
 *   <motion.li variants={m.cardEnter} custom={i} initial="hidden" animate="visible" />
 */
export function useCatalogSetupMotion(): CatalogSetupMotion {
  const reduced = !!useReducedMotion();
  return {
    reduced,
    cardAccept: reduced ? cardAcceptVariantsReduced : cardAcceptVariants,
    cardAcceptDot: reduced ? cardAcceptDotVariantsReduced : cardAcceptDotVariants,
    cardEnter: reduced ? cardEnterVariantsReduced : cardEnterVariants,
    cardEnterContainer: reduced
      ? cardEnterContainerVariantsReduced
      : cardEnterContainerVariants,
    railAdvance: reduced ? railAdvanceVariantsReduced : railAdvanceVariants,
  };
}
