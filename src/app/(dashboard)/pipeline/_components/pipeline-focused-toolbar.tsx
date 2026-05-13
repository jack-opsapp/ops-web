"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mail, Plus, Search } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import {
  OpportunityStage,
  OPPORTUNITY_STAGE_COLORS,
  getActiveStages,
  getStageDisplayName,
} from "@/lib/types/pipeline";
import {
  spatialToolbarVariants,
  spatialToolbarVariantsReduced,
} from "@/lib/utils/motion";

interface PipelineFocusedToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  stageFilter: OpportunityStage | "all";
  onStageFilterChange: (stage: OpportunityStage | "all") => void;
  assigneeFilter: string | "all";
  onAssigneeFilterChange: (userId: string | "all") => void;
  teamMembers: { id: string; firstName: string; lastName: string }[];
  onAddLead: () => void;
  canManage: boolean;
  reviewCount?: number;
  onReviewEmails?: () => void;
}

const dropdownSurface =
  "absolute bottom-[calc(100%+4px)] left-0 z-50 min-w-full glass-dense p-1";
const dropdownItem =
  "flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left font-mohave text-body-sm whitespace-nowrap transition-colors hover:bg-surface-hover";

export function PipelineFocusedToolbar({
  searchQuery,
  onSearchChange,
  stageFilter,
  onStageFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  teamMembers,
  onAddLead,
  canManage,
  reviewCount = 0,
  onReviewEmails,
}: PipelineFocusedToolbarProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialToolbarVariantsReduced
    : spatialToolbarVariants;
  const [showSearch, setShowSearch] = useState(searchQuery.length > 0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchLabel = t("focused.search.action", "Search");
  const searchPlaceholder = t("focused.search.placeholder", "search pipeline...");

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    if (searchQuery.length > 0) setShowSearch(true);
  }, [searchQuery.length]);

  return (
    <motion.div
      className="flex items-center gap-2 px-[6px]"
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      {reviewCount > 0 && onReviewEmails && (
        <>
          <ToolbarAction onClick={onReviewEmails}>
            <Mail className="h-[13px] w-[13px]" strokeWidth={1.5} />
            <span className="font-mono text-micro uppercase tracking-wider">
              {t("gmail.reviewEmails")}
            </span>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-chip border border-line-hi bg-surface-active px-1 font-mono text-micro text-text">
              {reviewCount > 99 ? "99+" : reviewCount}
            </span>
          </ToolbarAction>
          <Divider />
        </>
      )}

      <ToolbarAction
        onClick={() => {
          setShowSearch((current) => {
            if (current) onSearchChange("");
            return !current;
          });
        }}
        isActive={showSearch || searchQuery.length > 0}
      >
        <Search className="h-[13px] w-[13px]" strokeWidth={1.5} />
        <span className="font-mono text-micro uppercase tracking-wider">
          {searchLabel}
        </span>
      </ToolbarAction>

      {showSearch && (
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setShowSearch(false);
              onSearchChange("");
            }
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-[28px] w-[180px] rounded-sm border border-line bg-surface-input px-2 py-[3px] font-mohave text-[12px] text-text outline-none placeholder:text-text-3 focus:border-line-hi"
        />
      )}

      <Divider />

      <StageFilter
        value={stageFilter}
        onChange={onStageFilterChange}
        allStagesLabel={t("filter.allStages")}
      />

      <AssigneeFilter
        value={assigneeFilter}
        onChange={onAssigneeFilterChange}
        teamMembers={teamMembers}
        everyoneLabel={t("filter.everyone")}
      />

      {canManage && (
        <>
          <Divider />
          <ToolbarAction onClick={onAddLead}>
            <Plus className="h-[13px] w-[13px]" strokeWidth={1.5} />
            <span className="font-mono text-micro uppercase tracking-wider">
              {t("spatial.newLead")}
            </span>
          </ToolbarAction>
        </>
      )}
    </motion.div>
  );
}

function StageFilter({
  value,
  onChange,
  allStagesLabel,
}: {
  value: OpportunityStage | "all";
  onChange: (stage: OpportunityStage | "all") => void;
  allStagesLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const stages = getActiveStages();
  const label = value === "all" ? allStagesLabel : getStageDisplayName(value);
  const activeColor = value === "all" ? undefined : OPPORTUNITY_STAGE_COLORS[value];

  useDismissOnOutsidePointer(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <ToolbarAction
        onClick={() => setOpen((current) => !current)}
        isActive={open || value !== "all"}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-fill-neutral"
          style={{ backgroundColor: activeColor }}
        />
        <span className="font-mono text-micro uppercase tracking-wider">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-180"
          )}
          strokeWidth={1.5}
        />
      </ToolbarAction>

      {open && (
        <div className={dropdownSurface} role="listbox" aria-label={allStagesLabel}>
          <DropdownItem
            isSelected={value === "all"}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-fill-neutral" />
            {allStagesLabel}
          </DropdownItem>
          {stages.map((stage) => (
            <DropdownItem
              key={stage}
              isSelected={value === stage}
              onClick={() => {
                onChange(stage);
                setOpen(false);
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: OPPORTUNITY_STAGE_COLORS[stage] }}
              />
              {getStageDisplayName(stage)}
            </DropdownItem>
          ))}
        </div>
      )}
    </div>
  );
}

function AssigneeFilter({
  value,
  onChange,
  teamMembers,
  everyoneLabel,
}: {
  value: string | "all";
  onChange: (userId: string | "all") => void;
  teamMembers: { id: string; firstName: string; lastName: string }[];
  everyoneLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeMember =
    value === "all" ? undefined : teamMembers.find((member) => member.id === value);
  const label = activeMember
    ? `${activeMember.firstName} ${activeMember.lastName}`
    : everyoneLabel;

  useDismissOnOutsidePointer(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <ToolbarAction
        onClick={() => setOpen((current) => !current)}
        isActive={open || value !== "all"}
      >
        <span className="font-mono text-micro uppercase tracking-wider">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-180"
          )}
          strokeWidth={1.5}
        />
      </ToolbarAction>

      {open && (
        <div className={dropdownSurface} role="listbox" aria-label={everyoneLabel}>
          <DropdownItem
            isSelected={value === "all"}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            {everyoneLabel}
          </DropdownItem>
          {teamMembers.map((member) => (
            <DropdownItem
              key={member.id}
              isSelected={value === member.id}
              onClick={() => {
                onChange(member.id);
                setOpen(false);
              }}
            >
              {member.firstName} {member.lastName}
            </DropdownItem>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolbarAction({
  children,
  onClick,
  isActive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[30px] items-center gap-[5px] rounded-sm border px-2 transition-colors duration-150",
        isActive
          ? "border-line-hi bg-surface-active text-text"
          : "border-transparent text-text-3 hover:bg-surface-hover hover:text-text"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function DropdownItem({
  children,
  isSelected,
  onClick,
}: {
  children: React.ReactNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      className={cn(dropdownItem, isSelected ? "text-text" : "text-text-2")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-[18px] w-px bg-border-subtle" />;
}

function useDismissOnOutsidePointer(
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [active, onDismiss, ref]);
}
