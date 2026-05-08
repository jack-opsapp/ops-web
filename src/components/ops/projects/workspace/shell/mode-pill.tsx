"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

// `ModePill` — VIEWING / EDITING / CREATING badge in the workspace title
// bar. Encodes the workspace's emotional state at a glance:
//
//   VIEWING  — neutral chrome (workspace at rest, no commit pending)
//   EDITING  — tan tint (warning tone — there is unsaved change in
//              flight) + 1.6s opacity pulse drawing the eye
//   CREATING — accent tint (the workspace is in a generative state) +
//              identical pulse cadence
//
// Pulse spec: opacity 1 → 0.45 → 1, 1.6s ease-in-out, infinite. Driven
// by Framer Motion `animate` + `transition`, gated by `useReducedMotion`
// per WCAG 2.3.3 — vestibular users get the steady tinted pill instead.
//
// `data-pulsing` is exposed so tests + downstream debugging tooling can
// assert pulse state without measuring rAF frames.

export type WorkspaceMode = "viewing" | "editing" | "creating";

const PILL_SURFACE: Record<WorkspaceMode, string> = {
  viewing: cn(
    "bg-[rgba(255,255,255,0.05)] text-text-2",
    "border border-[rgba(255,255,255,0.06)]",
  ),
  editing: cn(
    "bg-[var(--tan-soft)] text-[var(--tan)]",
    "border border-[var(--tan-line)]",
  ),
  creating: cn(
    "bg-[var(--ops-accent-soft)] text-ops-accent",
    "border border-[var(--ops-accent-line)]",
  ),
};

const DOT_TONE: Record<WorkspaceMode, string> = {
  viewing: "bg-text-3",
  editing: "bg-[var(--tan)]",
  creating: "bg-ops-accent",
};

const MODE_LABEL: Record<WorkspaceMode, string> = {
  viewing: "VIEWING",
  editing: "EDITING",
  creating: "CREATING",
};

// 1.6s pulse, opacity 1 → 0.45 → 1. ease-in-out (the default for keyed
// arrays in Framer Motion) gives the soft breathe rather than a hard
// blink — a tactical breathing chip, not an alert.
const PULSE_KEYFRAMES = { opacity: [1, 0.45, 1] };
const PULSE_TRANSITION = {
  duration: 1.6,
  repeat: Infinity,
  ease: EASE_SMOOTH,
} as const;

export interface ModePillProps {
  mode: WorkspaceMode;
  className?: string;
}

export function ModePill({ mode, className }: ModePillProps) {
  const reducedMotion = useReducedMotion();
  const shouldPulse = (mode === "editing" || mode === "creating") && !reducedMotion;

  return (
    <motion.span
      data-testid={`mode-pill-${mode}`}
      data-pulsing={String(shouldPulse)}
      // We animate opacity ONLY (compositor-only property) — never
      // transform / colour, which would force layout or repaint.
      animate={shouldPulse ? PULSE_KEYFRAMES : undefined}
      transition={shouldPulse ? PULSE_TRANSITION : undefined}
      className={cn(
        "inline-flex items-center gap-[6px]",
        "rounded-chip",
        "font-mono uppercase tracking-[0.16em] text-[9.5px] leading-[1.2]",
        "px-[7px] py-[2px]",
        PILL_SURFACE[mode],
        className,
      )}
    >
      <span
        data-testid={`mode-pill-dot-${mode}`}
        className={cn(
          "inline-block w-[5px] h-[5px] rounded-full shrink-0",
          DOT_TONE[mode],
        )}
        aria-hidden
      />
      {MODE_LABEL[mode]}
    </motion.span>
  );
}
