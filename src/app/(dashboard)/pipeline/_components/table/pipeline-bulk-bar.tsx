"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Archive, CalendarDays, Check, Flag, Users, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  bulkResultToast,
  usePipelineBulkActions,
} from "@/lib/hooks/pipeline-table/use-pipeline-bulk-actions";
import { useLeadAssignmentCandidates } from "@/lib/hooks/use-lead-assignment";
import { OpportunityPriority } from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";
import type { LeadAccess } from "@/lib/permissions/lead-access-policy";
import { cn } from "@/lib/utils/cn";

/**
 * Bulk-actions bar for the pipeline table. Appears only when at least one row
 * is selected; mirrors the projects table-v2 bar (floating glass-dense rail,
 * mono `// N selected` count, action controls, a "select all N" affordance, and
 * a clear-selection control), but offers PIPELINE-appropriate, side-effect-free
 * batch operations:
 *
 *   - Reassign assignee → guarded bulk assignment
 *   - Set follow-up    → bulk `nextFollowUpAt`
 *   - Change priority  → bulk `priority`
 *   - Archive          → bulk archive
 *
 * Field/archive actions are optimistic and undoable. Reassignment is the
 * deliberate exception: every row uses an exact guarded snapshot, reconciles
 * the server result, and has no unsafe inverse write.
 *
 * STAGE CHANGES ARE DELIBERATELY ABSENT.
 * Marking deals Won/Lost is terminal and must capture per-deal details
 * (actualValue for Won, lostReason/lostNotes for Lost) through the
 * `StageTransitionDialog`, which is single-opportunity by design. A bulk Won/
 * Lost would either be a silent write (forbidden — a stage change always
 * carries side effects) or force one reason onto every deal (incorrect). So
 * bulk Won/Lost is omitted from v1: the single-row stage cell already routes
 * each deal through the dialog correctly. Bulk move to an active stage is also
 * omitted — `requestStageChange` is single-row and an active-stage batch would
 * spawn N separate toasts + N undo entries, which is noisier than the value it
 * adds. Both are intentional, documented scope decisions, not stubs.
 */

