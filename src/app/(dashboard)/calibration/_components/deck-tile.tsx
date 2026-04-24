"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { CAL_DURATIONS, CAL_EASE } from "@/lib/utils/calibration-motion";
import { RadarSweep, type RadarSweepState } from "./radar-sweep";

interface DeckTileProps {
  /** Includes the leading `//` prefix already formatted for display. */
  title: string;
  /** 0-4 for deck-entry stagger calculation. */
  indexInGrid: number;
  radarState: RadarSweepState;
  onClick: () => void;
  ariaLabel: string;
  /** Body content */
  children: React.ReactNode;
  /** Footer content */
  footer: React.ReactNode;
  className?: string;
  /** Pass a unique key to re-fire a one-shot accent pulse. */
  pulseToken?: number;
}

export function DeckTile({
  title,
  indexInGrid,
  radarState,
  onClick,
  ariaLabel,
  children,
  footer,
  className,
  pulseToken,
}: DeckTileProps) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "cal-tile glass-surface rounded-panel group relative overflow-hidden text-left",
        "flex flex-col h-[200px] w-full",
        "hover:bg-[rgba(22,22,24,0.68)] transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        className
      )}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0.15 : CAL_DURATIONS.tileEnter,
        ease: CAL_EASE,
        delay: reduced ? 0 : indexInGrid * CAL_DURATIONS.deckEntryStagger,
      }}
      layoutId={`cal-tile-${title}`}
      data-pulse-token={pulseToken ?? 0}
    >
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <span className="font-mono text-micro uppercase tracking-wider text-text-2">
          <span className="text-text-mute mr-[6px]">{title.slice(0, 2)}</span>
          {title.slice(2).trim()}
        </span>
      </div>
      <div className="flex-1 px-5 pb-2 min-h-0">{children}</div>
      <div className="px-5 pb-3 text-text-3 font-mono text-micro">{footer}</div>
      <RadarSweep state={radarState} className="absolute bottom-3 right-3" />
    </motion.button>
  );
}
