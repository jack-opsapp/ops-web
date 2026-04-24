"use client";

import { useEffect } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Count-up number primitive. cubicOut easing produces the most natural
 * tick-up feel per the data-visualization skill. Reduced motion falls back
 * to the final value with no animation.
 */
export function AnimatedNumber({
  value,
  duration = 0.8,
  format,
  className,
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(prefersReducedMotion ? value : 0);
  const rendered = useTransform(motionValue, (v) =>
    format ? format(v) : Math.round(v).toLocaleString()
  );

  useEffect(() => {
    if (prefersReducedMotion) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.33, 1, 0.68, 1], // cubicOut
    });
    return () => controls.stop();
  }, [value, duration, motionValue, prefersReducedMotion]);

  return (
    <motion.span
      className={className}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {rendered}
    </motion.span>
  );
}
