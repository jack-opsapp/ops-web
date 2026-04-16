"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, ChevronDown } from "lucide-react";
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
  "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)] " +
  "border border-[rgba(255,255,255,0.08)] rounded-[4px] py-[4px] shadow-lg";

const DROPDOWN_ITEM =
  "flex items-center gap-[8px] w-full px-[10px] py-[6px] " +
  "font-mohave text-body-sm text-left whitespace-nowrap " +
  "hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer";

// ---------------------------------------------------------------------------
// Stage Dropdown
// ---------------------------------------------------------------------------

interface StageDropdownProps {
  value: OpportunityStage | "all";
  onChange: (stage: OpportunityStage | "all") => void;
  allStagesLabel: string;
}

function StageDropdown({ value, onChange, allStagesLabel }: StageDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
          "flex items-center gap-[6px] h-[30px] px-[10px]",
          "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
          "border border-[rgba(255,255,255,0.06)] rounded-[4px]",
          "font-mohave text-body-sm text-text",
          "hover:border-[rgba(255,255,255,0.14)] transition-colors cursor-pointer",
          open && "border-[rgba(255,255,255,0.14)]"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {activeDotColor && (
          <span
            className="w-[6px] h-[6px] rounded-full shrink-0"
            style={{ backgroundColor: activeDotColor }}
          />
        )}
        <span className="whitespace-nowrap">{labelText}</span>
        <ChevronDown
          className={cn(
            "w-[12px] h-[12px] text-text-3 shrink-0 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={DROPDOWN_SURFACE} role="listbox" aria-label="Stage filter">
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
            <span className="w-[6px] h-[6px] rounded-full bg-[rgba(255,255,255,0.18)] shrink-0" />
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
                className="w-[6px] h-[6px] rounded-full shrink-0"
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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const activeMember =
    value !== "all" ? teamMembers.find((m) => m.id === value) : undefined;

  const labelText =
    activeMember
      ? `${activeMember.firstName} ${activeMember.lastName}`
      : everyoneLabel;

  return (
    <div ref={containerRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-[6px] h-[30px] px-[10px]",
          "bg-[rgba(10,10,10,0.25)] backdrop-blur-[12px] [-webkit-backdrop-filter:blur(12px)_saturate(1.1)]",
          "border border-[rgba(255,255,255,0.06)] rounded-[4px]",
          "font-mohave text-body-sm text-text",
          "hover:border-[rgba(255,255,255,0.14)] transition-colors cursor-pointer",
          open && "border-[rgba(255,255,255,0.14)]"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="whitespace-nowrap">{labelText}</span>
        <ChevronDown
          className={cn(
            "w-[12px] h-[12px] text-text-3 shrink-0 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className={DROPDOWN_SURFACE} role="listbox" aria-label="Assignee filter">
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
  searchQuery: _searchQuery,
  onSearchChange: _onSearchChange,
  stageFilter,
  onStageFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  teamMembers,
  onAddLead,
  canManage,
}: PipelineFilterRowProps) {
  const { t } = useDictionary("pipeline");

  return (
    <div className="flex items-center gap-[8px]">
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
            "flex items-center gap-[6px] h-[30px] px-3 shrink-0",
            "bg-[#597794] hover:bg-[#597794]/90",
            "font-mohave text-body-sm text-white",
            "rounded-[4px] transition-colors cursor-pointer"
          )}
        >
          <Plus className="w-[14px] h-[14px] shrink-0" />
          {t("newLead")}
        </button>
      )}
    </div>
  );
}
