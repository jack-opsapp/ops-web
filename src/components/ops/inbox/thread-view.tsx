"use client";

import { useEffect, useMemo } from "react";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  Sparkles,
  EyeOff,
  Eye,
  Reply,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import {
  usePipelineThreadMessages,
  useAllMailThread,
  useMarkThreadRead,
  useMarkThreadUnread,
} from "@/lib/hooks/use-inbox";
import type { ThreadMessage } from "@/lib/types/inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ThreadViewProps {
  /** The email_thread_id to display */
  threadId: string;
  /** Source tab — determines which hook to use for fetching */
  source: "pipeline" | "all-mail";
  /** Optional AI summary to display at top (pipeline threads only) */
  aiSummary?: string | null;
  /** Optional opportunity title (pipeline threads only) */
  opportunityTitle?: string;
  /** Callback to go back to the thread list */
  onBack: () => void;
  /** Callback to open compose modal in reply mode */
  onReply?: (data: ComposeEmailData) => void;
}

// ─── Time Formatting ──────────────────────────────────────────────────────────

function formatMessageTime(date: Date): string {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isToday) return time;

  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return `${dateStr}, ${time}`;
}

// ─── Sender Display ───────────────────────────────────────────────────────────

function extractSenderName(from: string | null): string {
  if (!from) return "Unknown";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split("@")[0];
}

function extractSenderEmail(from: string | null): string {
  if (!from) return "";
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1];
  return from;
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ThreadMessage }) {
  const isOutbound = message.direction === "outbound";
  const senderName = extractSenderName(message.fromEmail);
  const senderEmail = extractSenderEmail(message.fromEmail);
  const body = message.bodyText || message.content || "";

  return (
    <div
      className={cn(
        "px-3 py-3 border-b border-[rgba(255,255,255,0.04)] last:border-b-0",
        !message.isRead && "bg-[rgba(255,255,255,0.015)]"
      )}
    >
      {/* Header: sender, direction, time */}
      <div className="flex items-center gap-1.5 mb-2">
        {/* Direction indicator */}
        {isOutbound ? (
          <ArrowUpRight className="w-[13px] h-[13px] text-text-mute shrink-0" />
        ) : (
          <ArrowDownLeft className="w-[13px] h-[13px] text-text-mute shrink-0" />
        )}

        {/* Sender name */}
        <span className="font-mohave text-body-sm text-text font-semibold truncate">
          {senderName}
        </span>

        {/* Sender email */}
        <span className="font-mohave text-body-sm text-text-mute truncate hidden sm:inline">
          &lt;{senderEmail}&gt;
        </span>

        {/* Attachments indicator */}
        {message.hasAttachments && message.attachmentCount > 0 && (
          <span className="flex items-center gap-0.5 shrink-0">
            <Paperclip className="w-[11px] h-[11px] text-text-mute" />
            <span className="font-kosugi text-[10px] text-text-mute">
              {message.attachmentCount}
            </span>
          </span>
        )}

        {/* Timestamp */}
        <span className="ml-auto shrink-0 font-kosugi text-caption-sm text-text-mute">
          {formatMessageTime(message.createdAt)}
        </span>
      </div>

      {/* Recipients (if outbound) */}
      {isOutbound && message.toEmails.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          <span className="font-kosugi text-[10px] text-text-mute uppercase">To:</span>
          <span className="font-mohave text-body-sm text-text-mute truncate">
            {message.toEmails.join(", ")}
          </span>
        </div>
      )}

      {/* CC */}
      {message.ccEmails.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          <span className="font-kosugi text-[10px] text-text-mute uppercase">Cc:</span>
          <span className="font-mohave text-body-sm text-text-mute truncate">
            {message.ccEmails.join(", ")}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="font-mohave text-body-sm text-text-2 whitespace-pre-wrap leading-relaxed break-words">
        {body || (
          <span className="italic text-text-mute">No message content available.</span>
        )}
      </div>
    </div>
  );
}

// ─── All Mail Message Bubble (from API) ───────────────────────────────────────

