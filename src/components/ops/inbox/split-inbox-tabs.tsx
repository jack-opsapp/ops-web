"use client";

/**
 * SplitInboxTabs — four-rail segmented control at the top of the inbox.
 *
 * Rails: NEEDS REPLY · EVERYTHING · SCHEDULED · DONE. Each rail shows an
 * unread counter in JetBrains Mono. Keyboard 1/2/3/4 switches rails (when
 * focus isn't trapped in an input). Active tab uses the white-8% fill +
 * 18% border pattern from the design system — no accent on segment controls.
 *
 * Animated underline uses a Motion `layoutId` so it slides between tabs
 * with EASE_SMOOTH. Reduced motion crossfades instead.
 */

import { useEffect, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxRail } from "@/lib/types/email-thread";

export interface InboxRailCounts {
  needs_reply: number;
  everything: number;
  scheduled: number;
  done: number;
}

interface SplitInboxTabsProps {
  active: InboxRail;
  onChange: (rail: InboxRail) => void;
  counts?: Partial<InboxRailCounts>;
  /** When true, listens for 1/2/3/4 on window to switch rails. Default true. */
  hotkeys?: boolean;
}

interface RailDef {
  id: InboxRail;
  label: string;
  hotkey: "1" | "2" | "3" | "4";
}

const RAILS: readonly RailDef[] = [
  { id: "needs_reply", label: "Needs reply", hotkey: "1" },
  { id: "everything",  label: "Everything",  hotkey: "2" },
  { id: "scheduled",   label: "Scheduled",   hotkey: "3" },
  { id: "done",        label: "Done",        hotkey: "4" },
] as const;

function formatCount(n: number | undefined): string | null {
  if (n === undefined || n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function SplitInboxTabs({
  active,
  onChange,
  counts,
  hotkeys = true,
}: SplitInboxTabsProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!hotkeys) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const match = RAILS.find((r) => r.hotkey === e.key);
      if (!match) return;
      e.preventDefault();
      onChange(match.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hotkeys, onChange]);

  const underlineId = useMemo(() => `split-tabs-${Math.random().toString(36).slice(2, 7)}`, []);

  return (
    <div
      role="tablist"
      aria-label="Inbox rail"
      className="flex items-stretch gap-1 px-2.5 pt-2.5 pb-2 border-b border-border-subtle"
    >
      {RAILS.map((rail) => {
        const isActive = rail.id === active;
        const countDisplay = formatCount(counts?.[rail.id]);

        return (
          <button
            key={rail.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`inbox-rail-${rail.id}`}
            onClick={() => onChange(rail.id)}
            className={cn(
              "group relative flex items-center gap-1.5 px-2 py-1.5 rounded-[5px]",
              "border transition-colors duration-150",
              isActive
                ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                : "border-transparent text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.03)]"
            )}
          >
            <span className="font-cakemono font-light uppercase text-[11px] tracking-[0.18em] leading-none">
              {rail.label}
            </span>

            {countDisplay && (
              <span
                className={cn(
                  "font-mono text-[10px] leading-none tabular-nums px-1 py-[1px] rounded-[3px]",
                  isActive
                    ? "text-text-2 bg-[rgba(255,255,255,0.08)]"
                    : "text-text-mute bg-[rgba(255,255,255,0.04)]"
                )}
              >
                {countDisplay}
              </span>
            )}

            <span
              aria-hidden
              className={cn(
                "font-mono text-[10px] leading-none text-text-mute ml-1",
                !isActive && "opacity-60"
              )}
            >
              {rail.hotkey}
            </span>

            {isActive && !reduceMotion && (
              <motion.span
                layoutId={underlineId}
                aria-hidden
                className="absolute left-1 right-1 bottom-[-7px] h-[1px] bg-text"
                transition={{ duration: 0.22, ease: EASE_SMOOTH }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
