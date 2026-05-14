"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Archive, CalendarDays, Check, RotateCw, Users, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useDictionary } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import {
  ProjectTableTeamService,
  type ProjectTableTaskOption,
} from "@/lib/api/services/project-table-team-service";
import type { ProjectTableBulkUndoEntry } from "@/lib/hooks/projects-table/use-cell-edit";
import { useProjectsBulkActions } from "@/lib/hooks/projects-table/use-projects-bulk-actions";
import { ProjectStatus } from "@/lib/types/models";
import type { ProjectTableRow } from "@/lib/types/project-table";
import { cn } from "@/lib/utils/cn";

type PendingBulkAction = {
  label: string;
  run: () => Promise<void>;
};

const STATUS_OPTIONS = [
  { value: ProjectStatus.RFQ, labelKey: "status.rfq" },
  { value: ProjectStatus.Estimated, labelKey: "status.estimated" },
  { value: ProjectStatus.Accepted, labelKey: "status.accepted" },
  { value: ProjectStatus.InProgress, labelKey: "status.inProgress" },
  { value: ProjectStatus.Completed, labelKey: "status.completed" },
  { value: ProjectStatus.Closed, labelKey: "status.closed" },
] as const;

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

function BulkButton({
  children,
  className,
  disabled,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-[5px] border border-border px-2",
        "font-cakemono text-[12px] font-light uppercase text-text-2 transition-colors",
        "hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ProjectsBulkBar({
  visibleRows,
  selectedIds,
  onClearSelection,
  recordBulkUndo,
}: {
  visibleRows: ProjectTableRow[];
  selectedIds: Set<string>;
  onClearSelection: () => void;
  recordBulkUndo: (entry: ProjectTableBulkUndoEntry) => void;
}) {
  const { t } = useDictionary("projects");
  const [status, setStatus] = useState<ProjectStatus>(ProjectStatus.Completed);
  const [dueDate, setDueDate] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignAllActiveTasks, setAssignAllActiveTasks] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingBulkAction | null>(null);

  const bulkActions = useProjectsBulkActions({
    visibleRows,
    selectedIds,
    onClearSelection,
    recordBulkUndo,
  });

  const targetRows = bulkActions.targetRows;
  const selectedCount = targetRows.length;
  const companyId = targetRows[0]?.companyId ?? null;
  const disabled = bulkActions.isRunning || selectedCount === 0;

  const teamMembersQuery = useQuery({
    queryKey: queryKeys.projects.tableTeamMembers(companyId ?? "__none__"),
    queryFn: () => ProjectTableTeamService.fetchCompanyTeamMembers(companyId ?? ""),
    enabled: assignOpen && Boolean(companyId),
    staleTime: 60_000,
  });

  const selectedCountLabel = useMemo(
    () => formatText(t("table.bulk.selectedCount"), { count: selectedCount }),
    [selectedCount, t],
  );

  const partialFailureLabel = useMemo(() => {
    const failure = bulkActions.partialFailure;
    if (!failure) return null;
    return formatText(t("table.bulk.partialFailure"), {
      success: failure.successCount,
      failed: failure.failedCount,
      total: failure.successCount + failure.failedCount,
    });
  }, [bulkActions.partialFailure, t]);

  const runAction = useCallback(
    (label: string, action: () => Promise<unknown>) => {
      const run = async () => {
        setAssignFeedback(null);
        await action();
      };

      if (selectedCount > 25) {
        setPendingAction({ label, run });
        return;
      }

      void run();
    },
    [selectedCount],
  );

  const buildAllActiveTaskMap = useCallback(async () => {
    const entries = await Promise.all(
      targetRows.map(async (row) => {
        const tasks = await ProjectTableTeamService.fetchProjectTasks(row.id);
        return [row.id, tasks.filter(isAssignableTask).map((task) => task.id)] as const;
      }),
    );

    if (entries.some(([, taskIds]) => taskIds.length === 0)) {
      throw new Error(t("table.bulk.assignTaskRequired"));
    }

    return new Map(entries);
  }, [targetRows, t]);

  const handleAssign = useCallback(() => {
    if (!assignUserId || !assignAllActiveTasks) {
      setAssignFeedback(t("table.bulk.assignTaskRequired"));
      return;
    }

    runAction(t("table.bulk.assignTo"), async () => {
      try {
        const taskIdsByProjectId = await buildAllActiveTaskMap();
        await bulkActions.assignTeamMember({ userId: assignUserId, taskIdsByProjectId });
        setAssignOpen(false);
        setAssignFeedback(null);
      } catch (error) {
        setAssignFeedback(error instanceof Error ? error.message : t("table.bulk.assignTaskRequired"));
      }
    });
  }, [
    assignAllActiveTasks,
    assignUserId,
    buildAllActiveTaskMap,
    bulkActions,
    runAction,
    t,
  ]);

  if (selectedCount === 0) return null;

  return (
    <div className="glass-dense sticky bottom-0 z-[1500] flex h-12 w-full items-center overflow-visible !rounded-none border-x-0 border-b-0 px-3 py-2 [&::before]:!rounded-none">
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2">
        <div className="mr-1 flex min-w-[112px] shrink-0 items-center gap-2 font-mono text-micro uppercase tracking-wider text-text">
          <Check className="h-3.5 w-3.5 text-text-3" strokeWidth={1.5} />
          <span>{selectedCountLabel}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <select
            aria-label={t("table.bulk.changeStatus")}
            value={status}
            disabled={disabled}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            className="h-8 shrink-0 rounded-[5px] border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <BulkButton
            disabled={disabled}
            onClick={() => runAction(t("table.bulk.changeStatus"), () => bulkActions.updateStatus(status))}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.changeStatus")}
          </BulkButton>

          <div className="h-6 w-px shrink-0 bg-border-subtle" />

          <input
            type="date"
            aria-label={t("table.bulk.setDueDate")}
            value={dueDate}
            disabled={disabled}
            onChange={(event) => setDueDate(event.target.value)}
            className="h-8 w-[132px] shrink-0 rounded-[5px] border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          />
          <BulkButton
            disabled={disabled}
            onClick={() =>
              runAction(t("table.bulk.setDueDate"), () =>
                bulkActions.updateDate("end_date", dueDate.trim() || null),
              )
            }
          >
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.setDueDate")}
          </BulkButton>

          <BulkButton disabled={disabled} onClick={() => setAssignOpen((open) => !open)}>
            <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.assignTo")}
          </BulkButton>

          <BulkButton
            disabled={disabled}
            onClick={() =>
              runAction(t("table.bulk.archive"), () => bulkActions.updateStatus(ProjectStatus.Archived))
            }
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.archive")}
          </BulkButton>
        </div>

        <BulkButton className="border-transparent text-text-mute" disabled={bulkActions.isRunning} onClick={onClearSelection}>
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("table.bulk.clear")}
        </BulkButton>
      </div>

      {assignOpen ? (
        <div className="glass-dense absolute bottom-[calc(100%+8px)] left-3 z-[1500] flex min-w-[520px] max-w-[calc(100%-24px)] items-center gap-2 rounded-modal p-2">
          <select
            aria-label={t("table.bulk.assignTo")}
            value={assignUserId}
            disabled={teamMembersQuery.isLoading || bulkActions.isRunning}
            onChange={(event) => {
              setAssignUserId(event.target.value);
              setAssignFeedback(null);
            }}
            className="h-8 min-w-[180px] rounded-[5px] border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          >
            <option value="">—</option>
            {(teamMembersQuery.data ?? []).map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <label className="inline-flex h-8 shrink-0 items-center gap-2 rounded-[5px] border border-border px-2 font-mono text-micro uppercase text-text-2">
            <input
              type="checkbox"
              checked={assignAllActiveTasks}
              disabled={bulkActions.isRunning}
              onChange={(event) => {
                setAssignAllActiveTasks(event.target.checked);
                setAssignFeedback(null);
              }}
              className="h-3.5 w-3.5 rounded-[3px] border border-border bg-surface-input accent-ops-accent"
            />
            {t("table.bulk.assignAllActiveTasks")}
          </label>

          <BulkButton disabled={bulkActions.isRunning} onClick={handleAssign}>
            <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.assignTo")}
          </BulkButton>

          {assignFeedback ? (
            <p className="min-w-0 truncate font-mono text-micro uppercase tracking-wider text-status-warning">
              {assignFeedback}
            </p>
          ) : null}
        </div>
      ) : null}

      {partialFailureLabel ? (
        <div
          role="status"
          aria-live="polite"
          className="glass-dense absolute bottom-[calc(100%+8px)] right-3 z-[1500] flex w-[360px] max-w-[calc(100%-24px)] items-center gap-2 rounded-modal p-2"
        >
          <p className="min-w-0 flex-1 font-mono text-micro uppercase tracking-wider text-text-2">
            {partialFailureLabel}
          </p>
          <BulkButton
            disabled={bulkActions.isRunning}
            onClick={() => {
              void bulkActions.partialFailure?.retry();
            }}
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.retry")}
          </BulkButton>
          <BulkButton disabled={bulkActions.isRunning} onClick={() => bulkActions.partialFailure?.discard()}>
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            {t("table.bulk.discard")}
          </BulkButton>
        </div>
      ) : null}

      {pendingAction ? (
        <div role="dialog" aria-modal="false" className="glass-dense absolute bottom-[calc(100%+8px)] right-3 z-[1500] w-[300px] rounded-modal border border-border p-3">
          <p className="font-mono text-micro uppercase tracking-wider text-text">
            {formatText(t("table.bulk.confirmLarge"), { count: selectedCount })}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <BulkButton
              disabled={bulkActions.isRunning}
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                void action.run();
              }}
            >
              {pendingAction.label}
            </BulkButton>
            <BulkButton className="border-transparent text-text-mute" onClick={() => setPendingAction(null)}>
              {t("cancel")}
            </BulkButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