function AllMailMessageBubble({
  message,
}: {
  message: {
    id: string;
    from: string;
    fromName: string;
    to: string[];
    cc: string[];
    subject: string;
    bodyText: string;
    date: Date;
    isRead: boolean;
    hasAttachments: boolean;
  };
}) {
  return (
    <div
      className={cn(
        "px-3 py-3 border-b border-[rgba(255,255,255,0.04)] last:border-b-0",
        !message.isRead && "bg-[rgba(255,255,255,0.015)]"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="font-mohave text-body-sm text-text font-semibold truncate">
          {message.fromName || message.from.split("@")[0]}
        </span>
        <span className="font-mohave text-body-sm text-text-mute truncate hidden sm:inline">
          &lt;{message.from}&gt;
        </span>
        {message.hasAttachments && (
          <Paperclip className="w-[11px] h-[11px] text-text-mute shrink-0" />
        )}
        <span className="ml-auto shrink-0 font-kosugi text-caption-sm text-text-mute">
          {formatMessageTime(message.date)}
        </span>
      </div>

      {/* Recipients */}
      {message.to.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          <span className="font-kosugi text-[10px] text-text-mute uppercase">To:</span>
          <span className="font-mohave text-body-sm text-text-mute truncate">
            {message.to.join(", ")}
          </span>
        </div>
      )}
      {message.cc.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          <span className="font-kosugi text-[10px] text-text-mute uppercase">Cc:</span>
          <span className="font-mohave text-body-sm text-text-mute truncate">
            {message.cc.join(", ")}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="font-mohave text-body-sm text-text-2 whitespace-pre-wrap leading-relaxed break-words">
        {message.bodyText || (
          <span className="italic text-text-mute">No message content available.</span>
        )}
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function MessageSkeleton() {
  return (
    <div className="px-3 py-3 space-y-2 animate-pulse border-b border-[rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-2">
        <div className="h-[14px] w-[100px] rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="h-[14px] w-[160px] rounded bg-[rgba(255,255,255,0.06)]" />
        <div className="ml-auto h-[12px] w-[60px] rounded bg-[rgba(255,255,255,0.06)]" />
      </div>
      <div className="space-y-1">
        <div className="h-[14px] w-full rounded bg-[rgba(255,255,255,0.04)]" />
        <div className="h-[14px] w-3/4 rounded bg-[rgba(255,255,255,0.04)]" />
        <div className="h-[14px] w-1/2 rounded bg-[rgba(255,255,255,0.04)]" />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ThreadView({
  threadId,
  source,
  aiSummary,
  opportunityTitle,
  onBack,
  onReply,
}: ThreadViewProps) {
  const { t } = useDictionary("inbox");
  const markRead = useMarkThreadRead();
  const markUnread = useMarkThreadUnread();

  // Fetch messages based on source
  const pipelineQuery = usePipelineThreadMessages(
    source === "pipeline" ? threadId : null
  );
  const allMailQuery = useAllMailThread(
    source === "all-mail" ? threadId : null
  );

  const isLoading =
    source === "pipeline" ? pipelineQuery.isLoading : allMailQuery.isLoading;

  // Mark thread as read when opening (pipeline only — we own those records)
  useEffect(() => {
    if (source === "pipeline" && threadId) {
      markRead.mutate(threadId);
    }
    // Only fire on mount/threadId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, source]);

  // Subject line from first message
  const subject = useMemo(() => {
    if (source === "pipeline") {
      const msgs = pipelineQuery.data;
      return msgs?.[0]?.subject || "(no subject)";
    }
    const msgs = allMailQuery.data?.messages;
    return msgs?.[0]?.subject || "(no subject)";
  }, [source, pipelineQuery.data, allMailQuery.data]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
        <button
          onClick={onBack}
          className="shrink-0 p-1 rounded-[4px] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          title={t("thread.back")}
        >
          <ArrowLeft className="w-[16px] h-[16px] text-text-3" />
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="font-mohave text-body text-text truncate">
            {subject}
          </h2>
          {opportunityTitle && (
            <p className="font-kosugi text-caption-sm text-text-mute uppercase truncate">
              {opportunityTitle}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {onReply && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // Build reply data from the last inbound message
                const msgs =
                  source === "pipeline"
                    ? pipelineQuery.data
                    : allMailQuery.data?.messages;
                const lastMsg = msgs?.[msgs.length - 1];
                const replyTo =
                  lastMsg && "fromEmail" in lastMsg
                    ? extractSenderEmail((lastMsg as ThreadMessage).fromEmail)
                    : lastMsg && "from" in lastMsg
                      ? (lastMsg as { from: string }).from
                      : "";
                const replyBody =
                  lastMsg && "bodyText" in lastMsg
                    ? (lastMsg as { bodyText?: string }).bodyText ?? ""
                    : lastMsg && "content" in lastMsg
                      ? (lastMsg as { content?: string }).content ?? ""
                      : "";

                // Extract message ID for In-Reply-To header (Gmail threading)
                const replyMessageId =
                  lastMsg && "emailMessageId" in lastMsg
                    ? (lastMsg as { emailMessageId?: string }).emailMessageId
                    : lastMsg && "id" in lastMsg
                      ? (lastMsg as { id?: string }).id
                      : undefined;

                onReply({
                  mode: "reply",
                  to: replyTo,
                  subject,
                  quotedMessage: replyBody.slice(0, 2000),
                  threadId,
                  inReplyTo: replyMessageId,
                });
              }}
              className="shrink-0 text-text-3"
              title={t("thread.reply")}
            >
              <Reply className="w-[14px] h-[14px]" />
            </Button>
          )}
          {source === "pipeline" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markUnread.mutate(threadId)}
              className="shrink-0 text-text-3"
              title={t("thread.markUnread")}
            >
              <EyeOff className="w-[14px] h-[14px]" />
            </Button>
          )}
        </div>
      </div>

      {/* AI Summary Banner */}
      {source === "pipeline" && aiSummary && (
        <div className="shrink-0 mx-3 mt-2 px-3 py-2 rounded-[4px] bg-[rgba(89,119,148,0.08)] border border-[rgba(89,119,148,0.15)]">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="w-[12px] h-[12px] text-[#597794]" />
            <span className="font-kosugi text-[10px] text-[#597794] uppercase tracking-wider">
              {t("thread.aiSummary")}
            </span>
          </div>
          <p className="font-mohave text-body-sm text-text-2 leading-relaxed">
            {aiSummary}
          </p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading && (
          <>
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </>
        )}

        {/* Pipeline thread messages */}
        {source === "pipeline" &&
          !isLoading &&
          pipelineQuery.data?.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

        {/* All-mail thread messages */}
        {source === "all-mail" &&
          !isLoading &&
          allMailQuery.data?.messages.map((msg) => (
            <AllMailMessageBubble key={msg.id} message={msg as any} />
          ))}
      </div>
    </div>
  );
}
