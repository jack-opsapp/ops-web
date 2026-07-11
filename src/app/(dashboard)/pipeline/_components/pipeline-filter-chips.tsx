"use client";

/**
 * PipelineFilterChips — the pipeline toolbar's stage + assignee filters on the
 * shared {@link FilterChips} idiom (WEB OVERHAUL toolbar-cohesion). Replaces the
 * bespoke `min-w-max flex-nowrap` dropdown row that fed the Workbar's elastic
 * `filters` cell and broke its reflow contract (`table-shell.tsx` Workbar). Now
 * the filters reflow inside the cell like every other surface (Clients, Books).
 *
 *   [ ALL ] [ NEW LEAD ] [ QUALIFYING ] … [ NEGOTIATION ]   ← stage, inline chips
 *   [ EVERYONE ⌄ ]                                           ← assignee, chip → picker
 *
 * Stage is a fixed enum → inline single-select chips. Assignee is a dynamic user
 * list → one chip-styled trigger opening the portaled {@link EntityPicker}. Zero
 * behavior change to the filtering: same state, same setters as the old row.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import {
  OpportunityStage,
  getActiveStages,
  getStageDisplayName,
} from "@/lib/types/pipeline";

interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
}

interface PipelineFilterChipsProps {
  stageFilter: OpportunityStage | "all";
  onStageFilterChange: (stage: OpportunityStage | "all") => void;
  assigneeFilter: string | "all";
  onAssigneeFilterChange: (userId: string | "all") => void;
  teamMembers: TeamMember[];
}

export function PipelineFilterChips({
  stageFilter,
  onStageFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  teamMembers,
}: PipelineFilterChipsProps) {
  const { t } = useDictionary("pipeline");
  const { t: tp } = useDictionary("picker");

  const stageOptions: FilterChipOption<OpportunityStage | "all">[] = [
    { value: "all", label: t("filter.allStages") },
    ...getActiveStages().map((stage) => ({
      value: stage,
      label: getStageDisplayName(stage),
    })),
  ];

  return (
    <>
      <FilterChips<OpportunityStage | "all">
        options={stageOptions}
        value={stageFilter}
        onChange={onStageFilterChange}
      />
      <AssigneeFilterChip
        value={assigneeFilter}
        onChange={onAssigneeFilterChange}
        teamMembers={teamMembers}
        everyoneLabel={t("filter.everyone")}
        searchPlaceholder={t("table.cell.assignee.search")}
        emptyLabel={t("table.cell.assignee.empty")}
        clearLabel={tp("clear")}
      />
    </>
  );
}

/**
 * The assignee filter: a single chip matching the {@link FilterChips} tag tier
 * (24px, rounded-chip, mono micro uppercase) that acts as the trigger for the
 * canonical {@link EntityPicker}. Filled (active style) whenever a member is
 * selected so a scanning operator sees the board is narrowed. The picker portals
 * to the body via the Picker kit; `data-keyboard-scope` keeps the pipeline "V"
 * shortcut suppressed while it is open.
 */
function AssigneeFilterChip({
  value,
  onChange,
  teamMembers,
  everyoneLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
}: {
  value: string | "all";
  onChange: (userId: string | "all") => void;
  teamMembers: TeamMember[];
  everyoneLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const activeMember = value !== "all" ? teamMembers.find((m) => m.id === value) : undefined;
  const filtered = value !== "all";
  const labelText = activeMember
    ? `${activeMember.firstName} ${activeMember.lastName}`
    : everyoneLabel;

  return (
    <div className="inline-flex" data-keyboard-scope="modal-or-menu">
      <EntityPicker<TeamMember>
        trigger={
          <button
            type="button"
            className={cn(
              "inline-flex h-3 items-center gap-[5px] rounded-chip border px-1",
              "font-mono text-micro font-medium uppercase tracking-[0.12em]",
              "transition-colors duration-150 ease-smooth",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
              open || filtered
                ? "border-[rgba(255,255,255,0.18)] bg-surface-active text-text"
                : "border-border text-text-3 hover:bg-surface-hover hover:text-text-2",
            )}
          >
            <span className="whitespace-nowrap">{labelText}</span>
            <ChevronDown
              className={cn(
                "h-[10px] w-[10px] shrink-0 transition-transform duration-150",
                open && "rotate-180",
              )}
              strokeWidth={1.5}
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
