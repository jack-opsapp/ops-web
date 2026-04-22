"use client";

/**
 * SplitInboxTabs — four-rail segmented control at the top of the inbox.
 *
 * Rails (left→right, matching daily workflow): REPLY · ALL · LATER · DONE.
 * The cake-mono uppercase rendering is applied via CSS — dictionary strings
 * stay in title case. Unread count shows as a JetBrains Mono badge; zero is
 * suppressed. The keyboard shortcut `1`/`2`/`3`/`4` stays live; its
 * discoverability is handled by the `title` tooltip (and the command
 * palette) so the tab chrome stays tight enough to fit the 360px list
 * column without bleeding into the thread pane. Active tab uses the
 * white-8% fill + 18% border pattern from the design system — no accent on
 * segment controls. Animated underline uses a Motion `layoutId` so it slides
 * between tabs with EASE_SMOOTH; reduced motion crossfades instead.
 */

import { useEffect, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { InboxRail } from "@/lib/types/email-thread";

export interface InboxRailCounts {
  needs_reply: number;
  everything: number;
  scheduled: number;
  done: number;
  drafts: number;
  commitments: number;
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
  /** Dictionary key for the short (compact) label shown inside the tab. */
  labelKey: string;
  /** Dictionary key for the verbose tooltip shown on hover. */
  titleKey: string;
  /** Fallback label used when the dictionary key isn't present yet. */
  fallbackLabel: string;
  /** Fallback tooltip used when the dictionary key isn't present yet. */
  fallbackTitle: string;
  hotkey: "1" | "2" | "3" | "4" | "5" | "6";
}

// NOTE: six tabs in a 360px left column is tight — labels stay ≤ 6 chars
// and the container clips overflow. COMMIT slots between DRAFTS and the
// canvas edge because commitments are a triage-urgency surface, adjacent
// to where the user is already scanning for attention.
const RAILS: readonly RailDef[] = [
  { id: "needs_reply", labelKey: "rail.needsReply", titleKey: "rail.needsReply.title", fallbackLabel: "Reply",  fallbackTitle: "Needs reply",  hotkey: "1" },
  { id: "everything",  labelKey: "rail.everything", titleKey: "rail.everything.title", fallbackLabel: "All",    fallbackTitle: "Everything",   hotkey: "2" },
  { id: "scheduled",   labelKey: "rail.scheduled",  titleKey: "rail.scheduled.title",  fallbackLabel: "Later",  fallbackTitle: "Snoozed",      hotkey: "3" },
  { id: "done",        labelKey: "rail.done",       titleKey: "rail.done.title",       fallbackLabel: "Done",   fallbackTitle: "Archived",     hotkey: "4" },
  { id: "drafts",      labelKey: "rail.drafts",     titleKey: "rail.drafts.title",     fallbackLabel: "Drafts", fallbackTitle: "Drafts — provider + AI (5)", hotkey: "5" },
  { id: "commitments", labelKey: "rail.commitments", titleKey: "rail.commitments.title", fallbackLabel: "Commit", fallbackTitle: "Commitments — threads with unresolved deadlines (6)", hotkey: "6" },
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
  const { t } = useDictionary("inbox");
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

  const underlineId = useMemo(
    () => `split-tabs-${Math.random().toString(36).slice(2, 7)}`,
    []
  );

  return (
    <div
      role="tablist"
      aria-label="Inbox rail"
      className={cn(
        "flex items-stretch gap-1 px-2.5 pt-2.5 pb-2",
        "border-b border-border-subtle",
        // Defensive clip — the 360px column is snug; never let tabs bleed
        // into the thread detail pane even under long localizations.
        "overflow-hidden"
      )}
    >
      {RAILS.map((rail) => {
        const isActive = rail.id === active;
        const countDisplay = formatCount(counts?.[rail.id]);
        // Use the dictionary when the key resolves, else fall back to the
        // baked-in English label so new rails (e.g. `rail.drafts`) render
        // correctly before translations ship.
        const rawLabel = t(rail.labelKey);
        const label = rawLabel && rawLabel !== rail.labelKey ? rawLabel : rail.fallbackLabel;
        const rawTitle = t(rail.titleKey);
        const title = rawTitle && rawTitle !== rail.titleKey ? rawTitle : rail.fallbackTitle;

        return (
          <button
            key={rail.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`inbox-rail-${rail.id}`}
            aria-keyshortcuts={rail.hotkey}
            title={title}
            onClick={() => onChange(rail.id)}
            className={cn(
              "group relative flex flex-1 min-w-0 items-center justify-center gap-1",
              "px-1 py-1.5 rounded-[5px] border transition-colors duration-150",
              isActive
                ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                : "border-transparent text-text-3 hover:text-text-2 hover:bg-[rgba(255,255,255,0.03)]"
            )}
          >
            <span
              className={cn(
                "font-cakemono font-light uppercase whitespace-nowrap",
                // Tight tracking so 5-char labels (REPLY / LATER) fit inside
                // an 80px flex-basis button next to their count badge.
                "text-[11px] tracking-[0.08em] leading-none"
              )}
            >
              {label}
            </span>

            {countDisplay && (
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px] leading-none tabular-nums",
                  // No background pill — the label carries the tab identity,
                  // the count is a supporting datum. A color shift is enough
                  // to differentiate without eating horizontal space.
                  isActive ? "text-text-2" : "text-text-mute"
                )}
              >
                {countDisplay}
              </span>
            )}

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
