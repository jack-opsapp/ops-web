"use client";

import { useEffect, type ReactNode } from "react";
import { ContactStrip } from "./contact-strip";
import { ThreadDetailHeader } from "./thread-detail-header";
import { cn } from "@/lib/utils/cn";

interface ThreadClient {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

interface ThreadDetailProps {
  client: ThreadClient;
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
  client,
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
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <ThreadDetailHeader
        clientName={client.name}
        onPrev={onPrev}
        onNext={onNext}
        onArchive={onArchive}
        onSnooze={onSnooze}
        onRecategorize={onRecategorize}
        onMore={onMore}
        onToggleRail={onToggleRail}
        rightRailOpen={rightRailOpen}
      />
      <ContactStrip
        phone={client.phone}
        email={client.email}
        address={client.address}
      />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
