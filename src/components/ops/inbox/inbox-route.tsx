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
 *  - `phaseC` and `agent.needsInput` are not yet on the thread row schema;
 *    we default them to "none" / false. Bands that depend on them won't
 *    fire until the data layer surfaces those fields.
 *  - `Project` / `Opportunity` / `Attachment` from the existing services
 *    don't expose every field the redesign cards consume (accounting
 *    totals, confidence, sizes). Missing fields render as zeros / dashes.
 */

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useDictionary } from "@/i18n/client";
import { useInboxThreads, useInboxThread } from "@/lib/hooks/use-inbox-threads";
import { useClientProjects } from "@/lib/hooks/use-client-projects";
import { useClientOpportunities } from "@/lib/hooks/use-client-opportunities";
import { useClientFiles } from "@/lib/hooks/use-client-files";
import { ResponsiveInboxShell } from "./responsive-inbox-shell";
import { TodayBar, type TodayCommitment } from "./today-bar";
import { ThreadList, type ThreadListItem } from "./thread-list";
import { ThreadDetail } from "./thread-detail";
import { DetailBand } from "./detail-band";
import { MessageList, type RenderableMessage } from "./message-list";
import { Composer } from "./composer/composer";
import { ContextRail } from "./context-rail/context-rail";
import { ProjectCard, type ProjectCardData } from "./context-rail/project-card";
import { PipelineList, type PipelineOpp } from "./context-rail/pipeline-list";
import { FilesView, type FileItem, type PhotoItem } from "./context-rail/files-view";
import {
  type ProjectStatus as UIProjectStatus,
} from "./context-rail/status-pip";
import { useInboxLayoutStore } from "@/stores/inbox-layout-store";
import type {
  InboxThreadRow,
  InboxThreadMessage,
} from "@/lib/hooks/use-inbox-threads";
import type { Project, ProjectTask as DataProjectTask } from "@/lib/types/models";
import { ProjectStatus as DataProjectStatus, TaskStatus } from "@/lib/types/models";
import type { Opportunity } from "@/lib/types/pipeline";
import type { ProjectPhoto } from "@/lib/types/pipeline";

interface InboxRouteProps {
  threadId?: string;
}

