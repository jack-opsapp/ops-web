"use client";

/**
 * InboxRoute — the integration layer that wires the redesigned components
 * to live data. Both `/inbox` and `/inbox/[threadId]` server pages delegate
 * here. The component owns:
 *
 *  - thread list fetch + selection (URL is the source of truth)
 *  - thread detail fetch when a thread is selected
 *  - client-scoped context fetches (projects / opportunities / files)
 *  - shape adapters between the API hooks and the UI props
 *
 * Known data-layer gaps (documented inline at the adapters):
 *  - `Project` / `Opportunity` / `Attachment` from the existing services
 *    don't expose every field the redesign cards consume (accounting
 *    totals, confidence, sizes). Missing fields render as zeros / dashes.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import type { RailFilter } from "@/lib/inbox/rail-predicates";
import { useBreadcrumbStore } from "@/stores/breadcrumb-store";
import { useAuthStore, selectUserId, selectCompanyId } from "@/lib/store/auth-store";
import {
  useInboxThreads,
  useInboxThread,
  useInboxDrafts,
  useSendReply,
  useThreadActions,
  useAnswerAgentQuestion,
  useResolveCommitment,
  useSaveDraft,
} from "@/lib/hooks/use-inbox-threads";
import {
  DraftSwitcher,
  type DraftEntry,
  type DraftSource as UIDraftSource,
} from "./composer/draft-switcher";
import { AiDraftBanner } from "./composer/ai-draft-banner";
import { SnoozePicker } from "./snooze-picker";
import { RecategorizeMenu } from "./recategorize-menu";
import {
  ArchiveConfirmModal,
  type ArchiveConfirmContext,
} from "./archive-confirm-modal";
import { enqueueUndoToast } from "./undo-toast";
import {
  useClientOpportunities,
  useClientOpportunitiesWon,
} from "@/lib/hooks/use-client-opportunities";
import { useClientProjects } from "@/lib/hooks/use-client-projects";
import { useClientTasks } from "@/lib/hooks/use-client-tasks";
import { useClientFiles } from "@/lib/hooks/use-client-files";
import { useClient, useSubClients } from "@/lib/hooks/use-clients";
import { useThreadOpportunityLinks } from "@/lib/hooks/use-thread-opportunity-links";
import { useClientThreads } from "@/lib/hooks/use-client-threads";
import { ThreadPicker, type ThreadPickerThread } from "./thread-picker";
import { computeStateTag } from "@/lib/inbox/format-wait";
import { deriveStripContact } from "@/lib/inbox/derive-strip-contact";
import { useWindowStore } from "@/stores/window-store";
import { ResponsiveInboxShell } from "./responsive-inbox-shell";
import type { MobileInboxPane } from "./mobile-stacked-shell";
import { ThreadColumnHeader } from "./thread-column-header";
import { DraftsChip } from "./drafts-chip";
import { SnoozedChip } from "./snoozed-chip";
import { TodayBar, type TodayCommitment } from "./today-bar";
import { RailEmptyState } from "./rail-empty-state";
import { ThreadList, type ThreadListItem } from "./thread-list";
import { ThreadDetail } from "./thread-detail";
import {
  CommitmentPills,
  type CommitmentPillItem,
} from "./commitment-pills";
import { DetailBand } from "./detail-band";
import { MessageList, type RenderableMessage } from "./message-list";
import { Composer } from "./composer/composer";
import {
  categoryDotClassName,
  categoryLabel as resolveCategoryLabel,
} from "./category-chip";
import { ContextRail } from "./context-rail/context-rail";
import { type PipelineOpp } from "./context-rail/pipeline-list";
import { WorkView } from "./context-rail/work-view";
import { AccountingView } from "./context-rail/accounting-view";
import { FilesViewV3 } from "./context-rail/files-view-v3";
import type {
  InboxThreadRow,
  InboxThreadMessage,
} from "@/lib/hooks/use-inbox-threads";
import type { Opportunity } from "@/lib/types/pipeline";
import { inboxThreadHref, threadIdFromInboxPathname } from "./inbox-navigation";

interface InboxRouteProps {
  threadId?: string;
}

export function InboxRoute({ threadId: initialThreadId }: InboxRouteProps) {
  const router = useRouter();
  const { t } = useDictionary("inbox");
  const setEntityName = useBreadcrumbStore((s) => s.setEntityName);
  const clearEntityName = useBreadcrumbStore((s) => s.clearEntityName);
  const userId = useAuthStore(selectUserId);
  const companyId = useAuthStore(selectCompanyId);
  const sendReply = useSendReply();
  const threadActions = useThreadActions();
  const answerAgentQuestion = useAnswerAgentQuestion();
  const resolveCommitment = useResolveCommitment();
  const draftsQuery = useInboxDrafts("own");
  const openWindow = useWindowStore((s) => s.openWindow);
  const openProjectWindow = useWindowStore((s) => s.openProjectWindow);
  const [composerValue, setComposerValue] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveContext, setArchiveContext] =
    useState<ArchiveConfirmContext | null>(null);
  const [filter, setFilter] = useState<RailFilter>("YOUR_MOVE");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    () => initialThreadId ?? null,
  );
  const [mobilePane, setMobilePane] = useState<MobileInboxPane>(
    () => (initialThreadId ? "detail" : "list"),
  );
  // Search state lives in URL (?q=…) so the operator can back-button to drop
  // the filter and bookmark/share filtered views. The raw input updates on
  // every keystroke; `debouncedSearch` is what reaches the threads query and
  // the URL, so we don't refetch (or thrash history.replaceState) per
  // keypress. Both seeds read the URL synchronously on mount so a deep-link
  // to `?q=acme` shows filtered results on first paint instead of after a
  // 250ms ghost frame.
  const SEARCH_DEBOUNCE_MS = 250;
  const [searchInput, setSearchInput] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  const [debouncedSearch, setDebouncedSearch] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("q") ?? "").trim();
  });
  const qc = useQueryClient();

  const threadsQuery = useInboxThreads({
    scope: "own",
    filter,
    search: debouncedSearch.length > 0 ? debouncedSearch : undefined,
  });
  const threadDetail = useInboxThread(selectedThreadId);

  useEffect(() => {
    const nextThreadId =
      initialThreadId ?? threadIdFromInboxPathname(window.location.pathname);
    setSelectedThreadId(nextThreadId);
    setMobilePane(nextThreadId ? "detail" : "list");
  }, [initialThreadId]);

  useEffect(() => {
    const syncFromLocation = () => {
      const nextThreadId = threadIdFromInboxPathname(window.location.pathname);
      setSelectedThreadId(nextThreadId);
      setMobilePane(nextThreadId ? "detail" : "list");
      const nextSearch =
        new URLSearchParams(window.location.search).get("q") ?? "";
      setSearchInput(nextSearch);
      setDebouncedSearch(nextSearch.trim());
    };
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  // Debounce keystrokes into `debouncedSearch`. Both the threads query and
  // the URL writeback consume the debounced value — keystrokes don't refetch
  // and don't bloat browser history.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === debouncedSearch) return;
    const handle = window.setTimeout(() => {
      setDebouncedSearch(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput, debouncedSearch]);

  // Write `?q=` into the URL when the debounced value changes. `replaceState`
  // (not `pushState`) is intentional: each character typed shouldn't add a
  // history entry. The single entry the operator navigated TO the inbox with
  // is still revertable by the back button, which restores the empty query.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("q") ?? "";
    if (debouncedSearch.length > 0) {
      if (current === debouncedSearch) return;
      url.searchParams.set("q", debouncedSearch);
    } else {
      if (!url.searchParams.has("q")) return;
      url.searchParams.delete("q");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  }, [debouncedSearch]);

  const navigateToThread = useCallback((id: string) => {
    const href = inboxThreadHref(id);
    setSelectedThreadId(id);
    setMobilePane("detail");
    if (window.location.pathname !== href) {
      window.history.pushState(window.history.state, "", href);
    }
  }, []);

  // Surface the thread subject in the dashboard breadcrumb instead of the
  // raw UUID. Falls back to "—" while the detail is still loading.
  const subject = threadDetail.data?.thread.subject ?? null;
  useEffect(() => {
    if (!selectedThreadId) {
      clearEntityName();
      return;
    }
    setEntityName(subject ?? "—");
    return () => clearEntityName();
  }, [selectedThreadId, subject, setEntityName, clearEntityName]);

  const threads = threadsQuery.data?.pages?.[0]?.threads ?? [];
  const detail = threadDetail.data ?? null;
  const clientId = detail?.thread.clientId ?? null;
  // providerThreadId lives on InboxThreadRow but not on InboxThreadDetail.
  // Cross-reference the list to recover it for outbound send threading.
  const providerThreadId =
    threads.find((row) => row.id === selectedThreadId)?.providerThreadId ?? null;

  // Drafts scoped to the current thread (provider thread id match).
  const allDrafts = draftsQuery.data ?? [];
  const threadDrafts = useMemo(
    () =>
      providerThreadId
        ? allDrafts.filter((d) => d.threadId === providerThreadId)
        : [],
    [allDrafts, providerThreadId],
  );
  const activeDraft = useMemo(
    () => threadDrafts.find((d) => d.id === activeDraftId) ?? null,
    [threadDrafts, activeDraftId],
  );
  const draftEntries = useMemo<DraftEntry[]>(
    () =>
      threadDrafts.map((d) => ({
        id: d.id,
        // The wire shape splits provider vs ai. We don't disambiguate
        // Gmail vs Outlook here — both render as the generic "Yours" chip.
        source: (d.source === "ai" ? "claude" : "yours") as UIDraftSource,
        label: d.subject?.replace(/^re:\s*/i, "").slice(0, 24) || undefined,
      })),
    [threadDrafts],
  );

  // Keep activeDraftId valid when the drafts list changes.
  useEffect(() => {
    if (!activeDraftId) return;
    if (!threadDrafts.some((d) => d.id === activeDraftId)) {
      setActiveDraftId(null);
    }
  }, [activeDraftId, threadDrafts]);

  const isAgentDraft = activeDraft?.source === "ai";
  const isPristineDraft =
    activeDraft !== null && composerValue === activeDraft.bodyText;

  // ─── Auto-save ──────────────────────────────────────────────────────────
  // Debounced provider-side draft save. Fires whenever the composer body has
  // settled for AUTOSAVE_DELAY_MS and a non-empty value is being held against
  // a real thread. The first save provisions a new provider draft and we
  // stash the returned id in `autoSaveDraftIdRef` so subsequent ticks PATCH
  // the same row. When the thread changes, the ref resets so we don't
  // accidentally overwrite a draft on the WRONG thread.
  //
  // Skipped when:
  //   - selectedThreadId or detail is not yet loaded
  //   - composer is empty (whitespace-only)
  //   - the user is currently viewing a pristine AI draft (the AI row is
  //     authoritative; auto-save would mirror it pointlessly)
  //   - the saved body matches what we last successfully shipped
  const saveDraft = useSaveDraft();
  const autoSaveDraftIdRef = useRef<string | null>(null);
  const lastSavedBodyRef = useRef<string>("");
  const lastSavedThreadIdRef = useRef<string | null>(null);
  const AUTOSAVE_DELAY_MS = 1500;

  // Reset the saved-draft tracking whenever the open thread changes. Without
  // this, switching threads would treat the new thread's first keystroke as
  // an update to the previous thread's draft id.
  useEffect(() => {
    if (lastSavedThreadIdRef.current !== selectedThreadId) {
      autoSaveDraftIdRef.current = null;
      lastSavedBodyRef.current = "";
      lastSavedThreadIdRef.current = selectedThreadId;
    }
  }, [selectedThreadId]);

  // Seed the auto-save draft id from the currently-active provider draft so
  // subsequent edits update the existing row rather than creating a new one
  // alongside it. AI drafts deliberately do NOT seed — they live on a
  // different table and aren't routable through the provider update path.
  useEffect(() => {
    if (activeDraft?.source === "provider") {
      autoSaveDraftIdRef.current = activeDraft.id;
      lastSavedBodyRef.current = activeDraft.bodyText;
    }
  }, [activeDraft]);

  useEffect(() => {
    if (!selectedThreadId || !detail) return;
    if (!composerValue.trim()) return;
    if (isAgentDraft && isPristineDraft) return;
    if (composerValue === lastSavedBodyRef.current) return;

    // Detail wire shape doesn't expose connectionId — only the list row does.
    // Fall back gracefully when the row isn't in the current page (deep-link
    // to a thread that's outside the first cursor window).
    const conn = threads.find((row) => row.id === selectedThreadId)?.connectionId ?? null;
    if (!conn) return;

    const lastInbound = [...detail.messages]
      .reverse()
      .find((m) => m.direction === "inbound");
    const recipient = lastInbound?.from ?? null;
    if (!recipient) return;

    const subjectBase = detail.thread.subject ?? "";
    const replySubject = /^re:/i.test(subjectBase)
      ? subjectBase
      : subjectBase
        ? `Re: ${subjectBase}`
        : "(no subject)";

    const handle = window.setTimeout(() => {
      const valueAtFire = composerValue;
      saveDraft.mutate(
        {
          connectionId: conn,
          to: recipient,
          subject: replySubject,
          body: valueAtFire,
          providerThreadId: providerThreadId ?? null,
          draftId: autoSaveDraftIdRef.current,
        },
        {
          onSuccess: (res) => {
            autoSaveDraftIdRef.current = res.draftId;
            lastSavedBodyRef.current = valueAtFire;
          },
        },
      );
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(handle);
    // saveDraft.mutate is referentially stable from useMutation; intentionally
    // excluded so the timer doesn't re-arm on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerValue, selectedThreadId, detail, isAgentDraft, isPristineDraft, providerThreadId, threads]);

  const opportunitiesQuery = useClientOpportunities(clientId);
  const wonOpportunitiesQuery = useClientOpportunitiesWon(clientId);
  const projectsQuery = useClientProjects(clientId);
  const tasksQuery = useClientTasks(clientId);
  const filesQuery = useClientFiles(clientId, selectedThreadId);
  const clientQuery = useClient(clientId ?? undefined);
  const subClientsQuery = useSubClients(clientId ?? undefined);
  const clientThreadsQuery = useClientThreads(clientId, {
    excludeId: selectedThreadId,
  });
  const linkedOpsQuery = useThreadOpportunityLinks(selectedThreadId);
  const linkedOppIds = useMemo(
    () => new Set(linkedOpsQuery.data ?? []),
    [linkedOpsQuery.data],
  );

  const now = Date.now();

  const rows = useMemo<ThreadListItem[]>(
    () => threads.map(toThreadListItem),
    [threads],
  );

  // ThreadPicker feed — map sibling EmailThread rows to the picker's
  // ThreadPickerThread shape via computeStateTag. Per-row inbound/outbound
  // timestamps don't exist on EmailThread (only `lastMessageAt` +
  // `latestDirection`), so we derive both timestamps from those: the
  // direction stamps lastMessageAt, the other side gets null. This is the
  // best fidelity we have without a second join, and matches what the
  // sibling-context view already does.
  const pickerThreads: ThreadPickerThread[] = (clientThreadsQuery.data ?? []).map((row) => {
    const ts = row.lastMessageAt.getTime();
    return {
      id: row.id,
      subject: row.subject ?? "",
      unread: (row.unreadCount ?? 0) > 0,
      state: computeStateTag({
        lastInboundAt: row.latestDirection === "inbound" ? ts : null,
        lastOutboundAt: row.latestDirection === "outbound" ? ts : null,
        hasAiDraft: false,
        sentByAgentRecently: false,
        labels: row.labels ?? [],
        closed: row.archivedAt !== null,
        now,
      }),
    };
  });

  const commitments = useMemo<TodayCommitment[]>(
    () => threads.flatMap(toCommitments).slice(0, 3),
    [threads],
  );

  // Tracks the per-row pending state for the inline ✓ resolve affordance.
  // We can't lean on `resolveCommitment.isPending` alone because TanStack's
  // useMutation collapses concurrent invocations into one global flag —
  // the today-bar needs per-id granularity so only the clicked row dims.
  const [resolvingIds, setResolvingIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const onResolveCommitment = (commitmentId: string, threadIdForResolve: string) => {
    setResolvingIds((prev) => {
      const next = new Set(prev);
      next.add(commitmentId);
      return next;
    });
    resolveCommitment.mutate(
      {
        id: commitmentId,
        resolvedAt: new Date().toISOString(),
        threadId: threadIdForResolve,
      },
      {
        onSettled: () => {
          setResolvingIds((prev) => {
            const next = new Set(prev);
            next.delete(commitmentId);
            return next;
          });
        },
      },
    );
  };

  const onSelectThread = (id: string) => {
    navigateToThread(id);
  };

  const onPrev = () => {
    const idx = rows.findIndex((r) => r.id === selectedThreadId);
    if (idx > 0) navigateToThread(rows[idx - 1].id);
  };
  const onNext = () => {
    const idx = rows.findIndex((r) => r.id === selectedThreadId);
    if (idx >= 0 && idx < rows.length - 1) navigateToThread(rows[idx + 1].id);
  };

  const onDismissAwaitingReply = (id: string) => {
    threadActions.dismissAwaitingReply.mutate(id, {
      onSuccess: () => {
        enqueueUndoToast({
          message: t("toast.dismissedTactic", "SYS :: MARKED NO REPLY NEEDED"),
          onUndo: () => threadActions.restoreAwaitingReply.mutate(id),
        });
      },
      onError: () => {
        // Failure path — the optimistic update has already rolled back inside
        // the mutation. No undo is meaningful here; we render a transient
        // failure toast whose "undo" is a retry that re-fires the dismiss.
        enqueueUndoToast({
          message: t("toast.dismissFailedTactic", "SYS :: DISMISS FAILED"),
          onUndo: () => threadActions.dismissAwaitingReply.mutate(id),
        });
      },
    });
  };

  const onRefresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.inbox.threadsAll() });
  };

  const onOpenArchived = () => setFilter("ARCHIVED");
  const onOpenSettings = () => router.push("/settings/inbox");

  const threadList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadColumnHeader
        filter={filter}
        onFilterChange={setFilter}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onRefresh={onRefresh}
        onOpenArchived={onOpenArchived}
        onOpenSettings={onOpenSettings}
        headerChipSlot={
          <>
            <SnoozedChip scope="own" onOpenThread={navigateToThread} />
            <DraftsChip scope="own" onOpenThread={navigateToThread} />
          </>
        }
      />
      <TodayBar
        commitments={commitments}
        onResolve={(commitmentId) => {
          const target = commitments.find((c) => c.id === commitmentId);
          if (!target) return;
          onResolveCommitment(commitmentId, target.threadId);
        }}
        pendingResolveIds={resolvingIds}
      />
      {threadsQuery.isLoading ? (
        <EmptyState label={t("list.loading", "Loading…")} />
      ) : rows.length === 0 ? (
        <RailEmptyState
          rail={filter}
          searchActive={debouncedSearch.length > 0}
          searchQuery={debouncedSearch}
        />
      ) : (
        <ThreadList
          threads={rows}
          now={now}
          selectedThreadId={selectedThreadId}
          onSelect={onSelectThread}
          onDismissAwaitingReply={onDismissAwaitingReply}
        />
      )}
    </div>
  );

  const onArchiveClick = () => {
    if (!selectedThreadId || !detail) return;
    threadActions.archive.mutate(selectedThreadId, {
      onSuccess: (res) => {
        if (res.needsConfirmation) {
          setArchiveContext({
            currentThread: {
              id: selectedThreadId,
              subject: detail.thread.subject ?? "",
              latestSenderName: guessSenderName(detail.messages),
              latestSenderEmail:
                detail.messages.find((m) => m.direction === "inbound")?.from ??
                null,
            },
            linkedOpportunity: res.linkedOpportunity ?? {
              id: detail.thread.opportunityId ?? "",
              title: "",
            },
            siblingThreads: res.siblingThreads ?? [],
            leadPreference: res.leadPreference ?? "ask",
            connectionId: res.connectionId ?? "",
          });
          setArchiveOpen(true);
          return;
        }
        enqueueUndoToast({
          message: t("toast.archivedTactic", "SYS :: THREAD ARCHIVED"),
          onUndo: () => threadActions.unarchive.mutate(selectedThreadId),
        });
      },
    });
  };

  const detailNode = detail ? (
    <ThreadDetail
      subject={detail.thread.subject ?? t("detail.untitled", "(no subject)")}
      category={{
        label: resolveCategoryLabel(detail.thread.primaryCategory),
        dotClassName: categoryDotClassName(detail.thread.primaryCategory),
      }}
      senderName={
        detail.thread.clientName ??
        guessSenderName(detail.messages) ??
        t("detail.unknownClient", "Unknown sender")
      }
      messageCount={detail.thread.messageCount ?? detail.messages.length}
      otherThreadCount={0}
      onPrev={onPrev}
      onNext={onNext}
      onArchive={onArchiveClick}
      snoozeSlot={(button) =>
        selectedThreadId ? (
          <SnoozePicker threadId={selectedThreadId} trigger={button} align="end" />
        ) : (
          button
        )
      }
      recategorizeSlot={(button) =>
        selectedThreadId ? (
          <RecategorizeMenu
            threadId={selectedThreadId}
            currentCategory={detail.thread.primaryCategory}
            trigger={button}
            align="end"
          />
        ) : (
          button
        )
      }
      threadPickerSlot={
        selectedThreadId && clientId ? (
          <ThreadPicker
            threads={pickerThreads}
            currentThreadId={selectedThreadId}
            onSelectThread={navigateToThread}
            clientName={
              detail.thread.clientName ??
              guessSenderName(detail.messages) ??
              ""
            }
          />
        ) : undefined
      }
    >
      <CommitmentPills
        commitments={detail.commitments.map(toCommitmentPillItem)}
        onResolve={(commitmentId) => {
          if (!selectedThreadId) return;
          onResolveCommitment(commitmentId, selectedThreadId);
        }}
        pendingResolveIds={resolvingIds}
      />
      <DetailBand
        thread={{
          aiSummary: detail.thread.aiSummary,
          phaseC: detail.thread.phaseC,
          agent: {
            needsInput: detail.thread.agentBlockingQuestion !== null,
          },
          closed: detail.thread.archivedAt !== null,
          // Prefer the server-resolved latestDirection; fall back to walking
          // the message list when the wire field is absent (older payloads).
          ballInCourt:
            (detail.thread.latestDirection ??
              detail.messages.at(-1)?.direction ?? null) === "inbound"
              ? "user"
              : "them",
        }}
        agentQuestion={detail.thread.agentBlockingQuestion?.question}
        agentOptions={detail.thread.agentBlockingQuestion?.options}
        agentPausedMinutesAgo={
          detail.thread.agentBlockingQuestion
            ? Math.max(
                0,
                Math.round(
                  (now -
                    new Date(
                      detail.thread.agentBlockingQuestion.askedAt,
                    ).getTime()) /
                    60_000,
                ),
              )
            : undefined
        }
        clientName={detail.thread.clientName ?? ""}
        renderedAt={now}
        ballYoursOnAcknowledge={
          selectedThreadId ? () => onDismissAwaitingReply(selectedThreadId) : undefined
        }
        ballYoursSnoozeSlot={(button) =>
          selectedThreadId ? (
            <SnoozePicker threadId={selectedThreadId} trigger={button} align="end" />
          ) : (
            button
          )
        }
        onAction={(action) => {
          if (!selectedThreadId || !detail.thread.agentBlockingQuestion) return;
          const q = detail.thread.agentBlockingQuestion;

          if (action.startsWith("answer:")) {
            // Quick-pick chip. Find the option, record its label as the
            // operator's answer, clear the column server-side. The thread
            // re-groups out of NEEDS_INPUT on the next refetch.
            const optionId = action.slice("answer:".length);
            const option = q.options?.find((o) => o.id === optionId);
            if (!option) return;
            answerAgentQuestion.mutate({
              threadId: selectedThreadId,
              answer: option.label,
              optionId: option.id,
            });
            return;
          }

          // "provide-answer" / "type-reply": the user is opting to type a
          // free-form reply. We don't clear the column here — that happens
          // when they actually hit send below (the composer.onSend hook
          // forwards the typed body to the answer endpoint when an open
          // question is still attached). The band stays put as a marker
          // until the answer lands.
        }}
      />
      <MessageList messages={detail.messages.map(toRenderableMessage)} />
      <Composer
        value={composerValue}
        onChange={(next) => {
          setComposerValue(next);
          if (composerError) setComposerError(null);
        }}
        onSend={(value) => {
          if (!userId || !companyId || !selectedThreadId) return;
          // Free-form answer path: when an unresolved agent question is
          // attached to this thread, treat the operator's typed reply as
          // both the email body AND the question's answer. Fire-and-forget
          // — answering shouldn't block the email send if it fails (the
          // band stays up and the operator can retry from the chip).
          if (detail.thread.agentBlockingQuestion) {
            answerAgentQuestion.mutate({ threadId: selectedThreadId, answer: value });
          }
          const lastInbound = [...detail.messages]
            .reverse()
            .find((m) => m.direction === "inbound");
          const recipient = lastInbound?.from ?? null;
          if (!recipient) {
            setComposerError(
              t("composer.error.noRecipient", "Cannot resolve recipient address."),
            );
            return;
          }
          const subjectBase = detail.thread.subject ?? "";
          const replySubject = /^re:/i.test(subjectBase)
            ? subjectBase
            : subjectBase
              ? `Re: ${subjectBase}`
              : "(no subject)";
          sendReply.mutate(
            {
              userId,
              companyId,
              payload: {
                threadId: selectedThreadId,
                to: [recipient],
                subject: replySubject,
                body: value,
                inReplyTo: lastInbound?.id ?? null,
                providerThreadId: providerThreadId ?? null,
                opportunityId: detail.thread.opportunityId,
                format: "markdown",
              },
            },
            {
              onSuccess: () => {
                setComposerValue("");
                // Once the send lands, the provider auto-removes the draft
                // it was based on (Gmail drafts.send / Graph sendDraft both
                // do this). Clear our local tracking so the next typed reply
                // provisions a fresh draft instead of trying to PATCH a row
                // that no longer exists.
                autoSaveDraftIdRef.current = null;
                lastSavedBodyRef.current = "";
              },
              onError: (e) =>
                setComposerError(
                  e instanceof Error
                    ? e.message
                    : t("composer.error.sendFailed", "Send failed"),
                ),
            },
          );
        }}
        disabled={sendReply.isPending}
        placeholder={t("composer.tacticPlaceholder", "[type message — ⌘↵ to send]")}
        agentTinted={isAgentDraft && isPristineDraft}
        sendVariant={isAgentDraft && isPristineDraft ? "agent" : "accent"}
        topAccessory={
          <>
            {draftEntries.length > 0 && (
              <DraftSwitcher
                drafts={draftEntries}
                activeId={activeDraftId}
                onSelect={(id) => {
                  const picked = threadDrafts.find((d) => d.id === id);
                  if (!picked) return;
                  setActiveDraftId(id);
                  setComposerValue(picked.bodyText);
                }}
              />
            )}
            {isAgentDraft && isPristineDraft && activeDraft && (
              <AiDraftBanner draftedAt={activeDraft.updatedAt} />
            )}
          </>
        }
      />
      {composerError && (
        <p
          role="alert"
          className="px-2 pb-2 font-mono text-[11px] text-rose"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {composerError}
        </p>
      )}
    </ThreadDetail>
  ) : selectedThreadId ? (
    <EmptyState label={t("detail.loading", "Loading thread")} />
  ) : (
    <EmptyState label={t("detail.empty", "Pick a thread from the list")} />
  );

  const opportunities = opportunitiesQuery.data ?? [];
  const wonOpportunities = wonOpportunitiesQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const photos = filesQuery.data?.photos ?? [];
  const documentRows = filesQuery.data?.documents ?? [];
  const threadOnlyPhotos = filesQuery.data?.threadOnlyPhotos ?? [];

  const pipelineOpps = useMemo<PipelineOpp[]>(
    () => opportunities.map((o) => toPipelineOpp(o, linkedOppIds, selectedThreadId ?? undefined)),
    [opportunities, linkedOppIds, selectedThreadId],
  );

  const wonPipelineOpps = useMemo<PipelineOpp[]>(
    () => wonOpportunities.map((o) => toPipelineOpp(o, linkedOppIds, selectedThreadId ?? undefined)),
    [wonOpportunities, linkedOppIds, selectedThreadId],
  );

  // FilesViewV3 consumes the raw ProjectDocument / ProjectPhoto shapes —
  // no adapter step needed. The total surfaced to the tab strip counts
  // every non-financial doc + every photo bucket; estimates/invoices live
  // on the ACCOUNTING tab and are excluded from the FILES count so the
  // two badges don't double-count the same record.
  const otherDocsCount = documentRows.filter(
    (d) => d.sourceType !== "estimate" && d.sourceType !== "invoice",
  ).length;
  const filesCount = otherDocsCount + photos.length + threadOnlyPhotos.length;

  const senderEmail =
    detail?.messages.find((m) => m.direction === "inbound")?.from ?? null;
  const client = clientQuery.data ?? null;
  const stripContact = useMemo(
    () =>
      deriveStripContact({
        client,
        opportunities: [...opportunities, ...wonOpportunities],
        projects,
      }),
    [client, opportunities, wonOpportunities, projects],
  );
  const subClientCount = subClientsQuery.data?.length ?? 0;
  const subtitle = subClientCount > 0
    ? `${subClientCount} ${subClientCount === 1 ? t("rail.subclient", "subclient") : t("rail.subclients", "subclients")}`
    : null;

  // <ContextRail> is now always mounted. It renders the unlinked-state
  // header internally when `client` is undefined — see context-rail.tsx
  // § "Header anatomy". This replaces the previous EmptyState shortcircuit
  // and keeps the tab strip + tab bodies discoverable (dimmed) even when
  // no client is attached.
  const contextRail = (
    <ContextRail
      client={
        clientId
          ? {
              name: client?.name ?? detail?.thread.clientName ?? "",
              subtitle,
              email: client?.email ?? senderEmail,
              phone: stripContact.phone,
              address: stripContact.address,
            }
          : undefined
      }
      threadId={selectedThreadId ?? ""}
      onOpenClient={
        clientId ? () => router.push(`/clients/${clientId}`) : undefined
      }
      // Link-client wiring deferred — the affordance is in place. Product
      // to decide whether to open a floating window or route to a picker.
      // `link-client` is not yet a FloatingWindowType (see window-store.ts),
      // so the button renders but does not yet trigger a window.
      onLinkClient={() => {
        /* no-op until link-client UX is specified */
      }}
      counts={{
        work: opportunities.length + wonOpportunities.length + projects.length,
        accounting: documentRows.length,
        files: filesCount,
      }}
      work={
        <WorkView
          pipelineOpps={pipelineOpps}
          wonOpps={wonPipelineOpps}
          projects={projects}
          tasks={tasks}
          currentThreadId={selectedThreadId ?? ""}
          onNewOpportunity={() =>
            openWindow({
              id: clientId
                ? `create-lead-${clientId}`
                : `create-lead-${selectedThreadId ?? "new"}`,
              title: t("pipeline.newOpportunity", "New opportunity"),
              type: "create-lead",
              metadata: clientId
                ? { clientId, sourceThreadId: selectedThreadId }
                : { sourceThreadId: selectedThreadId },
            })
          }
          onNewProject={() =>
            openProjectWindow({
              projectId: null,
              mode: "creating",
            })
          }
          onOpenProject={(projectId) => router.push(`/projects/${projectId}`)}
        />
      }
      accounting={
        <AccountingView
          documents={documentRows}
          onOpenDocument={(doc) => {
            // pdf_storage_path is the same fully qualified S3 URL the
            // files tab consumes — open in a new tab. No-op when the
            // PDF hasn't been rendered yet.
            if (doc.pdfStoragePath) {
              window.open(doc.pdfStoragePath, "_blank", "noopener");
            }
          }}
        />
      }
      files={
        <FilesViewV3
          documents={documentRows}
          photos={photos}
          threadOnlyPhotos={threadOnlyPhotos}
          projects={projects}
          onFileOpen={(file) => {
            // pdf_storage_path is a fully qualified S3 URL — open in a new
            // tab rather than client-routing inside the SPA. No-op when
            // unset (PDF not yet generated). Estimates/invoices live in the
            // ACCOUNTING tab now; FilesViewV3 filters those out internally,
            // so this handler only fires for non-financial docs.
            if (file.pdfStoragePath) {
              window.open(file.pdfStoragePath, "_blank", "noopener");
            }
          }}
        />
      }
    />
  );

  return (
    <>
      <ResponsiveInboxShell
        threadId={selectedThreadId ?? ""}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        threadList={threadList}
        detail={detailNode}
        contextRail={contextRail}
      />
      <ArchiveConfirmModal
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        context={archiveContext}
        onConfirm={async (args) => {
          if (args.saveLeadPreference && archiveContext?.connectionId) {
            await threadActions.setLeadArchivePreference.mutateAsync({
              connectionId: archiveContext.connectionId,
              preference: args.saveLeadPreference,
            });
          }
          await threadActions.archiveBatch.mutateAsync({
            threadIds: args.threadIds,
            archiveOpportunityId: args.archiveOpportunityId,
          });
          setArchiveOpen(false);
          setArchiveContext(null);
          enqueueUndoToast({
            message: t("toast.archivedTactic", "SYS :: THREAD ARCHIVED"),
            onUndo: () =>
              threadActions.unarchiveBatch.mutate({
                threadIds: args.threadIds,
                unarchiveOpportunityId: args.archiveOpportunityId,
              }),
          });
        }}
      />
    </>
  );
}

