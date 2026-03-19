"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Mail,
  MailOpen,
  Search,
  Paperclip,
  Link2Off,
  Settings,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { EmptyState } from "@/components/ops/empty-state";
import { Button } from "@/components/ui/button";
import { useAllMail } from "@/lib/hooks/use-inbox";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";
import type { AllMailMessage } from "@/lib/types/inbox";
import { useRouter } from "next/navigation";

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

// ─── Mail Row ─────────────────────────────────────────────────────────────────

function MailRow({
  message,
  onClick,
}: {
  message: AllMailMessage;
  onClick: (msg: AllMailMessage) => void;
}) {
  const isUnread = !message.isRead;
  const senderInitial = message.fromName
    ? message.fromName.charAt(0).toUpperCase()
    : message.from.charAt(0).toUpperCase();

  return (
    <button
      onClick={() => onClick(message)}
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
        {/* Row 1: Sender + Time */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={cn(
              "font-mohave text-body-sm truncate",
              isUnread ? "text-text-primary font-semibold" : "text-text-secondary"
            )}
          >
            {message.fromName || message.from.split("@")[0]}
          </span>

          <span className="ml-auto shrink-0 font-kosugi text-caption-sm text-text-disabled">
            {formatRelativeTime(message.date)}
          </span>
        </div>

        {/* Row 2: Subject */}
        <p
          className={cn(
            "font-mohave text-body-sm truncate leading-tight",
            isUnread ? "text-text-primary" : "text-text-secondary"
          )}
        >
          {message.subject || "(no subject)"}
        </p>

        {/* Row 3: Snippet + indicators */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="font-mohave text-body-sm text-text-disabled truncate flex-1">
            {message.snippet}
          </p>

          <div className="flex items-center gap-1 shrink-0">
            {message.hasAttachments && (
              <Paperclip className="w-[11px] h-[11px] text-text-disabled" />
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

function MailSkeleton() {
  return (
    <div className="px-3 py-2.5 flex items-start gap-2.5 animate-pulse">
      <div className="w-[32px] h-[32px] rounded-[4px] bg-[rgba(255,255,255,0.06)]" />
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="h-[14px] w-[120px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="ml-auto h-[12px] w-[30px] rounded bg-[rgba(255,255,255,0.06)]" />
        </div>
        <div className="h-[14px] w-[200px] rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="h-[12px] w-[260px] rounded bg-[rgba(255,255,255,0.06)]" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface AllMailListProps {
  onSelectThread: (threadId: string, subject: string) => void;
}

export function AllMailList({ onSelectThread }: AllMailListProps) {
  const { t } = useDictionary("inbox");
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);

  // Debounce search
  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    setPageSize(50); // Reset pagination on new search
    // Simple debounce via setTimeout
    const timer = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(timer);
  }, []);

  const { data: connections } = useEmailConnections();
  const hasConnection = (connections ?? []).length > 0;

  const { data, isLoading, isFetching, error } = useAllMail(debouncedQuery, pageSize);
  const messages = data?.messages ?? [];

  const handleLoadMore = useCallback(() => {
    setPageSize((prev) => prev + 50);
  }, []);

  // No email connection state
  if (!isLoading && !hasConnection) {
    return (
      <EmptyState
        icon={<Link2Off className="w-[20px] h-[20px]" />}
        title={t("allMail.noConnection.title")}
        description={t("allMail.noConnection.description")}
        action={{
          label: t("allMail.noConnection.cta"),
          onClick: () => router.push("/settings"),
        }}
        className="py-12"
      />
    );
  }

  return (
    <div>
      {/* Search Bar */}
      <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)]">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-disabled" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("allMail.search.placeholder")}
            className={cn(
              "w-full pl-7 pr-3 py-1.5 rounded-[4px]",
              "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)]",
              "font-mohave text-body-sm text-text-primary placeholder:text-text-disabled",
              "focus:outline-none focus:border-[rgba(89,119,148,0.4)]",
              "transition-colors"
            )}
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="divide-y divide-[rgba(255,255,255,0.04)]">
          {Array.from({ length: 8 }, (_, i) => (
            <MailSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <EmptyState
          icon={<Mail className="w-[20px] h-[20px]" />}
          title={t("error")}
          className="py-12"
        />
      )}

      {/* Empty */}
      {!isLoading && !error && messages.length === 0 && (
        <EmptyState
          icon={<MailOpen className="w-[20px] h-[20px]" />}
          title={t("allMail.empty.title")}
          description={t("allMail.empty.description")}
          className="py-12"
        />
      )}

      {/* Message List */}
      {!isLoading && messages.length > 0 && (
        <>
          {messages.map((msg) => (
            <MailRow
              key={msg.id}
              message={msg}
              onClick={(m) => onSelectThread(m.threadId, m.subject)}
            />
          ))}

          {data?.hasMore && (
            <div className="px-3 py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                disabled={isFetching}
                className="font-mohave text-body-sm uppercase text-text-tertiary"
              >
                {isFetching ? (
                  <Loader2 className="w-[14px] h-[14px] animate-spin mr-1" />
                ) : null}
                {t("allMail.loadMore")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
