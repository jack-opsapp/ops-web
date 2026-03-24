"use client";

import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

// ─── OPS Logo SVG Paths ─────────────────────────────────────────────────────
// Recreates the concentric-stroke "P" logo shape.
// Each path: rounded rect open at bottom-left, inner bowl curving up.
// viewBox 0 0 100 100, 4 concentric strokes from outer to inner.

const LOGO_PATHS = [
  // Outermost stroke
  "M 12 88 L 12 22 Q 12 8 26 8 L 78 8 Q 92 8 92 22 L 92 58 Q 92 72 78 72 L 42 72 Q 28 72 28 58 L 28 88",
  // Second stroke
  "M 20 88 L 20 26 Q 20 16 30 16 L 74 16 Q 84 16 84 26 L 84 54 Q 84 64 74 64 L 42 64 Q 36 64 36 58 L 36 88",
  // Third stroke
  "M 28 88 L 28 30 Q 28 24 34 24 L 70 24 Q 76 24 76 30 L 76 50 Q 76 56 70 56 L 50 56 Q 44 56 44 50 L 44 88",
  // Innermost stroke
  "M 36 88 L 36 34 Q 36 32 38 32 L 66 32 Q 68 32 68 34 L 68 46 Q 68 48 66 48 L 56 48 Q 52 48 52 44 L 52 88",
];

// ─── Timing (brand tokens) ──────────────────────────────────────────────────
// Each stroke draws in 600ms with sharp ease-out.
// 100ms stagger between strokes. Total draw: ~900ms.
// Then ambient accent pulse loops every 2.4s.
const STROKE_DURATION = 0.6; // seconds
const STAGGER = 0.1; // seconds between each stroke start

// ─── Component ──────────────────────────────────────────────────────────────

interface OpsLoadingScreenProps {
  /** Optional size override (default 64px) */
  size?: number;
  /** Show "LOADING" text below logo */
  showText?: boolean;
  /** Additional className for container */
  className?: string;
}

export function OpsLoadingScreen({
  size = 64,
  showText = true,
  className,
}: OpsLoadingScreenProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        className="ops-logo-loading"
      >
        {LOGO_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
              !prefersReducedMotion && "ops-logo-stroke"
            )}
            style={
              !prefersReducedMotion
                ? {
                    // Each path's total length (approximate — generous overshoot is fine)
                    strokeDasharray: 300,
                    strokeDashoffset: 300,
                    animationDelay: `${i * STAGGER}s`,
                    animationDuration: `${STROKE_DURATION}s`,
                  }
                : undefined
            }
          />
        ))}

        {/* Accent pulse overlay — traces the outermost path after draw completes */}
        {!prefersReducedMotion && (
          <path
            d={LOGO_PATHS[0]}
            stroke="#597794"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="ops-logo-pulse"
            style={{
              strokeDasharray: 300,
              strokeDashoffset: 300,
            }}
          />
        )}
      </svg>

      {showText && (
        <span
          className={cn(
            "font-kosugi text-[10px] uppercase tracking-[0.3em] text-text-disabled",
            !prefersReducedMotion && "ops-loading-text"
          )}
        >
          Loading
        </span>
      )}

      {/* CSS Animations — scoped to this component */}
      <style jsx>{`
        /* Stroke draw: offset → 0 with sharp ease-out */
        .ops-logo-stroke {
          animation-name: ops-draw;
          animation-fill-mode: forwards;
          animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes ops-draw {
          to {
            stroke-dashoffset: 0;
          }
        }

        /* Accent pulse — starts after all strokes drawn (~1s), loops */
        .ops-logo-pulse {
          opacity: 0;
          animation:
            ops-pulse-entry 0.3s cubic-bezier(0.16, 1, 0.3, 1) 1s forwards,
            ops-pulse-trace 2.4s cubic-bezier(0.22, 1, 0.36, 1) 1s infinite;
        }

        @keyframes ops-pulse-entry {
          to {
            opacity: 1;
          }
        }

        @keyframes ops-pulse-trace {
          0% {
            stroke-dashoffset: 300;
            opacity: 0.6;
          }
          40% {
            stroke-dashoffset: 0;
            opacity: 0.4;
          }
          60% {
            stroke-dashoffset: 0;
            opacity: 0.2;
          }
          100% {
            stroke-dashoffset: -300;
            opacity: 0;
          }
        }

        /* Text fade-in after logo draws */
        .ops-loading-text {
          opacity: 0;
          animation: ops-text-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.8s forwards;
        }

        @keyframes ops-text-in {
          to {
            opacity: 1;
          }
        }

        /* Reduced motion: instant display, no animation */
        @media (prefers-reduced-motion: reduce) {
          .ops-logo-stroke {
            stroke-dashoffset: 0 !important;
            animation: none !important;
          }
          .ops-logo-pulse {
            animation: none !important;
            opacity: 0 !important;
          }
          .ops-loading-text {
            opacity: 1 !important;
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