export function InboxRoute({ threadId }: InboxRouteProps) {
  const router = useRouter();
  const { t } = useDictionary("inbox");
  const setRailOpen = useInboxLayoutStore((s) => s.setRightRailOpen);
  const railOpen = useInboxLayoutStore((s) => s.rightRailOpen);
  const [composerValue, setComposerValue] = useState("");

  const threadsQuery = useInboxThreads({ scope: "own", filter: "everything" });
  const threadDetail = useInboxThread(threadId ?? null);

  const threads = threadsQuery.data?.pages?.[0]?.threads ?? [];
  const detail = threadDetail.data ?? null;
  const clientId = detail?.thread.clientId ?? null;

  const projectsQuery = useClientProjects(clientId);
  const opportunitiesQuery = useClientOpportunities(clientId);
  const filesQuery = useClientFiles(clientId);

  const now = Date.now();

  const rows = useMemo<ThreadListItem[]>(
    () => threads.map(toThreadListItem),
    [threads],
  );

  const commitments = useMemo<TodayCommitment[]>(
    () => threads.flatMap(toCommitments).slice(0, 3),
    [threads],
  );

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
      <TodayBar commitments={commitments} />
      {threadsQuery.isLoading ? (
        <EmptyState label={t("list.loading", "// LOADING")} />
      ) : rows.length === 0 ? (
        <EmptyState label={t("list.empty", "// ALL CAUGHT UP")} />
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

  const detailNode = detail ? (
    <ThreadDetail
      client={{
        name:
          detail.thread.clientName ??
          guessSenderName(detail.messages) ??
          t("detail.unknownClient", "Unknown sender"),
        phone: null,
        email:
          detail.messages.find((m) => m.direction === "inbound")?.from ?? null,
        address: null,
      }}
      rightRailOpen={railOpen}
      onPrev={onPrev}
      onNext={onNext}
      onArchive={() => {}}
      onSnooze={() => {}}
      onRecategorize={() => {}}
      onMore={() => {}}
      onToggleRail={() => setRailOpen(!railOpen)}
    >
      <DetailBand
        thread={{
          aiSummary: detail.thread.aiSummary,
          // Data-layer gap: phaseC + agent.needsInput aren't on InboxThreadDetail
          // yet. Defaults keep the band system selecting summary / ball-yours
          // until the schema catches up.
          phaseC: "none",
          agent: { needsInput: false },
          closed: detail.thread.archivedAt !== null,
          ballInCourt:
            detail.messages.at(-1)?.direction === "inbound" ? "user" : "them",
        }}
        clientName={detail.thread.clientName ?? ""}
        renderedAt={now}
        onAction={() => {}}
      />
      <MessageList messages={detail.messages.map(toRenderableMessage)} />
      <Composer
        value={composerValue}
        onChange={setComposerValue}
        onSend={(value) => {
          // Sending wires up to `useThreadActions` in a follow-up. For now
          // the composer is interactive but submissions are no-ops.
          if (process.env.NODE_ENV !== "production") {
            console.info("[inbox] composer send (stub):", value);
          }
          setComposerValue("");
        }}
        placeholder={t("composer.placeholder", "Reply to this thread…")}
      />
    </ThreadDetail>
  ) : threadId ? (
    <EmptyState label={t("detail.loading", "// LOADING THREAD")} />
  ) : (
    <EmptyState label={t("detail.empty", "// SELECT A THREAD")} />
  );

  const projects = projectsQuery.data ?? [];
  const opportunities = opportunitiesQuery.data ?? [];
  const photoRows = filesQuery.data?.photos ?? [];

  const projectCards = projects.map((p) => (
    <ProjectCard
      key={p.id}
      project={toProjectCardData(p)}
      threadId={threadId ?? ""}
      defaultOpen={false}
    />
  ));

  const pipelineOpps = useMemo<PipelineOpp[]>(
    () => opportunities.map(toPipelineOpp),
    [opportunities],
  );

  const photos = useMemo<PhotoItem[]>(
    () => photoRows.map(toPhotoItem),
    [photoRows],
  );

  // The ClientFilesResult only surfaces photos right now (documents is `never[]`).
  // The // DOCUMENTS section will render an empty state until ProjectFileService
  // is added — see use-client-files.ts.
  const docs: FileItem[] = [];

  const filesCount = photos.length + docs.length;

  const contextRail = clientId ? (
    <ContextRail
      client={{ name: detail?.thread.clientName ?? "" }}
      threadId={threadId ?? ""}
      onOpenClient={() => router.push(`/clients/${clientId}`)}
      counts={{
        projects: projects.length,
        pipeline: opportunities.length,
        files: filesCount,
      }}
      projects={
        projects.length === 0 ? (
          <EmptyState label={t("rail.projects.empty", "// NO PROJECTS")} />
        ) : (
          <div className="flex flex-col gap-2">{projectCards}</div>
        )
      }
      pipeline={
        pipelineOpps.length === 0 ? (
          <EmptyState label={t("rail.pipeline.empty", "// NO OPPORTUNITIES")} />
        ) : (
          <PipelineList
            opps={pipelineOpps}
            threadId={threadId ?? ""}
            onNewOpportunity={() => {}}
          />
        )
      }
      files={<FilesView photos={photos} documents={docs} />}
    />
  ) : (
    <EmptyState label={t("rail.empty", "// NO CLIENT LINKED")} />
  );

  return (
    <ResponsiveInboxShell
      threadId={threadId ?? ""}
      threadList={threadList}
      detail={detailNode}
      contextRail={contextRail}
    />
  );
}

// ─── Adapters ────────────────────────────────────────────────────────────────

function toThreadListItem(t: InboxThreadRow): ThreadListItem {
  return {
    id: t.id,
    ts: new Date(t.lastMessageAt).getTime(),
    labels: t.labels,
    // See "Known data-layer gaps" at the top — defaults until schema lands.
    agent: { needsInput: false },
    phaseC: "none",
    closed: t.archivedAt !== null,
    clientName: t.clientName ?? t.latestSenderName ?? "Unknown",
    snippet: t.latestSnippet ?? "",
    unread: t.unreadCount > 0,
  };
}

function toCommitments(t: InboxThreadRow): TodayCommitment[] {
  if (!t.hasUnresolvedCommitments || !t.nextCommitmentDueAt) return [];
  const due = new Date(t.nextCommitmentDueAt);
  return [
    {
      id: t.id,
      threadId: t.id,
      text: `${t.clientName ?? t.latestSenderName ?? "Thread"} — ${t.subject ?? "—"}`,
      due: formatDue(due),
      urgent: t.labels.includes("URGENT"),
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
  return {
    id: m.id,
    authorId: m.from || m.id,
    ts,
    source: "human",
    direction: m.direction,
    body: m.cleanBodyText || m.bodyText || m.snippet || "",
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

// Map the data-layer ProjectStatus enum to the UI type the StatusPip
// component understands. UI knows: "On site" | "Quoted" | "Awaiting acceptance"
// | "Done" | "Paid" | "Scheduled".
function toUIProjectStatus(status: DataProjectStatus): UIProjectStatus {
  switch (status) {
    case DataProjectStatus.InProgress:
      return "On site";
    case DataProjectStatus.RFQ:
    case DataProjectStatus.Estimated:
      return "Quoted";
    case DataProjectStatus.Accepted:
      return "Scheduled";
    case DataProjectStatus.Completed:
      return "Done";
    case DataProjectStatus.Closed:
    case DataProjectStatus.Archived:
      return "Done";
    default:
      return "Quoted";
  }
}

function toProjectCardData(p: Project): ProjectCardData {
  // Data-layer gap: Project doesn't expose value, accounting, invoices, or
  // estimates in the live shape. The Card renders zeroes / empty arrays for
  // those slots — the next iteration extends ProjectService.
  const start = p.startDate
    ? p.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
  const end = p.endDate
    ? p.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";
  return {
    id: p.id,
    title: p.title,
    value: 0,
    status: toUIProjectStatus(p.status),
    stage: p.projectDescription ?? "—",
    startDate: start,
    endDate: end,
    leadName: "—",
    tasks: (p.tasks ?? []).map(toUITask),
    accounting: { total: 0, invoiced: 0, paid: 0 },
    invoices: [],
    estimates: [],
  };
}

function toUITask(t: DataProjectTask): { id: string; label: string; done: boolean } {
  return {
    id: t.id,
    label: t.customTitle ?? "Task",
    done: t.status === TaskStatus.Completed,
  };
}

function toPipelineOpp(o: Opportunity): PipelineOpp {
  return {
    id: o.id,
    title: o.title,
    value: o.estimatedValue ?? 0,
    stage: String(o.stage),
    estimateRef: null,
    confidence: o.winProbability ?? 0,
    source: o.source ? String(o.source) : "—",
    threadId: null,
  };
}

function toPhotoItem(p: ProjectPhoto): PhotoItem {
  return {
    id: p.id,
    url: p.thumbnailUrl ?? p.url,
    filename: p.caption ?? "Photo",
  };
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12 text-text-3 font-mono text-[11px] tracking-[0.18em] uppercase">
      {label}
    </div>
  );
}
