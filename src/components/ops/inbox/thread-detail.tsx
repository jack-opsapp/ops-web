"use client";

import { useEffect, type ReactNode } from "react";
import { ThreadDetailHeader } from "./thread-detail-header";
import type { EmailThreadCategory } from "@/lib/types/email-thread";
import { cn } from "@/lib/utils/cn";

interface ThreadDetailProps {
  subject: string;
  /**
   * Raw classifier category. Forwarded to `<ThreadDetailHeader>` which
   * renders it through `<CategoryChip>` for canonical tone-per-category.
   */
  category?: EmailThreadCategory | null;
  senderName: string;
  messageCount: number;
  otherThreadCount?: number;
  onOpenThreadPicker?: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** Render-slot for the archive button (wraps a styled button). */
  archiveSlot?: (button: ReactNode) => ReactNode;
  snoozeSlot?: (button: ReactNode) => ReactNode;
  recategorizeSlot?: (button: ReactNode) => ReactNode;
  moreSlot?: (button: ReactNode) => ReactNode;
  /** Fallback handlers when no slot is provided. */
  onArchive?: () => void;
  onSnooze?: () => void;
  onRecategorize?: () => void;
  onMore?: () => void;
  /** Inline slot rendered in the detail-header meta strip after the message
   *  count. Forwarded as-is to <ThreadDetailHeader>. */
  threadPickerSlot?: ReactNode;
  /**
   * Triage chip rendered in the title row of the detail header (between
   * subject and the action cluster). Forwarded as-is to
   * `<ThreadDetailHeader>`. Typically a `<StateTag>` computed from the
   * thread's labels + direction + phaseC via `computeStateTag`.
   */
  triageSlot?: ReactNode;
  /**
   * Reserved status affordance mounted below the detail header — typically
   * the `<FloatingYourTurnBadge>`. It stays in flow so it cannot collide
   * with commitments, bands, or the message list.
   */
  floatingBadgeSlot?: ReactNode;
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
  otherThreadCount,
  onOpenThreadPicker,
  onPrev,
  onNext,
  archiveSlot,
  snoozeSlot,
  recategorizeSlot,
  moreSlot,
  onArchive,
  onSnooze,
  onRecategorize,
  onMore,
  threadPickerSlot,
  triageSlot,
  floatingBadgeSlot,
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
        otherThreadCount={otherThreadCount}
        onOpenThreadPicker={onOpenThreadPicker}
        archiveSlot={archiveSlot}
        snoozeSlot={snoozeSlot}
        recategorizeSlot={recategorizeSlot}
        moreSlot={moreSlot}
        onArchive={onArchive}
        onSnooze={onSnooze}
        onRecategorize={onRecategorize}
        onMore={onMore}
        threadPickerSlot={threadPickerSlot}
        triageSlot={triageSlot}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {floatingBadgeSlot && (
          <div
            data-testid="detail-status-stack"
            className="flex shrink-0 items-center justify-center border-b border-line bg-inbox-panel/40 px-2 py-1.5"
          >
            {floatingBadgeSlot}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
