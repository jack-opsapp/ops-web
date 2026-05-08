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
import { useEffect, useMemo, useState } from "react";
import { useDictionary } from "@/i18n/client";
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
import { useClientOpportunities } from "@/lib/hooks/use-client-opportunities";
import { useClientFiles } from "@/lib/hooks/use-client-files";
import { useClient, useSubClients } from "@/lib/hooks/use-clients";
import { useThreadOpportunityLinks } from "@/lib/hooks/use-thread-opportunity-links";
import { useClientTasks } from "@/lib/hooks/use-client-tasks";
import { useWindowStore } from "@/stores/window-store";
import { ResponsiveInboxShell } from "./responsive-inbox-shell";
import { ThreadColumnHeader } from "./thread-column-header";
import { TodayBar, type TodayCommitment } from "./today-bar";
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
import { PipelineList, type PipelineOpp } from "./context-rail/pipeline-list";
import { FilesView, type FileItem, type PhotoItem } from "./context-rail/files-view";
import { TasksView, type RailTask } from "./context-rail/tasks-view";
import { ThreadsView, type RailRelatedThread } from "./context-rail/threads-view";
import type {
  InboxThreadRow,
  InboxThreadMessage,
} from "@/lib/hooks/use-inbox-threads";
import type { Opportunity } from "@/lib/types/pipeline";
import type { ProjectPhoto } from "@/lib/types/pipeline";
import type { ProjectDocument } from "@/lib/api/services/project-file-service";

interface InboxRouteProps {
  threadId?: string;
}

