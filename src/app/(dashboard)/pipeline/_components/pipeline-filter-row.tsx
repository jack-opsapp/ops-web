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
  variant?: "surface" | "toolbar";
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
  variant?: "surface" | "toolbar";
}

function StageDropdown({
  value,
  onChange,
  allStagesLabel,
  variant = "surface",
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
  const isToolbar = variant === "toolbar";

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      data-keyboard-scope="modal-or-menu"
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-[5px] rounded-[4px] px-[8px] font-mono transition-colors",
          isToolbar
            ? "h-[26px] whitespace-nowrap uppercase leading-none tracking-[0.12em] text-micro"
            : "h-[30px] border border-border bg-fill-neutral-dim text-caption-sm",
          isToolbar
            ? open || value !== "all"
              ? "bg-surface-input text-text hover:bg-surface-hover"
              : "text-text-2 hover:bg-surface-input hover:text-text"
            : "border-border text-text hover:border-line-hi",
          !isToolbar && open && "border-line-hi"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
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

      {/* Dropdown */}
      {open && (
        <div
          className={DROPDOWN_SURFACE}
          data-keyboard-scope="modal-or-menu"
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
  variant?: "surface" | "toolbar";
}

function AssigneeDropdown({
  value,
  onChange,
  teamMembers,
  everyoneLabel,
  variant = "surface",
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
  const isToolbar = variant === "toolbar";

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      data-keyboard-scope="modal-or-menu"
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-[5px] rounded-[4px] px-[8px] font-mono transition-colors",
          isToolbar
            ? "h-[26px] whitespace-nowrap uppercase leading-none tracking-[0.12em] text-micro"
            : "h-[30px] border border-border bg-fill-neutral-dim text-caption-sm",
          isToolbar
            ? open || value !== "all"
              ? "bg-surface-input text-text hover:bg-surface-hover"
              : "text-text-2 hover:bg-surface-input hover:text-text"
            : "border-border text-text hover:border-line-hi",
          !isToolbar && open && "border-line-hi"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="whitespace-nowrap">{labelText}</span>
        <ChevronDown
          className={cn(
            "h-[10px] w-[10px] shrink-0 text-text-3 transition-transform duration-150",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className={DROPDOWN_SURFACE}
          data-keyboard-scope="modal-or-menu"
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
  variant = "surface",
}: PipelineFilterRowProps) {
  const { t } = useDictionary("pipeline");
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
      <label
        className={cn(
          "flex items-center gap-[5px] rounded-[4px] px-[8px] transition-colors",
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
        variant={variant}
      />

      {isToolbar && canManage && <ToolbarDivider />}

      {/* New Lead button */}
      {canManage && (
        <button
          type="button"
          onClick={onAddLead}
          className={cn(
            "flex shrink-0 items-center gap-[5px] rounded-[4px] border border-ops-accent bg-ops-accent px-[8px] font-mono uppercase text-black transition-colors hover:bg-ops-accent-hover hover:border-ops-accent-hover",
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
