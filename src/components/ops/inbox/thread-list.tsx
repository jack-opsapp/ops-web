"use client";

import { useMemo } from "react";
import {
  groupThreads,
  GROUP_ORDER,
  type GroupKey,
} from "@/lib/inbox/grouping";
import { ThreadRow, type ThreadRowData } from "./thread-row";
import { cn } from "@/lib/utils/cn";

export type ThreadListItem = ThreadRowData;

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
                  <ThreadRow
                    thread={thread}
                    selected={thread.id === selectedThreadId}
                    now={now}
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
