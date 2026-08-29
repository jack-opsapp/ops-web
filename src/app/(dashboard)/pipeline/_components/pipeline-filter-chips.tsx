"use client";

/**
 * PipelineFilterChips — the pipeline toolbar's stage + assignee filters.
 *
 *   [ ALL STAGES ⌄ ]  [ EVERYONE ⌄ ]     ← two chips, each → portaled picker
 *
 * Both filters are single-select chip triggers opening the canonical
 * {@link EntityPicker}. Pipeline is the ONE surface where the stage enum is
 * large enough (8 active stages) that rendering it as an inline {@link
 * FilterChips} row breaks the Workbar's overflow contract: the elastic
 * `filters` cell floors at min-content, so between ~1000–1300px the eight
 * stage chips wrapped one-per-line into an ~8-row vertical stack that
 * ballooned the toolbar and pushed the tab strip and table off-screen.
 *
 * A picker trigger's min-content is ONE small chip, so the filters cell can
 * never force row 1 to grow — the toolbar holds a fixed height at every width.
 * Surfaces with few options (Clients, Books, Catalog) keep using the inline
 * `FilterChips` row; that component and the Workbar are deliberately untouched.
 *
 * Zero behavior change to the filtering: same state, same setters.
 */

import { forwardRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import {
  OpportunityStage,
  getActiveStages,
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
  type OpportunityAssigneeFilter,
} from "@/lib/types/pipeline";

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
}

interface PipelineFilterChipsProps {
  stageFilter: OpportunityStage | "all";
  onStageFilterChange: (stage: OpportunityStage | "all") => void;
  assigneeFilter: OpportunityAssigneeFilter;
  onAssigneeFilterChange: (filter: OpportunityAssigneeFilter) => void;
  teamMembers: TeamMember[];
  currentUserId: string | null;
  showAssigneeFilter: boolean;
}

export function PipelineFilterChips({
  stageFilter,
  onStageFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  teamMembers,
  currentUserId,
  showAssigneeFilter,
}: PipelineFilterChipsProps) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");

  return (
    // ONE unwrappable flex item, deliberately. The Workbar's elastic filters
    // cell is `flex-wrap`, so two loose chips still break onto separate lines
    // whenever the right cluster is wide (≥lg, where the density and view
    // controls render text labels instead of icons — the toolbar was two rows
    // at 1300px even after the stage chips collapsed to a picker). Keeping the
    // pair `flex-nowrap` raises the cell's min-content floor from one chip to
    // two — still tiny and bounded — so row 1 holds a single line at every
    // width, and any remaining pressure falls to the right cluster's own
    // internal wrap, which is the Workbar's documented last-resort relief.
    <div className="flex flex-nowrap items-center gap-2">
      <StageFilterChip
        value={stageFilter}
        onChange={onStageFilterChange}
        allStagesLabel={t("filter.allStages")}
      />
      {showAssigneeFilter ? (
        <AssigneeFilterChip
          value={assigneeFilter}
          onChange={onAssigneeFilterChange}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          everyoneLabel={t("filter.everyone")}
          mineLabel={t("filter.mine")}
          unassignedLabel={t("filter.unassigned")}
          searchPlaceholder={t("table.cell.assignee.search")}
          emptyLabel={t("table.cell.assignee.empty")}
          clearLabel={tp("clear")}
        />
      ) : null}
    </div>
  );
}

/**
 * The shared filter-chip trigger: the DESIGN.md §9 tag tier (24px,
 * rounded-chip, JetBrains Mono micro uppercase, 0.12em) rendered as a button.
 * Filled (active style) while the picker is open OR a filter is applied, so a
 * scanning operator sees at a glance that the board is narrowed.
 *
 * Both pipeline filters render through this one component so the stage and
 * assignee chips can never drift apart.
 *
 * MUST forward ref and spread props: `PickerTrigger asChild` clones this
 * element to attach the popover's `onPointerDown`, `aria-expanded`, and its
 * positioning ref. A plain function component swallows them and the picker
 * silently never opens — the chip renders perfectly and does nothing.
 */
const FilterPickerChipTrigger = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    open: boolean;
    filtered: boolean;
    leading?: React.ReactNode;
  } & React.ComponentPropsWithoutRef<"button">
