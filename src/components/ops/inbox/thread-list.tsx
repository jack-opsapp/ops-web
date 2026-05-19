"use client";

/**
 * ThreadList — feed body. Renders the active rail's result set beneath the
 * column header + today strip.
 *
 * The active rail owns membership (`CLIENTS` / `EVERYTHING ELSE` / `ALL`).
 * Reply debt, drafts, and waiting state stay on the rows themselves via
 * StateTag and draft prefixes; the list does not create secondary sections.
 */

import { ThreadRow, type ThreadRowData } from "./thread-row";
import { TodayBar, type TodayCommitment } from "./today-bar";
import { cn } from "@/lib/utils/cn";

export type ThreadListItem = ThreadRowData;

interface ThreadListProps {
  threads: ThreadListItem[];
  now: number;
  selectedThreadId: string | null;
  onSelect: (id: string) => void;
  /**
   * Passed through to each ThreadRow. When set, the inline YOURS chip
   * reveals a hover-X that fires this callback with the row's thread id.
   * Wire to `useThreadActions().dismissAwaitingReply` at the route layer.
   */
  onDismissAwaitingReply?: (threadId: string) => void;
  obligations?: TodayCommitment[];
  onResolveObligation?: (commitmentId: string) => void;
  pendingResolveIds?: ReadonlySet<string>;
  className?: string;
}

export function ThreadList({
  threads,
  now,
  selectedThreadId,
  onSelect,
  onDismissAwaitingReply,
  obligations = [],
  onResolveObligation,
  pendingResolveIds,
  className,
}: ThreadListProps) {
  return (
    <div
      data-testid="thread-list-scroll"
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide",
        className,
      )}
    >
      <TodayBar
        commitments={obligations}
        onResolve={onResolveObligation}
        pendingResolveIds={pendingResolveIds}
      />
      <ul className="flex flex-col">
        {threads.map((thread) => (
          <li key={thread.id}>
            <ThreadRow
              thread={thread}
              selected={thread.id === selectedThreadId}
              now={now}
              onSelect={onSelect}
              onDismissAwaitingReply={onDismissAwaitingReply}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
