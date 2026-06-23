"use client";
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { EASE_SMOOTH } from "@/lib/utils/motion";

interface Props {
  sent: number;
  total: number;
  bounced: number;
  failed: number;
}

/**
 * Segmented progress bar — olive (sent), rose (bounced), brick (failed)
 * stacked on a 2px rail. Shows the campaign's actual delivery shape, not
 * just a generic percentage.
 */
export function CampaignProgressBar({ sent, total, bounced, failed }: Props) {
  const reduce = useReducedMotion();
  const safeTotal = Math.max(total, 1);
  const sentPct = Math.min(sent / safeTotal, 1);
  const bouncedPct = Math.min(bounced / safeTotal, 1);
  const failedPct = Math.min(failed / safeTotal, 1);

  const t = reduce
    ? { duration: 0.15 }
    : { duration: 0.6, ease: EASE_SMOOTH };

  return (
    <div className="space-y-1">
      <div
        className="h-[2px] rounded-bar relative overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
        aria-label={`${sent} of ${total} sent`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={sent}
      >
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: "#9DB582" }}
          initial={{ width: 0 }}
          animate={{ width: `${sentPct * 100}%` }}
          transition={t}
        />
        <motion.div
          className="absolute inset-y-0"
          style={{ background: "#B58289", left: `${sentPct * 100}%` }}
          initial={{ width: 0 }}
          animate={{ width: `${bouncedPct * 100}%` }}
          transition={t}
        />
        <motion.div
          className="absolute inset-y-0"
          style={{
            background: "#93321A",
            left: `${(sentPct + bouncedPct) * 100}%`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${failedPct * 100}%` }}
          transition={t}
        />
      </div>
      <div
        className="flex gap-3 font-mono text-[10px] text-[#8A8A8A]"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        <span>SENT {sent}</span>
        <span>BOUNCED {bounced}</span>
        <span>FAILED {failed}</span>
        <span className="ml-auto">/ {total}</span>
      </div>
    </div>
  );
}
