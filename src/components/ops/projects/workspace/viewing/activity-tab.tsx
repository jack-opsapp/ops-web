"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
import { EASE_SMOOTH } from "@/lib/utils/motion";
import { useDictionary } from "@/i18n/client";

// `ActivityTab` — unified project_notes timeline. event_kind discriminates
// user notes (NULL → "note") from system events (status_change,
// payment_received, …) — we render both in a single ordered stream so the
// project's history reads as one continuous record. System rows get a kind
// chip + leading icon; note rows get the author's avatar.
//
// NoteComposer is reused as-is (per Phase 7.5 plan: no new ActivityComposer).
// The mutate shape comes from useCreateProjectNote — projectId / companyId /
// authorId are filled in here so the composer stays domain-agnostic.
//
// Phase 12.5 — entry stagger. Each row enters with opacity 0→1 + y 4→0
// over 180ms EASE_SMOOTH. Per-row delay is 50ms × index, capped at the
// 300ms total budget so a 100-entry timeline doesn't lag-load. The
// 7th+ row all share the 300ms ceiling, appearing simultaneously.
// AnimatePresence keys on entry.id so newly-mounted rows (e.g. a fresh
// optimistic note) animate in; existing rows don't re-stagger on
// re-render. Reduced motion → no entry animation.

const STAGGER_PER_ITEM = 0.05; // 50ms per row
const STAGGER_CEILING = 0.3;   // 300ms total budget
const ROW_FADE_DURATION = 0.18;

interface ActivityTabProps {
  projectId: string;
}

const KIND_KEY: Record<ProjectActivityKind, string> = {
  note: "activity.kind.note",
  status_change: "activity.kind.statusChange",
  estimate_sent: "activity.kind.estimateSent",
  estimate_approved: "activity.kind.estimateApproved",
  estimate_declined: "activity.kind.estimateDeclined",
  invoice_sent: "activity.kind.invoiceSent",
  payment_received: "activity.kind.paymentReceived",
  expense_logged: "activity.kind.expenseLogged",
  photo_uploaded: "activity.kind.photoUploaded",
  project_created: "activity.kind.projectCreated",
  project_archived: "activity.kind.projectArchived",
  task_completed: "activity.kind.taskCompleted",
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

interface ActivityRowProps {
  entry: ProjectActivityEntry;
  /** 0-based index within the rendered list — drives the stagger delay. */
  index: number;
  reducedMotion: boolean;
  t: (key: string) => string;
}

function ActivityRow({ entry, index, reducedMotion, t }: ActivityRowProps) {
  const isSystem = entry.kind !== "note";
  // Cap the per-row delay at the 300ms total budget so long timelines
  // don't lag-load. Math.min keeps the seventh-and-onwards rows pinned
  // at the ceiling rather than stretching the cascade.
  const delay = Math.min(index * STAGGER_PER_ITEM, STAGGER_CEILING);
  const initial = reducedMotion ? false : { opacity: 0, y: 4 };
  const animate = { opacity: 1, y: 0 };
  const transition = reducedMotion
    ? { duration: 0 }
    : { duration: ROW_FADE_DURATION, ease: EASE_SMOOTH, delay };
  return (
    <motion.div
      data-testid="activity-row"
      data-kind={entry.kind}
      data-stagger-delay={delay.toFixed(2)}
      initial={initial}
      animate={animate}
      transition={transition}
      className="flex gap-3 py-3"
    >
      <ActivityRowBody entry={entry} isSystem={isSystem} t={t} />
    </motion.div>
  );
}

function ActivityRowBody({
  entry,
  isSystem,
  t,
}: {
  entry: ProjectActivityEntry;
  isSystem: boolean;
  t: (key: string) => string;
}) {
  return (
    <>
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
            {entry.author?.name ?? t("activity.author.system")}
          </Body>
          {isSystem && (
            <Mono color="text-3" size={9}>
              {t(KIND_KEY[entry.kind])}
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
    </>
  );
}

export function ActivityTab({ projectId }: ActivityTabProps) {
  const { t } = useDictionary("project-workspace");
  const { currentUser, company } = useAuthStore();
  const { data: activity = [], isLoading } = useProjectActivity(projectId);
  const { data: teamData } = useTeamMembers();
  const createNote = useCreateProjectNote();
  const reducedMotion = useReducedMotion() ?? false;

  const canCompose = !!currentUser?.id && !!company?.id;

  return (
    <Stack gap={3} className="px-4 py-3">
      <Section title={t("activity.section")}>
        {isLoading ? (
          <Body size={14} color="text-3" className="py-6">
            {t("activity.loading")}
          </Body>
        ) : activity.length === 0 ? (
          <Body size={14} color="text-3" className="py-6">
            {t("activity.empty")}
          </Body>
        ) : (
          <div data-testid="activity-list" className="divide-y divide-glass-border">
            {/* AnimatePresence keys on entry.id so mounting a new note
                triggers the stagger entry; existing rows are stable
                across re-renders so they don't re-stagger. initial=false
                skips the entry animation on the first render of the tab
                — the timeline is already there when the tab opens; only
                NEW rows should animate. We override per-row via the
                row's `initial` prop so the first paint still skips, but
                NoteComposer-driven adds animate. */}
            <AnimatePresence initial={true}>
              {activity.map((entry, index) => (
                <ActivityRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  reducedMotion={reducedMotion}
                  t={t}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </Section>

      {canCompose && (
        <NoteComposer
          users={teamData?.users ?? []}
          isSubmitting={createNote.isPending}
          placeholder={t("activity.composerPlaceholder")}
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
