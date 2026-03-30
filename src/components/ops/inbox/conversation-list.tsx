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
}

function ConversationSkeleton() {
  return (
    <div className="px-2.5 py-2.5 flex items-start gap-1.5 animate-pulse">
      <div className="w-[28px] h-[28px] rounded-full bg-[rgba(255,255,255,0.06)] shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="flex justify-between">
          <div className="h-[14px] w-[100px] rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="h-[12px] w-[24px] rounded bg-[rgba(255,255,255,0.04)]" />
        </div>
        <div className="h-[12px] w-3/4 rounded bg-[rgba(255,255,255,0.04)]" />
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
      <div className="p-2.5 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-[3px] px-2.5 py-[7px]">
          <Search className="w-[12px] h-[12px] text-[rgba(255,255,255,0.3)] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-micro-sm font-mohave text-text-primary placeholder:text-[rgba(255,255,255,0.25)] placeholder:uppercase outline-none"
          />
        </div>
      </div>

      {/* New Message */}
      <div className="px-2.5 py-1.5">
        <button
          onClick={onNewMessage}
          className="flex items-center justify-center gap-1 w-full py-[5px] rounded-[3px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)] transition-colors"
        >
          <Plus className="w-[11px] h-[11px] text-[rgba(255,255,255,0.4)]" />
          <span className="font-kosugi text-micro-xs text-[rgba(255,255,255,0.4)] uppercase tracking-[0.5px]">
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
          <div className="px-4 py-8 text-center">
            <p className="font-mohave text-body-sm text-text-disabled">
              {searchQuery ? "No conversations match your search." : t("empty.title")}
            </p>
            {!searchQuery && (
              <p className="font-kosugi text-micro-sm text-text-disabled mt-1">
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
              onClick={() => onSelect(conversation)}
            />
          ))}
      </div>
    </div>
  );
}
