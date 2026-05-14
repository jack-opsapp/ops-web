"use client";

import Image from "next/image";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Check, ChevronRight, Search, UserPlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDictionary } from "@/i18n/client";
import { useProjectTableTeam } from "@/lib/hooks/projects-table/use-project-table-team";
import type {
  ProjectTableTaskOption,
  ProjectTableTeamMember,
} from "@/lib/api/services/project-table-team-service";
import type { ProjectTableRow } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";

const ISOLATED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  " ",
]);

function formatText(template: string, replacements?: Record<string, string | number>) {
  if (!replacements) return template;
  return Object.entries(replacements).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
    template,
  );
}

function mutationMessage(error: unknown, readOnly: string, fallback: string) {
  if (error && typeof error === "object" && "code" in error && error.code === "42501") {
    return readOnly;
  }
  return fallback;
}

function memberInitials(member: ProjectTableTeamMember) {
  const source = member.name.trim() || member.email?.trim() || member.id;
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last || source[1] || ""}`.toUpperCase();
}

function isAssignableTask(task: ProjectTableTaskOption) {
  const status = task.status.trim().toLowerCase();
  return status !== "completed" && status !== "cancelled";
}

function matchesSearch(member: ProjectTableTeamMember, search: string) {
  if (!search) return true;
  const haystack = [member.name, member.email, member.role].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(search);
}

function taskTitle(task: ProjectTableTaskOption, fallback: string) {
  return task.title.trim() || fallback;
}

function matchesTaskSearch(task: ProjectTableTaskOption, search: string, fallback: string) {
  if (!search) return true;
  return taskTitle(task, fallback).toLowerCase().includes(search);
}

function stopTableKeys(event: KeyboardEvent<HTMLElement>, onEscape?: () => void) {
  if (!ISOLATED_KEYS.has(event.key)) return;
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape?.();
  }
}

function stopPointer(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function MemberAvatar({
  member,
  size = 20,
}: {
  member: ProjectTableTeamMember;
  size?: number;
}) {
  const initials = memberInitials(member);
  const fontSize = Math.max(10, Math.round(size * 0.52));

  return (
    <span
      aria-hidden="true"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-input font-mono text-[11px] uppercase leading-none text-text-2"
      style={{ height: size, width: size, fontSize }}
    >
      {member.profileImageUrl ? (
        <Image
          src={member.profileImageUrl}
          alt=""
          width={size}
          height={size}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}

export function CellTeam({
  row,
  avatarSize = 20,
}: {
  row: ProjectTableRow;
  avatarSize?: number;
}) {
  const { t } = useDictionary("projects");
  const [open, setOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<ProjectTableTeamMember | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const {
    teamMembersQuery,
    tasksQuery,
    assignedMembers,
    availableMembers,
    assignTeamMember,
    removeTeamMember,
    createFirstTask,
  } = useProjectTableTeam({ row });

  const readOnlyMessage = t("table.cell.team.readOnly");
  const errorMessage = t("table.cell.team.error");
  const untitledTaskLabel = t("table.cell.team.untitledTask");
  const assignableTasks = useMemo(
    () => (tasksQuery.data ?? []).filter(isAssignableTask),
    [tasksQuery.data],
  );
  const normalizedMemberSearch = memberSearch.trim().toLowerCase();
  const normalizedTaskSearch = taskSearch.trim().toLowerCase();
  const filteredAssignedMembers = useMemo(
    () => assignedMembers.filter((member) => matchesSearch(member, normalizedMemberSearch)),
    [assignedMembers, normalizedMemberSearch],
  );
  const filteredAvailableMembers = useMemo(
    () => availableMembers.filter((member) => matchesSearch(member, normalizedMemberSearch)),
    [availableMembers, normalizedMemberSearch],
  );
  const visibleTasks = useMemo(
    () =>
      assignableTasks.filter((task) =>
        matchesTaskSearch(task, normalizedTaskSearch, untitledTaskLabel),
      ),
    [assignableTasks, normalizedTaskSearch, untitledTaskLabel],
  );
  const selectedMemberId = selectedMember?.id ?? null;
  const assignedCount = row.teamMemberIds.length;
  const triggerLabel = formatText(t("table.cell.team.triggerLabel"), {
    project: row.title,
    count: assignedCount,
  });
  const title = formatText(t("table.cell.team.title"), { project: row.title });
  const loading = teamMembersQuery.isLoading || tasksQuery.isLoading;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSelectedMember(null);
      setSelectedTaskIds([]);
      setTaskSearch("");
      setNewTaskTitle("");
      setFeedback(null);
    }
  }

  function toggleTask(taskId: string) {
    setFeedback(null);
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId],
    );
  }

  async function handleAssign() {
    if (!selectedMember) return;
    if (selectedTaskIds.length === 0) {
      setFeedback(t("table.cell.team.selectTask"));
      return;
    }

    try {
      await assignTeamMember.mutateAsync({
        userId: selectedMember.id,
        taskIds: selectedTaskIds,
      });
      setSelectedMember(null);
      setSelectedTaskIds([]);
      setTaskSearch("");
      setFeedback(null);
    } catch (error) {
      setFeedback(mutationMessage(error, readOnlyMessage, errorMessage));
    }
  }

  async function handleCreateFirstTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMember) return;

    const titleValue = newTaskTitle.trim();
    if (!titleValue) {
      setFeedback(t("table.cell.team.createTaskRequired"));
      return;
    }

    try {
      const created = await createFirstTask.mutateAsync({ title: titleValue });
      await assignTeamMember.mutateAsync({
        userId: selectedMember.id,
        taskIds: [created.taskId],
      });
      setSelectedMember(null);
      setSelectedTaskIds([]);
      setNewTaskTitle("");
      setFeedback(null);
    } catch (error) {
      setFeedback(mutationMessage(error, readOnlyMessage, errorMessage));
    }
  }

  async function handleRemoveFromAll(member: ProjectTableTeamMember) {
    try {
      await removeTeamMember.mutateAsync({
        userId: member.id,
        taskIds: null,
      });
      setFeedback(null);
    } catch (error) {
      setFeedback(mutationMessage(error, readOnlyMessage, errorMessage));
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          onClick={stopPointer}
          onKeyDown={(event) => stopTableKeys(event)}
          className="flex h-full w-full min-w-0 items-center gap-1 rounded-[5px] px-1 text-left outline-none transition-colors hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ops-accent"
        >
          {assignedMembers.length > 0 ? (
            <span className="flex min-w-0 items-center">
              {assignedMembers.slice(0, 3).map((member, index) => (
                <span key={member.id} className={cn(index > 0 && "-ml-1")}>
                  <MemberAvatar member={member} size={avatarSize} />
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
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        role="dialog"
        aria-label={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchInputRef.current?.focus();
        }}
        onKeyDown={(event) => stopTableKeys(event, () => handleOpenChange(false))}
        className="z-[1000] w-[min(720px,calc(100vw-32px))] rounded-modal border border-border p-0"
      >
        <div className="grid max-h-[min(620px,calc(100vh-96px))] min-h-[320px] grid-cols-1 overflow-hidden md:grid-cols-[268px_minmax(280px,1fr)]">
          <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
            <div className="border-b border-border px-3 py-3">
              <p className="font-mono text-micro uppercase tracking-wider text-text">
                {title}
              </p>
              <label className="mt-3 flex items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 focus-within:ring-1 focus-within:ring-ops-accent">
                <Search className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  placeholder={t("table.cell.team.search")}
                  className="min-w-0 flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-3"
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <section>
                <h3 className="px-1 font-mono text-micro uppercase tracking-wider text-text-3">
                  {t("table.cell.team.assigned")}
                </h3>
                <div className="mt-1 space-y-1">
                  {filteredAssignedMembers.map((member) => (
                    <div
                      key={member.id}
                      className="flex min-w-0 items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 py-1.5"
                    >
                      <MemberAvatar member={member} size={avatarSize} />
                      <span className="min-w-0 flex-1 truncate font-mohave text-body-sm text-text">
                        {member.name}
                      </span>
                      <button
                        type="button"
                        aria-label={formatText(t("table.cell.team.removeFromAllMember"), {
                          member: member.name,
                        })}
                        onClick={() => {
                          void handleRemoveFromAll(member);
                        }}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-border px-1.5 py-1 font-mono text-micro uppercase tracking-wider text-text-3 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                      >
                        <X className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
                        <span className="hidden sm:inline">{t("table.cell.team.removeFromAll")}</span>
                      </button>
                    </div>
                  ))}
                  {filteredAssignedMembers.length === 0 ? (
                    <p className="px-1 py-2 font-mono text-micro uppercase tracking-wider text-text-3">
                      —
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="mt-4">
                <h3 className="px-1 font-mono text-micro uppercase tracking-wider text-text-3">
                  {t("table.cell.team.available")}
                </h3>
                <div className="mt-1 space-y-1">
                  {filteredAvailableMembers.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setSelectedMember(member);
                        setSelectedTaskIds([]);
                        setTaskSearch("");
                        setFeedback(null);
                      }}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-2 rounded-[5px] border px-2 py-1.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                        selectedMemberId === member.id
                          ? "border-border-strong bg-surface-active text-text"
                          : "border-transparent text-text-2",
                      )}
                    >
                      <MemberAvatar member={member} size={avatarSize} />
                      <span className="min-w-0 flex-1 truncate font-mohave text-body-sm">
                        {member.name}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  ))}
                  {filteredAvailableMembers.length === 0 ? (
                    <p className="px-1 py-2 font-mono text-micro uppercase tracking-wider text-text-3">
                      {t("table.cell.team.emptyAvailable")}
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-border px-3 py-3">
              <p className="font-mono text-micro uppercase tracking-wider text-text">
                {selectedMember ? t("table.cell.team.assignToTasks") : t("table.cell.team.available")}
              </p>
              {selectedMember ? (
                <p className="mt-1 truncate font-mohave text-body-sm text-text-2">
                  {selectedMember.name}
                </p>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {feedback ? (
                <p className="mb-3 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 font-mono text-micro uppercase tracking-wider text-text-2">
                  {feedback}
                </p>
              ) : null}

              {!selectedMember ? (
                <div className="flex h-full min-h-[180px] items-center justify-center rounded-[5px] border border-border bg-surface-input px-4 text-center">
                  <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                    {t("table.cell.team.available")}
                  </p>
                </div>
              ) : assignableTasks.length === 0 ? (
                <form onSubmit={handleCreateFirstTask} className="space-y-3">
                  <p className="font-mono text-micro uppercase tracking-wider text-text-3">
                    {t("table.cell.team.noTasks")}
                  </p>
                  <input
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                    placeholder={t("table.cell.team.createTaskPlaceholder")}
                    className="h-9 w-full rounded-[5px] border border-border bg-surface-input px-2 font-mohave text-body-sm text-text outline-none placeholder:text-text-3 focus-visible:ring-1 focus-visible:ring-ops-accent"
                  />
                  <button
                    type="submit"
                    disabled={createFirstTask.isPending || assignTeamMember.isPending}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-[5px] border border-border px-3 font-mohave text-button uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40"
                  >
                    <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {t("table.cell.team.createFirstTask")}
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 rounded-[5px] border border-border bg-surface-input px-2 py-1.5 focus-within:ring-1 focus-within:ring-ops-accent">
                    <Search className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.5} aria-hidden="true" />
                    <input
                      value={taskSearch}
                      onChange={(event) => setTaskSearch(event.target.value)}
                      placeholder={t("table.cell.team.taskSearch")}
                      className="min-w-0 flex-1 bg-transparent font-mohave text-body-sm text-text outline-none placeholder:text-text-3"
                    />
                  </label>

                  <div className="space-y-1">
                    {visibleTasks.map((task) => {
                      const checked = selectedTaskIds.includes(task.id);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => toggleTask(task.id)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2 rounded-[5px] border px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                            checked
                              ? "border-border-strong bg-surface-active text-text"
                              : "border-border bg-surface-input text-text-2",
                          )}
                        >
                          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border border-border bg-background">
                            {checked ? (
                              <Check className="h-3 w-3 text-text" strokeWidth={1.5} aria-hidden="true" />
                            ) : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mohave text-body-sm">
                            {taskTitle(task, untitledTaskLabel)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={assignTeamMember.isPending || selectedTaskIds.length === 0}
                    onClick={() => {
                      void handleAssign();
                    }}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-[5px] border border-border px-3 font-mohave text-button uppercase text-text-2 transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {t("table.cell.team.assign")}
                  </button>
                </div>
              )}

              {loading ? (
                <p className="mt-3 font-mono text-micro uppercase tracking-wider text-text-3">
                  {t("table.loading.refetching")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