// ─── Adapters ────────────────────────────────────────────────────────────────

function toThreadListItem(t: InboxThreadRow): ThreadListItem {
  const lastMessageMs = new Date(t.lastMessageAt).getTime();
  const lastInboundAt =
    t.latestDirection === "inbound" ? lastMessageMs : null;
  const lastOutboundAt =
    t.latestDirection === "outbound" ? lastMessageMs : null;
  const aiSummary = t.aiSummary?.trim() || null;
  const snippet = t.latestSnippet?.trim() || "";
  const state = computeStateTag({
    lastInboundAt,
    lastOutboundAt,
    hasAiDraft: t.phaseC === "ai_drafted",
    sentByAgentRecently: t.phaseC === "auto_sent",
    labels: t.labels,
    closed: t.archivedAt !== null,
    now: Date.now(),
  });
  return {
    id: t.id,
    ts: lastMessageMs,
    labels: t.labels,
    agent: { needsInput: t.agentBlockingQuestion !== null },
    phaseC: t.phaseC,
    closed: t.archivedAt !== null,
    clientName: t.clientName ?? t.latestSenderName ?? "Unknown",
    subject: t.subject ?? "",
    snippet,
    aiSummary,
    unread: t.unreadCount > 0,
    messageCount: t.messageCount,
    draftKind: null,
    state,
    lastInboundAt,
  };
}

