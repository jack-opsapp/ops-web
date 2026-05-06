"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Tag,
} from "lucide-react";
import { KeyHint } from "@/components/ui/key-hint";
import { cn } from "@/lib/utils/cn";

interface ThreadDetailHeaderProps {
  clientName: string;
  onPrev: () => void;
  onNext: () => void;
  onArchive: () => void;
  onSnooze: () => void;
  onRecategorize: () => void;
  onMore: () => void;
  onToggleRail: () => void;
  rightRailOpen: boolean;
  className?: string;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-text-3 transition-colors hover:bg-inbox-elev hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent";

export function ThreadDetailHeader({
  clientName,
  onPrev,
  onNext,
  onArchive,
  onSnooze,
  onRecategorize,
  onMore,
  onToggleRail,
  rightRailOpen,
  className,
}: ThreadDetailHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b border-line bg-inbox-panel px-3.5",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous thread"
          className={iconBtn}
        >
          <ChevronLeft aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next thread"
          className={iconBtn}
        >
          <ChevronRight aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <span className="ml-1 hidden md:inline-flex">
          <KeyHint keys={["⌘", "K"]} variant="inline" />
        </span>
        <button
          type="button"
          onClick={onToggleRail}
          aria-label="Toggle context rail"
          aria-pressed={rightRailOpen}
          className={cn(iconBtn, "ml-1")}
        >
          {rightRailOpen ? (
            <PanelRightClose aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          ) : (
            <PanelRightOpen aria-hidden className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </div>

      <h1 className="min-w-0 flex-1 truncate font-mohave text-[16px] font-medium tracking-[-0.005em] text-text">
        {clientName}
      </h1>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onArchive}
          aria-label="Archive thread"
          className={iconBtn}
        >
          <Archive aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onSnooze}
          aria-label="Snooze thread"
          className={iconBtn}
        >
          <Clock aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onRecategorize}
          aria-label="Recategorize thread"
          className={iconBtn}
        >
          <Tag aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onMore}
          aria-label="More actions"
          className={iconBtn}
        >
          <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
