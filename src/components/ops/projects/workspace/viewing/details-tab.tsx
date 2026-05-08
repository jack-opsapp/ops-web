"use client";

import * as React from "react";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import {
  useProjectTasksGrouped,
  type ProjectTaskRow,
} from "@/lib/hooks/use-project-tasks-grouped";
import { useProjectTeam, type ProjectTeamMember } from "@/lib/hooks/use-project-team";
import { useProject } from "@/lib/hooks/use-projects";
import { Stack } from "@/components/ops/projects/workspace/atoms/stack";
import { Inline } from "@/components/ops/projects/workspace/atoms/inline";
import { Body } from "@/components/ops/projects/workspace/atoms/body";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Hairline } from "@/components/ops/projects/workspace/atoms/hairline";
import { UserAvatar } from "@/components/ops/user-avatar";
import { formatDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

// `DetailsTab` — Scope → Team → TaskList composition.
//
// Scope: project.projectDescription as sentence-case body. Empty state is a
// dim placeholder, not a missing block — the Scope section is structural.
//
// Team: flat membership (no PM concept). Each member's "role" on this project
// is the set of task types they're assigned to (e.g. "Roofing · Framing").
// Empty taskTypeNames → dim "Unassigned" tag so the row still reads.
//
// TaskList: groups tasks by status — Active (today's window), Upcoming, Done.
// Cancelled tasks are filtered upstream by useProjectTasksGrouped. Each task
// uses its task_type colour as a leading dot, the type name as the chip, and
// a status icon (active / upcoming / done).

interface DetailsTabProps {
  projectId: string;
}

function ScopeSection({ description }: { description: string | null }) {
  const { t } = useDictionary("project-workspace");
  return (
    <Section title={t("details.scope.section")}>
      {description && description.trim().length > 0 ? (
        <Body as="p" size={14} color="text" className="whitespace-pre-wrap break-words pt-1">
          {description}
        </Body>
      ) : (
        <Body size={14} color="text-3" className="pt-1">
          {t("details.scope.empty")}
        </Body>
      )}
    </Section>
  );
}

function TeamRow({ member }: { member: ProjectTeamMember }) {
  const { t } = useDictionary("project-workspace");
  return (
    <div data-testid="team-row" className="flex items-center gap-3 py-2">
      <UserAvatar
        name={member.name}
        imageUrl={member.profileImageURL}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <Body size={14} color="text">
          {member.name}
        </Body>
        {member.taskTypeNames.length > 0 ? (
          <Mono color="text-3" size={9} className="block">
            {member.taskTypeNames.join(" · ")}
          </Mono>
        ) : (
          <Mono color="mute" size={9} className="block">
            {t("details.team.unassigned")}
          </Mono>
        )}
      </div>
    </div>
  );
}

function TeamSection({ projectId }: { projectId: string }) {
  const { t } = useDictionary("project-workspace");
  const { members } = useProjectTeam(projectId);
  return (
    <Section
      title={t("details.team.section")}
      rightSlot={<Mono color="text-3" size={9}>{`${members.length}`}</Mono>}
    >
      {members.length === 0 ? (
        <Body size={14} color="text-3" className="py-3">
          {t("details.team.empty")}
        </Body>
      ) : (
        <div className="divide-y divide-glass-border">
          {members.map((m) => (
            <TeamRow key={m.id} member={m} />
          ))}
        </div>
      )}
    </Section>
  );
}

function StatusIcon({ status }: { status: ProjectTaskRow["status"] }) {
  const cls = "w-3.5 h-3.5 shrink-0";
  if (status === "completed") {
    return <CheckCircle2 className={cls} strokeWidth={1.5} aria-hidden="true" />;
  }
  if (status === "active") {
    return <Clock className={cls} strokeWidth={1.5} aria-hidden="true" />;
  }
  return <Circle className={cls} strokeWidth={1.5} aria-hidden="true" />;
}

function TaskRow({ task }: { task: ProjectTaskRow }) {
  const isDone = task.status === "completed";
  return (
    <div
      data-testid="task-row"
      data-status={task.status}
      className="flex items-center gap-2 py-2"
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: task.chipColor }}
      />
      <span style={{ color: isDone ? "var(--text-3)" : "var(--text-2)" }}>
        <StatusIcon status={task.status} />
      </span>
      <Body
        size={14}
        color={isDone ? "text-3" : "text"}
        className={cn("min-w-0 flex-1 truncate", isDone && "line-through")}
      >
        {task.title}
      </Body>
      <Mono color="text-3" size={9}>
        {task.chipLabel}
      </Mono>
      {(task.startDate || task.endDate) && (
        <Mono color="mute" size={9}>
          {task.startDate && task.endDate && task.startDate !== task.endDate
            ? `${formatDate(task.startDate, "MMM d")} – ${formatDate(task.endDate, "MMM d")}`
            : formatDate(task.startDate ?? task.endDate, "MMM d, yyyy")}
        </Mono>
      )}
    </div>
  );
}

function TaskGroup({
  groupId,
  label,
  tasks,
}: {
  /** Stable id for testing/styling — independent of the translated label. */
  groupId: "active" | "upcoming" | "done";
  label: string;
  tasks: ProjectTaskRow[];
}) {
  if (tasks.length === 0) return null;
  return (
    <div data-testid={`task-group-${groupId}`}>
      <Inline gap={1.5} className="pb-1.5">
        <Mono color="text-3" size={9}>{`// ${label}`}</Mono>
        <Mono color="mute" size={9}>{`${tasks.length}`}</Mono>
      </Inline>
      <Hairline variant="dashed" className="mb-1" />
      <div className="divide-y divide-glass-border">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </div>
    </div>
  );
}

function TasksSection({ projectId }: { projectId: string }) {
  const { t } = useDictionary("project-workspace");
  const { data, isLoading } = useProjectTasksGrouped(projectId);
  const grouped = data ?? {
    done: [],
    active: [],
    upcoming: [],
    totals: { done: 0, total: 0 },
  };

  return (
    <Section
      title={t("details.tasks.section")}
      rightSlot={
        <Mono color="text-3" size={9}>{`${grouped.totals.done}/${grouped.totals.total}`}</Mono>
      }
    >
      {isLoading ? (
        <Body size={14} color="text-3" className="py-6">
          {t("details.tasks.loading")}
        </Body>
      ) : grouped.totals.total === 0 ? (
        <Body size={14} color="text-3" className="py-6">
          {t("details.tasks.empty")}
        </Body>
      ) : (
        <Stack gap={2} className="pt-1">
          <TaskGroup groupId="active" label={t("details.tasks.group.active")} tasks={grouped.active} />
          <TaskGroup groupId="upcoming" label={t("details.tasks.group.upcoming")} tasks={grouped.upcoming} />
          <TaskGroup groupId="done" label={t("details.tasks.group.done")} tasks={grouped.done} />
        </Stack>
      )}
    </Section>
  );
}

export function DetailsTab({ projectId }: DetailsTabProps) {
  const { data: project } = useProject(projectId);

  return (
    <Stack gap={4} className="px-4 py-3">
      <ScopeSection description={project?.projectDescription ?? null} />
      <TeamSection projectId={projectId} />
      <TasksSection projectId={projectId} />
    </Stack>
  );
}
