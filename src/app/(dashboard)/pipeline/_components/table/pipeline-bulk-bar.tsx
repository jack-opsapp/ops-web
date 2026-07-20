"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Archive, CalendarDays, Check, Flag, Users, X } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  bulkResultToast,
  usePipelineBulkActions,
} from "@/lib/hooks/pipeline-table/use-pipeline-bulk-actions";
import { useLeadAssignmentCandidates } from "@/lib/hooks/use-lead-assignment";
import { EntityPicker } from "@/components/ui/entity-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { OpportunityPriority } from "@/lib/types/pipeline";
import type { PipelineTableRow } from "@/lib/types/pipeline-table";
import {
  actorLosesAccessOnAssign,
  type LeadAccess,
} from "@/lib/permissions/lead-access-policy";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
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

// Shared rail-control chrome — reused by BulkButton and the assignee picker's
// trigger (a raw button, so PickerTrigger's asChild can compose onto it).
const BULK_CONTROL_CLASS = cn(
  "inline-flex h-[32px] shrink-0 items-center gap-1 rounded border border-border px-2",
  "font-cakemono text-cake-button font-light uppercase text-text-2 transition-colors",
  "hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
  "disabled:pointer-events-none disabled:opacity-40"
);

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
      className={cn(BULK_CONTROL_CLASS, className)}
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

