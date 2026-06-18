"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

/**
 * Hero-number count-up — the single shared count-up across the instrument
 * strips (Books `// LEDGER`, Catalog `// SUPPLY`).
 *
 * Runs for `duration` ms (800 by default) evaluated on the one OPS easing curve
 * EASE_SMOOTH = `cubic-bezier(0.22, 1, 0.36, 1)` (DESIGN.md §8), referenced from
 * the single source `@/lib/utils/motion`, via framer-motion's `animate()`.
 * framer evaluates the real cubic-bezier on a rAF-driven loop and cleans up via
 * `controls.stop()` — never hand-roll a rAF easing approximation (an
 * ease-out-quad `1 - (1 - p)²` is NOT this curve).
 *
 * `enabled = false` (reduced motion, or no data yet) snaps straight to the
 * final value. For a pure number reveal that is the correct reduced-motion
 * alternative: the figure still arrives, only the materialization motion drops.
 */
export function useCountUp(target: number, enabled: boolean, duration = 800): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const prev = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const from = prev.current;
    prev.current = target;
    const controls = animate(from, target, {
      duration: duration / 1000,
      ease: EASE_SMOOTH,
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [target, enabled, duration]);

  return value;
}
