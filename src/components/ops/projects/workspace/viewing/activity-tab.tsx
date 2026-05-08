"use client";

import * as React from "react";
import {
  CheckCircle2,
  FileText,
  Receipt,
  DollarSign,
  Camera,
  ArrowUpDown,
  Coins,
  Archive,
  FilePlus2,
  FileSignature,
} from "lucide-react";
import {
  useProjectActivity,
  type ProjectActivityEntry,
  type ProjectActivityKind,
} from "@/lib/hooks/use-project-activity";
import { useTeamMembers } from "@/lib/hooks/use-users";
import { useCreateProjectNote } from "@/lib/hooks/use-project-notes";
import { useAuthStore } from "@/lib/store/auth-store";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { UserAvatar } from "@/components/ops/user-avatar";
import { NoteComposer } from "@/components/ops/note-composer";
import { formatRelativeTime } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";

// `ActivityTab` — unified project_notes timeline. event_kind discriminates
// user notes (NULL → "note") from system events (status_change,
// payment_received, …) — we render both in a single ordered stream so the
// project's history reads as one continuous record. System rows get a kind
// chip + leading icon; note rows get the author's avatar.
//
// NoteComposer is reused as-is (per Phase 7.5 plan: no new ActivityComposer).
// The mutate shape comes from useCreateProjectNote — projectId / companyId /
// authorId are filled in here so the composer stays domain-agnostic.

interface ActivityTabProps {
  projectId: string;
}

const KIND_LABEL: Record<ProjectActivityKind, string> = {
  note: "NOTE",
  status_change: "STATUS",
  estimate_sent: "ESTIMATE SENT",
  estimate_approved: "ESTIMATE APPROVED",
  estimate_declined: "ESTIMATE DECLINED",
  invoice_sent: "INVOICE SENT",
  payment_received: "PAYMENT",
  expense_logged: "EXPENSE",
  photo_uploaded: "PHOTO",
  project_created: "CREATED",
  project_archived: "ARCHIVED",
  task_completed: "TASK DONE",
};

function KindIcon({ kind }: { kind: ProjectActivityKind }) {
  const cls = "w-3.5 h-3.5";
  switch (kind) {
    case "status_change":
      return <ArrowUpDown className={cls} strokeWidth={1.5} />;
    case "estimate_sent":
    case "estimate_approved":
    case "estimate_declined":
      return <FileText className={cls} strokeWidth={1.5} />;
    case "invoice_sent":
      return <Receipt className={cls} strokeWidth={1.5} />;
    case "payment_received":
      return <DollarSign className={cls} strokeWidth={1.5} />;
    case "expense_logged":
      return <Coins className={cls} strokeWidth={1.5} />;
    case "photo_uploaded":
      return <Camera className={cls} strokeWidth={1.5} />;
    case "project_created":
      return <FilePlus2 className={cls} strokeWidth={1.5} />;
    case "project_archived":
      return <Archive className={cls} strokeWidth={1.5} />;
    case "task_completed":
      return <CheckCircle2 className={cls} strokeWidth={1.5} />;
    default:
      return <FileSignature className={cls} strokeWidth={1.5} />;
  }
}

function ActivityRow({ entry }: { entry: ProjectActivityEntry }) {
  const isSystem = entry.kind !== "note";
  return (
    <div data-testid="activity-row" data-kind={entry.kind} className="flex gap-3 py-3">
      {entry.author && !isSystem ? (
        <UserAvatar name={entry.author.name} size="sm" />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--fill-neutral-dim)", color: "var(--text-3)" }}
        >
          <KindIcon kind={entry.kind} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Inline gap={1.5} align="baseline" wrap>
          <Body size={14} color="text">
            {entry.author?.name ?? "System"}
          </Body>
          {isSystem && (
            <Mono color="text-3" size={9}>
              {KIND_LABEL[entry.kind]}
            </Mono>
          )}
          <Mono color="mute" size={9}>
            {formatRelativeTime(entry.createdAt)}
          </Mono>
        </Inline>
        {entry.content && (
          <Body
            as="p"
            size={14}
            color={isSystem ? "text-3" : "text-2"}
            className={cn("mt-0.5 whitespace-pre-wrap break-words")}
          >
            {entry.content}
          </Body>
        )}
        {entry.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {entry.attachments.map((a, i) => (
              <img
                key={i}
                src={a.markedUpUrl ?? a.url}
                alt={a.caption ?? ""}
                className="h-16 w-16 rounded border border-glass-border object-cover"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityTab({ projectId }: ActivityTabProps) {
  const { currentUser, company } = useAuthStore();
  const { data: activity = [], isLoading } = useProjectActivity(projectId);
  const { data: teamData } = useTeamMembers();
  const createNote = useCreateProjectNote();

  const canCompose = !!currentUser?.id && !!company?.id;

  return (
    <Stack gap={3} className="px-4 py-3">
      <Section title="ACTIVITY">
        {isLoading ? (
          <Body size={14} color="text-3" className="py-6">
            Loading…
          </Body>
        ) : activity.length === 0 ? (
          <Body size={14} color="text-3" className="py-6">
            No activity yet.
          </Body>
        ) : (
          <div data-testid="activity-list" className="divide-y divide-glass-border">
            {activity.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Section>

      {canCompose && (
        <NoteComposer
          users={teamData?.users ?? []}
          isSubmitting={createNote.isPending}
          onSubmit={(content, mentionedUserIds, attachments) => {
            if (!currentUser?.id || !company?.id) return;
            createNote.mutate({
              projectId,
              companyId: company.id,
              authorId: currentUser.id,
              content,
              mentionedUserIds,
              attachments,
            });
          }}
        />
      )}
    </Stack>
  );
}
