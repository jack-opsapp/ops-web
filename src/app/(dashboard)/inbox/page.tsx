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
import {
  useThreadActions,
  useInboxThreads,
  useInboxDrafts,
  useDiscardDraft,
  type InboxDraftRow,
  type InboxThreadRow,
} from "@/lib/hooks/use-inbox-threads";
import type { ArchiveWritebackPreference, EmailThreadCategory, InboxRail, InboxScope } from "@/lib/types/email-thread";
import type { ComposeEmailData } from "@/lib/types/email-template";

import { ConversationList } from "@/components/ops/inbox/conversation-list";
import { ThreadDetailView } from "@/components/ops/inbox/thread-detail-view";
import { ThreadContextPanel } from "@/components/ops/inbox/thread-context-panel";
import { SplitInboxTabs } from "@/components/ops/inbox/split-inbox-tabs";
import { CategoryFilterChips } from "@/components/ops/inbox/category-filter-chips";
import { CommandPalette } from "@/components/ops/inbox/command-palette";
import { WritebackPreferenceModal } from "@/components/ops/inbox/writeback-preference-modal";
import {
  ArchiveConfirmModal,
  type ArchiveConfirmContext,
  type ArchiveConfirmSubmitArgs,
} from "@/components/ops/inbox/archive-confirm-modal";
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
//
// PendingArchive carries the data needed to (a) re-fire the archive after the
// user picks a write-back preference, and (b) build the
// ArchiveConfirmContext for the multi-select modal when the same thread
// turns out to need confirmation. Sender details are captured at click time
// so the modal can render them even if the row has scrolled out of view.

interface PendingArchive {
  threadId: string;
  connectionId: string;
  subject: string;
  latestSenderName: string | null;
  latestSenderEmail: string | null;
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
  // Commitments rail — separate fetch so the badge reflects overdue
  // count independently of whichever rail the user is currently viewing.
  const commitmentsCounts = useInboxThreads({
    scope,
    filter: "commitments",
    search: undefined,
  });

  // ─── Drafts — merged provider + AI, indexed by providerThreadId for pill
  //     painting on the list. Polled every 60s by the hook. ────────────────
  const { data: draftsData } = useInboxDrafts(scope);
  const drafts = useMemo<InboxDraftRow[]>(() => draftsData ?? [], [draftsData]);

  // Keyed on providerThreadId because the conversation-list emits
  // thread.providerThreadId (the Gmail/M365 native id) — which is what the
  // draft's threadId matches against. Thread-bound drafts only; standalones
  // live in the DRAFTS rail list instead.
  const draftsByThreadId = useMemo(() => {
    const m: Record<string, InboxDraftRow> = {};
    for (const d of drafts) {
      if (d.threadId) m[d.threadId] = d;
    }
    return m;
  }, [drafts]);

  const discardDraft = useDiscardDraft();

  const railCounts = useMemo(() => {
    const now = Date.now();
    // Commitments badge shows OVERDUE only — the urgent subset. Threads
    // whose earliest due date hasn't hit yet are still visible inside
    // the rail but don't inflate the tab counter.
    const overdueCommitments =
      commitmentsCounts.data?.pages[0]?.threads.filter((r) => {
        if (!r.nextCommitmentDueAt) return false;
        return new Date(r.nextCommitmentDueAt).getTime() <= now;
      }).length ?? 0;
    return {
      needs_reply:
        needsReplyCounts.data?.pages[0]?.threads.filter((r) => r.unreadCount > 0).length ?? 0,
      everything:
        everythingCounts.data?.pages[0]?.threads.filter((r) => r.unreadCount > 0).length ?? 0,
      scheduled: 0,
      done: 0,
      drafts: drafts.length,
      commitments: overdueCommitments,
    };
  }, [
    needsReplyCounts.data,
    everythingCounts.data,
    commitmentsCounts.data,
    drafts.length,
  ]);

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

