"use client";

import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { PanelRight, Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";
import { useUnifiedThread, markPortalMessagesRead } from "@/lib/hooks/use-unified-inbox";
import { useMarkThreadRead } from "@/lib/hooks/use-inbox";
import { ChannelFilterBar } from "./channel-filter";
import { MessageBubble } from "./message-bubble";
import { ChannelDivider, DateDivider } from "./channel-divider";
import { UnifiedReplyBar } from "./unified-reply-bar";
import type { InboxConversation, InboxMessage, ChannelFilter } from "@/lib/types/unified-inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

interface UnifiedThreadViewProps {
  conversation: InboxConversation;
  emailThreadIds: string[];
  onToggleContext: () => void;
  contextOpen: boolean;
  onReply: (data: ComposeEmailData) => void;
}

// ─── Date formatting helpers ────────────────────────────────────────────────

function getDateLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shouldShowTimestamp(
  current: InboxMessage,
  previous: InboxMessage | undefined
): boolean {
  if (!previous) return true;
  if (current.direction !== previous.direction) return true;
  if (current.channel !== previous.channel) return true;
  // Group consecutive same-sender messages within 5 minutes
  const diffMs = current.timestamp.getTime() - previous.timestamp.getTime();
  return diffMs > 5 * 60_000;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function UnifiedThreadView({
  conversation,
  emailThreadIds,
  onToggleContext,
  contextOpen,
  onReply,
}: UnifiedThreadViewProps) {
  const { t } = useDictionary("inbox");
  const companyId = useAuthStore((s) => s.company?.id);
  const currentUser = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<ChannelFilter>("all");

  const { data: messages = [], isLoading } = useUnifiedThread(
    conversation.id,
    conversation.clientId,
    emailThreadIds,
    filter
  );

  const markEmailRead = useMarkThreadRead();

  // Mark as read on mount
  useEffect(() => {
    if (!companyId) return;

    // Mark email threads as read
    for (const tid of emailThreadIds) {
      markEmailRead.mutate(tid);
    }

    // Mark portal messages as read
    if (conversation.clientId) {
      markPortalMessagesRead(companyId, conversation.clientId).then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send portal message
  const sendPortalMutation = useMutation({
    mutationFn: async (content: string) => {
      const supabase = requireSupabase();
      const senderName = currentUser
        ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim() || currentUser.email || "Admin"
        : "Admin";

      const { error } = await supabase.from("portal_messages").insert({
        company_id: companyId,
        client_id: conversation.clientId,
        sender_type: "company",
        sender_name: senderName,
        content,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
    },
  });

  const handleSendEmail = useCallback(() => {
    // Find the last email message to build reply context
    const lastEmail = [...messages].reverse().find((m) => m.channel === "email");
    onReply({
      mode: "reply",
      to: lastEmail?.senderEmail ?? "",
      subject: lastEmail?.subject ?? "",
      quotedMessage: lastEmail?.content?.slice(0, 2000) ?? "",
      threadId: lastEmail?.emailThreadId ?? emailThreadIds[0],
      inReplyTo: lastEmail?.emailMessageId ?? undefined,
    });
  }, [messages, emailThreadIds, onReply]);

  // Build message list with dividers
  const renderedMessages = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let lastDateLabel = "";
    let lastChannel = "";
    let lastSubject = "";

    messages.forEach((msg, i) => {
      const dateLabel = getDateLabel(msg.timestamp);
      const prev = i > 0 ? messages[i - 1] : undefined;

      // Date divider
      if (dateLabel !== lastDateLabel) {
        elements.push(<DateDivider key={`date-${i}`} label={dateLabel} />);
        lastDateLabel = dateLabel;
        lastChannel = ""; // Reset channel tracking on new date
      }

      // Channel divider (only in "all" filter)
      if (filter === "all" && msg.channel !== lastChannel) {
        elements.push(
          <ChannelDivider
            key={`channel-${i}`}
            channel={msg.channel}
            subject={msg.channel === "email" ? msg.subject ?? undefined : undefined}
          />
        );
        lastChannel = msg.channel;
      } else if (msg.channel === "email" && msg.subject !== lastSubject) {
        // New email subject within same channel
        if (filter !== "portal") {
          elements.push(
            <ChannelDivider
              key={`subject-${i}`}
              channel="email"
              subject={msg.subject ?? undefined}
            />
          );
        }
      }

      if (msg.channel === "email") lastSubject = msg.subject ?? "";

      elements.push(
        <MessageBubble
          key={msg.id}
          message={msg}
          showTimestamp={shouldShowTimestamp(msg, prev)}
        />
      );
    });

    return elements;
  }, [messages, filter]);

  // Loading skeleton
  const MessageSkeleton = () => (
    <div className="flex justify-start">
      <div className="max-w-[65%] animate-pulse">
        <div className="bg-[rgba(255,255,255,0.04)] rounded-[3px] px-3 py-2.5 space-y-1.5">
          <div className="h-[14px] w-[200px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[14px] w-[150px] rounded bg-[rgba(255,255,255,0.04)]" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 font-kosugi text-caption-sm font-semibold",
              conversation.type === "unmatched"
                ? "bg-[rgba(255,165,0,0.1)] text-[rgba(255,165,0,0.5)]"
                : "bg-[rgba(89,119,148,0.25)] text-[#597794]"
            )}
          >
            {conversation.avatarInitials}
          </div>
          <div className="min-w-0">
            <h2 className="font-mohave text-body text-text-primary font-semibold truncate">
              {conversation.displayName}
            </h2>
            <p className="font-kosugi text-micro-sm text-text-disabled uppercase truncate">
              {conversation.projectName
                ? `${conversation.projectName} \u00b7 ${emailThreadIds.length + (conversation.hasPortalMessages ? 1 : 0)} threads`
                : `${emailThreadIds.length + (conversation.hasPortalMessages ? 1 : 0)} threads`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {conversation.type === "unmatched" && (
            <button className="flex items-center gap-1 px-2 py-1 rounded-[3px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] font-kosugi text-micro-sm uppercase tracking-[0.3px] hover:bg-[rgba(255,255,255,0.06)] transition-colors">
              <LinkIcon className="w-[10px] h-[10px]" />
              {t("unmatched.linkToClient")}
            </button>
          )}
          <button
            onClick={onToggleContext}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-[3px] border border-[rgba(255,255,255,0.06)] font-kosugi text-micro-sm uppercase tracking-[0.3px] transition-colors",
              contextOpen
                ? "bg-[rgba(89,119,148,0.1)] text-[#597794] border-[rgba(89,119,148,0.2)]"
                : "bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] hover:bg-[rgba(255,255,255,0.06)]"
            )}
          >
            <PanelRight className="w-[10px] h-[10px]" />
            {t("context.toggle")}
          </button>
        </div>
      </div>

      {/* Channel filter */}
      <ChannelFilterBar active={filter} onChange={setFilter} />

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide px-3.5 py-3 space-y-1.5">
        {isLoading && (
          <div className="space-y-3">
            <MessageSkeleton />
            <MessageSkeleton />
            <MessageSkeleton />
          </div>
        )}
        {!isLoading && renderedMessages}
      </div>

      {/* Reply bar */}
      {conversation.clientId && (
        <UnifiedReplyBar
          defaultChannel={conversation.lastMessageChannel}
          onSendPortal={(content) => sendPortalMutation.mutate(content)}
          onSendEmail={handleSendEmail}
          isSending={sendPortalMutation.isPending}
          hasEmailThreads={conversation.hasEmailThreads}
          hasPortalMessages={conversation.hasPortalMessages}
        />
      )}
    </div>
  );
}
