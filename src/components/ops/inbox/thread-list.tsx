"use client";

/**
 * ThreadList — feed body. Renders the grouped sections beneath the column
 * header + today strip.
 *
 * Phase B rebuild: group dividers are now slash-prefixed Cake labels via
 * `<SlashLabel>` (e.g. `// NEEDS REPLY · 9`). Color-dot prefix removed —
 * group identity is carried by the // label, not by a colored disc.
 */

import { useMemo } from "react";
import {
  groupThreads,
  GROUP_ORDER,
  type GroupKey,
} from "@/lib/inbox/grouping";
import { useDictionary } from "@/i18n/client";
import { ThreadRow, type ThreadRowData } from "./thread-row";
import { SlashLabel } from "./voice/slash-label";
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
  NEEDS_INPUT: "groups.needsInputLabel",
  NEEDS_REPLY: "groups.needsReplyLabel",
  DRAFTS_READY: "groups.draftsReadyLabel",
  AWAITING_THEM: "groups.awaitingThemLabel",
  LATER: "groups.laterLabel",
};

const GROUP_FALLBACK: Record<GroupKey, string> = {
  NEEDS_INPUT: "// NEEDS INPUT",
  NEEDS_REPLY: "// NEEDS REPLY",
  DRAFTS_READY: "// DRAFTS READY",
  AWAITING_THEM: "// AWAITING THEM",
  LATER: "// LATER",
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
              <h3 className="m-0">
                <SlashLabel label={label} tone="text-3" />
              </h3>
              <span
                className="font-mono text-[11px] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                · {items.length}
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
