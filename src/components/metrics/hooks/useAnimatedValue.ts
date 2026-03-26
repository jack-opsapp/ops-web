"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric value from the previous value to the new target using cubicOut easing.
 * Respects prefers-reduced-motion by returning target immediately.
 */
export function useAnimatedValue(target: number, duration = 800): number {
  const [current, setCurrent] = useState(target);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const fromRef = useRef<number>(target);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setCurrent(target);
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    startRef.current = performance.now();

    function tick(now: number) {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(from + (target - from) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setCurrent(target);
        fromRef.current = target;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return current;
}