  // Continue a draft → populate the compose modal with the draft body,
  // subject, and recipients (provider drafts only — AI drafts don't store
  // to/subject, so for AI drafts the compose modal re-derives from the
  // thread context, same as hitting Reply). Sets mode="reply" when the
  // draft is attached to a thread; "new" for standalone.
  const handleContinueDraft = useCallback(
    (draft: InboxDraftRow) => {
      const mode: "reply" | "new" = draft.threadId ? "reply" : "new";
      setComposeData({
        mode,
        to: draft.to[0],
        cc: draft.cc,
        subject: draft.subject || undefined,
        threadId: draft.threadId ?? undefined,
        connectionId: draft.connectionId ?? undefined,
        // We don't have inReplyTo here — the message-id of the last inbound
        // message isn't on the draft row. The compose modal will fall back
        // to threadId-only threading (still correct at the provider level).
      });
      setComposeOpen(true);
    },
    []
  );

  const handleDiscardDraft = useCallback(
    (draft: InboxDraftRow) => {
      discardDraft.mutate({
        source: draft.source,
        id: draft.id,
        connectionId: draft.connectionId,
      });
    },
    [discardDraft]
  );

  // ─── Context panel ────────────────────────────────────────────────────────
  const [contextOpen, setContextOpen] = useState(false);
  const handleToggleContext = useCallback(() => setContextOpen((v) => !v), []);

  // ─── Archive flow ─────────────────────────────────────────────────────────
  //
  // Three modal-driven branches off a single archive click:
  //
  //   1. needsPreference (writeback)  → WritebackPreferenceModal saves the
  //      Gmail/M365 preference, then we re-fire archive — which may itself
  //      hit branch 2 or 3.
  //
  //   2. needsConfirmation             → ArchiveConfirmModal lets the user
  //      pick which sibling threads + the linked lead to also archive.
  //      Submits to archiveBatch.
  //
  //   3. archived (success)            → undo toast.
  //
  // The "single archive click" can come from: detail view button, list-row
  // action, command palette item, keyboard shortcut. All paths converge on
  // resolveArchiveResponse() so the handling is identical.
  const [writebackOpen, setWritebackOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiveConfirmContext, setArchiveConfirmContext] =
    useState<ArchiveConfirmContext | null>(null);
  const {
    archive: archiveMutation,
    unarchive: unarchiveMutation,
    archiveBatch: archiveBatchMutation,
    unarchiveBatch: unarchiveBatchMutation,
    setLeadArchivePreference: setLeadArchivePreferenceMutation,
  } = useThreadActions();

  const enqueueArchivedToast = useCallback(
    (subject: string | undefined, threadId: string, leadOpportunityId: string | null) => {
      enqueueUndoToast({
        message: t("toast.archived") ?? "Archived",
        detail: subject,
        onUndo: () => {
          if (leadOpportunityId) {
            // Single-thread archive that auto-archived the lead — undo both.
            unarchiveBatchMutation.mutate({
              threadIds: [threadId],
              unarchiveOpportunityId: leadOpportunityId,
            });
          } else {
            unarchiveMutation.mutate(threadId);
          }
        },
      });
    },
    [t, unarchiveMutation, unarchiveBatchMutation]
  );

  const enqueueBatchArchivedToast = useCallback(
    (
      threadIds: string[],
      leadOpportunityId: string | null,
      detail: string | undefined
    ) => {
      const itemCount = threadIds.length + (leadOpportunityId ? 1 : 0);
      const message =
        itemCount === 1
          ? t("toast.archived") ?? "Archived"
          : `Archived ${itemCount} items`;
      enqueueUndoToast({
        message,
        detail,
        onUndo: () => {
          unarchiveBatchMutation.mutate({
            threadIds,
            unarchiveOpportunityId: leadOpportunityId,
          });
        },
      });
    },
    [t, unarchiveBatchMutation]
  );

