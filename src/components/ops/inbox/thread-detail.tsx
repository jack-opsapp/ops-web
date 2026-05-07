"use client";

import { useEffect, type ReactNode } from "react";
import { ThreadDetailHeader } from "./thread-detail-header";
import { cn } from "@/lib/utils/cn";

interface ThreadDetailProps {
  subject: string;
  category?: { label: string; dotClassName: string } | null;
  senderName: string;
  messageCount: number;
  clientType?: string | null;
  onOpenClient?: () => void;
  rightRailOpen: boolean;
  onPrev: () => void;
  onNext: () => void;
  onArchive: () => void;
  onSnooze: () => void;
  onRecategorize: () => void;
  onMore: () => void;
  onToggleRail: () => void;
  className?: string;
  children?: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function ThreadDetail({
  subject,
  category,
  senderName,
  messageCount,
  clientType,
  onOpenClient,
  rightRailOpen,
  onPrev,
  onNext,
  onArchive,
  onSnooze,
  onRecategorize,
  onMore,
  onToggleRail,
  className,
  children,
}: ThreadDetailProps) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        onNext();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        onPrev();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNext, onPrev]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-inbox-bg", className)}>
      <ThreadDetailHeader
        subject={subject}
        category={category}
        senderName={senderName}
        messageCount={messageCount}
        clientType={clientType}
        onOpenClient={onOpenClient}
        onArchive={onArchive}
        onSnooze={onSnooze}
        onRecategorize={onRecategorize}
        onMore={onMore}
        onToggleRail={onToggleRail}
        rightRailOpen={rightRailOpen}
      />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
