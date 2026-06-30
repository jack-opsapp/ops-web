"use client";

/**
 * FloatingComposerWrapper — absolutely-positioned shell that mounts the
 * thread composer over the bottom of the messages region inside the
 * detail surface. Owns the floating geometry (bottom offset, side gutters,
 * max-width cap) and the AnimatePresence motion. The wrapped Composer
 * itself handles all the interactive concerns (typing, sending, draft
 * switching) — this component is presentational chrome only.
 *
 *   ┌────── messages-wrapper (relative) ──────────────────────────┐
 *   │ floatingBadgeSlot   (top, z-1500)                           │
 *   │                                                             │
 *   │ <messages scroll>                                           │
 *   │                                                             │
 *   │   ╔══════════════════════════════════════════════════════╗  │  ← composer
 *   │   ║ [optional draft switcher / AI banner accessories]    ║  │     z-1550
 *   │   ║ [textarea — grows up to max 200px]                   ║  │
 *   │   ║ [✦] [📎] [🖼] [📅]            [EDIT] [SEND ⌘↵]      ║  │
 *   │   ╚══════════════════════════════════════════════════════╝  │
 *   │     ↓ 12px breathing room ↓                                 │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * - z-index 1550: between P4-2's floating badge (1500) and the floating-ui
 *   range ceiling (1600 reserved for future). Both sit below the floating
 *   window range (2000+) and the Radix modal range (3000).
 * - 24px side gutters via `px-6`; 12px bottom via `bottom-3`; max-width
 *   760px so the composer doesn't stretch on wide viewports.
 * - `pointer-events-none` on the outer wrapper so the gutter regions stay
 *   click-throughable to the message list underneath; `pointer-events-auto`
 *   on the inner panel.
 *
 * Mount/exit motion mirrors `<FloatingYourTurnBadge>` (top-anchored, enters
 * from above) on the opposite axis — the composer is bottom-anchored and
 * enters from below. Same easing curve, same timing. Reduced-motion strips
 * the y translate.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import {
  floatingComposerVariants,
  floatingComposerVariantsReduced,
} from "@/lib/utils/motion";

interface FloatingComposerWrapperProps {
  /** Mounted state — drives the AnimatePresence enter/exit. Typically true
   *  whenever a thread is loaded in the detail pane. */
  show: boolean;
  /** The composer element itself. Pass a `<Composer floating ... />` here. */
  children: ReactNode;
  className?: string;
}

export function FloatingComposerWrapper({
  show,
  children,
  className,
}: FloatingComposerWrapperProps) {
  const reduced = !!useReducedMotion();
  const variants = reduced
    ? floatingComposerVariantsReduced
    : floatingComposerVariants;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="floating-composer"
          data-testid="floating-composer-wrapper"
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-3 z-[1550]",
            "flex justify-center px-6",
            className,
          )}
        >
          <div className="pointer-events-auto w-full max-w-[760px]">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
