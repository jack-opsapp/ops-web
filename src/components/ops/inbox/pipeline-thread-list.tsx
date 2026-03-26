"use client";

import { useMemo, useCallback } from "react";
import {
  Mail,
  MailOpen,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EmptyState } from "@/components/ops/empty-state";
import { StatusBadge } from "@/components/ops/status-badge";
import { usePipelineThreads } from "@/lib/hooks/use-inbox";
import type { PipelineThread } from "@/lib/types/inbox";
import { OpportunityStage } from "@/lib/types/pipeline";

// ─── Stage → StatusBadge mapping ──────────────────────────────────────────────

const STAGE_STATUS_MAP: Record<OpportunityStage, string> = {
  [OpportunityStage.NewLead]: "rfq",
  [OpportunityStage.Qualifying]: "rfq",
  [OpportunityStage.Quoting]: "estimated",
  [OpportunityStage.Quoted]: "estimated",
  [OpportunityStage.FollowUp]: "in_progress",
  [OpportunityStage.Negotiation]: "in_progress",
  [OpportunityStage.Won]: "accepted",
  [OpportunityStage.Lost]: "closed",
  [OpportunityStage.Discarded]: "closed",
};

// ─── Time Formatting ──────────────────────────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Thread Row ───────────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  onClick,
}: {
  thread: PipelineThread;
  onClick: (thread: PipelineThread) => void;
}) {
  const isUnread = thread.unreadCount > 0;
  const senderInitial = thread.latestSender
    ? thread.latestSender.charAt(0).toUpperCase()
    : "?";

  // Extract sender display name (before @ or before <)
  const senderDisplay = useMemo(() => {
    const raw = thread.latestSender;
    if (!raw) return "Unknown";
    // "John Doe <john@..." → "John Doe"
    const match = raw.match(/^"?([^"<]+)"?\s*</);
    if (match) return match[1].trim();
    // "john@company.com" → "john"
    return raw.split("@")[0];
  }, [thread.latestSender]);

  return (
    <button
      onClick={() => onClick(thread)}
      className={cn(
        "w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors",
        "border-b border-[rgba(255,255,255,0.04)] last:border-b-0",
        "hover:bg-[rgba(255,255,255,0.03)]",
        isUnread && "bg-[rgba(255,255,255,0.02)]"
      )}
    >
      {/* Sender Avatar */}
      <div
        className={cn(
          "shrink-0 w-[32px] h-[32px] rounded-[4px] flex items-center justify-center mt-0.5",
          isUnread
            ? "bg-[rgba(89,119,148,0.15)] text-[#597794]"
            : "bg-[rgba(255,255,255,0.06)] text-text-tertiary"
        )}
      >
        <span className="font-mohave text-body-sm font-semibold">{senderInitial}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: Sender + Opportunity badge + Time */}
        <div className="flex items-center gap-1.5 mb-0.5">
          {/* Direction icon */}
          {thread.latestDirection === "inbound" ? (
            <ArrowDownLeft className="w-[12px] h-[12px] text-text-disabled shrink-0" />
          ) : thread.latestDirection === "outbound" ? (
            <ArrowUpRight className="w-[12px] h-[12px] text-text-disabled shrink-0" />
          ) : null}

          <span
            className={cn(
              "font-mohave text-body-sm truncate",
              isUnread ? "text-text-primary font-semibold" : "text-text-secondary"
            )}
          >
            {senderDisplay}
          </span>

          {/* Opportunity badge */}
          <StatusBadge
            status={STAGE_STATUS_MAP[thread.opportunityStage] as any}
            label={thread.opportunityTitle}
            className="shrink-0 max-w-[140px] truncate"
          />

          {/* Spacer + timestamp */}
          <span className="ml-auto shrink-0 font-kosugi text-caption-sm text-text-disabled">
            {formatRelativeTime(thread.latestAt)}
          </span>
        </div>

        {/* Row 2: Subject */}
        <p
          className={cn(
            "font-mohave text-body-sm truncate leading-tight",
            isUnread ? "text-text-primary" : "text-text-secondary"
          )}
        >
          {thread.latestSubject}
        </p>

        {/* Row 3: Snippet + metadata */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="font-mohave text-body-sm text-text-disabled truncate flex-1">
            {thread.latestSnippet}
          </p>

          {/* Indicators */}
          <div className="flex items-center gap-1 shrink-0">
            {thread.hasAttachments && (
              <Paperclip className="w-[11px] h-[11px] text-text-disabled" />
            )}
            {thread.aiSummary && (
              <Sparkles className="w-[11px] h-[11px] text-[#597794]" />
            )}
            {thread.messageCount > 1 && (
              <span className="font-kosugi text-[10px] text-text-disabled">
                {thread.messageCount}
              </span>
            )}
            {isUnread && (
              <div className="w-[6px] h-[6px] rounded-full bg-[#597794]" />
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function ThreadSkeleton() {
  return (
    <div className="px-3 py-2.5 flex items-start gap-2.5 animate-pulse">
      <div className="w-[32px] h-[32px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-[14px] w-[100px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[14px] w-[60px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="ml-auto h-[12px] w-[30px] rounded bg-[rgba(255,255,255,0.06)]" />
        </div>
        <div className="h-[14px] w-[200px] rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="h-[12px] w-[260px] rounded bg-[rgba(255,255,255,0.06)]" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface PipelineThreadListProps {
  onSelectThread: (thread: PipelineThread) => void;
}

export function PipelineThreadList({ onSelectThread }: PipelineThreadListProps) {
  const { t } = useDictionary("inbox");
  const { data: threads, isLoading, error } = usePipelineThreads();

  const handleClick = useCallback(
    (thread: PipelineThread) => onSelectThread(thread),
    [onSelectThread]
  );

  if (isLoading) {
    return (
      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {Array.from({ length: 6 }, (_, i) => (
          <ThreadSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Mail className="w-[20px] h-[20px]" />}
        title={t("error")}
        className="py-12"
      />
    );
  }

  if (!threads || threads.length === 0) {
    return (
      <EmptyState
        icon={<MailOpen className="w-[20px] h-[20px]" />}
        title={t("pipeline.empty.title")}
        description={t("pipeline.empty.description")}
        className="py-12"
      />
    );
  }

  return (
    <div>
      {threads.map((thread) => (
        <ThreadRow key={thread.threadId} thread={thread} onClick={handleClick} />
      ))}
    </div>
  );
}