>(function FilterPickerChipTrigger(
  { label, open, filtered, leading, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex h-3 items-center gap-0.5 rounded-chip border px-1",
        "font-mono text-micro font-medium uppercase tracking-[0.12em]",
        "transition-colors duration-150 ease-smooth",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        open || filtered
          ? "border-line-hi bg-surface-active text-text"
          : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
        className
      )}
    >
      {leading}
      <span className="whitespace-nowrap">{label}</span>
      <ChevronDown
        className={cn(
          "h-2 w-2 shrink-0 transition-transform duration-150",
          open && "rotate-180"
        )}
        strokeWidth={1.5}
      />
    </button>
  );
});

/**
 * The stage swatch — geometry matched to the canonical stage dot already used
 * by the table's stage cell, the stage-action cell, the group header, and the
 * detail timeline, so one stage reads identically everywhere it appears.
 */
function StageDot({ stage }: { stage: OpportunityStage }) {
  return (
    <span
      aria-hidden="true"
      className="h-[7px] w-[7px] shrink-0 rounded-full"
      style={{ backgroundColor: OPPORTUNITY_STAGE_COLORS[stage] }}
    />
  );
}

type StageOption = { id: OpportunityStage; label: string };

/**
 * The stage filter: one chip-styled trigger opening the portaled
 * {@link EntityPicker}. The trigger carries the active stage's color dot so
 * the applied filter reads without opening anything; with no filter applied
 * there is no single stage color, so no dot is shown.
 *
 * `data-keyboard-scope` keeps the pipeline "V" mode shortcut suppressed while
 * the picker is open (same contract as the assignee chip).
 */
function StageFilterChip({
  value,
  onChange,
  allStagesLabel,
}: {
  value: OpportunityStage | "all";
  onChange: (stage: OpportunityStage | "all") => void;
  allStagesLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const options: StageOption[] = getActiveStages().map((stage) => ({
    id: stage,
    label: getStageDisplayName(stage),
  }));
  const filtered = value !== "all";
  const activeOption = options.find((option) => option.id === value);
  const labelText = activeOption?.label ?? allStagesLabel;

  return (
    <div className="inline-flex" data-keyboard-scope="modal-or-menu">
      <EntityPicker<StageOption>
        trigger={
          <FilterPickerChipTrigger
            label={labelText}
            open={open}
            filtered={filtered}
            leading={
              activeOption ? <StageDot stage={activeOption.id} /> : undefined
            }
          />
        }
        open={open}
        onOpenChange={setOpen}
        label={allStagesLabel}
        items={options}
        value={filtered ? value : null}
        onChange={(id) => onChange((id ?? "all") as OpportunityStage | "all")}
        getId={(option) => option.id}
        getLabel={(option) => option.label}
        getLeading={(option) => <StageDot stage={option.id} />}
        // Eight known, short stage names — a search box would be noise.
        searchable={false}
        noneOption
        noneLabel={allStagesLabel}
        size="md"
      />
    </div>
  );
}

/**
 * The assignee filter: the same chip trigger over the canonical
 * {@link EntityPicker}. The picker portals to the body via the Picker kit;
 * `data-keyboard-scope` keeps the pipeline "V" shortcut suppressed while open.
 */
function AssigneeFilterChip({
  value,
  onChange,
  teamMembers,
  currentUserId,
  everyoneLabel,
  mineLabel,
  unassignedLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
}: {
  value: OpportunityAssigneeFilter;
  onChange: (filter: OpportunityAssigneeFilter) => void;
  teamMembers: TeamMember[];
  currentUserId: string | null;
  everyoneLabel: string;
  mineLabel: string;
  unassignedLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const options: Array<{ id: OpportunityAssigneeFilter; label: string }> = [
    ...(currentUserId ? [{ id: "mine" as const, label: mineLabel }] : []),
    { id: "unassigned", label: unassignedLabel },
    ...teamMembers
      .filter((member) => member.id !== currentUserId)
      .map((member) => ({
        id: `user:${member.id}` as const,
        label: `${member.firstName} ${member.lastName}`.trim(),
      })),
  ];
  const activeOption = options.find((option) => option.id === value);
  const filtered = value !== "all";
  const labelText = activeOption?.label ?? everyoneLabel;

  return (
    <div className="inline-flex" data-keyboard-scope="modal-or-menu">
      <EntityPicker<(typeof options)[number]>
        trigger={
          <FilterPickerChipTrigger
            label={labelText}
            open={open}
            filtered={filtered}
          />
        }
        open={open}
        onOpenChange={setOpen}
        label={everyoneLabel}
        items={options}
        value={value === "all" ? null : value}
        onChange={(id) => onChange((id ?? "all") as OpportunityAssigneeFilter)}
        getId={(option) => option.id}
        getLabel={(option) => option.label}
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
