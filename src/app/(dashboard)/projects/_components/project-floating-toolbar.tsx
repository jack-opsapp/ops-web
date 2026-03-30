"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2, Search, SlidersHorizontal, Archive, ArrowUpDown, LayoutGrid, Table2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useProjectCanvasStore, type ProjectSortOption } from "./project-canvas-store";
import { ProjectStatus, PROJECT_STATUS_COLORS } from "@/lib/types/models";
import { getProjectStatusDisplayName } from "./project-stage-stack";
import {
  spatialToolbarVariants,
  spatialToolbarVariantsReduced,
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
  viewMode: "canvas" | "spreadsheet";
  onViewModeChange: (mode: "canvas" | "spreadsheet") => void;
  onArchivedToggle: () => void;
  isArchivedActive: boolean;
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
  viewMode,
  onViewModeChange,
  onArchivedToggle,
  isArchivedActive,
  selectedCount,
  onBulkChangeStatus,
  onBulkArchive,
  onBulkDelete,
  onBulkClear,
}: ProjectFloatingToolbarProps) {
  const { t } = useDictionary("projects-canvas");
  const reduced = useReducedMotion();
  const variants = reduced ? spatialToolbarVariantsReduced : spatialToolbarVariants;

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
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
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
          className="w-[160px] px-2 py-[3px] rounded-sm font-mohave text-[12px] text-text-primary bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] placeholder:text-text-disabled focus:outline-none focus:border-[rgba(89,119,148,0.3)]"
        />
      )}

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* ── SHARED: Filter ── */}
      <div className="relative" ref={filterMenuRef}>
        <ToolbarAction onClick={() => setShowFilterMenu(!showFilterMenu)} isActive={showFilterMenu || hasActiveFilter}>
          <SlidersHorizontal className="w-[13px] h-[13px]" />
          <span className="font-kosugi text-micro-sm uppercase tracking-wider">
            Filter
          </span>
          {hasActiveFilter && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-sm border border-ops-accent/30 bg-ops-accent-muted font-kosugi text-micro-xs text-ops-accent">
              {(selectedMemberId ? 1 : 0) + (selectedClientId ? 1 : 0)}
            </span>
          )}
        </ToolbarAction>

        {showFilterMenu && (
          <div
            className="absolute top-full left-0 mt-1 z-50 min-w-[200px] p-2 rounded-[4px] space-y-2"
            style={{
              background: "rgba(10,10,10,0.95)",
              backdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <div>
              <span className="font-kosugi text-[9px] uppercase tracking-widest text-text-disabled">
                {t("toolbar.allMembers")}
              </span>
              <select
                value={selectedMemberId ?? ""}
                onChange={(e) => onMemberFilterChange(e.target.value || null)}
                className="w-full mt-1 px-2 py-1.5 rounded-[2px] font-mohave text-[12px] text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
              >
                <option value="">All</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="font-kosugi text-[9px] uppercase tracking-widest text-text-disabled">
                {t("toolbar.allClients")}
              </span>
              <select
                value={selectedClientId ?? ""}
                onChange={(e) => onClientFilterChange(e.target.value || null)}
                className="w-full mt-1 px-2 py-1.5 rounded-[2px] font-mohave text-[12px] text-text-secondary bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)] focus:outline-none"
              >
                <option value="">All</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {hasActiveFilter && (
              <button
                onClick={() => {
                  onMemberFilterChange(null);
                  onClientFilterChange(null);
                  setShowFilterMenu(false);
                }}
                className="w-full px-2 py-1.5 rounded-[2px] font-kosugi text-micro-sm text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors text-center"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* ── SHARED: Archived ── */}
      <ToolbarAction onClick={onArchivedToggle} isActive={isArchivedActive}>
        <Archive className="w-[13px] h-[13px]" />
        <span className="font-kosugi text-micro-sm uppercase tracking-wider">
          Archived
        </span>
      </ToolbarAction>

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* ── CANVAS ONLY: Fit All + Sort ── */}
      {viewMode === "canvas" && (
        <>
          <ToolbarAction onClick={handleFitAll}>
            <Maximize2 className="w-[13px] h-[13px]" />
            <span className="font-kosugi text-micro-sm uppercase tracking-wider">
              Fit All
            </span>
          </ToolbarAction>

          <div className="relative" ref={sortMenuRef}>
            <ToolbarAction onClick={() => setShowSortMenu(!showSortMenu)} isActive={showSortMenu}>
              <ArrowUpDown className="w-[13px] h-[13px]" />
              <span className="font-kosugi text-micro-sm uppercase tracking-wider">
                {t("toolbar.sort")}
              </span>
            </ToolbarAction>

            {showSortMenu && (
              <div
                className="absolute top-full left-0 mt-1 z-50 min-w-[120px] p-1 rounded-[4px]"
                style={{
                  background: "rgba(10,10,10,0.95)",
                  backdropFilter: "blur(20px) saturate(1.2)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] transition-colors",
                      sortBy === opt.value
                        ? "text-ops-accent bg-ops-accent-muted/20"
                        : "text-text-secondary hover:bg-[rgba(255,255,255,0.06)]"
                    )}
                  >
                    <span className="font-kosugi text-micro-sm">{opt.label}</span>
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
          <span className="font-mono text-data-sm text-ops-accent">
            {t("spreadsheet.bulk.selected").replace("{count}", String(selectedCount))}
          </span>

          {canManage && (
            <>
              <div className="relative" ref={bulkStatusMenuRef}>
                <ToolbarAction onClick={() => setShowBulkStatusMenu(!showBulkStatusMenu)} isActive={showBulkStatusMenu}>
                  <span className="font-kosugi text-micro-sm uppercase tracking-wider">
                    {t("spreadsheet.bulk.changeStatus")}
                  </span>
                </ToolbarAction>
                {showBulkStatusMenu && (
                  <div
                    className="absolute top-full left-0 mt-1 z-50 min-w-[140px] p-1 rounded-[4px]"
                    style={{
                      background: "rgba(10,10,10,0.95)",
                      backdropFilter: "blur(20px) saturate(1.2)",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                  >
                    {BULK_STATUSES.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onBulkChangeStatus(s); setShowBulkStatusMenu(false); }}
                        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[2px] text-text-secondary hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PROJECT_STATUS_COLORS[s] }} />
                        <span className="font-mohave text-body-sm">{getProjectStatusDisplayName(s)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ToolbarAction onClick={onBulkArchive}>
                <span className="font-kosugi text-micro-sm uppercase tracking-wider">
                  {t("spreadsheet.bulk.archive")}
                </span>
              </ToolbarAction>
            </>
          )}

          {canDelete && (
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer text-[#93321A] hover:text-[#b5423a] hover:bg-[rgba(147,50,26,0.1)]"
            >
              <span className="font-kosugi text-micro-sm uppercase tracking-wider">
                {t("spreadsheet.bulk.delete")}
              </span>
            </button>
          )}

          <button
            onClick={onBulkClear}
            className="flex items-center gap-1 px-[8px] py-[5px] rounded-sm text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>

          <div className="w-[1px] h-[18px] bg-border-subtle" />
        </>
      )}

      {/* ── View toggle (always last) ── */}
      <ToolbarAction onClick={() => onViewModeChange("canvas")} isActive={viewMode === "canvas"}>
        <LayoutGrid className="w-[13px] h-[13px]" />
      </ToolbarAction>
      <ToolbarAction onClick={() => onViewModeChange("spreadsheet")} isActive={viewMode === "spreadsheet"}>
        <Table2 className="w-[13px] h-[13px]" />
      </ToolbarAction>
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
        "flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-ops-accent bg-ops-accent-muted/20"
          : "text-text-tertiary hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
