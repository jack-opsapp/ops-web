"use client";

/**
 * OPS Web — Empty-Status Drafts Section
 *
 * Renders the 3 most recently-updated drafts. Click a row → opens
 * that draft in compose for continuation. "Open Drafts rail" in the
 * footer switches the left rail to DRAFTS.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useInboxDrafts,
  type InboxDraftRow,
} from "@/lib/hooks/use-inbox-threads";
import type { InboxScope } from "@/lib/types/email-thread";

function formatAge(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

export interface EmptyStatusDraftsProps {
  scope: InboxScope;
  onContinueDraft: (draft: InboxDraftRow) => void;
  onOpenRail: () => void;
}

export function EmptyStatusDrafts({
  scope,
  onContinueDraft,
  onOpenRail,
}: EmptyStatusDraftsProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxDrafts(scope);
  const drafts = useMemo<InboxDraftRow[]>(() => data ?? [], [data]);

  const top3 = useMemo<InboxDraftRow[]>(() => {
    return [...drafts]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, 3);
  }, [drafts]);

  const total = drafts.length;
  const now = new Date();

  return (
    <section className="px-3 py-3">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">// </span>DRAFTS
        </p>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            total === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {isError ? "—" : isLoading ? "" : total === 0 ? "—" : total}
        </span>
      </div>

      {isError && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          SYS :: DRAFTS UNAVAILABLE
        </p>
      )}

      {!isError && (isLoading || top3.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border border-[rgba(255,255,255,0.10)] overflow-hidden"
          role="list"
          aria-label="Top 3 drafts in progress"
        >
          {isLoading
            ? Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-[44px] animate-pulse bg-[rgba(255,255,255,0.03)]",
                    i < 1 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                />
              ))
            : top3.map((d, i) => (
                <motion.button
                  key={`${d.source}:${d.id}`}
                  type="button"
                  role="listitem"
                  onClick={() => onContinueDraft(d)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left",
                    "transition-colors duration-150",
                    "hover:bg-[rgba(255,255,255,0.05)]",
                    "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                    i < top3.length - 1 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.3,
                    delay: reduceMotion ? 0 : i * 0.05,
                    ease: EASE_SMOOTH,
                  }}
                >
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 shrink-0 w-[80px]">
                    {d.source === "ai" ? "AI DRAFT" : "DRAFT"}
                  </span>
                  <span className="font-mohave text-[13px] text-text truncate max-w-[180px] shrink-0">
                    To {d.to[0] || "—"}
                  </span>
                  <span className="font-mohave text-[12px] text-text-2 truncate flex-1 min-w-0">
                    {d.subject || "(no subject)"}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-text-3 shrink-0">
                    {formatAge(d.updatedAt, now)}
                  </span>
                  <span className="font-mono text-[13px] text-text-mute shrink-0" aria-hidden>
                    →
                  </span>
                </motion.button>
              ))}
        </div>
      )}

      {!isError && !isLoading && total > 0 && (
        <button
          type="button"
          onClick={onOpenRail}
          className={cn(
            "mt-3 inline-flex items-center gap-1.5",
            "font-cakemono font-light uppercase text-[12px] tracking-[0.04em]",
            "text-text-2 hover:text-text transition-colors duration-150",
            "focus:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          )}
        >
          OPEN DRAFTS RAIL
          <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}
