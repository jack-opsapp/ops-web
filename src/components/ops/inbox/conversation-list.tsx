"use client";

import { useState, useMemo, useCallback } from "react";
import { Search, Plus } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { ConversationItem } from "./conversation-item";
import type { InboxConversation } from "@/lib/types/unified-inbox";

interface ConversationListProps {
  conversations: InboxConversation[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (conversation: InboxConversation) => void;
  onNewMessage: () => void;
  /** Thread IDs with pending auto-drafts — shows sparkles badge. */
  autoDraftThreadIds?: Set<string>;
}

function ConversationSkeleton() {
  return (
    <div className="px-2.5 py-2.5 flex items-start gap-1.5 animate-pulse">
      <div className="w-[28px] h-[28px] rounded-full bg-surface-input shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex justify-between">
          <div className="h-[14px] w-[100px] rounded bg-surface-input" />
          <div className="h-[12px] w-[24px] rounded bg-border-subtle" />
        </div>
        <div className="h-[12px] w-3/4 rounded bg-border-subtle" />
      </div>
    </div>
  );
}

export function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  onNewMessage,
  autoDraftThreadIds,
}: ConversationListProps) {
  const { t } = useDictionary("inbox");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q) ||
        (c.projectName?.toLowerCase().includes(q) ?? false)
    );
  }, [conversations, searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      const currentIndex = filtered.findIndex((c) => c.id === selectedId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIndex + 1, filtered.length - 1);
        onSelect(filtered[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIndex - 1, 0);
        onSelect(filtered[prev]);
      } else if ((e.key === "Enter" || e.key === "ArrowRight") && currentIndex >= 0) {
        e.preventDefault();
        onSelect(filtered[currentIndex]);
      }
    },
    [filtered, selectedId, onSelect]
  );

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Search */}
      <div className="p-2.5 border-b border-border-subtle">
        <div className="flex items-center gap-1.5 bg-surface-input border border-border-subtle rounded-[3px] px-2.5 py-[7px]">
          <Search className="w-3.5 h-3.5 text-text-mute shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-body-sm font-mohave text-text placeholder:text-text-3 placeholder:uppercase outline-none"
          />
        </div>
      </div>

      {/* New Message */}
      <div className="px-2.5 py-1.5">
        <button
          onClick={onNewMessage}
          className="flex items-center justify-center gap-1 w-full py-[5px] rounded-[3px] border border-border-subtle bg-surface-input hover:bg-background-card transition-colors"
        >
          <Plus className="w-[12px] h-[12px] text-text-mute" />
          <span className="font-kosugi text-micro text-text-mute uppercase tracking-[0.5px]">
            {t("newMessage")}
          </span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {isLoading && (
          <>
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
            <ConversationSkeleton />
          </>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="px-4 py-8 text-left">
            <p className="font-mohave text-body-sm text-text-mute">
              {searchQuery ? "No conversations match your search." : t("empty.title")}
            </p>
            {!searchQuery && (
              <p className="font-kosugi text-caption-sm text-text-mute mt-1">
                {t("empty.description")}
              </p>
            )}
          </div>
        )}

        {!isLoading &&
          filtered.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === selectedId}
              hasAutoDraft={autoDraftThreadIds?.has(conversation.id) ?? false}
              onClick={() => onSelect(conversation)}
            />
          ))}
      </div>
    </div>
  );
}
