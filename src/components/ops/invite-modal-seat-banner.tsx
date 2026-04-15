"use client";

import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { fadeSlideDown, fadeSlideDownReduced } from "@/lib/utils/motion";

interface InviteModalSeatBannerProps {
  seatsRemaining: number;
  invitesQueued: number;
}

/**
 * Inline warning banner inside the invite modal. Renders only when the
 * number of invites in the chip row would leave new members unseated.
 * Three conceptual states:
 *   - quiet (not rendered): enough seats
 *   - over-capacity: some seats, not enough
 *   - full: zero seats
 */
export function InviteModalSeatBanner({
  seatsRemaining,
  invitesQueued,
}: InviteModalSeatBannerProps) {
  const reduce = useReducedMotion();
  const variants = reduce ? fadeSlideDownReduced : fadeSlideDown;

  if (invitesQueued === 0) return null;
  if (seatsRemaining >= invitesQueued) return null;

  const isFull = seatsRemaining === 0;
  const deficit = invitesQueued - seatsRemaining;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={isFull ? "full" : "over"}
        variants={variants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="rounded-sm border border-status-warning/30 bg-status-warning/10 p-3 mt-2"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-[14px] h-[14px] text-status-warning mt-[2px] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-kosugi text-micro uppercase tracking-wider text-status-warning">
              {isFull
                ? "All seats in use"
                : `${seatsRemaining} seats remaining — ${invitesQueued} invites queued`}
            </p>
            <p className="font-mohave text-body-sm text-text-secondary leading-relaxed mt-1">
              {isFull
                ? "New members will join but won't have access until you shift seats or upgrade."
                : `${deficit} new member${deficit > 1 ? "s" : ""} will join without a seat. Shift seats or upgrade your plan to give them access.`}
            </p>
            <Link
              href="/settings?tab=subscription"
              className="font-kosugi text-micro uppercase tracking-wider text-ops-accent hover:text-ops-accent-hover transition-colors inline-flex items-center gap-1 mt-2"
            >
              Upgrade plan
              <ArrowRight className="w-[12px] h-[12px]" />
            </Link>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
