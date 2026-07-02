"use client";

import { useState } from "react";
import { Plus, ChevronDown, Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import {
  OpportunityStage,
  getActiveStages,
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PipelineFilterRowProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  stageFilter: OpportunityStage | "all";
  onStageFilterChange: (stage: OpportunityStage | "all") => void;
  assigneeFilter: string | "all";
  onAssigneeFilterChange: (userId: string | "all") => void;
  teamMembers: { id: string; firstName: string; lastName: string }[];
  onAddLead: () => void;
  canManage: boolean;
  variant?: "surface" | "toolbar";
  /**
   * Render the search field. Default true. The unified pipeline toolbar (WEB
   * OVERHAUL P6-2 rework) owns a single shared search input above the mode
   * crossfade, so the toolbar renders with `showSearch={false}` to avoid a
   * duplicate field — the stage/assignee filters carry over intact.
   */
  showSearch?: boolean;
  /**
   * Render the NEW LEAD button. Default true. The unified toolbar renders NEW
   * LEAD once (shared across both modes, as a `WorkbarButton` on the right), so
   * it passes `showNewLead={false}` and this component contributes only the
   * stage + assignee filters.
   */
  showNewLead?: boolean;
}

// ---------------------------------------------------------------------------
// Shared filter-chip trigger
// ---------------------------------------------------------------------------

/**
 * The filter chip look, unchanged from the hand-rolled era: 26px quiet chip in
 * the toolbar, 30px bordered chip on the surface variant. `filtered` (an
 * active non-"all" value) keeps the toolbar chip filled so the operator can
 * see at a glance that the board is narrowed.
 */
function filterTriggerClass(isToolbar: boolean, open: boolean, filtered: boolean) {
  return cn(
    "flex items-center gap-[5px] rounded-chip px-[8px] font-mono transition-colors",
    isToolbar
      ? "h-[26px] whitespace-nowrap uppercase leading-none tracking-[0.12em] text-micro"
      : "h-[30px] border border-border bg-fill-neutral-dim text-caption-sm",
    isToolbar
      ? open || filtered
        ? "bg-surface-input text-text hover:bg-surface-hover"
        : "text-text-2 hover:bg-surface-input hover:text-text"
      : "border-border text-text hover:border-line-hi",
    !isToolbar && open && "border-line-hi"
  );
}

// ---------------------------------------------------------------------------
// Stage Dropdown
// ---------------------------------------------------------------------------

interface StageDropdownProps {
  value: OpportunityStage | "all";
  onChange: (stage: OpportunityStage | "all") => void;
  allStagesLabel: string;
  variant?: "surface" | "toolbar";
}

/**
 * Stage filter on the canonical {@link EntityPicker} (previously a hand-rolled
 * non-portaled listbox — the Picker kit docstring mandates the shared shell).
 * The `"all"` sentinel maps through the kit's `noneOption`; six static stages
 * need no search row. The portaled panel carries `data-keyboard-scope` from
 * the kit, so the pipeline "V" shortcut stays suppressed while it is open.
 */
function StageDropdown({
  value,
  onChange,
  allStagesLabel,
  variant = "surface",
}: StageDropdownProps) {
  const [open, setOpen] = useState(false);
  const stages = getActiveStages();

  const labelText =
    value === "all" ? allStagesLabel : getStageDisplayName(value);

  const activeDotColor =
    value !== "all" ? OPPORTUNITY_STAGE_COLORS[value] : undefined;
  const isToolbar = variant === "toolbar";

  return (
    <div className="shrink-0" data-keyboard-scope="modal-or-menu">
      <EntityPicker<OpportunityStage>
        trigger={
          <button
            type="button"
            className={filterTriggerClass(isToolbar, open, value !== "all")}
          >
            {activeDotColor && (
              <span
                className="h-[5px] w-[5px] shrink-0 rounded-full"
                style={{ backgroundColor: activeDotColor }}
              />
            )}
            <span className="whitespace-nowrap">{labelText}</span>
            <ChevronDown
              className={cn(
                "h-[10px] w-[10px] shrink-0 text-text-3 transition-transform duration-150",
                open && "rotate-180"
              )}
            />
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label={allStagesLabel}
        items={stages}
        value={value === "all" ? null : value}
        onChange={(id) => onChange((id as OpportunityStage | null) ?? "all")}
        getId={(stage) => stage}
        getLabel={(stage) => getStageDisplayName(stage)}
        getLeading={(stage) => (
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ backgroundColor: OPPORTUNITY_STAGE_COLORS[stage] }}
          />
        )}
        searchable={false}
        noneOption
        noneLabel={allStagesLabel}
        size="sm"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignee Dropdown
// ---------------------------------------------------------------------------

interface AssigneeDropdownProps {
  value: string | "all";
  onChange: (userId: string | "all") => void;
  teamMembers: { id: string; firstName: string; lastName: string }[];
  everyoneLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
  variant?: "surface" | "toolbar";
}

/**
 * Assignee filter on the canonical {@link EntityPicker} — same migration as
 * {@link StageDropdown}, and the list gains typed search for free (parity with
 * the table's assignee cell picker). `"all"` maps through `noneOption`.
 */
function AssigneeDropdown({
  value,
  onChange,
  teamMembers,
  everyoneLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  variant = "surface",
}: AssigneeDropdownProps) {
  const [open, setOpen] = useState(false);

  const activeMember =
    value !== "all" ? teamMembers.find((m) => m.id === value) : undefined;

  const labelText = activeMember
    ? `${activeMember.firstName} ${activeMember.lastName}`
    : everyoneLabel;
  const isToolbar = variant === "toolbar";

  return (
    <div className="shrink-0" data-keyboard-scope="modal-or-menu">
      <EntityPicker<{ id: string; firstName: string; lastName: string }>
        trigger={
          <button
            type="button"
            className={filterTriggerClass(isToolbar, open, value !== "all")}
          >
            <span className="whitespace-nowrap">{labelText}</span>
            <ChevronDown
              className={cn(
                "h-[10px] w-[10px] shrink-0 text-text-3 transition-transform duration-150",
                open && "rotate-180"
              )}
            />
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label={everyoneLabel}
        items={teamMembers}
        value={value === "all" ? null : value}
        onChange={(id) => onChange(id ?? "all")}
        getId={(member) => member.id}
        getLabel={(member) => `${member.firstName} ${member.lastName}`}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
        clearLabel={clearLabel}
        noneOption
        noneLabel={everyoneLabel}
        size="md"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineFilterRow
// ---------------------------------------------------------------------------

export function PipelineFilterRow({
  searchQuery,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  teamMembers,
  onAddLead,
  canManage,
  variant = "surface",
  showSearch = true,
  showNewLead = true,
}: PipelineFilterRowProps) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");
  const searchPlaceholder = t("focused.search.placeholder");
  const isToolbar = variant === "toolbar";

  return (
    <div
      className={cn(
        "flex items-center",
        isToolbar ? "min-w-max flex-nowrap gap-[10px]" : "flex-wrap gap-[8px]"
      )}
      data-pipeline-filter-row={variant}
    >
      {showSearch && (
        <>
          <label
            className={cn(
              "flex items-center gap-[5px] rounded-chip px-[8px] transition-colors",
              isToolbar
                ? "h-[26px] w-[150px] min-w-[145px] bg-transparent focus-within:bg-surface-input"
                : "h-[30px] w-full min-w-[220px] border border-border bg-fill-neutral-dim focus-within:border-line-hi sm:w-[240px] sm:min-w-[240px]",
              isToolbar && searchQuery.length > 0 && "bg-surface-input"
            )}
          >
            <Search
              className="h-[11px] w-[11px] shrink-0 text-text-3"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={cn(
                "h-full min-w-0 flex-1 bg-transparent font-mono text-text outline-none placeholder:text-text-3",
                isToolbar
                  ? "uppercase leading-none tracking-[0.12em] text-micro"
                  : "text-caption-sm"
              )}
            />
          </label>

          {isToolbar && <ToolbarDivider />}
        </>
      )}

      {/* Stage filter */}
      <StageDropdown
        value={stageFilter}
        onChange={onStageFilterChange}
        allStagesLabel={t("filter.allStages")}
        variant={variant}
      />

      {isToolbar && <ToolbarDivider />}

      {/* Assignee filter */}
      <AssigneeDropdown
        value={assigneeFilter}
        onChange={onAssigneeFilterChange}
        teamMembers={teamMembers}
        everyoneLabel={t("filter.everyone")}
        searchPlaceholder={t("table.cell.assignee.search")}
        emptyLabel={t("table.cell.assignee.empty")}
        clearLabel={tp("clear")}
        variant={variant}
      />

      {isToolbar && canManage && showNewLead && <ToolbarDivider />}

      {/* New Lead button */}
      {canManage && showNewLead && (
        <button
          type="button"
          onClick={onAddLead}
          className={cn(
            "flex shrink-0 items-center gap-[5px] rounded-chip border border-ops-accent bg-ops-accent px-[8px] font-mono uppercase text-black transition-colors hover:bg-ops-accent-hover hover:border-ops-accent-hover",
            isToolbar
              ? "h-[26px] whitespace-nowrap leading-none tracking-[0.12em] text-micro"
              : "h-[30px] text-caption-sm"
          )}
        >
          <Plus className="h-[11px] w-[11px] shrink-0" strokeWidth={1.5} />
          {t("newLead")}
        </button>
      )}
    </div>
  );
}

function ToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className="h-[14px] w-px shrink-0 bg-border-subtle opacity-70"
    />
  );
}
