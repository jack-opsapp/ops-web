"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { useUnifiedConversations } from "@/lib/hooks/use-unified-inbox";
import { ConversationList } from "@/components/ops/inbox/conversation-list";
import { UnifiedThreadView } from "@/components/ops/inbox/unified-thread-view";
import { ContextPanel } from "@/components/ops/inbox/context-panel";
import { ComposeEmailModal } from "@/components/ops/compose-email-modal";
import type { InboxConversation, InboxMessage, ChannelFilter } from "@/lib/types/unified-inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

export default function InboxPage() {
  usePageTitle("Inbox");
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);
  const { company } = useAuthStore();

  const [selectedConversation, setSelectedConversation] = useState<InboxConversation | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<ComposeEmailData | undefined>(undefined);
  const [threadMessages, setThreadMessages] = useState<InboxMessage[]>([]);
  const [goToThread, setGoToThread] = useState<((threadId: string) => void) | null>(null);

  // Single data source — emailThreadIds live on each conversation
  const { data: conversations = [], isLoading } = useUnifiedConversations();

  // E5: Fetch thread IDs with pending auto-drafts for sparkles badge
  const [autoDraftThreadIds, setAutoDraftThreadIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!company?.id) return;
    fetch(`/api/integrations/email/auto-drafts?companyId=${company.id}`)
      .then((res) => (res.ok ? res.json() : { autoDrafts: [] }))
      .then((data) => {
        const ids = new Set<string>();
        for (const d of (data.autoDrafts || []) as Array<{ threadId: string }>) {
          if (d.threadId) ids.add(d.threadId);
        }
        setAutoDraftThreadIds(ids);
      })
      .catch(() => {});
  }, [company?.id, conversations.length]);

  // Auto-select first conversation
  useEffect(() => {
    if (!selectedConversation && conversations.length > 0) {
      setSelectedConversation(conversations[0]);
    }
  }, [conversations, selectedConversation]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

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

  const handleGoToThreadReady = useCallback(
    (fn: (threadId: string) => void) => setGoToThread(() => fn),
    []
  );

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
    <div className="space-y-3">
      <div className="flex h-[calc(100vh-68px-96px)] overflow-hidden rounded border border-border">
      {/* Left: Conversation List */}
      <div style={{ width: 320 }} className="shrink-0 border-r border-border-subtle">
        <ConversationList
          conversations={conversations}
          isLoading={isLoading}
          selectedId={selectedConversation?.id ?? null}
          onSelect={handleSelectConversation}
          onNewMessage={handleNewMessage}
          autoDraftThreadIds={autoDraftThreadIds}
        />
      </div>

      {/* Center: Thread View */}
      <div className="flex-1 min-w-0">
        {selectedConversation ? (
          <UnifiedThreadView
            conversation={selectedConversation}
            emailThreadIds={selectedConversation.emailThreadIds}
            onToggleContext={handleToggleContext}
            contextOpen={contextOpen}
            onReply={handleReply}
            onMessagesLoaded={setThreadMessages}
            onGoToThreadReady={handleGoToThreadReady}
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
        messages={threadMessages}
        onGoToThread={goToThread ?? undefined}
      />

      </div>

      {/* Compose Email Modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        composeData={composeData}
      />
    </div>
  );
}
