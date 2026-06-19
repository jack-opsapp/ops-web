"use client";

import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { UserPlus } from "lucide-react";
import { EntityPicker } from "@/components/ui/entity-picker";
import { UserAvatar } from "@/components/ops/user-avatar";
import { useDictionary } from "@/i18n/client";
import { useProjectTableTeam } from "@/lib/hooks/projects-table/use-project-table-team";
import { useTeamScheduleConflicts } from "@/lib/hooks/use-team-conflicts";
import { ProjectTableMutationError } from "@/lib/api/services/project-table-service";
import type {
  ProjectTableTaskOption,
  ProjectTableTeamMember,
} from "@/lib/api/services/project-table-team-service";
import type { ProjectTableRow } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";

// Keys the table grid handles itself — swallow them while the picker is open so
// cell navigation doesn't fire underneath the popover.
const ISOLATED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  " ",
]);

function formatText(template: string, replacements: Record<string, string | number>) {
  return Object.entries(replacements).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
    template,
  );
}

function isAssignableTask(task: ProjectTableTaskOption) {
  const status = task.status.trim().toLowerCase();
  return status !== "completed" && status !== "cancelled";
}

function formatConflictWhen(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function is42501(error: unknown) {
  return (
    (error instanceof ProjectTableMutationError && error.code === "42501") ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "42501")
  );
}

/**
 * CellTeam — crew for a project row.
 *
 * Team membership is per-task (the project's `team_member_ids` is the union of
 * its tasks'), so the picker is just a multi-select of crew: checking a member
 * assigns them to every active task ("on the job"); unchecking removes them from
 * all. Optimistic, no Apply. When the project has no active task there is nothing
 * to assign to, so the list is read-only with a notice. A denied write (RLS
 * 42501) surfaces inline. Members already booked on another project in the
 * window get an inline advisory (not a hard block).
 */
export function CellTeam({
  row,
  avatarSize = 20,
}: {
  row: ProjectTableRow;
  avatarSize?: number;
}) {
  const { t } = useDictionary("projects");
  const { t: tp } = useDictionary("picker");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { teamMembersQuery, tasksQuery, assignedMembers, assignTeamMember, removeTeamMember } =
    useProjectTableTeam({ row });

  const members = teamMembersQuery.data ?? [];
  const activeTaskIds = useMemo(
    () => (tasksQuery.data ?? []).filter(isAssignableTask).map((task) => task.id),
    [tasksQuery.data],
  );
  const hasActiveTasks = activeTaskIds.length > 0;

  // Schedule-conflict advisory — members booked on another project in the
  // window. Fetched only while the picker is open (excludes this project).
  const memberNameMap = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );
  const { data: conflicts = [] } = useTeamScheduleConflicts(
    members.map((member) => member.id),
    row.id,
    memberNameMap,
    open,
  );
  const conflictByMember = useMemo(() => {
    const map = new Map<string, { projectTitle: string; date: Date }>();
    for (const conflict of conflicts) {
      if (!map.has(conflict.memberId)) {
        map.set(conflict.memberId, { projectTitle: conflict.projectTitle, date: conflict.date });
      }
    }
    return map;
  }, [conflicts]);

  const assignedCount = row.teamMemberIds.length;
  const triggerLabel = formatText(t("table.cell.team.triggerLabel"), {
    project: row.title,
    count: assignedCount,
  });
  const title = formatText(t("table.cell.team.title"), { project: row.title });

  async function handleChange(nextIds: string[]) {
    if (!hasActiveTasks) return;
    setError(null);
    const current = new Set(row.teamMemberIds);
    const next = new Set(nextIds);
    const added = nextIds.filter((id) => !current.has(id));
    const removed = row.teamMemberIds.filter((id) => !next.has(id));
    try {
      for (const userId of added) {
        await assignTeamMember.mutateAsync({ userId, taskIds: activeTaskIds });
      }
      for (const userId of removed) {
        await removeTeamMember.mutateAsync({ userId, taskIds: null });
      }
    } catch (err) {
      setError(is42501(err) ? t("table.cell.team.readOnly") : t("table.cell.team.error"));
    }
  }

  function conflictFor(id: string) {
    const conflict = conflictByMember.get(id);
    if (!conflict) return null;
    return formatText(tp("conflict"), {
      project: conflict.projectTitle,
      when: formatConflictWhen(conflict.date),
    });
  }

  const trigger = (
    <button
      type="button"
      aria-label={triggerLabel}
      onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
        if (ISOLATED_KEYS.has(event.key)) event.stopPropagation();
      }}
      className="flex h-full w-full min-w-0 items-center gap-1 rounded-[5px] px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black"
    >
      {assignedMembers.length > 0 ? (
        <span className="flex min-w-0 items-center">
          {assignedMembers.slice(0, 3).map((member, index) => (
            <span key={member.id} className={cn(index > 0 && "-ml-1")}>
              <UserAvatar name={member.name} imageUrl={member.profileImageUrl} size="sm" />
            </span>
          ))}
        </span>
      ) : (
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-input text-text-3"
          style={{ height: avatarSize, width: avatarSize }}
        >
          <UserPlus
            style={{
              height: Math.max(12, Math.round(avatarSize * 0.7)),
              width: Math.max(12, Math.round(avatarSize * 0.7)),
            }}
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
      )}
      <span className="font-mono text-micro tabular-nums text-text-2">{assignedCount}</span>
    </button>
  );

  return (
    <EntityPicker<ProjectTableTeamMember>
      multiple
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      label={title}
      items={members}
      value={row.teamMemberIds}
      onChange={handleChange}
      getId={(member) => member.id}
      getLabel={(member) => member.name}
      getAvatar={(member) => ({ name: member.name, imageUrl: member.profileImageUrl })}
      conflictFor={conflictFor}
      searchPlaceholder={t("table.cell.team.search")}
      clearLabel={tp("clear")}
      emptyLabel={t("table.cell.team.emptyAvailable")}
      readOnly={!hasActiveTasks}
      readOnlyLabel={hasActiveTasks ? undefined : t("table.cell.team.noTasks")}
      error={error}
    />
  );
}