// The picker has no "current" assignee in a bulk context; this non-null,
// non-matching sentinel keeps every candidate row (and the Unassign row)
// un-checked, so the panel reads as "pick a target", not "here's the current".
const NO_BULK_SELECTION = "__bulk_no_selection__";

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
  const [pendingHandOff, setPendingHandOff] = useState<{
    assigneeId: string | null;
    name: string;
  } | null>(null);
  const actorUserId = useAuthStore((state) => state.currentUser?.id ?? null);
  const permissionState = usePermissionStore();

  // Sentence-case name for a candidate, mirroring the single-lead AssigneeField
  // (never uppercased — names are content, not authority).
  const candidateName = useCallback(
    (candidate: { firstName: string | null; lastName: string | null }) =>
      [candidate.firstName, candidate.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || t("band.unknownAssignee", "Unknown"),
    [t]
  );

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
  const hasFollowUpDate = followUpDate.trim().length > 0;
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
  const assignmentCandidates = useMemo(
    () => candidatesQuery.data?.candidates ?? [],
    [candidatesQuery.data?.candidates]
  );
  const canOfferUnassign =
    canBulkUnassign && candidatesQuery.data?.canUnassign === true;

  // Immediate-apply on pick — the canonical single-select picker commits and
  // closes (no separate Apply). `null` is the Unassign row; the guarded bulk
  // action treats "" as clearing the assignee across every selected row.
  const commitReassign = useCallback(
    (assigneeId: string | null) => {
      if (bulkActions.isRunning) return;
      if (assigneeId === null && !canOfferUnassign) return;
      const nextAssignee = assigneeId ?? "";
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
    },
    [bulkActions, canOfferUnassign, t]
  );

  const requestReassign = useCallback(
    (assigneeId: string | null) => {
      if (bulkActions.isRunning) return;
      if (assigneeId === null && !canOfferUnassign) return;

      const removesActorAccess = targetRows.some((row) =>
        actorLosesAccessOnAssign(
          permissionState,
          actorUserId,
          { assignedTo: row.assignedTo },
          assigneeId
        )
      );
      if (!removesActorAccess) {
        commitReassign(assigneeId);
        return;
      }

      const candidate = assignmentCandidates.find(
        ({ id }) => id === assigneeId
      );
      setPendingHandOff({
        assigneeId,
        name: candidate
          ? candidateName(candidate)
          : t("band.unassigned", "Unassigned"),
      });
      setAssignOpen(false);
    },
    [
      actorUserId,
      assignmentCandidates,
      bulkActions.isRunning,
      canOfferUnassign,
      candidateName,
      commitReassign,
      permissionState,
      t,
      targetRows,
    ]
  );

  const handleSetFollowUp = useCallback(() => {
    const nextFollowUpDate = followUpDate.trim();
    if (disabled || nextFollowUpDate.length === 0) return;

    void bulkActions.setFollowUpDate(nextFollowUpDate).then((result) => {
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
  }, [bulkActions, disabled, followUpDate, t]);

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
    <>
      <div className="glass-dense absolute bottom-3 left-1/2 z-[1500] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center overflow-visible rounded-modal border border-border px-3 py-2">
        {/* Wraps to a second row within the rail when the controls exceed the
          available width (1280/1440) instead of clipping under overflow. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
          <div className="mr-1 flex shrink-0 items-center gap-2 font-mono text-micro uppercase tracking-[0.16em] text-text">
            <Check
              className="h-[14px] w-[14px] text-text-3"
              strokeWidth={1.5}
            />
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

          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
            {canBulkAssign ? (
              <>
                <EntityPicker
                  trigger={
                    <button
                      type="button"
                      disabled={disabled}
                      className={BULK_CONTROL_CLASS}
                    >
                      <Users className="h-[14px] w-[14px]" strokeWidth={1.5} />
                      {t("table.bulk.reassign")}
                    </button>
                  }
                  items={assignmentCandidates}
                  getId={(candidate) => candidate.id}
                  getLabel={candidateName}
                  getAvatar={(candidate) => ({
                    name: candidateName(candidate),
                    imageUrl: candidate.profileImageUrl,
                  })}
                  label={t("table.bulk.reassign")}
                  value={NO_BULK_SELECTION}
                  onChange={requestReassign}
                  noneOption={canOfferUnassign}
                  noneLabel={t("table.bulk.unassign")}
                  searchPlaceholder={t("band.assigneeSearch", "Search team")}
                  emptyLabel={
                    candidatesQuery.isLoading
                      ? t("band.loadingAssignees", "Loading team…")
                      : t(
                          "band.noEligibleAssignees",
                          "No eligible team members"
                        )
                  }
                  error={
                    candidatesQuery.isError
                      ? t("band.assigneeLoadFailed", "Team unavailable")
                      : undefined
                  }
                  open={assignOpen}
                  onOpenChange={setAssignOpen}
                  align="start"
                  size="md"
                  contentClassName="border border-border"
                />

                <div className="h-6 w-px shrink-0 bg-border" />
              </>
            ) : null}

            <input
              type="date"
              aria-label={t("table.bulk.setFollowUp")}
              value={followUpDate}
              disabled={disabled}
              onChange={(event) => setFollowUpDate(event.target.value)}
              className="h-[32px] w-[132px] shrink-0 rounded border border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2 outline-none transition-colors [color-scheme:dark] focus-visible:ring-1 focus-visible:ring-ops-accent disabled:opacity-40"
            />
            <BulkButton
              disabled={disabled || !hasFollowUpDate}
              onClick={handleSetFollowUp}
            >
              <CalendarDays className="h-[14px] w-[14px]" strokeWidth={1.5} />
              {t("table.bulk.setFollowUp")}
            </BulkButton>

            <div className="h-6 w-px shrink-0 bg-border" />

            <Select
              value={priority}
              disabled={disabled}
              onValueChange={(value) =>
                setPriority(value as OpportunityPriority)
              }
            >
              <SelectTrigger
                aria-label={t("table.bulk.changePriority")}
                className="h-[32px] w-auto min-w-[72px] shrink-0 border-border bg-surface-input px-2 font-mono text-micro uppercase text-text-2"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-dropdown border border-border">
                {PRIORITY_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    className="font-mono text-micro uppercase"
                  >
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            className="border-transparent text-text-3"
            disabled={bulkActions.isRunning}
            onClick={onClearSelection}
          >
            <X className="h-[14px] w-[14px]" strokeWidth={1.5} />
            {t("table.bulk.clear")}
          </BulkButton>
        </div>
      </div>

      <AlertDialog
        open={pendingHandOff !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHandOff(null);
        }}
      >
        <AlertDialogContent className="z-modal" overlayClassName="z-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedCount === 1
                ? t("handoff.title", "Hand off this lead?")
                : t("handoff.bulkTitle", "Hand off selected leads?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {formatText(
                selectedCount === 1
                  ? t(
                      "handoff.body",
                      "It moves to {name} and leaves your list."
                    )
                  : t(
                      "handoff.bulkBody",
                      "{count} leads move to {name} and leave your list."
                    ),
                {
                  count: selectedCount,
                  name:
                    pendingHandOff?.name ?? t("band.unassigned", "Unassigned"),
                }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("handoff.cancel", "KEEP")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingHandOff) return;
                const { assigneeId } = pendingHandOff;
                setPendingHandOff(null);
                commitReassign(assigneeId);
              }}
            >
              {t("handoff.confirm", "HAND OFF")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
