"use client";

import { useState, useCallback, useEffect } from "react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useUnifiedConversations } from "@/lib/hooks/use-unified-inbox";
import { usePipelineThreads } from "@/lib/hooks/use-inbox";
import { ConversationList } from "@/components/ops/inbox/conversation-list";
import { UnifiedThreadView } from "@/components/ops/inbox/unified-thread-view";
import { ContextPanel } from "@/components/ops/inbox/context-panel";
import { ResizableDivider } from "@/components/ops/inbox/resizable-divider";
import { ComposeEmailModal } from "@/components/ops/compose-email-modal";
import type { InboxConversation } from "@/lib/types/unified-inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

const LIST_MIN = 240;
const LIST_MAX = 400;
const LIST_DEFAULT = 300;
const STORAGE_KEY = "ops-inbox-list-width";

function getStoredWidth(): number {
  if (typeof window === "undefined") return LIST_DEFAULT;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= LIST_MIN && parsed <= LIST_MAX) return parsed;
  }
  return LIST_DEFAULT;
}

export default function InboxPage() {
  usePageTitle("Inbox");
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);

  const [listWidth, setListWidth] = useState(getStoredWidth);
  const [selectedConversation, setSelectedConversation] = useState<InboxConversation | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<ComposeEmailData | undefined>(undefined);

  // Data
  const { data: conversations = [], isLoading } = useUnifiedConversations();
  const { data: pipelineThreads = [] } = usePipelineThreads();

  // Auto-select first conversation
  useEffect(() => {
    if (!selectedConversation && conversations.length > 0) {
      setSelectedConversation(conversations[0]);
    }
  }, [conversations, selectedConversation]);

  // Get email thread IDs for the selected conversation's client
  const emailThreadIds = selectedConversation?.clientId
    ? pipelineThreads
        .filter((t) => t.clientId === selectedConversation.clientId)
        .map((t) => t.threadId)
    : [];

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleResize = useCallback((delta: number) => {
    setListWidth((prev) => {
      const next = Math.max(LIST_MIN, Math.min(LIST_MAX, prev + delta));
      return next;
    });
  }, []);

  const handleResizeEnd = useCallback(() => {
    setListWidth((current) => {
      localStorage.setItem(STORAGE_KEY, String(current));
      return current;
    });
  }, []);

  const handleSelectConversation = useCallback((conv: InboxConversation) => {
    setSelectedConversation(conv);
  }, []);

  const handleReply = useCallback((data: ComposeEmailData) => {
    setComposeData(data);
    setComposeOpen(true);
  }, []);

  const handleNewMessage = useCallback(() => {
    setComposeData({ mode: "new" });
    setComposeOpen(true);
  }, []);

  const handleToggleContext = useCallback(() => {
    setContextOpen((prev) => !prev);
  }, []);

  // Keyboard: Escape to close context panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextOpen) {
          setContextOpen(false);
        }
      }
      // Cmd+K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          '[placeholder]'
        );
        searchInput?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextOpen]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-68px)] flex rounded-[4px] border border-border bg-[rgba(255,255,255,0.02)] overflow-hidden">
      {/* Left: Conversation List */}
      <div style={{ width: listWidth, minWidth: listWidth }} className="shrink-0">
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedId={selectedConversation?.id ?? null}
          onSelect={handleSelectConversation}
          onNewMessage={handleNewMessage}
        />
      </div>

      {/* Resizable Divider */}
      <ResizableDivider onResize={handleResize} onResizeEnd={handleResizeEnd} />

      {/* Center: Thread View */}
      <div className="flex-1 min-w-0">
        {selectedConversation ? (
          <UnifiedThreadView
            conversation={selectedConversation}
            emailThreadIds={emailThreadIds}
            onToggleContext={handleToggleContext}
            contextOpen={contextOpen}
            onReply={handleReply}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="font-mohave text-body text-text-disabled">
              {t("empty.title")}
            </p>
          </div>
        )}
      </div>

      {/* Right: Context Panel */}
      <ContextPanel
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        conversation={selectedConversation}
      />

      {/* Compose Email Modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        composeData={composeData}
      />
    </div>
  );
}
