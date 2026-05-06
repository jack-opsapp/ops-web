"use client";

import { useMemo } from "react";
import {
  groupThreads,
  GROUP_ORDER,
  type GroupKey,
  type ThreadForGrouping,
} from "@/lib/inbox/grouping";
import { cn } from "@/lib/utils/cn";

export interface ThreadListItem extends ThreadForGrouping {
  clientName: string;
  snippet: string;
  unread: boolean;
}

interface ThreadListProps {
  threads: ThreadListItem[];
  now: number;
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
  className?: string;
}

const GROUP_LABELS: Record<GroupKey, string> = {
  NEEDS_YOUR_INPUT: "// NEEDS YOUR INPUT",
  URGENT: "// URGENT",
  TODAY: "// TODAY",
  THIS_WEEK: "// THIS WEEK",
  EARLIER: "// EARLIER",
};

export function ThreadList({
  threads,
  now,
  selectedThreadId,
  onSelect,
  className,
}: ThreadListProps) {
  const groups = useMemo(() => groupThreads(threads, now), [threads, now]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide",
        className,
      )}
    >
      {GROUP_ORDER.map((key) => {
        const items = groups.get(key) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={key} aria-label={GROUP_LABELS[key]}>
            <h3 className="sticky top-0 z-[1] bg-inbox-bg/95 px-3.5 pb-1.5 pt-3 font-cakemono text-[9.5px] font-light uppercase leading-none tracking-[0.18em] text-text-3 backdrop-blur-[4px]">
              {GROUP_LABELS[key]}
            </h3>
            <ul className="flex flex-col">
              {items.map((thread) => (
                <li key={thread.id}>
                  <ThreadRowPlaceholder
                    thread={thread}
                    selected={thread.id === selectedThreadId}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Placeholder row used only until Task 2.4 lands the real <ThreadRow>.
 * Renders client name + snippet + ts as a button. Variants (urgent stripe,
 * AI-draft chevron, ?-pill, selected accent bar) come in 2.4.
 */
function ThreadRowPlaceholder({
  thread,
  selected,
  onSelect,
}: {
  thread: ThreadListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(thread.id)}
      className={cn(
        "flex w-full items-start gap-2 px-3.5 py-2 text-left",
        "border-b border-line/40",
        selected ? "bg-ops-accent/[0.07]" : "hover:bg-inbox-elev",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate font-mohave text-[13px] tracking-[-0.003em]",
            thread.unread ? "font-semibold text-text" : "font-medium text-text-2",
          )}
        >
          {thread.clientName}
        </span>
        <span className="truncate font-mohave text-[12px] leading-[1.4] text-text-3">
          {thread.snippet}
        </span>
      </div>
    </button>
  );
}
