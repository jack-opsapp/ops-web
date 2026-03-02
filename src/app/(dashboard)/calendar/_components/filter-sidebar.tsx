"use client";

import { useState, useMemo } from "react";
import { X, Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { TASK_TYPE_COLORS } from "@/lib/utils/calendar-constants";
import { useCalendarStore } from "@/stores/calendar-store";
import { useTeamMembers, useProjects } from "@/lib/hooks";
import { useDictionary } from "@/i18n/client";
import { UnscheduledPanel } from "./unscheduled-panel";

// ─── Event Status Options ────────────────────────────────────────────────────

const EVENT_STATUS_OPTIONS = [
  { value: "upcoming", labelKey: "status.upcoming", color: "#8195B5" },
  { value: "in-progress", labelKey: "status.inProgress", color: "#C4A868" },
  { value: "past", labelKey: "status.past", color: "#9DB582" },
] as const;

// ─── Section Toggle ──────────────────────────────────────────────────────────

function FilterSection({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border-subtle">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-background-elevated/30 transition-colors"
      >
        <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-[0.12em]">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {count > 0 && (
            <span className="font-mono text-[9px] text-ops-accent bg-ops-accent-muted/20 px-[6px] py-[1px] rounded-sm">
              {count}
            </span>
          )}
          {open ? (
            <ChevronDown className="w-3 h-3 text-text-disabled" />
          ) : (
            <ChevronRight className="w-3 h-3 text-text-disabled" />
          )}
        </div>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

// ─── Checkbox Item ───────────────────────────────────────────────────────────

function FilterCheckbox({
  checked,
  onChange,
  label,
  colorDot,
  avatar,
  sublabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  colorDot?: string;
  avatar?: string | null;
  sublabel?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-[3px] cursor-pointer group">
      <div
        className={cn(
          "w-[14px] h-[14px] rounded-sm border flex items-center justify-center shrink-0 transition-colors",
          checked
            ? "bg-ops-accent border-ops-accent"
            : "border-border bg-transparent group-hover:border-text-tertiary"
        )}
      >
        {checked && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {colorDot && (
        <div
          className="w-[8px] h-[8px] rounded-full shrink-0"
          style={{ backgroundColor: colorDot }}
        />
      )}
      {avatar && (
        <img
          src={avatar}
          alt=""
          className="w-[18px] h-[18px] rounded-full object-cover shrink-0"
        />
      )}
      {!avatar && (
        <div className="w-[18px] h-[18px] rounded-full bg-background-elevated shrink-0 flex items-center justify-center">
          <span className="font-mono text-[8px] text-text-disabled">
            {label.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex flex-col min-w-0">
        <span className="font-mohave text-body-sm text-text-secondary group-hover:text-text-primary transition-colors truncate">
          {label}
        </span>
        {sublabel && (
          <span className="font-mono text-[9px] text-text-disabled truncate">
            {sublabel}
          </span>
        )}
      </div>
    </label>
  );
}

// ─── Main Sidebar ────────────────────────────────────────────────────────────

export function FilterSidebar() {
  const { t } = useDictionary("calendar");
  const {
    isFilterSidebarOpen,
    toggleFilterSidebar,
    filterTeamMemberIds,
    filterTaskTypes,
    filterProjectIds,
    filterStatuses,
    updateFilters,
    clearFilters,
  } = useCalendarStore();

  const [projectSearch, setProjectSearch] = useState("");

  // Fetch team members and projects
  const { data: teamData } = useTeamMembers();
  const { data: projectData } = useProjects();

  const teamMembers = useMemo(() => teamData?.users ?? [], [teamData]);
  const projects = useMemo(() => {
    const all = projectData?.projects ?? [];
    if (!projectSearch.trim()) return all;
    const q = projectSearch.toLowerCase();
    return all.filter((p) => p.title.toLowerCase().includes(q));
  }, [projectData, projectSearch]);

  const totalActiveFilters =
    filterTeamMemberIds.length +
    filterTaskTypes.length +
    filterProjectIds.length +
    filterStatuses.length;

  if (!isFilterSidebarOpen) return null;

  // ── Toggle helpers ──
  function toggleTeamMember(id: string) {
    const current = filterTeamMemberIds;
    updateFilters({
      filterTeamMemberIds: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  }

  function toggleTaskType(type: string) {
    const current = filterTaskTypes;
    updateFilters({
      filterTaskTypes: current.includes(type)
        ? current.filter((x) => x !== type)
        : [...current, type],
    });
  }

  function toggleProject(id: string) {
    const current = filterProjectIds;
    updateFilters({
      filterProjectIds: current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    });
  }

  function toggleStatus(status: string) {
    const current = filterStatuses;
    updateFilters({
      filterStatuses: current.includes(status)
        ? current.filter((x) => x !== status)
        : [...current, status],
    });
  }

  return (
    <div className="w-[260px] shrink-0 bg-background-panel border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="font-mohave text-body-sm text-text-primary">
          {t("filter.title")}
        </span>
        <div className="flex items-center gap-1.5">
          {totalActiveFilters > 0 && (
            <button
              onClick={clearFilters}
              className="font-kosugi text-[9px] text-ops-accent uppercase tracking-wider hover:text-ops-accent/80 transition-colors"
            >
              {t("filter.clearAll")}
            </button>
          )}
          <button
            onClick={toggleFilterSidebar}
            className="p-0.5 hover:bg-background-elevated/50 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5 text-text-disabled" />
          </button>
        </div>
      </div>

      {/* Scrollable filter content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Team Members */}
        <FilterSection
          title={t("filter.teamMembers")}
          count={filterTeamMemberIds.length}
          defaultOpen
        >
          <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
            {teamMembers.map((member) => (
              <FilterCheckbox
                key={member.id}
                checked={filterTeamMemberIds.includes(member.id)}
                onChange={() => toggleTeamMember(member.id)}
                label={`${member.firstName} ${member.lastName}`}
                avatar={member.profileImageURL}
                sublabel={member.role}
              />
            ))}
            {teamMembers.length === 0 && (
              <span className="font-mono text-[10px] text-text-disabled py-1">
                {t("filter.noTeamMembers")}
              </span>
            )}
          </div>
        </FilterSection>

        {/* Task Types */}
        <FilterSection
          title={t("filter.taskTypes")}
          count={filterTaskTypes.length}
          defaultOpen
        >
          <div className="flex flex-col gap-0.5">
            {Object.entries(TASK_TYPE_COLORS).map(([type, colors]) => (
              <FilterCheckbox
                key={type}
                checked={filterTaskTypes.includes(type)}
                onChange={() => toggleTaskType(type)}
                label={type.charAt(0).toUpperCase() + type.slice(1)}
                colorDot={colors.border}
              />
            ))}
          </div>
        </FilterSection>

        {/* Projects */}
        <FilterSection
          title={t("filter.projects")}
          count={filterProjectIds.length}
        >
          <div className="mb-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-disabled" />
              <input
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder={t("filter.searchProjects")}
                className="w-full pl-[26px] pr-2 py-[5px] bg-background-elevated/50 border border-border-subtle rounded-sm font-mono text-[11px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-ops-accent/40 transition-colors"
              />
            </div>
          </div>
          <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
            {projects.map((project) => (
              <FilterCheckbox
                key={project.id}
                checked={filterProjectIds.includes(project.id)}
                onChange={() => toggleProject(project.id)}
                label={project.title}
                sublabel={project.status ?? undefined}
              />
            ))}
            {projects.length === 0 && (
              <span className="font-mono text-[10px] text-text-disabled py-1">
                {projectSearch ? t("filter.noMatchingProjects") : t("filter.noProjects")}
              </span>
            )}
          </div>
        </FilterSection>

        {/* Event Status */}
        <FilterSection
          title={t("filter.status")}
          count={filterStatuses.length}
        >
          <div className="flex flex-col gap-0.5">
            {EVENT_STATUS_OPTIONS.map(({ value, labelKey, color }) => (
              <FilterCheckbox
                key={value}
                checked={filterStatuses.includes(value)}
                onChange={() => toggleStatus(value)}
                label={t(labelKey)}
                colorDot={color}
              />
            ))}
          </div>
        </FilterSection>

        {/* Unscheduled tasks — draggable into calendar grid */}
        <UnscheduledPanel />
      </div>
    </div>
  );
}