  const fireArchiveForPending = useCallback(
    (pending: PendingArchive) => {
      archiveMutation.mutate(pending.threadId, {
        onSuccess: (res) => {
          if (res?.needsPreference && res.connectionId) {
            // Should not happen on a re-fire after writeback save, but guard.
            setPendingArchive((curr) => curr ?? pending);
            setWritebackOpen(true);
            return;
          }
          if (res?.needsConfirmation) {
            setArchiveConfirmContext({
              currentThread: {
                id: pending.threadId,
                subject: pending.subject,
                latestSenderName: pending.latestSenderName,
                latestSenderEmail: pending.latestSenderEmail,
              },
              connectionId: res.connectionId!,
              leadPreference: res.leadPreference!,
              linkedOpportunity: res.linkedOpportunity!,
              siblingThreads: res.siblingThreads!,
            });
            setArchiveConfirmOpen(true);
            return;
          }
          enqueueArchivedToast(
            pending.subject,
            pending.threadId,
            res?.leadArchivedOpportunityId ?? null
          );
        },
      });
    },
    [archiveMutation, enqueueArchivedToast]
  );

  const handleNeedsWritebackPreference = useCallback(
    (
      connectionId: string,
      threadId: string,
      subject: string,
      latestSenderName: string | null,
      latestSenderEmail: string | null
    ) => {
      setPendingArchive({
        threadId,
        connectionId,
        subject,
        latestSenderName,
        latestSenderEmail,
      });
      setWritebackOpen(true);
    },
    []
  );

  const handleNeedsArchiveConfirmation = useCallback(
    (context: ArchiveConfirmContext) => {
      setArchiveConfirmContext(context);
      setArchiveConfirmOpen(true);
    },
    []
  );

  const handleWritebackConfirmed = useCallback(
    (_preference: ArchiveWritebackPreference) => {
      const pending = pendingArchive;
      setPendingArchive(null);
      if (!pending) return;
      // Re-fire archive — server will now skip the writeback branch and
      // either succeed or escalate to needsConfirmation.
      fireArchiveForPending(pending);
    },
    [pendingArchive, fireArchiveForPending]
  );

  const handleWritebackCancel = useCallback(() => {
    setPendingArchive(null);
  }, []);

  const handleArchiveConfirmed = useCallback(
    async (args: ArchiveConfirmSubmitArgs) => {
      const ctx = archiveConfirmContext;
      if (!ctx) return;
      // Persist the lead-archive preference first when applicable so the
      // user is never asked again under the same condition. Failure here is
      // non-fatal — the archive still proceeds; the modal would just show
      // again on the next no-sibling opp-linked archive.
      if (args.saveLeadPreference) {
        try {
          await setLeadArchivePreferenceMutation.mutateAsync({
            connectionId: ctx.connectionId,
            preference: args.saveLeadPreference,
          });
        } catch (err) {
          console.error("[inbox] setLeadArchivePreference failed:", err);
        }
      }
      const res = await archiveBatchMutation.mutateAsync({
        threadIds: args.threadIds,
        archiveOpportunityId: args.archiveOpportunityId,
      });
      enqueueBatchArchivedToast(
        res.archivedThreadIds,
        res.leadArchivedOpportunityId,
        ctx.currentThread.subject
      );
      setArchiveConfirmContext(null);
    },
    [
      archiveConfirmContext,
      setLeadArchivePreferenceMutation,
      archiveBatchMutation,
      enqueueBatchArchivedToast,
    ]
  );

