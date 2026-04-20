"use client";

/**
 * Inbox v2 — /inbox page
 *
 * Rebuilt around `email_threads` as the primary surface. Replaces the legacy
 * pipeline-only, conversation-centric view with a four-rail, category-chipped,
 * keyboard-first Superhuman-tier thread list.
 *
 * Layout:
 *   [ 320px conversation list ] [ flex thread detail ] [ 320px context ]
 *
 * The page owns:
 *   - list/filter/search state
 *   - selected thread state
 *   - compose modal state
 *   - write-back preference modal state (shown once per connection)
 *   - command palette open state
 *
 * Everything else (actions, animations, styles) lives in the child
 * components under src/components/ops/inbox/*.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { usePageTitle } from "@/lib/hooks/use-page-title";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useAuthStore } from "@/lib/store/auth-store";
import { cn } from "@/lib/utils/cn";
import { useThreadActions, type InboxThreadRow } from "@/lib/hooks/use-inbox-threads";
import { useInboxThreads } from "@/lib/hooks/use-inbox-threads";
import type { ArchiveWritebackPreference, EmailThreadCategory, InboxRail, InboxScope } from "@/lib/types/email-thread";
import type { ComposeEmailData } from "@/lib/types/email-template";

import { ConversationList } from "@/components/ops/inbox/conversation-list";
import { ThreadDetailView } from "@/components/ops/inbox/thread-detail-view";
import { ThreadContextPanel } from "@/components/ops/inbox/thread-context-panel";
import { SplitInboxTabs } from "@/components/ops/inbox/split-inbox-tabs";
import { CategoryFilterChips } from "@/components/ops/inbox/category-filter-chips";
import { CommandPalette } from "@/components/ops/inbox/command-palette";
import { WritebackPreferenceModal } from "@/components/ops/inbox/writeback-preference-modal";
import { UndoToastHost, enqueueUndoToast } from "@/components/ops/inbox/undo-toast";
import { ComposeEmailModal } from "@/components/ops/compose-email-modal";
import { KeyHint } from "@/components/ui/key-hint";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEmailConnections } from "@/lib/hooks/use-email-connections";

// ─── Pending action queue — for "archive then choose write-back" flow ───────

interface PendingArchive {
  threadId: string;
  connectionId: string;
}

export default function InboxPage() {
  usePageTitle("Inbox");
  const { t } = useDictionary("inbox");
  const can = usePermissionStore((s) => s.can);
  const { company, currentUser } = useAuthStore();
  const { data: emailConnections } = useEmailConnections();

  // ─── Filters & scope ──────────────────────────────────────────────────────
  const canViewCompany = can("inbox.view_company");
  const canConfigurePhaseC = can("inbox.configure_phase_c");

  // Build hover tooltips for the My inbox / Company scope toggle so the user
  // can see exactly which mailbox(es) each scope covers without opening
  // Settings. "My inbox" resolves to the current user's individual
  // connections plus any company-type connections they can see; "Company"
  // shows the full list.
  const myScopeEmails = useMemo(() => {
    const rows = emailConnections ?? [];
    if (!currentUser) return rows.map((r) => r.email);
    return rows
      .filter((r) => r.type === "company" || r.userId === currentUser.id)
      .map((r) => r.email);
  }, [emailConnections, currentUser]);

  const companyScopeEmails = useMemo(
    () => (emailConnections ?? []).map((r) => r.email),
    [emailConnections]
  );

  const [scope, setScope] = useState<InboxScope>("own");
  const [rail, setRail] = useState<InboxRail>("needs_reply");
  const [category, setCategory] = useState<EmailThreadCategory | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search by 200ms — avoids thrashing the API on every keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 200);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  const listParams = useMemo(
    () => ({
      scope,
      filter: rail,
      category: category ?? undefined,
      search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
    }),
    [scope, rail, category, debouncedSearch]
  );

  // ─── Selection ────────────────────────────────────────────────────────────
  const [selectedThread, setSelectedThread] = useState<InboxThreadRow | null>(null);

  const handleSelectThread = useCallback((row: InboxThreadRow) => {
    setSelectedThread(row);
  }, []);

  // When filters change, drop selection so we don't hold onto a thread
  // that no longer appears in the active list.
  useEffect(() => {
    setSelectedThread(null);
  }, [scope, rail, category]);

  // ─── Counts — pulled once per (scope, search), split across rails ─────────
  // NOTE: A proper implementation would have a dedicated `/api/inbox/counts`
  // endpoint. For Phase 4 we derive counts from the first page of each rail.
  const everythingCounts = useInboxThreads({
    scope,
    filter: "everything",
    search: undefined,
  });
  const needsReplyCounts = useInboxThreads({
    scope,
    filter: "needs_reply",
    search: undefined,
  });

  const railCounts = useMemo(
    () => ({
      needs_reply:
        needsReplyCounts.data?.pages[0]?.threads.filter((r) => r.unreadCount > 0).length ?? 0,
      everything:
        everythingCounts.data?.pages[0]?.threads.filter((r) => r.unreadCount > 0).length ?? 0,
      scheduled: 0,
      done: 0,
    }),
    [needsReplyCounts.data, everythingCounts.data]
  );

  const categoryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    const rows = everythingCounts.data?.pages[0]?.threads ?? [];
    for (const r of rows) {
      if (r.unreadCount > 0) {
        m[r.primaryCategory] = (m[r.primaryCategory] ?? 0) + 1;
      }
    }
    return m;
  }, [everythingCounts.data]);

  // ─── Compose modal ────────────────────────────────────────────────────────
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeData, setComposeData] = useState<ComposeEmailData | undefined>(undefined);

  const handleReply = useCallback((data: ComposeEmailData) => {
    setComposeData(data);
    setComposeOpen(true);
  }, []);

  const handleComposeNew = useCallback(() => {
    setComposeData({ mode: "new" });
    setComposeOpen(true);
  }, []);

  // ─── Context panel ────────────────────────────────────────────────────────
  const [contextOpen, setContextOpen] = useState(false);
  const handleToggleContext = useCallback(() => setContextOpen((v) => !v), []);

  // ─── Write-back preference modal ──────────────────────────────────────────
  const [writebackOpen, setWritebackOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);
  const { archive: archiveMutation, unarchive: unarchiveMutation } = useThreadActions();

  const handleNeedsWritebackPreference = useCallback(
    (connectionId: string, threadId: string) => {
      setPendingArchive({ threadId, connectionId });
      setWritebackOpen(true);
    },
    []
  );

  const handleWritebackConfirmed = useCallback(
    (_preference: ArchiveWritebackPreference) => {
      const pending = pendingArchive;
      setPendingArchive(null);
      if (!pending) return;
      archiveMutation.mutate(pending.threadId, {
        onSuccess: () => {
          enqueueUndoToast({
            message: t("toast.archived") ?? "Archived",
            onUndo: () => unarchiveMutation.mutate(pending.threadId),
          });
        },
      });
    },
    [pendingArchive, archiveMutation, unarchiveMutation, t]
  );

  const handleWritebackCancel = useCallback(() => {
    setPendingArchive(null);
  }, []);

  // ─── Command palette ──────────────────────────────────────────────────────
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global Cmd+K — opens the palette regardless of focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        e.preventDefault();
        // Focus the inbox search input.
        const input = document.querySelector<HTMLInputElement>(
          'input[data-inbox-search="true"]'
        );
        input?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Open a specific thread from the palette — may require loading the list row
  // from a search result. For simplicity the palette passes a threadId and we
  // locate the row lazily via a synthetic list row.
  const handleOpenThreadFromPalette = useCallback(
    (threadId: string) => {
      // Try active list first.
      const activeRow =
        everythingCounts.data?.pages
          .flatMap((p) => p.threads)
          .find((r) => r.id === threadId) ??
        needsReplyCounts.data?.pages
          .flatMap((p) => p.threads)
          .find((r) => r.id === threadId);
      if (activeRow) {
        setSelectedThread(activeRow);
        return;
      }
      // If the thread isn't in the active list, switch rail to 'everything'
      // and clear filters so it shows up after refetch.
      setRail("everything");
      setCategory(null);
      setScope("own");
      // The selected thread id is carried via a minimal placeholder. The
      // detail view will still load full data via useInboxThread(threadId).
      setSelectedThread({
        id: threadId,
        connectionId: "",
        providerThreadId: "",
        primaryCategory: "OTHER",
        categoryConfidence: 0,
        categoryManuallySet: false,
        labels: [],
        archivedAt: null,
        snoozedUntil: null,
        priorityScore: 0,
        aiSummary: null,
        subject: "",
        participants: [],
        firstMessageAt: new Date().toISOString(),
        lastMessageAt: new Date().toISOString(),
        messageCount: 0,
        unreadCount: 0,
        latestDirection: null,
        latestSenderEmail: null,
        latestSenderName: null,
        latestSnippet: null,
        opportunityId: null,
        clientId: null,
      });
    },
    [everythingCounts.data, needsReplyCounts.data]
  );

  // ─── Permission gate ──────────────────────────────────────────────────────
  if (!can("inbox.view")) {
    return (
      <div className="flex flex-col items-start justify-start px-6 py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose">
          // Access denied
        </p>
        <p className="font-mohave text-[14px] text-text mt-1">
          You don&apos;t have permission to view the inbox.
        </p>
        <p className="font-mohave text-[12px] text-text-3 mt-0.5">
          Ask an owner or admin to grant you <code>inbox.view</code>.
        </p>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex h-[calc(100vh-68px-96px)] overflow-hidden",
          "rounded-panel border border-border glass-surface"
        )}
      >
        {/* ─── Left: list ────────────────────────────────────────────────── */}
        <div
          style={{ width: 360 }}
          className="shrink-0 flex flex-col border-r border-border-subtle min-h-0 min-w-0 overflow-hidden"
        >
          {/* Search */}
          <div className="p-2.5 border-b border-border-subtle">
            <div className="flex items-center gap-2 bg-surface-input border border-border-subtle rounded-[5px] px-2.5 h-[30px]">
              <SearchIcon className="w-[13px] h-[13px] text-text-mute shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("search.placeholder") ?? "Search threads · run a command"}
                data-inbox-search="true"
                className={cn(
                  "flex-1 bg-transparent outline-none",
                  "font-mohave text-[13px] text-text placeholder:text-text-3"
                )}
              />
              <span className="shrink-0 font-mono text-[10px] text-text-mute">
                <KeyHint keys="/" variant="inline" />
              </span>
            </div>
            {canViewCompany && (
              <TooltipProvider delayDuration={200}>
                <div className="flex items-center gap-1 mt-2 px-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setScope("own")}
                        className={cn(
                          "px-2 h-[22px] rounded-[4px] border transition-colors",
                          "font-cakemono font-light uppercase text-[10px] tracking-[0.16em]",
                          scope === "own"
                            ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                            : "border-border-subtle text-text-3 hover:text-text-2"
                        )}
                      >
                        My inbox
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start">
                      {myScopeEmails.length === 0 ? (
                        <span className="font-mono text-[11px] text-text-3">
                          No email connected
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {myScopeEmails.map((addr) => (
                            <span
                              key={addr}
                              className="font-mono text-[11px] text-text leading-none"
                            >
                              {addr}
                            </span>
                          ))}
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setScope("company")}
                        className={cn(
                          "px-2 h-[22px] rounded-[4px] border transition-colors",
                          "font-cakemono font-light uppercase text-[10px] tracking-[0.16em]",
                          scope === "company"
                            ? "border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.08)] text-text"
                            : "border-border-subtle text-text-3 hover:text-text-2"
                        )}
                      >
                        Company
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start">
                      {companyScopeEmails.length === 0 ? (
                        <span className="font-mono text-[11px] text-text-3">
                          No email connected
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          <span className="font-cakemono font-light uppercase text-[10px] tracking-[0.18em] text-text-mute leading-none">
                            {companyScopeEmails.length === 1
                              ? "1 account"
                              : `${companyScopeEmails.length} accounts`}
                          </span>
                          {companyScopeEmails.map((addr) => (
                            <span
                              key={addr}
                              className="font-mono text-[11px] text-text leading-none"
                            >
                              {addr}
                            </span>
                          ))}
                        </div>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            )}
          </div>

          {/* Rail tabs */}
          <SplitInboxTabs active={rail} onChange={setRail} counts={railCounts} />

          {/* Category chips */}
          <CategoryFilterChips
            active={category}
            onChange={setCategory}
            counts={categoryCounts}
          />

          {/* Thread list */}
          <ConversationList
            params={listParams}
            selectedThreadId={selectedThread?.id ?? null}
            onSelectThread={handleSelectThread}
            onNeedsWritebackPreference={handleNeedsWritebackPreference}
            keyboardActive={!paletteOpen && !composeOpen && !writebackOpen}
          />
        </div>

        {/* ─── Center: thread detail ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <ThreadDetailView
            listRow={selectedThread}
            threadId={selectedThread?.id ?? null}
            onNeedsWritebackPreference={handleNeedsWritebackPreference}
            onReply={handleReply}
            onComposeNew={handleComposeNew}
            onToggleContext={handleToggleContext}
            contextOpen={contextOpen}
            keyboardActive={!paletteOpen && !composeOpen && !writebackOpen}
            canConfigurePhaseC={canConfigurePhaseC}
          />
        </div>

        {/* ─── Right: context panel ─────────────────────────────────────── */}
        <ThreadContextPanel
          open={contextOpen}
          onClose={() => setContextOpen(false)}
          thread={selectedThread}
        />
      </div>

      {/* Command palette */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        scope={scope}
        selectedThreadId={selectedThread?.id ?? null}
        handlers={{
          onOpenThread: handleOpenThreadFromPalette,
          onSwitchRail: setRail,
          onFilterCategory: setCategory,
          onComposeNew: handleComposeNew,
          onArchive: () => {
            if (!selectedThread) return;
            archiveMutation.mutate(selectedThread.id, {
              onSuccess: (res) => {
                if (res?.needsPreference && res.connectionId) {
                  handleNeedsWritebackPreference(res.connectionId, selectedThread.id);
                  return;
                }
                enqueueUndoToast({
                  message: t("toast.archived") ?? "Archived",
                  detail: selectedThread.subject,
                  onUndo: () => unarchiveMutation.mutate(selectedThread.id),
                });
              },
            });
          },
          onSnooze: () => {
            // Delegates to row-level picker by simulating a 'S' keypress once list
            // regains focus. Simpler: the palette closes, then the next keystroke
            // handler on the thread-detail view picks it up. We fire a synthetic
            // keyboard event targeting window.
            if (!selectedThread) return;
            const evt = new KeyboardEvent("keydown", { key: "s" });
            window.dispatchEvent(evt);
          },
          onRecategorizeOpen: () => {
            if (!selectedThread) return;
            const evt = new KeyboardEvent("keydown", { key: "l" });
            window.dispatchEvent(evt);
          },
          onMarkUnread: () => {
            if (!selectedThread) return;
            const evt = new KeyboardEvent("keydown", { key: "u" });
            window.dispatchEvent(evt);
          },
          onAIDraft: () => {
            if (!selectedThread) return;
            const evt = new KeyboardEvent("keydown", { key: "D", shiftKey: true });
            window.dispatchEvent(evt);
          },
        }}
      />

      {/* Write-back preference modal */}
      <WritebackPreferenceModal
        open={writebackOpen}
        onOpenChange={setWritebackOpen}
        connectionId={pendingArchive?.connectionId ?? null}
        onConfirmed={handleWritebackConfirmed}
        onCancel={handleWritebackCancel}
      />

      {/* Compose modal — unchanged */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        composeData={composeData}
      />

      {/* Undo toast host — singleton for the whole page */}
      <UndoToastHost />

      {/* Suppress unused — company may power future filters */}
      {company?.id ? null : null}
    </div>
  );
}
