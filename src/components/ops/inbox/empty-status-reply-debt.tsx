"use client";

/**
 * OPS Web — Empty-Status Reply-Debt Section
 *
 * Renders the top-3 oldest threads in the "Needs Reply" rail. Fetches
 * limit=10 and sorts ASC client-side to surface urgent debt first.
 * Click a row → opens that thread in the detail view.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import {
  useInboxThreads,
  type InboxThreadRow,
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

export interface EmptyStatusReplyDebtProps {
  scope: InboxScope;
  onSelectThread: (row: InboxThreadRow) => void;
  onOpenRail: () => void;
}

export function EmptyStatusReplyDebt({
  scope,
  onSelectThread,
  onOpenRail,
}: EmptyStatusReplyDebtProps) {
  const reduceMotion = useReducedMotion();
  const { data, isLoading, isError } = useInboxThreads({
    scope,
    filter: "needs_reply",
    limit: 10,
  });

  const top3 = useMemo<InboxThreadRow[]>(() => {
    const rows = data?.pages.flatMap((p) => p.threads) ?? [];
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(a.lastMessageAt).getTime() - new Date(b.lastMessageAt).getTime()
    );
    return sorted.slice(0, 3);
  }, [data]);

  const totalCount = data?.pages[0]?.threads.length ?? 0;
  const now = new Date();
  const oldestAge = top3[0] ? formatAge(top3[0].lastMessageAt, now) : null;

  return (
    <section className="px-3 py-3 border-b border-[rgba(255,255,255,0.10)]">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">// </span>REPLY DEBT
        </p>
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            totalCount === 0 ? "text-text-3" : "text-text",
            "[font-feature-settings:'tnum'_1,'zero'_1]"
          )}
        >
          {isError
            ? "—"
            : isLoading
            ? ""
            : totalCount === 0
            ? "0 OUTSTANDING"
            : `${totalCount} WAITING`}
        </span>
      </div>

      {!isError && !isLoading && oldestAge && totalCount > 0 && (
        <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          OLDEST {oldestAge}
        </p>
      )}

      {isError && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">
          SYS :: DEBT UNAVAILABLE
        </p>
      )}

      {!isError && (isLoading || top3.length > 0) && (
        <div
          className="mt-3 rounded-[5px] border border-[rgba(255,255,255,0.10)] overflow-hidden"
          role="list"
          aria-label="Top 3 threads waiting on reply"
        >
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-[44px] animate-pulse bg-[rgba(255,255,255,0.03)]",
                    i < 2 && "border-b border-[rgba(255,255,255,0.10)]"
                  )}
                />
              ))
            : top3.map((row, i) => (
                <motion.button
                  key={row.id}
                  type="button"
                  role="listitem"
                  onClick={() => onSelectThread(row)}
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
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-text-2 shrink-0 w-[64px]">
                    {row.primaryCategory}
                  </span>
                  <span className="font-mohave text-[13px] text-text shrink-0 max-w-[180px] truncate">
                    {row.clientName || row.latestSenderName || row.latestSenderEmail || "Unknown"}
                  </span>
                  <span className="font-mohave text-[12px] text-text-2 truncate flex-1 min-w-0">
                    {row.subject || "(no subject)"}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-text-3 shrink-0">
                    {formatAge(row.lastMessageAt, now)}
                  </span>
                  <span className="font-mono text-[13px] text-text-mute shrink-0" aria-hidden>
                    →
                  </span>
                </motion.button>
              ))}
        </div>
      )}

      {!isError && !isLoading && totalCount > 0 && (
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
          OPEN NEEDS REPLY RAIL
          <span aria-hidden>→</span>
        </button>
      )}
    </section>
  );
}