function formatText(
  template: string,
  replacements: Record<string, string | number>
) {
  return Object.entries(replacements).reduce(
    (value, [key, replacement]) =>
      value.replaceAll(`{${key}}`, String(replacement)),
    template
  );
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
        "inline-flex h-[32px] shrink-0 items-center gap-1 rounded border border-border px-2",
        "font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors",
        "hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        "disabled:pointer-events-none disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

const PRIORITY_OPTIONS = [
  { value: OpportunityPriority.Low, labelKey: "table.bulk.priorityLow" },
  { value: OpportunityPriority.Medium, labelKey: "table.bulk.priorityMedium" },
  { value: OpportunityPriority.High, labelKey: "table.bulk.priorityHigh" },
] as const;

const UNASSIGN_VALUE = "__unassigned__";

export function PipelineBulkBar({
  selectedRows,
  selectedIds,
  leadAccessById,
  renderedRowCount,
  allRenderedSelected,
  onClearSelection,
  onSelectAllRendered,
}: {
  /** The post-search rows the table holds (the bulk targets are these ∩ selectedIds). */
  selectedRows: PipelineTableRow[];
  /** The live selection set (owned by the shell's `useTableSelection`). */
  selectedIds: Set<string>;
  /** Row-specific access; assignment is shown only when every target allows it. */
  leadAccessById: ReadonlyMap<string, LeadAccess>;
  /** How many data rows are currently rendered (collapse-aware) — the "select all N" count. */
  renderedRowCount: number;
  /** True when every rendered data row is already selected (hides the select-all affordance). */
  allRenderedSelected: boolean;
  /** Clear the entire selection. */
  onClearSelection: () => void;
  /** Select every rendered data row (the shell's collapse-safe select-all). */
  onSelectAllRendered: () => void;
}) {
  const { t } = useDictionary("pipeline");

  const [priority, setPriority] = useState<OpportunityPriority>(
    OpportunityPriority.High
  );
  const [followUpDate, setFollowUpDate] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");

  const undoLabels = useMemo(
    () => ({
      reassign: (count: number) =>
        formatText(t("table.bulk.undoReassign"), { count }),
      followUp: (count: number) =>
        formatText(t("table.bulk.undoFollowUp"), { count }),
      priority: (count: number) =>
        formatText(t("table.bulk.undoPriority"), { count }),
      archive: (count: number) =>
        formatText(t("table.bulk.undoArchive"), { count }),
    }),
    [t]
  );

  const bulkActions = usePipelineBulkActions({
    selectedRows,
    selectedIds,
    onClearSelection,
    undoLabels,
  });

  const targetRows = bulkActions.targetRows;
  const selectedCount = targetRows.length;
  const disabled = bulkActions.isRunning || selectedCount === 0;
  const canBulkAssign =
    selectedCount > 0 &&
    targetRows.every((row) => leadAccessById.get(row.id)?.canAssign === true);
  const canBulkUnassign =
    canBulkAssign &&
    targetRows.every((row) => leadAccessById.get(row.id)?.canUnassign === true);

  const selectedCountLabel = useMemo(
    () => formatText(t("table.bulk.selectedCount"), { count: selectedCount }),
    [selectedCount, t]
  );

  const selectAllLabel = useMemo(
    () => formatText(t("table.bulk.selectAll"), { count: renderedRowCount }),
    [renderedRowCount, t]
  );

  // Candidate eligibility comes from the guarded server contract. All selected
  // rows belong to the same company, so the eligible-user set is identical;
  // every row is still independently authorized by the assignment mutation.
  const candidatesQuery = useLeadAssignmentCandidates(
    targetRows[0]?.id ?? "",
    assignOpen && canBulkAssign
  );
  const assignmentCandidates = candidatesQuery.data?.candidates ?? [];
  const canOfferUnassign =
    canBulkUnassign && candidatesQuery.data?.canUnassign === true;
  const canApplyAssignment =
    !bulkActions.isRunning &&
    assignUserId !== "" &&
    (assignUserId !== UNASSIGN_VALUE || canOfferUnassign);

  const handleReassign = useCallback(() => {
    if (!canApplyAssignment) return;
    const nextAssignee = assignUserId === UNASSIGN_VALUE ? "" : assignUserId;
    void bulkActions.reassignAssignee(nextAssignee).then((result) => {
      bulkResultToast({
        result,
        successMessage: (count) =>
          formatText(t("table.bulk.reassignDone"), { count }),
        partialMessage: (success, total) =>
          formatText(t("table.bulk.partialFailure"), {
            success,
            total,
            failed: total - success,
          }),
        failureMessage: t("table.bulk.failure"),
      });
    });
    setAssignOpen(false);
    setAssignUserId("");
  }, [assignUserId, bulkActions, canApplyAssignment, t]);

  const handleSetFollowUp = useCallback(() => {
    void bulkActions.setFollowUpDate(followUpDate).then((result) => {
      bulkResultToast({
        result,
        successMessage: (count) =>
          formatText(t("table.bulk.setFollowUpDone"), { count }),
        partialMessage: (success, total) =>
          formatText(t("table.bulk.partialFailure"), {
            success,
            total,
            failed: total - success,
          }),
        failureMessage: t("table.bulk.failure"),
      });
    });
    setFollowUpDate("");
  }, [bulkActions, followUpDate, t]);

  const handleChangePriority = useCallback(() => {
    void bulkActions.changePriority(priority).then((result) => {
      bulkResultToast({
        result,
        successMessage: (count) =>
          formatText(t("table.bulk.priorityDone"), { count }),
        partialMessage: (success, total) =>
          formatText(t("table.bulk.partialFailure"), {
            success,
            total,
            failed: total - success,
          }),
        failureMessage: t("table.bulk.failure"),
      });
    });
  }, [bulkActions, priority, t]);

  const handleArchive = useCallback(() => {
    void bulkActions.archive().then((result) => {
      bulkResultToast({
        result,
        successMessage: (count) =>
          formatText(t("table.bulk.archiveDone"), { count }),
        partialMessage: (success, total) =>
          formatText(t("table.bulk.partialFailure"), {
            success,
            total,
            failed: total - success,
          }),
        failureMessage: t("table.bulk.failure"),
      });
    });
  }, [bulkActions, t]);

  if (selectedCount === 0) return null;

  return (
    <div className="glass-dense absolute bottom-3 left-1/2 z-[1500] flex h-[48px] max-w-[calc(100%-24px)] -translate-x-1/2 items-center overflow-visible rounded-modal border border-border px-3 py-2">
      <div className="flex h-[32px] min-w-0 items-center gap-2">
        <div className="mr-1 flex shrink-0 items-center gap-2 font-mono text-micro uppercase tracking-[0.16em] text-text">
          <Check className="h-[14px] w-[14px] text-text-3" strokeWidth={1.5} />
          <span>{selectedCountLabel}</span>
        </div>

        {/* Select-all-N affordance — only when more rendered rows remain
            unselected. States the EXACT rendered count, never an ambiguous
            "select all". */}
        {!allRenderedSelected && renderedRowCount > selectedCount ? (
          <BulkButton
            className="border-transparent text-text-3"
            disabled={bulkActions.isRunning}
            onClick={onSelectAllRendered}
          >
            {selectAllLabel}
          </BulkButton>
        ) : null}

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {canBulkAssign ? (
            <>
              <BulkButton
                disabled={disabled}
                onClick={() => setAssignOpen((open) => !open)}
              >
                <Users className="h-[14px] w-[14px]" strokeWidth={1.5} />
                {t("table.bulk.reassign")}
              </BulkButton>

              <div className="h-6 w-px shrink-0 bg-border" />
            </>
          ) : null}

          <input
            type="date"
            aria-label={t("table.bulk.setFollowUp")}
            value={followUpDate}
            disabled={disabled}
            onChange={(event) => setFollowUpDate(event.target.value)}
            className="h-[32px] w-[132px] shrink-0 rounded border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          />
          <BulkButton disabled={disabled} onClick={handleSetFollowUp}>
            <CalendarDays className="h-[14px] w-[14px]" strokeWidth={1.5} />
            {t("table.bulk.setFollowUp")}
          </BulkButton>

          <div className="h-6 w-px shrink-0 bg-border" />

          <select
            aria-label={t("table.bulk.changePriority")}
            value={priority}
            disabled={disabled}
            onChange={(event) =>
              setPriority(event.target.value as OpportunityPriority)
            }
            className="h-[32px] shrink-0 rounded border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <BulkButton disabled={disabled} onClick={handleChangePriority}>
            <Flag className="h-[14px] w-[14px]" strokeWidth={1.5} />
            {t("table.bulk.changePriority")}
          </BulkButton>

          <div className="h-6 w-px shrink-0 bg-border" />

          <BulkButton disabled={disabled} onClick={handleArchive}>
            <Archive className="h-[14px] w-[14px]" strokeWidth={1.5} />
            {t("table.bulk.archive")}
          </BulkButton>
        </div>

        <BulkButton
          className="border-transparent text-text-mute"
          disabled={bulkActions.isRunning}
          onClick={onClearSelection}
        >
          <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
          {t("table.bulk.clear")}
        </BulkButton>
      </div>

      {assignOpen && canBulkAssign ? (
        <div className="glass-dense absolute bottom-[calc(100%+8px)] left-3 z-[1500] flex min-w-[320px] max-w-[calc(100%-24px)] items-center gap-2 rounded-modal p-2">
          <select
            aria-label={t("table.bulk.reassign")}
            value={assignUserId}
            disabled={candidatesQuery.isLoading || bulkActions.isRunning}
            onChange={(event) => setAssignUserId(event.target.value)}
            className="h-[32px] min-w-[200px] flex-1 rounded border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
          >
            <option value="" disabled>
              {t("table.bulk.selectAssignee")}
            </option>
            {canOfferUnassign ? (
              <option value={UNASSIGN_VALUE}>{t("table.bulk.unassign")}</option>
            ) : null}
            {assignmentCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {[candidate.firstName, candidate.lastName]
                  .filter(Boolean)
                  .join(" ") || t("band.unknownAssignee")}
              </option>
            ))}
          </select>

          <BulkButton disabled={!canApplyAssignment} onClick={handleReassign}>
            <Users className="h-[14px] w-[14px]" strokeWidth={1.5} />
            {t("table.bulk.reassign")}
          </BulkButton>
        </div>
      ) : null}
    </div>
  );
}