export function InboxRoute({ threadId }: InboxRouteProps) {
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
  const [composerValue, setComposerValue] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveContext, setArchiveContext] =
    useState<ArchiveConfirmContext | null>(null);

  const threadsQuery = useInboxThreads({ scope: "own", filter: "everything" });
  const threadDetail = useInboxThread(threadId ?? null);

  // Surface the thread subject in the dashboard breadcrumb instead of the
  // raw UUID. Falls back to "—" while the detail is still loading.
  const subject = threadDetail.data?.thread.subject ?? null;
  useEffect(() => {
    if (!threadId) {
      clearEntityName();
      return;
    }
    setEntityName(subject ?? "—");
    return () => clearEntityName();
  }, [threadId, subject, setEntityName, clearEntityName]);

  const threads = threadsQuery.data?.pages?.[0]?.threads ?? [];
  const detail = threadDetail.data ?? null;
  const clientId = detail?.thread.clientId ?? null;
  // providerThreadId lives on InboxThreadRow but not on InboxThreadDetail.
  // Cross-reference the list to recover it for outbound send threading.
  const providerThreadId =
    threads.find((row) => row.id === threadId)?.providerThreadId ?? null;

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

  const opportunitiesQuery = useClientOpportunities(clientId);
  const filesQuery = useClientFiles(clientId);
  const clientQuery = useClient(clientId ?? undefined);
  const subClientsQuery = useSubClients(clientId ?? undefined);
  const linkedOpsQuery = useThreadOpportunityLinks(threadId ?? null);
  const linkedOppIds = useMemo(
    () => new Set(linkedOpsQuery.data ?? []),
    [linkedOpsQuery.data],
  );
  const tasksQuery = useClientTasks(clientId ?? null);

  const now = Date.now();

  const rows = useMemo<ThreadListItem[]>(
    () => threads.map(toThreadListItem),
    [threads],
  );

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
    router.push(`/inbox/${id}`);
  };

  const onPrev = () => {
    const idx = rows.findIndex((r) => r.id === threadId);
    if (idx > 0) router.push(`/inbox/${rows[idx - 1].id}`);
  };
  const onNext = () => {
    const idx = rows.findIndex((r) => r.id === threadId);
    if (idx >= 0 && idx < rows.length - 1) router.push(`/inbox/${rows[idx + 1].id}`);
  };

  const threadList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadColumnHeader />
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
        <EmptyState label={t("list.empty", "All caught up")} />
      ) : (
        <ThreadList
          threads={rows}
          now={now}
          selectedThreadId={threadId ?? null}
          onSelect={onSelectThread}
        />
      )}
    </div>
  );

  const onArchiveClick = () => {
    if (!threadId || !detail) return;
    threadActions.archive.mutate(threadId, {
      onSuccess: (res) => {
        if (res.needsConfirmation) {
          setArchiveContext({
            currentThread: {
              id: threadId,
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
          message: t("toast.archived", "Archived"),
          onUndo: () => threadActions.unarchive.mutate(threadId),
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
        threadId ? (
          <SnoozePicker threadId={threadId} trigger={button} align="end" />
        ) : (
          button
        )
      }
      recategorizeSlot={(button) =>
        threadId ? (
          <RecategorizeMenu
            threadId={threadId}
            currentCategory={detail.thread.primaryCategory}
            trigger={button}
            align="end"
          />
        ) : (
          button
        )
      }
    >
      <CommitmentPills
        commitments={detail.commitments.map(toCommitmentPillItem)}
        onResolve={(commitmentId) => {
          if (!threadId) return;
          onResolveCommitment(commitmentId, threadId);
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
        onAction={(action) => {
          if (!threadId || !detail.thread.agentBlockingQuestion) return;
          const q = detail.thread.agentBlockingQuestion;

          if (action.startsWith("answer:")) {
            // Quick-pick chip. Find the option, record its label as the
            // operator's answer, clear the column server-side. The thread
            // re-groups out of NEEDS_INPUT on the next refetch.
            const optionId = action.slice("answer:".length);
            const option = q.options?.find((o) => o.id === optionId);
            if (!option) return;
            answerAgentQuestion.mutate({
              threadId,
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
          if (!userId || !companyId || !threadId) return;
          // Free-form answer path: when an unresolved agent question is
          // attached to this thread, treat the operator's typed reply as
          // both the email body AND the question's answer. Fire-and-forget
          // — answering shouldn't block the email send if it fails (the
          // band stays up and the operator can retry from the chip).
          if (detail.thread.agentBlockingQuestion) {
            answerAgentQuestion.mutate({ threadId, answer: value });
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
                threadId,
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
              onSuccess: () => setComposerValue(""),
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
  ) : threadId ? (
    <EmptyState label={t("detail.loading", "Loading thread")} />
  ) : (
    <EmptyState label={t("detail.empty", "Pick a thread from the list")} />
  );

  const opportunities = opportunitiesQuery.data ?? [];
  const photoRows = filesQuery.data?.photos ?? [];
  const documentRows = filesQuery.data?.documents ?? [];

  const pipelineOpps = useMemo<PipelineOpp[]>(
    () => opportunities.map((o) => toPipelineOpp(o, linkedOppIds, threadId)),
    [opportunities, linkedOppIds, threadId],
  );

  const photos = useMemo<PhotoItem[]>(
    () => photoRows.map(toPhotoItem),
    [photoRows],
  );

  const docs = useMemo<FileItem[]>(
    () => documentRows.map(toFileItem),
    [documentRows],
  );

  const railTasks = useMemo<RailTask[]>(
    () =>
      (tasksQuery.data ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        assignee: t.assignee,
        due: t.due,
        status: t.status,
        overdue: t.overdue,
      })),
    [tasksQuery.data],
  );

  // Related threads on the same client (excluding current). Already surfaced
  // by the inbox detail wire as `siblingThreads` (server returns up to 5,
  // most recent first, archived excluded).
  const railThreads = useMemo<RailRelatedThread[]>(() => {
    const siblings = detail?.siblingThreads ?? [];
    const now = Date.now();
    return siblings.map((s) => ({
      id: s.id,
      title: s.latestSenderName ?? s.subject ?? "—",
      subject: s.subject ?? "",
      messageCount: s.messageCount,
      when: formatRelativeShort(new Date(s.lastMessageAt).getTime(), now),
      unread: s.unreadCount > 0,
    }));
  }, [detail?.siblingThreads]);

  const filesCount = photos.length + docs.length;

  const senderEmail =
    detail?.messages.find((m) => m.direction === "inbound")?.from ?? null;
  const client = clientQuery.data ?? null;
  const subClientCount = subClientsQuery.data?.length ?? 0;
  const subtitle = subClientCount > 0
    ? `${subClientCount} ${subClientCount === 1 ? t("rail.subclient", "subclient") : t("rail.subclients", "subclients")}`
    : null;

  const contextRail = clientId ? (
    <ContextRail
      client={{
        name: client?.name ?? detail?.thread.clientName ?? "",
        subtitle,
        email: client?.email ?? senderEmail,
        phone: client?.phoneNumber ?? null,
        address: client?.address ?? null,
      }}
      threadId={threadId ?? ""}
      onOpenClient={() => router.push(`/clients/${clientId}`)}
      counts={{
        pipeline: opportunities.length,
        tasks: railTasks.length,
        files: filesCount,
        threads: railThreads.length,
      }}
      pipeline={
        pipelineOpps.length === 0 ? (
          <EmptyState label={t("rail.empty.pipeline", "No open opportunities")} />
        ) : (
          <PipelineList
            opps={pipelineOpps}
            threadId={threadId ?? ""}
            onNewOpportunity={() =>
              openWindow({
                id: clientId
                  ? `create-lead-${clientId}`
                  : `create-lead-${threadId ?? "new"}`,
                title: t("pipeline.newOpportunity", "New opportunity"),
                type: "create-lead",
                metadata: clientId
                  ? { clientId, sourceThreadId: threadId ?? null }
                  : { sourceThreadId: threadId ?? null },
              })
            }
          />
        )
      }
      tasks={<TasksView tasks={railTasks} />}
      files={
        <FilesView
          photos={photos}
          documents={docs}
          onFileOpen={(file) => {
            // pdf_storage_path is a fully qualified S3 URL — open in a new
            // tab rather than client-routing inside the SPA. No-op when
            // unset (PDF not yet generated).
            if (file.href) window.open(file.href, "_blank", "noopener");
          }}
        />
      }
      threads={<ThreadsView threads={railThreads} />}
    />
  ) : (
    <EmptyState label={t("rail.empty.client", "No client linked")} />
  );

  return (
    <>
      <ResponsiveInboxShell
        threadId={threadId ?? ""}
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
            message: t("toast.archived", "Archived"),
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
  return {
    id: t.id,
    ts: new Date(t.lastMessageAt).getTime(),
    labels: t.labels,
    agent: { needsInput: t.agentBlockingQuestion !== null },
    phaseC: t.phaseC,
    closed: t.archivedAt !== null,
    clientName: t.clientName ?? t.latestSenderName ?? "Unknown",
    subject: t.subject ?? "",
    snippet: t.latestSnippet ?? "",
    unread: t.unreadCount > 0,
    messageCount: t.messageCount,
    draftKind: null,
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
  const due = new Date(t.nextCommitmentDueAt);
  return [
    {
      id: t.nextCommitmentId,
      threadId: t.id,
      text: `${t.clientName ?? t.latestSenderName ?? "Thread"} — ${t.subject ?? "—"}`,
      due: formatDue(due),
      urgent: t.labels.includes("URGENT"),
    },
  ];
}

function formatRelativeShort(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
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
    value: o.estimatedValue ?? null,
    stage: String(o.stage),
    estimateRef: null,
    confidence,
    source: o.source ? String(o.source) : null,
    threadId: isLinked ? (currentThreadId ?? null) : null,
  };
}

function toPhotoItem(p: ProjectPhoto): PhotoItem {
  return {
    id: p.id,
    url: p.thumbnailUrl ?? p.url,
    filename: p.caption ?? "Photo",
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

function toFileItem(d: ProjectDocument): FileItem {
  // Estimates and invoices both render as PDFs in the rail, even when the
  // pdf hasn't been generated yet (drafts) — the icon stays consistent
  // with the operator's mental model. `pdf_storage_path` is a fully
  // qualified public S3 URL today (see /api/documents/generate-pdf), so
  // it can serve as the click target directly. When the PDF hasn't been
  // generated yet, omit the href — the click becomes a no-op rather than
  // a broken navigation to the list page.
  return {
    id: d.id,
    filename: d.filename,
    kind: "pdf",
    updatedAt: d.updatedAt,
    href: d.pdfStoragePath ?? undefined,
    status: d.status,
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
