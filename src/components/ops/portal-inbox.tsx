"use client";

/**
 * OPS Web - Portal Inbox Component
 *
 * Reusable split-view inbox for admin portal messages.
 * Shows conversation list on the left, thread on the right.
 * Responsive: full list -> click -> full thread with back button on mobile.
 */

import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft,
  MessageSquare,
  Send,
  Loader2,
  Inbox,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "@/lib/utils/date";
import type { PortalMessage } from "@/lib/types/portal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Conversation {
  clientId: string;
  clientName: string;
  lastMessage: string;
  lastMessageAt: Date;
  unreadCount: number;
}

interface PortalInboxProps {
  conversations: Conversation[];
  isLoadingConversations: boolean;
  selectedClientId: string | null;
  onSelectConversation: (clientId: string) => void;
  messages: PortalMessage[];
  isLoadingMessages: boolean;
  onSendMessage: (content: string) => void;
  isSending: boolean;
  onMarkRead?: (clientId: string) => void;
}

// ─── Conversation List Item ──────────────────────────────────────────────────

function ConversationItem({
  conversation,
  isSelected,
  onClick,
}: {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-lg transition-all duration-150",
        "hover:bg-[rgba(255,255,255,0.04)] group",
        isSelected && "bg-[rgba(255,255,255,0.06)] border-l-2 border-l-ops-accent",
        !isSelected && "border-l-2 border-l-transparent"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Avatar */}
        <div className="w-[36px] h-[36px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0 mt-[2px]">
          <User className="w-[16px] h-[16px] text-ops-accent" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={cn(
                "font-mohave text-body truncate",
                conversation.unreadCount > 0
                  ? "text-text-primary font-medium"
                  : "text-text-secondary"
              )}
            >
              {conversation.clientName}
            </span>
            {conversation.unreadCount > 0 && (
              <Badge variant="info" className="text-[10px] px-[6px] py-[1px] shrink-0">
                {conversation.unreadCount}
              </Badge>
            )}
          </div>

          <p className="font-mohave text-body-sm text-text-tertiary truncate mt-[2px]">
            {conversation.lastMessage}
          </p>

          <span className="font-mono text-[10px] text-text-disabled mt-[2px] block">
            {formatDistanceToNow(new Date(conversation.lastMessageAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: PortalMessage }) {
  const isCompany = message.senderType === "company";

  return (
    <div
      className={cn(
        "flex w-full",
        isCompany ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-2 py-1.5",
          isCompany
            ? "bg-ops-accent/20 border border-ops-accent/30"
            : "bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)]"
        )}
      >
        <div className="flex items-center gap-1 mb-[4px]">
          <span
            className={cn(
              "font-kosugi text-[10px] uppercase tracking-wider",
              isCompany ? "text-ops-accent" : "text-text-tertiary"
            )}
          >
            {message.senderName}
          </span>
        </div>
        <p className="font-mohave text-body-sm text-text-primary whitespace-pre-wrap break-words">
          {message.content}
        </p>
        <span className="font-mono text-[10px] text-text-disabled mt-[4px] block">
          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

// ─── Thread View ─────────────────────────────────────────────────────────────

function ThreadView({
  clientName,
  messages,
  isLoading,
  onSend,
  isSending,
  onBack,
  showBackButton,
}: {
  clientName: string;
  messages: PortalMessage[];
  isLoading: boolean;
  onSend: (content: string) => void;
  isSending: boolean;
  onBack?: () => void;
  showBackButton: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Sort messages chronologically (oldest first) for thread display
  const sortedMessages = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border shrink-0">
        {showBackButton && onBack && (
          <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
            <ArrowLeft className="w-[18px] h-[18px]" />
          </Button>
        )}
        <div className="w-[32px] h-[32px] rounded-full bg-ops-accent-muted flex items-center justify-center shrink-0">
          <User className="w-[14px] h-[14px] text-ops-accent" />
        </div>
        <div>
          <h3 className="font-mohave text-body text-text-primary">{clientName}</h3>
          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
            Portal Messages
          </span>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-[20px] h-[20px] text-text-disabled animate-spin" />
            <span className="font-mono text-body-sm text-text-disabled ml-1">
              Loading messages...
            </span>
          </div>
        ) : sortedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <MessageSquare className="w-[36px] h-[36px] text-text-disabled mb-1" />
            <p className="font-mohave text-body text-text-tertiary">No messages yet</p>
            <p className="font-kosugi text-caption-sm text-text-disabled mt-[4px]">
              Send a message to start the conversation
            </p>
          </div>
        ) : (
          sortedMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Compose area */}
      <div className="border-t border-border px-2 py-1.5 shrink-0">
        <div className="flex items-end gap-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            className="min-h-[40px] max-h-[120px] resize-none"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!draft.trim() || isSending}
            loading={isSending}
            className="shrink-0 gap-[4px]"
          >
            <Send className="w-[14px] h-[14px]" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function PortalInbox({
  conversations,
  isLoadingConversations,
  selectedClientId,
  onSelectConversation,
  messages,
  isLoadingMessages,
  onSendMessage,
  isSending,
  onMarkRead,
}: PortalInboxProps) {
  const [mobileShowThread, setMobileShowThread] = useState(false);

  const selectedConversation = conversations.find(
    (c) => c.clientId === selectedClientId
  );

  function handleSelectConversation(clientId: string) {
    onSelectConversation(clientId);
    setMobileShowThread(true);
    onMarkRead?.(clientId);
  }

  function handleMobileBack() {
    setMobileShowThread(false);
  }

  return (
    <div className="flex h-[calc(100vh-180px)] border border-border rounded-lg overflow-hidden bg-background">
      {/* Conversation list - hidden on mobile when thread is showing */}
      <div
        className={cn(
          "w-full md:w-[340px] md:min-w-[280px] border-r border-border flex flex-col shrink-0",
          mobileShowThread && "hidden md:flex"
        )}
      >
        {/* List header */}
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <div className="flex items-center gap-1">
            <Inbox className="w-[18px] h-[18px] text-text-secondary" />
            <h2 className="font-mohave text-heading text-text-primary">Inbox</h2>
            {conversations.length > 0 && (
              <span className="font-mono text-[11px] text-text-tertiary">
                ({conversations.length})
              </span>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-1 px-1 space-y-[2px]">
          {isLoadingConversations ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-[20px] h-[20px] text-text-disabled animate-spin" />
              <span className="font-mono text-body-sm text-text-disabled ml-1">
                Loading conversations...
              </span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-2">
              <Inbox className="w-[40px] h-[40px] text-text-disabled mb-1" />
              <p className="font-mohave text-body text-text-tertiary text-center">
                No messages yet
              </p>
              <p className="font-kosugi text-caption-sm text-text-disabled mt-[4px] text-center">
                Portal messages from clients will appear here
              </p>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.clientId}
                conversation={conv}
                isSelected={conv.clientId === selectedClientId}
                onClick={() => handleSelectConversation(conv.clientId)}
              />
            ))
          )}
        </div>
      </div>

      {/* Thread view - hidden on mobile when list is showing */}
      <div
        className={cn(
          "flex-1 min-w-0",
          !mobileShowThread && "hidden md:block"
        )}
      >
        {selectedConversation ? (
          <ThreadView
            clientName={selectedConversation.clientName}
            messages={messages}
            isLoading={isLoadingMessages}
            onSend={onSendMessage}
            isSending={isSending}
            onBack={handleMobileBack}
            showBackButton={mobileShowThread}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-12">
            <MessageSquare className="w-[48px] h-[48px] text-text-disabled mb-1.5" />
            <p className="font-mohave text-body-lg text-text-tertiary">
              Select a conversation
            </p>
            <p className="font-kosugi text-caption-sm text-text-disabled mt-[4px]">
              Choose a client from the list to view their messages
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
