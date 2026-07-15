"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2, Search, SlidersHorizontal, Archive, ArrowUpDown, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { SegmentControl, type SegmentControlOption } from "@/components/ui/segment-control";
import { EntityPicker } from "@/components/ui/entity-picker";
import { useProjectCanvasStore, type ProjectSortOption } from "./project-canvas-store";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "./project-stage-stack";

export type ProjectsViewMode = "canvas" | "spreadsheet" | "map";
import {
  toolbarVariants,
  toolbarVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface ProjectFloatingToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  teamMembers: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  selectedMemberId: string | null;
  onMemberFilterChange: (memberId: string | null) => void;
  selectedClientId: string | null;
  onClientFilterChange: (clientId: string | null) => void;
  canViewAccounting: boolean;
  canManage: boolean;
  canDelete: boolean;
  canViewMap: boolean;
  viewMode: ProjectsViewMode;
  onViewModeChange: (mode: ProjectsViewMode) => void;
  onArchivedToggle: () => void;
  isArchivedActive: boolean;
  onClosedToggle: () => void;
  isClosedActive: boolean;
  // Spreadsheet selection (only relevant when viewMode === "spreadsheet")
  selectedCount: number;
  onBulkChangeStatus: (status: ProjectStatus) => void;
  onBulkArchive: () => void;
  onBulkDelete: () => void;
  onBulkClear: () => void;
}

const BULK_STATUSES = [
  ProjectStatus.RFQ,
  ProjectStatus.Estimated,
  ProjectStatus.Accepted,
  ProjectStatus.InProgress,
  ProjectStatus.Completed,
  ProjectStatus.Closed,
];

// ── Component ──

