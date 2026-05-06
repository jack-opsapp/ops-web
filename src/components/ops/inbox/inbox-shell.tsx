"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface InboxShellProps {
  threadList: ReactNode;
  detail: ReactNode;
  contextRail: ReactNode;
  rightRailOpen?: boolean;
  className?: string;
}

export function InboxShell({
  threadList,
  detail,
  contextRail,
  rightRailOpen = true,
  className,
}: InboxShellProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full bg-inbox-bg text-text",
        className,
      )}
    >
      <aside
        role="complementary"
        aria-label="Thread list"
        className="flex w-[360px] shrink-0 flex-col border-r border-line bg-inbox-bg"
      >
        {threadList}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-inbox-bg">
        {detail}
      </main>
      {rightRailOpen && (
        <aside
          role="complementary"
          aria-label="Thread context"
          className="flex w-[360px] shrink-0 flex-col border-l border-line bg-inbox-bg-deep"
        >
          {contextRail}
        </aside>
      )}
    </div>
  );
}
