"use client";

import { useState, useMemo, useCallback } from "react";
import { Mail, PenSquare } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { cn } from "@/lib/utils/cn";
import { useInboxUnreadCount } from "@/lib/hooks/use-inbox";
import { useInboxMetrics } from "@/lib/hooks";
import { MetricsHeader } from "@/components/metrics";
import { PipelineThreadList } from "@/components/ops/inbox/pipeline-thread-list";
import { AllMailList } from "@/components/ops/inbox/all-mail-list";
import { ThreadView } from "@/components/ops/inbox/thread-view";
import { ComposeEmailModal } from "@/components/ops/compose-email-modal";
import type { InboxTab } from "@/lib/types/inbox";
import type { PipelineThread } from "@/lib/types/inbox";
import type { ComposeEmailData } from "@/lib/types/email-template";

// ─── Thread Selection State ───────────────────────────────────────────────────

interface SelectedThread {
  threadId: string;
  source: "pipeline" | "all-mail";
  aiSummary?: string | null;
  opportunityTitle?: string;
  subject?: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  usePageTitle("Inbox");
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);

  const [activeTab, setActiveTab] = useState<InboxTab>("pipeline");
  const [selectedThread, setSelectedThread] = useState<SelectedThread | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<ComposeEmailData | undefined>(undefined);

  // Unread count for pipeline badge
  const { data: unreadCount = 0 } = useInboxUnreadCount();
  const { data: inboxMetrics = [] } = useInboxMetrics();

  // Permission checks
  const canViewPipeline = can("pipeline.view");
  const canViewEmail = can("email.view");

  // Build available tabs
  const tabs = useMemo(() => {
    const all: Array<{ value: InboxTab; label: string; show: boolean; badge?: number }> = [
      {
        value: "pipeline",
        label: t("tabs.pipeline"),
        show: canViewPipeline,
        badge: unreadCount > 0 ? unreadCount : undefined,
      },
      {
        value: "all-mail",
        label: t("tabs.allMail"),
        show: canViewEmail,
      },
    ];
    return all.filter((tab) => tab.show);
  }, [t, canViewPipeline, canViewEmail, unreadCount]);

  // If current tab became hidden, switch to first available
  if (tabs.length > 0 && !tabs.some((tab) => tab.value === activeTab)) {
    setActiveTab(tabs[0].value);
  }

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectPipelineThread = useCallback((thread: PipelineThread) => {
    setSelectedThread({
      threadId: thread.threadId,
      source: "pipeline",
      aiSummary: thread.aiSummary,
      opportunityTitle: thread.opportunityTitle,
    });
  }, []);

  const handleSelectAllMailThread = useCallback(
    (threadId: string, subject: string) => {
      setSelectedThread({
        threadId,
        source: "all-mail",
        subject,
      });
    },
    []
  );

  const handleBack = useCallback(() => {
    setSelectedThread(null);
  }, []);

  const handleReply = useCallback((data: ComposeEmailData) => {
    setComposeData(data);
    setComposeOpen(true);
  }, []);

  const handleNewEmail = useCallback(() => {
    setComposeData({ mode: "new" });
    setComposeOpen(true);
  }, []);

  // ─── Render: Thread View ──────────────────────────────────────────────────

  if (selectedThread) {
    return (
      <div className="h-[calc(100vh-120px)]">
        <ThreadView
          threadId={selectedThread.threadId}
          source={selectedThread.source}
          aiSummary={selectedThread.aiSummary}
          opportunityTitle={selectedThread.opportunityTitle}
          onBack={handleBack}
          onReply={handleReply}
        />
        <ComposeEmailModal
          open={composeOpen}
          onOpenChange={setComposeOpen}
          composeData={composeData}
        />
      </div>
    );
  }

  // ─── Render: Thread List ──────────────────────────────────────────────────

  return (
    <div className="space-y-3 pb-6">
      {/* Metrics Header */}
      <MetricsHeader variant="compact" tabId="inbox" title="Inbox" metrics={inboxMetrics} />

      {/* Header with Tab Switcher + New Email */}
      <div className="flex items-center gap-1">
        {/* Tabs */}
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              "px-3 py-1 rounded-[4px] font-mohave text-body-sm uppercase transition-colors flex items-center gap-1.5",
              activeTab === tab.value
                ? "bg-[rgba(255,255,255,0.08)] text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                className={cn(
                  "inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full",
                  "font-kosugi text-[10px] leading-none",
                  activeTab === tab.value
                    ? "bg-[#597794] text-white"
                    : "bg-[rgba(255,255,255,0.1)] text-text-tertiary"
                )}
              >
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </button>
        ))}

        {/* New Email Button */}
        <button
          onClick={handleNewEmail}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] font-kosugi text-[10px] text-text-secondary uppercase tracking-wider hover:bg-[rgba(255,255,255,0.1)] hover:text-text-primary transition-colors"
        >
          <PenSquare className="w-[12px] h-[12px]" />
          New Email
        </button>
      </div>

      {/* Tab Content */}
      <div className="rounded-[4px] border border-border bg-[rgba(255,255,255,0.02)] overflow-hidden">
        {activeTab === "pipeline" && (
          <PipelineThreadList onSelectThread={handleSelectPipelineThread} />
        )}

        {activeTab === "all-mail" && (
          <AllMailList onSelectThread={handleSelectAllMailThread} />
        )}
      </div>

      {/* Compose Modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        composeData={composeData}
      />
    </div>
  );
}