export function ProjectFloatingToolbar({
  searchQuery,
  onSearchChange,
  teamMembers,
  clients,
  selectedMemberId,
  onMemberFilterChange,
  selectedClientId,
  onClientFilterChange,
  canViewAccounting,
  canManage,
  canDelete,
  canViewMap,
  viewMode,
  onViewModeChange,
  onArchivedToggle,
  isArchivedActive,
  onClosedToggle,
  isClosedActive,
  selectedCount,
  onBulkChangeStatus,
  onBulkArchive,
  onBulkDelete,
  onBulkClear,
}: ProjectFloatingToolbarProps) {
  const { t } = useDictionary("projects-canvas");
  const { t: tp } = useDictionary("picker");
  const reduced = useReducedMotion();
  const variants = reduced ? toolbarVariantsReduced : toolbarVariants;

  const sortBy = useProjectCanvasStore((s) => s.sortBy);
  const setSortBy = useProjectCanvasStore((s) => s.setSortBy);
  const fitAll = useProjectCanvasStore((s) => s.fitAll);

  const [showSearch, setShowSearch] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showBulkStatusMenu, setShowBulkStatusMenu] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const bulkStatusMenuRef = useRef<HTMLDivElement>(null);

  const hasActiveFilter = selectedMemberId !== null || selectedClientId !== null;
  const showBulkActions = viewMode === "spreadsheet" && selectedCount > 0;

  const handleFitAll = useCallback(() => {
    const canvas = document.querySelector("[data-spatial-canvas]");
    if (!canvas) return;
    fitAll(canvas.clientWidth, canvas.clientHeight);
  }, [fitAll]);

  useEffect(() => {
    if (showSearch) searchInputRef.current?.focus();
  }, [showSearch]);

  useEffect(() => {
    if (!showSortMenu && !showFilterMenu && !showBulkStatusMenu) return;
    function handleClick(e: MouseEvent) {
      // Interactions inside a portaled picker/popover (EntityPicker) live
      // outside these refs in the DOM — don't let them collapse the menus.
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }
      if (showSortMenu && sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
      if (showFilterMenu && filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
      if (showBulkStatusMenu && bulkStatusMenuRef.current && !bulkStatusMenuRef.current.contains(e.target as Node)) {
        setShowBulkStatusMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSortMenu, showFilterMenu, showBulkStatusMenu]);

  const sortOptions: { value: ProjectSortOption; label: string }[] = [
    { value: "title", label: t("sort.title") },
    { value: "client", label: t("sort.client") },
    { value: "date", label: t("sort.date") },
    ...(canViewAccounting ? [{ value: "value" as const, label: t("sort.value") }] : []),
    { value: "progress", label: t("sort.progress") },
  ];

  return (
    <motion.div
      className="flex items-center gap-[8px] px-[6px]"
      initial="hidden"
      animate="visible"
      variants={variants}
    >
      {/* ── SHARED: Search ── */}
      <ToolbarAction
        onClick={() => {
          setShowSearch(!showSearch);
          if (showSearch) onSearchChange("");
        }}
        isActive={showSearch || searchQuery.length > 0}
      >
        <Search className="w-[13px] h-[13px]" />
        <span className="font-mono text-micro uppercase tracking-wider">
          {t("toolbar.search").replace("...", "")}
        </span>
      </ToolbarAction>

      {showSearch && (
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t("toolbar.search")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowSearch(false);
              onSearchChange("");
            }
          }}
          className="h-[28px] w-[160px] rounded border border-line bg-fill-neutral-dim px-2 font-mohave text-caption-sm text-text placeholder:text-text-3 focus:border-ops-accent focus:outline-none"
        />
      )}

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* ── SHARED: Filter ── */}
      <div className="relative" ref={filterMenuRef}>
        <ToolbarAction onClick={() => setShowFilterMenu(!showFilterMenu)} isActive={showFilterMenu || hasActiveFilter}>
          <SlidersHorizontal className="w-[13px] h-[13px]" />
          <span className="font-mono text-micro uppercase tracking-wider">
            Filter
          </span>
          {hasActiveFilter && (
            <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-chip border border-line-hi bg-surface-active px-1 font-mono text-micro text-text">
              {(selectedMemberId ? 1 : 0) + (selectedClientId ? 1 : 0)}
            </span>
          )}
        </ToolbarAction>

        {showFilterMenu && (
          <div className="glass-dense absolute left-0 top-full z-50 mt-1 min-w-[200px] space-y-2 p-2">
            <div className="space-y-1">
              <span className="font-mono text-micro uppercase tracking-widest text-text-3">
                {t("toolbar.allMembers")}
              </span>
              <FilterSelect
                value={selectedMemberId}
                onChange={onMemberFilterChange}
                items={teamMembers}
                allLabel={t("toolbar.allMembers")}
                searchPlaceholder={tp("search")}
                emptyLabel={tp("noResults")}
                clearLabel={tp("clear")}
              />
            </div>
            <div className="space-y-1">
              <span className="font-mono text-micro uppercase tracking-widest text-text-3">
                {t("toolbar.allClients")}
              </span>
              <FilterSelect
                value={selectedClientId}
                onChange={onClientFilterChange}
                items={clients}
                allLabel={t("toolbar.allClients")}
                searchPlaceholder={tp("search")}
                emptyLabel={tp("noResults")}
                clearLabel={tp("clear")}
              />
            </div>
            {hasActiveFilter && (
              <button
                onClick={() => {
                  onMemberFilterChange(null);
                  onClientFilterChange(null);
                  setShowFilterMenu(false);
                }}
                className="w-full rounded-bar px-2 py-1.5 text-center font-mono text-micro text-text-3 transition-colors hover:bg-surface-hover hover:text-text"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* ── SHARED: Archived + Closed (not on the map — it excludes archived) ── */}
      {viewMode !== "map" && (
        <>
          <ToolbarAction onClick={onArchivedToggle} isActive={isArchivedActive}>
            <Archive className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              Archived
            </span>
          </ToolbarAction>

          {viewMode === "spreadsheet" && (
            <ToolbarAction onClick={onClosedToggle} isActive={isClosedActive}>
              <span className="font-mono text-micro uppercase tracking-wider">
                Closed
              </span>
            </ToolbarAction>
          )}

          <div className="w-[1px] h-[18px] bg-border-subtle" />
        </>
      )}

      {/* ── CANVAS ONLY: Fit All + Sort ── */}
      {viewMode === "canvas" && (
        <>
          <ToolbarAction onClick={handleFitAll}>
            <Maximize2 className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              Fit All
            </span>
          </ToolbarAction>

          <div className="relative" ref={sortMenuRef}>
            <ToolbarAction onClick={() => setShowSortMenu(!showSortMenu)} isActive={showSortMenu}>
              <ArrowUpDown className="w-[13px] h-[13px]" />
              <span className="font-mono text-micro uppercase tracking-wider">
                {t("toolbar.sort")}
              </span>
            </ToolbarAction>

            {showSortMenu && (
              <div className="glass-dense absolute left-0 top-full z-50 mt-1 min-w-[120px] p-1">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-bar px-2 py-1.5 transition-colors",
                      sortBy === opt.value
                        ? "bg-surface-active text-text"
                        : "text-text-2 hover:bg-surface-hover"
                    )}
                  >
                    <span className="font-mono text-micro">{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-[1px] h-[18px] bg-border-subtle" />
        </>
      )}

      {/* ── SPREADSHEET ONLY: Bulk actions (when rows selected) ── */}
      {showBulkActions && (
        <>
          <span className="font-mono text-data-sm text-text">
            {t("spreadsheet.bulk.selected").replace("{count}", String(selectedCount))}
          </span>

          {canManage && (
            <>
              <div className="relative" ref={bulkStatusMenuRef}>
                <ToolbarAction onClick={() => setShowBulkStatusMenu(!showBulkStatusMenu)} isActive={showBulkStatusMenu}>
                  <span className="font-mono text-micro uppercase tracking-wider">
                    {t("spreadsheet.bulk.changeStatus")}
                  </span>
                </ToolbarAction>
                {showBulkStatusMenu && (
                  <div className="glass-dense absolute left-0 top-full z-50 mt-1 min-w-[140px] p-1">
                    {BULK_STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onBulkChangeStatus(s); setShowBulkStatusMenu(false); }}
                        className="flex w-full items-center gap-2 rounded-bar px-2 py-1.5 text-text-2 transition-colors hover:bg-surface-hover"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }} />
                        <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ToolbarAction onClick={onBulkArchive}>
                <span className="font-mono text-micro uppercase tracking-wider">
                  {t("spreadsheet.bulk.archive")}
                </span>
              </ToolbarAction>
            </>
          )}

          {canDelete && (
            <button
              onClick={onBulkDelete}
              className="flex h-[28px] cursor-pointer items-center gap-[5px] rounded px-[8px] text-brick transition-colors duration-150 hover:bg-brick/10 hover:text-ops-error-hover"
            >
              <span className="font-mono text-micro uppercase tracking-wider">
                {t("spreadsheet.bulk.delete")}
              </span>
            </button>
          )}

          <button
            onClick={onBulkClear}
            className="flex h-[28px] cursor-pointer items-center gap-1 rounded px-[8px] text-text-3 transition-colors hover:text-text"
          >
            <X className="w-3 h-3" />
          </button>

          <div className="w-[1px] h-[18px] bg-border-subtle" />
        </>
      )}

      {/* ── View switcher (always last) — shared SegmentControl; MAP gated on map.view ── */}
      <SegmentControl<ProjectsViewMode>
        value={viewMode}
        onChange={onViewModeChange}
        options={[
          { value: "canvas", label: t("toolbar.canvas") },
          { value: "spreadsheet", label: t("toolbar.spreadsheet") },
          ...(canViewMap ? [{ value: "map", label: t("toolbar.map") }] : []),
        ] as SegmentControlOption<ProjectsViewMode>[]}
      />
    </motion.div>
  );
}

// ── Sub-component ──

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
      className={cn(
        "flex h-[28px] cursor-pointer items-center gap-[5px] rounded-chip border px-[8px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
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

/**
 * FilterSelect — a compact select-style trigger backed by the canonical
 * {@link EntityPicker}, replacing the raw `<select>` filters (raw selects violate
 * the component system). Filled active style whenever a value is set; the
 * portaled picker carries `data-keyboard-scope` so global shortcuts stay
 * suppressed while it is open, and its portal is excluded from the toolbar
 * menu's outside-click handler.
 */
function FilterSelect({
  value,
  onChange,
  items,
  allLabel,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  items: { id: string; name: string }[];
  allLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  clearLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const active = value ? items.find((i) => i.id === value) : undefined;

  return (
    <div data-keyboard-scope="modal-or-menu">
      <EntityPicker<{ id: string; name: string }>
        trigger={
          <button
            type="button"
            className={cn(
              "flex h-[28px] w-full items-center justify-between gap-1 rounded border px-2",
              "font-mohave text-caption-sm transition-colors focus:outline-none",
              value
                ? "border-line-hi bg-surface-active text-text"
                : "border-line bg-surface-input text-text-2 hover:border-line-hi",
            )}
          >
            <span className="truncate">{active ? active.name : allLabel}</span>
            <ChevronDown
              className={cn(
                "h-[12px] w-[12px] shrink-0 text-text-3 transition-transform duration-150",
                open && "rotate-180",
              )}
              strokeWidth={1.5}
            />
          </button>
        }
        open={open}
        onOpenChange={setOpen}
        label={allLabel}
        items={items}
        value={value}
        onChange={onChange}
        getId={(item) => item.id}
        getLabel={(item) => item.name}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
        clearLabel={clearLabel}
        noneOption
        noneLabel={allLabel}
        size="sm"
      />
    </div>
  );
}
