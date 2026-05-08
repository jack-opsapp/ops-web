"use client";

/**
 * ThreadsView — Threads tab in the right context rail. Renders related
 * threads on the same client (excluding the currently-open one).
 *
 * Per the production mockup:
 *   1418 Pendrell — final invoice receipt
 *   · msgs
 *
 * Each row links into the inbox with `/inbox/{threadId}`.
 */

import Link from "next/link";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface RailRelatedThread {
  id: string;
  title: string;
  /** Short subject. */
  subject: string;
  messageCount: number;
  /** Pre-formatted: "Apr 14" / "2w" */
  when: string;
  /** True when there's an unread inbound message. */
  unread?: boolean;
}

interface ThreadsViewProps {
  threads: RailRelatedThread[];
  className?: string;
}

export function ThreadsView({ threads, className }: ThreadsViewProps) {
  const { t } = useDictionary("inbox");
  if (threads.length === 0) {
    return (
      <div
        className={cn(
          "px-1 py-6 font-mono text-[11px] text-text-3",
          className,
        )}
      >
        {t("rail.empty.threads", "No related threads")}
      </div>
    );
  }
  return (
    <ul className={cn("flex flex-col gap-0.5", className)}>
      {threads.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/inbox/${thread.id}`}
            className="block rounded-chip border border-transparent px-2 py-2 transition-colors hover:border-line hover:bg-inbox-elev/40"
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mohave text-[12px] tracking-[-0.003em]",
                  thread.unread ? "font-medium text-text" : "font-normal text-text-2",
                )}
              >
                {thread.title}
              </span>
              <span
                className="shrink-0 font-mono text-[11px] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                {thread.when}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mohave text-[12px] text-text-3">
              {thread.subject}
            </div>
            <div
              className="mt-1 font-mono text-[11px] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              · {thread.messageCount}
              {thread.messageCount === 1
                ? t("threadsView.msg", " msg")
                : t("threadsView.msgs", " msgs")}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
