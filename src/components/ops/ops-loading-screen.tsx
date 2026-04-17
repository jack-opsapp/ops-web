"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

// ─── Timing ─────────────────────────────────────────────────────────────────
// Per-bracket entry: 450ms. 180ms stagger between top and bottom.
// After entry completes, mark pulses opacity 100% → 72% → 100% on a 2.4s loop.
const ENTRY_DURATION = 0.45;
const STAGGER = 0.18;
const PULSE_DURATION = 2.4;
const EASE = [0.22, 1, 0.36, 1] as const; // EASE_SMOOTH

interface OpsLoadingScreenProps {
  /** Width of mark in px (height derives from natural aspect). Default 72. */
  size?: number;
  /** Show "LOADING" caption under the mark. Default true. */
  showText?: boolean;
  className?: string;
}

export function OpsLoadingScreen({
  size = 72,
  showText = true,
  className,
}: OpsLoadingScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  const topEntry = prefersReducedMotion
    ? { opacity: 1, y: 0 }
    : {
        opacity: 1,
        y: 0,
        transition: { duration: ENTRY_DURATION, ease: EASE, delay: 0 },
      };

  const bottomEntry = prefersReducedMotion
    ? { opacity: 1, y: 0 }
    : {
        opacity: 1,
        y: 0,
        transition: { duration: ENTRY_DURATION, ease: EASE, delay: STAGGER },
      };

  const pulseAnim = prefersReducedMotion
    ? undefined
    : {
        opacity: [1, 0.72, 1],
        transition: {
          duration: PULSE_DURATION,
          ease: EASE,
          repeat: Infinity,
          delay: ENTRY_DURATION + STAGGER + 0.2,
        },
      };

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-text",
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <motion.svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="775 477 850 1440"
        width={size}
        height={(size * 1440) / 850}
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
        animate={pulseAnim}
      >
        {/* Top bracket */}
        <motion.path
          d="M1624.48,1228.51v-563.59s-375.6-187.86-375.6-187.86h0l-281.73,140.87.16.08,469.34,234.72v469.62s.07.04.07.04l187.78-93.89Z"
          initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
          animate={topEntry}
        />
        {/* Bottom bracket */}
        <motion.path
          d="M1432.95,1775.53l.03-.02v-.08l-469.49-234.8-.13-469.56-187.37,93.85-.15.08-.33,563.39.15.08,375.54,187.82.1.06,281.64-140.81Z"
          initial={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          animate={bottomEntry}
        />
      </motion.svg>

      {showText && (
        <motion.span
          className="font-mono text-[11px] uppercase tracking-[0.3em] text-text-mute"
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.3,
            ease: EASE,
            delay: prefersReducedMotion ? 0 : ENTRY_DURATION + STAGGER,
          }}
        >
          Loading
        </motion.span>
      )}
    </div>
  );
}
