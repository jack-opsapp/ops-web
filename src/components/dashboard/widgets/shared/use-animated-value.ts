"use client";

import { useState, useEffect } from "react";
import { cubicBezier, useReducedMotion } from "framer-motion";

const easeFn = cubicBezier(0.22, 1, 0.36, 1);

export function useAnimatedValue(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      // Honor prefers-reduced-motion: snap directly to the target.
      setValue(target);
      return;
    }

    let start: number | null = null;
    let raf: number;

    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = easeFn(progress);
      setValue(Math.round(eased * target));
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      }
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);

  return value;
}
