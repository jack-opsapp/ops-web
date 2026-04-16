"use client";

import { useMemo, useEffect, useRef, useCallback, useState } from "react";
import { PanelRight, Link as LinkIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireSupabase } from "@/lib/supabase/helpers";
import { queryKeys } from "@/lib/api/query-client";
import { useUnifiedThread, useClientThreads, markPortalMessagesRead } from "@/lib/hooks/use-unified-inbox";
import { useMarkThreadRead } from "@/lib/hooks/use-inbox";
import { ChannelFilterBar } from "./channel-filter";
import { ThreadSelector } from "./thread-selector";
import type { EmailThread } from "./thread-selector";
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
  /** Expose loaded messages to parent (for context panel) */
  onMessagesLoaded?: (messages: InboxMessage[]) => void;
  /** Expose go-to-thread function to parent (for context panel navigation) */
  onGoToThreadReady?: (fn: (threadId: string) => void) => void;
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
  onMessagesLoaded,
  onGoToThreadReady,
}: UnifiedThreadViewProps) {
  const { t } = useDictionary("inbox");
  const companyId = useAuthStore((s) => s.company?.id);
  const currentUser = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  // Track previous filter to detect transitions
  const prevFilterRef = useRef<ChannelFilter>(filter);

  // ─── Discover ALL Gmail threads for this client ──────────────────────

  // For unmatched contacts, extract sender email from conversation ID
  const unmatchedEmail = conversation.type === "unmatched"
    ? conversation.id.replace("unmatched-", "")
    : null;

  const { data: clientThreadData } = useClientThreads(
    conversation.clientId,
    unmatchedEmail
  );

  // Use Gmail-discovered thread IDs, falling back to activities-based IDs
  const discoveredThreadIds = useMemo(() => {
    if (clientThreadData?.threads && clientThreadData.threads.length > 0) {
      return clientThreadData.threads.map((t) => t.threadId);
    }
    return emailThreadIds;
  }, [clientThreadData, emailThreadIds]);

  const connectionEmail = clientThreadData?.connectionEmail ?? null;

  const { data: messages = [], isLoading } = useUnifiedThread(
    conversation.id,
    conversation.clientId,
    discoveredThreadIds,
    filter,
    connectionEmail
  );

  const markEmailRead = useMarkThreadRead();

  // ─── Build thread list for selector ──────────────────────────────────
  // Prefer the client-threads API data (has subject + date without needing
  // to fetch every message). Fall back to deriving from loaded messages.

  const emailThreads: EmailThread[] = useMemo(() => {
    if (clientThreadData?.threads && clientThreadData.threads.length > 0) {
      return clientThreadData.threads.map((t) => ({
        threadId: t.threadId,
        subject: t.subject,
        latestTimestamp: new Date(t.latestDate),
      }));
    }

    // Fallback: derive from loaded messages
    const threadMap = new Map<string, EmailThread>();

    for (const msg of messages) {
      if (msg.channel !== "email" || !msg.emailThreadId) continue;
      const existing = threadMap.get(msg.emailThreadId);
      if (!existing || msg.timestamp.getTime() > existing.latestTimestamp.getTime()) {
        threadMap.set(msg.emailThreadId, {
          threadId: msg.emailThreadId,
          subject: msg.subject || "No subject",
          latestTimestamp: msg.timestamp,
        });
      }
    }

    return Array.from(threadMap.values()).sort(
      (a, b) => b.latestTimestamp.getTime() - a.latestTimestamp.getTime()
    );
  }, [clientThreadData, messages]);

  // ─── Auto-select thread on filter change ─────────────────────────────

  useEffect(() => {
    if (filter === "email") {
      // Entering email view — select most recent thread if none selected
      if (prevFilterRef.current !== "email" || !selectedThreadId) {
        if (emailThreads.length > 0) {
          setSelectedThreadId(emailThreads[0].threadId);
        }
      }
    } else {
      // Leaving email view — clear thread selection
      setSelectedThreadId(null);
    }
    prevFilterRef.current = filter;
  }, [filter, emailThreads, selectedThreadId]);

  // ─── Filter messages by selected thread ──────────────────────────────

  const visibleMessages = useMemo(() => {
    if (filter !== "email" || !selectedThreadId) return messages;
    return messages.filter((m) => m.emailThreadId === selectedThreadId);
  }, [messages, filter, selectedThreadId]);

  // ─── Mark as read ────────────────────────────────────────────────────

  useEffect(() => {
    if (!companyId) return;

    // Mark email threads as read
    if (emailThreadIds.length > 0) {
      for (const tid of emailThreadIds) {
        markEmailRead.mutate(tid);
      }
    }

    // Mark portal messages as read
    if (conversation.clientId) {
      markPortalMessagesRead(companyId, conversation.clientId).then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox.all });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, emailThreadIds.length]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleMessages]);

  // Expose ALL messages (not filtered) to parent for context panel.
  // Callback is held in a ref so its identity does not drive the effect —
  // prevents an infinite render loop when the parent passes an inline arrow.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  onMessagesLoadedRef.current = onMessagesLoaded;
  useEffect(() => {
    onMessagesLoadedRef.current?.(messages);
  }, [messages]);

  // Expose go-to-thread function to parent. Same ref pattern — only fire once.
  const onGoToThreadReadyRef = useRef(onGoToThreadReady);
  onGoToThreadReadyRef.current = onGoToThreadReady;
  useEffect(() => {
    onGoToThreadReadyRef.current?.((threadId: string) => {
      setFilter("email");
      setSelectedThreadId(threadId);
    });
    // Only expose once on mount — re-exposing on every render was the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const lastEmail = [...visibleMessages].reverse().find((m) => m.channel === "email");
    onReply({
      mode: "reply",
      to: lastEmail?.senderEmail ?? "",
      subject: lastEmail?.subject ?? "",
      quotedMessage: lastEmail?.content?.slice(0, 2000) ?? "",
      threadId: lastEmail?.emailThreadId ?? emailThreadIds[0],
      inReplyTo: lastEmail?.emailMessageId ?? undefined,
    });
  }, [visibleMessages, emailThreadIds, onReply]);

  // Build message list with dividers
  const renderedMessages = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let lastDateLabel = "";
    let lastChannel = "";
    let lastSubject = "";

    visibleMessages.forEach((msg, i) => {
      const dateLabel = getDateLabel(msg.timestamp);
      const prev = i > 0 ? visibleMessages[i - 1] : undefined;

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
  }, [visibleMessages, filter]);

  // Show thread selector when in email view with 2+ threads
  const showThreadSelector = filter === "email" && emailThreads.length > 1;

  // Loading skeleton
  const MessageSkeleton = () => (
    <div className="flex justify-start">
      <div className="max-w-[65%] animate-pulse">
        <div className="bg-surface-input rounded-panel px-3 py-2.5 space-y-1.5">
          <div className="h-[14px] w-[200px] rounded bg-surface-input" />
          <div className="h-[14px] w-[150px] rounded bg-border-subtle" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "w-[32px] h-[32px] rounded-full flex items-center justify-center shrink-0 font-kosugi text-caption-sm font-semibold",
              conversation.type === "unmatched"
                ? "bg-ops-amber-muted text-ops-amber"
                : "bg-ops-accent-muted text-ops-accent"
            )}
          >
            {conversation.avatarInitials}
          </div>
          <div className="min-w-0">
            <h2 className="font-mohave text-body text-text font-semibold truncate">
              {conversation.displayName}
            </h2>
            <p className="font-kosugi text-micro text-text-mute uppercase truncate">
              {conversation.projectName
                ? `${conversation.projectName} \u00b7 ${emailThreads.length + (conversation.hasPortalMessages ? 1 : 0)} threads`
                : `${emailThreads.length + (conversation.hasPortalMessages ? 1 : 0)} threads`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {conversation.type === "unmatched" && (
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-panel border border-border-subtle bg-surface-input text-text-3 font-kosugi text-micro uppercase tracking-wider hover:bg-glass glass-surface transition-colors">
              <LinkIcon className="w-3.5 h-3.5" />
              {t("unmatched.linkToClient")}
            </button>
          )}
          <button
            onClick={onToggleContext}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-panel border font-kosugi text-micro uppercase tracking-wider transition-colors",
              contextOpen
                ? "bg-ops-accent-muted text-ops-accent border-ops-accent/20"
                : "bg-surface-input text-text-3 border-border-subtle hover:bg-glass glass-surface"
            )}
          >
            <PanelRight className="w-3.5 h-3.5" />
            {t("context.toggle")}
          </button>
        </div>
      </div>

      {/* Messages area with floating toolbar */}
      <div className="flex-1 min-h-0 relative">
        {/* Floating toolbar row: channel filter + thread selector + create lead */}
        <div className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2">
          {/* Channel filter (always visible) */}
          <ChannelFilterBar active={filter} onChange={setFilter} />

          {/* Thread selector (email view, 2+ threads) */}
          {showThreadSelector && selectedThreadId && (
            <ThreadSelector
              threads={emailThreads}
              selectedThreadId={selectedThreadId}
              onSelect={setSelectedThreadId}
            />
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Create Lead button for unmatched contacts */}
          {conversation.type === "unmatched" && (
            <button
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-[5px] rounded-panel border shrink-0",
                "border-ops-accent/30 bg-ops-accent-muted/20 text-ops-accent",
                "hover:bg-ops-accent-muted/40 transition-colors duration-150 cursor-pointer"
              )}
            >
              <Plus className="w-3 h-3" />
              <span className="font-kosugi text-micro uppercase tracking-wider">
                Create Lead
              </span>
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-hide px-3.5 pt-12 pb-3 space-y-1.5">
          {isLoading && (
            <div className="space-y-3">
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton />
            </div>
          )}
          {!isLoading && renderedMessages}
        </div>
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
