"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, ChevronDown, Search } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
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
}

// ---------------------------------------------------------------------------
// Shared dropdown surface styles
// ---------------------------------------------------------------------------

const DROPDOWN_SURFACE =
  "absolute top-[calc(100%+4px)] left-0 z-50 min-w-full " +
  "glass-dense py-[4px]";

const DROPDOWN_ITEM =
  "flex items-center gap-[8px] w-full px-[10px] py-[6px] " +
  "font-mono text-caption-sm text-left whitespace-nowrap " +
  "hover:bg-surface-hover transition-colors cursor-pointer";

// ---------------------------------------------------------------------------
// Stage Dropdown
// ---------------------------------------------------------------------------

interface StageDropdownProps {
  value: OpportunityStage | "all";
  onChange: (stage: OpportunityStage | "all") => void;
  allStagesLabel: string;
}

function StageDropdown({
  value,
  onChange,
  allStagesLabel,
}: StageDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const stages = getActiveStages();

  const labelText =
    value === "all" ? allStagesLabel : getStageDisplayName(value);

  const activeDotColor =
    value !== "all" ? OPPORTUNITY_STAGE_COLORS[value] : undefined;

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-[30px] items-center gap-[6px] rounded border border-border bg-fill-neutral-dim px-[10px]",
          "font-mono text-caption-sm text-text",
          "cursor-pointer transition-colors hover:border-line-hi",
          open && "border-line-hi"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {activeDotColor && (
          <span
            className="h-[6px] w-[6px] shrink-0 rounded-full"
            style={{ backgroundColor: activeDotColor }}
          />
        )}
        <span className="whitespace-nowrap">{labelText}</span>
        <ChevronDown
          className={cn(
            "h-[12px] w-[12px] shrink-0 text-text-3 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={DROPDOWN_SURFACE}
          role="listbox"
          aria-label={allStagesLabel}
        >
          {/* All Stages option */}
          <button
            type="button"
            role="option"
            aria-selected={value === "all"}
            className={cn(
              DROPDOWN_ITEM,
              value === "all" ? "text-text" : "text-text-2"
            )}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-fill-neutral" />
            {allStagesLabel}
          </button>

          {stages.map((stage) => (
            <button
              key={stage}
              type="button"
              role="option"
              aria-selected={value === stage}
              className={cn(
                DROPDOWN_ITEM,
                value === stage ? "text-text" : "text-text-2"
              )}
              onClick={() => {
                onChange(stage);
                setOpen(false);
              }}
            >
              <span
                className="h-[6px] w-[6px] shrink-0 rounded-full"
                style={{ backgroundColor: OPPORTUNITY_STAGE_COLORS[stage] }}
              />
              {getStageDisplayName(stage)}
            </button>
          ))}
        </div>
      )}
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
}

function AssigneeDropdown({
  value,
  onChange,
  teamMembers,
  everyoneLabel,
}: AssigneeDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const activeMember =
    value !== "all" ? teamMembers.find((m) => m.id === value) : undefined;

  const labelText = activeMember
    ? `${activeMember.firstName} ${activeMember.lastName}`
    : everyoneLabel;

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-[30px] items-center gap-[6px] rounded border border-border bg-fill-neutral-dim px-[10px]",
          "font-mono text-caption-sm text-text",
          "cursor-pointer transition-colors hover:border-line-hi",
          open && "border-line-hi"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="whitespace-nowrap">{labelText}</span>
        <ChevronDown
          className={cn(
            "h-[12px] w-[12px] shrink-0 text-text-3 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={DROPDOWN_SURFACE}
          role="listbox"
          aria-label={everyoneLabel}
        >
          {/* Everyone option */}
          <button
            type="button"
            role="option"
            aria-selected={value === "all"}
            className={cn(
              DROPDOWN_ITEM,
              value === "all" ? "text-text" : "text-text-2"
            )}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            {everyoneLabel}
          </button>

          {teamMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={value === member.id}
              className={cn(
                DROPDOWN_ITEM,
                value === member.id ? "text-text" : "text-text-2"
              )}
              onClick={() => {
                onChange(member.id);
                setOpen(false);
              }}
            >
              {member.firstName} {member.lastName}
            </button>
          ))}
        </div>
      )}
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
}: PipelineFilterRowProps) {
  const { t } = useDictionary("pipeline");
  const searchPlaceholder = t("focused.search.placeholder");

  return (
    <div className="flex flex-wrap items-center gap-[8px]">
      <label className="flex h-[30px] w-full min-w-[220px] items-center gap-[6px] rounded border border-border bg-fill-neutral-dim px-[10px] transition-colors focus-within:border-line-hi sm:w-[240px] sm:min-w-[240px]">
        <Search
          className="h-[13px] w-[13px] shrink-0 text-text-3"
          strokeWidth={1.5}
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-caption-sm text-text outline-none placeholder:text-text-3"
        />
      </label>

      {/* Stage filter */}
      <StageDropdown
        value={stageFilter}
        onChange={onStageFilterChange}
        allStagesLabel={t("filter.allStages")}
      />

      {/* Assignee filter */}
      <AssigneeDropdown
        value={assigneeFilter}
        onChange={onAssigneeFilterChange}
        teamMembers={teamMembers}
        everyoneLabel={t("filter.everyone")}
      />

      {/* New Lead button */}
      {canManage && (
        <button
          type="button"
          onClick={onAddLead}
          className={cn(
            "flex h-[30px] shrink-0 items-center gap-[6px] rounded border border-ops-accent px-3",
            "font-mono text-caption-sm uppercase text-ops-accent",
            "cursor-pointer transition-colors hover:bg-ops-accent hover:text-background"
          )}
        >
          <Plus className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
          {t("newLead")}
        </button>
      )}
    </div>
  );
}