function toCommitments(t: InboxThreadRow): TodayCommitment[] {
  // Three preconditions to surface a commitment row:
  //   1. The denormalized flag is on (the trigger flagged this thread)
  //   2. There's a due date (no point rendering "—")
  //   3. The page-time enrichment found the underlying memory id, so the
  //      ✓ resolve affordance has something to PATCH
  if (
    !t.hasUnresolvedCommitments ||
    !t.nextCommitmentDueAt ||
    !t.nextCommitmentId
  ) {
    return [];
  }
  const lastMessageMs = new Date(t.lastMessageAt).getTime();
  const lastInboundAt =
    t.latestDirection === "inbound" ? lastMessageMs : null;
  const lastOutboundAt =
    t.latestDirection === "outbound" ? lastMessageMs : null;
  const stateResult = computeStateTag({
    lastInboundAt,
    lastOutboundAt,
    hasAiDraft: t.phaseC === "ai_drafted",
    sentByAgentRecently: t.phaseC === "auto_sent",
    labels: t.labels,
    closed: t.archivedAt !== null,
    now: Date.now(),
  });
  const waitingDays =
    t.latestDirection === "inbound"
      ? Math.floor((Date.now() - lastMessageMs) / 86_400_000)
      : 0;
  const clientName = t.clientName ?? t.latestSenderName ?? "Unknown";
  return [
    {
      id: t.nextCommitmentId,
      threadId: t.id,
      text: `${clientName} — ${t.subject ?? "—"}`,
      clientName,
      state: {
        tone: stateResult.tone,
        prefix: stateResult.prefix ?? "",
        value: stateResult.value,
      },
      waitingDays,
    },
  ];
}


