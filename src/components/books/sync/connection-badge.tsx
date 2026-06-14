"use client";

/**
 * ConnectionBadge — the ambient connection instrument that lives in the Books
 * SYNC workbar chrome once an accounting provider is linked (WEB OVERHAUL P3-4).
 *
 * The single status signal — "QUICKBOOKS · LIVE" (olive, slow live pulse) or
 * "· OFFLINE" (tan). Clicking it opens the settings modal. Replaces the old
 * per-card status tags: a connection reads as a mission-control light, not a
 * settings panel. 28px workbar tier (DESIGN.md §9, ratified 2026-06-11).
 */

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";

export type ConnectionBadgeTone = "live" | "offline";

export function ConnectionBadge({
  providerName,
  statusLabel,
  tone,
  onClick,
  className,
}: {
  providerName: string;
  statusLabel: string;
  tone: ConnectionBadgeTone;
  onClick: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const isLive = tone === "live";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        "inline-flex h-[28px] items-center gap-[7px] rounded-[5px] border px-2.5",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        "transition-colors duration-150 ease-smooth",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        isLive
          ? "border-olive-line bg-olive-soft text-olive hover:border-olive"
          : "border-tan-line bg-tan-soft text-tan hover:border-tan",
        className,
      )}
    >
      <motion.span
        aria-hidden
        className={cn("h-[6px] w-[6px] rounded-full", isLive ? "bg-olive" : "bg-tan")}
        animate={isLive && !reduceMotion ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
        transition={
          isLive && !reduceMotion
            ? { duration: 2.4, repeat: Infinity, ease: EASE_SMOOTH }
            : undefined
        }
      />
      <span className="text-text-2">{providerName}</span>
      <span aria-hidden className="opacity-50">
        ·
      </span>
      <span>{statusLabel}</span>
      <ChevronDown aria-hidden className="h-[12px] w-[12px] opacity-60" />
    </button>
  );
}