  const handleArchiveConfirmCancel = useCallback(() => {
    setArchiveConfirmContext(null);
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
        clientName: null,
        nextCommitmentDueAt: null,
        hasUnresolvedCommitments: false,
      });
    },
    [everythingCounts.data, needsReplyCounts.data]
  );

  // ─── Permission gate ──────────────────────────────────────────────────────
  if (!can("inbox.view")) {
    return (
      <div className="flex flex-col items-start justify-start px-6 py-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-rose">
          {"// Access denied"}
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
    <>
      {/* BG fill matches site BG (#000) — inbox is a canvas-style page like
          pipeline/projects, not a glass card. Internal columns retain their
          own borders for separation. */}
      <div
        className={cn(
          "flex-1 min-h-0 flex overflow-hidden",
          "rounded-panel border border-border bg-background"
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

          {/* Thread list — switches to a flat drafts list when rail=drafts */}
          <ConversationList
            params={listParams}
            selectedThreadId={selectedThread?.id ?? null}
            onSelectThread={handleSelectThread}
            onNeedsWritebackPreference={handleNeedsWritebackPreference}
            onNeedsArchiveConfirmation={handleNeedsArchiveConfirmation}
            keyboardActive={
              !paletteOpen && !composeOpen && !writebackOpen && !archiveConfirmOpen
            }
            draftsByThreadId={draftsByThreadId}
            draftMode={rail === "drafts"}
            drafts={drafts}
            onOpenDraft={handleContinueDraft}
            onDiscardDraft={handleDiscardDraft}
          />
        </div>

        {/* ─── Center: thread detail ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <ThreadDetailView
            listRow={selectedThread}
            threadId={selectedThread?.id ?? null}
            onNeedsWritebackPreference={handleNeedsWritebackPreference}
            onNeedsArchiveConfirmation={handleNeedsArchiveConfirmation}
            onReply={handleReply}
            onComposeNew={handleComposeNew}
            onToggleContext={handleToggleContext}
            contextOpen={contextOpen}
            keyboardActive={
              !paletteOpen && !composeOpen && !writebackOpen && !archiveConfirmOpen
            }
            canConfigurePhaseC={canConfigurePhaseC}
            threadDraft={
              // Match by the selected thread's providerThreadId — same key
              // we used to build draftsByThreadId above.
              selectedThread?.providerThreadId
                ? draftsByThreadId[selectedThread.providerThreadId] ?? null
                : null
            }
            onContinueDraft={handleContinueDraft}
            onDiscardDraft={handleDiscardDraft}
            onSelectThread={handleSelectThread}
            emptyStateScope={scope}
            emptyStateUnreadCount={railCounts.everything}
            emptyStateContinueDraft={handleContinueDraft}
            emptyStateSwitchRail={setRail}
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
            const captured: PendingArchive = {
              threadId: selectedThread.id,
              connectionId: selectedThread.connectionId,
              subject: selectedThread.subject,
              latestSenderName: selectedThread.latestSenderName ?? null,
              latestSenderEmail: selectedThread.latestSenderEmail ?? null,
            };
            archiveMutation.mutate(selectedThread.id, {
              onSuccess: (res) => {
                if (res?.needsPreference && res.connectionId) {
                  handleNeedsWritebackPreference(
                    res.connectionId,
                    captured.threadId,
                    captured.subject,
                    captured.latestSenderName,
                    captured.latestSenderEmail
                  );
                  return;
                }
                if (res?.needsConfirmation) {
                  handleNeedsArchiveConfirmation({
                    currentThread: {
                      id: captured.threadId,
                      subject: captured.subject,
                      latestSenderName: captured.latestSenderName,
                      latestSenderEmail: captured.latestSenderEmail,
                    },
                    connectionId: res.connectionId!,
                    leadPreference: res.leadPreference!,
                    linkedOpportunity: res.linkedOpportunity!,
                    siblingThreads: res.siblingThreads!,
                  });
                  return;
                }
                enqueueArchivedToast(
                  captured.subject,
                  captured.threadId,
                  res?.leadArchivedOpportunityId ?? null
                );
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

      {/* Archive confirmation modal — shown when archiving a thread tied to a
          pipeline lead with siblings, or on the first opp-linked archive when
          no lead-archive preference has been saved yet. */}
      <ArchiveConfirmModal
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        context={archiveConfirmContext}
        onConfirm={handleArchiveConfirmed}
        onCancel={handleArchiveConfirmCancel}
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
    </>
  );
}