function formatDue(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d
    .toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    .toUpperCase();
  if (sameDay) return `TODAY ${time}`;
  return d
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .toUpperCase();
}

function toRenderableMessage(m: InboxThreadMessage): RenderableMessage {
  const ts = new Date(m.date).getTime();
  const senderName = m.fromName ?? m.from ?? "—";
  return {
    id: m.id,
    authorId: m.from || m.id,
    ts,
    source: "human",
    direction: m.direction,
    body: m.cleanBodyText || m.bodyText || m.snippet || "",
    senderName,
    initials: senderName,
    attachmentName: m.hasAttachments ? "attachment" : undefined,
    timestamp: new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

function guessSenderName(messages: InboxThreadMessage[]): string | null {
  for (const m of messages) {
    if (m.direction === "inbound" && m.fromName) return m.fromName;
  }
  for (const m of messages) {
    if (m.direction === "inbound") return m.from;
  }
  return null;
}

function toPipelineOpp(
  o: Opportunity,
  linkedOppIds: Set<string>,
  currentThreadId: string | undefined,
): PipelineOpp {
  // winProbability is 0..1 — collapse into a tactile string that matches the
  // canonical Pipeline tab data contract.
  let confidence: "low" | "warm" | "high" | null = null;
  if (typeof o.winProbability === "number") {
    if (o.winProbability >= 0.7) confidence = "high";
    else if (o.winProbability >= 0.4) confidence = "warm";
    else confidence = "low";
  }
  // PipelineList paints the "This thread" indicator when threadId on the opp
  // matches the currently-open thread. linkedOppIds is the set the
  // opportunity_email_threads junction returned for this thread.
  const isLinked = linkedOppIds.has(o.id);
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    value: o.estimatedValue ?? null,
    stage: String(o.stage),
    estimateRef: null,
    confidence,
    source: o.source ? String(o.source) : null,
    threadId: isLinked ? (currentThreadId ?? null) : null,
  };
}

function toCommitmentPillItem(c: {
  id: string;
  content: string;
  dueDate: string | null;
}): CommitmentPillItem {
  // Urgency window mirrors the today-bar — anything due in the next 24h
  // shows as urgent. Without a due date we default to non-urgent and
  // render an em-dash instead of a date string.
  let urgent = false;
  let due = "—";
  if (c.dueDate) {
    const d = new Date(c.dueDate);
    if (!Number.isNaN(d.getTime())) {
      const URGENCY_MS = 24 * 60 * 60 * 1000;
      urgent = d.getTime() - Date.now() <= URGENCY_MS;
      due = formatDue(d);
    }
  }
  return {
    id: c.id,
    content: c.content || "—",
    due,
    urgent,
  };
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12 font-mono text-[11px] text-text-3">
      {label}
    </div>
  );
}
