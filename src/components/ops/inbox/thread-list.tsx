"use client";

/**
 * ThreadList — feed body. Renders the grouped sections beneath the column
 * header + today strip. Faithful to `reference/v4-states.jsx :: V4Column`
 * (state-based groups, no sticky headers, plain padding, leading dot).
 *
 * Group dot color encodes the group's ball-in-court weight (canonical
 * v4-states.jsx:132-138):
 *   needsInput     → lavender (agent)
 *   needsReply     → accent (steel blue)
 *   draftsReady    → text-3
 *   awaitingThem   → muted
 *   later          → muted
 *
 * Each group header: 12/14/6 padding, dot + Cake 10.5px label + count.
 */

import { useMemo } from "react";
import {
  groupThreads,
  GROUP_ORDER,
  type GroupKey,
} from "@/lib/inbox/grouping";
import { useDictionary } from "@/i18n/client";
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

const GROUP_DICT_KEY: Record<GroupKey, string> = {
  NEEDS_INPUT: "groups.needsInput",
  NEEDS_REPLY: "groups.needsReply",
  DRAFTS_READY: "groups.draftsReady",
  AWAITING_THEM: "groups.awaitingThem",
  LATER: "groups.later",
};

const GROUP_FALLBACK: Record<GroupKey, string> = {
  NEEDS_INPUT: "Needs your input",
  NEEDS_REPLY: "Needs reply",
  DRAFTS_READY: "Drafts ready",
  AWAITING_THEM: "Awaiting them",
  LATER: "Later",
};

const GROUP_DOT_CLASS: Record<GroupKey, string> = {
  NEEDS_INPUT: "bg-agent",
  NEEDS_REPLY: "bg-ops-accent",
  DRAFTS_READY: "bg-text-3",
  AWAITING_THEM: "bg-text-mute",
  LATER: "bg-text-mute",
};

export function ThreadList({
  threads,
  now,
  selectedThreadId,
  onSelect,
  className,
}: ThreadListProps) {
  const { t } = useDictionary("inbox");
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
        const label = t(GROUP_DICT_KEY[key], GROUP_FALLBACK[key]);
        return (
          <section key={key} aria-label={label}>
            <div className="flex items-baseline gap-2 px-3.5 pb-1.5 pt-3">
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 rounded-full opacity-90",
                  GROUP_DOT_CLASS[key],
                )}
              />
              <h3 className="font-cakemono text-[10.5px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
                {label}
              </h3>
              <span
                className="font-mono text-[10px] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {items.length}
              </span>
            </div>
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
