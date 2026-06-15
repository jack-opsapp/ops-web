"use client";

/**
 * ProjectSitesDrawer — the collapsible roster for the Projects MAP view.
 *
 * Why a drawer at all (UX judgment, not chrome): 19% of projects have no
 * coordinates and therefore no pin. A pins-only map would silently drop them.
 * The drawer is the only surface that lists the un-geocoded jobs (the "NO GPS"
 * group) — and lets the owner open one to add an address. It is also the
 * find-by-name path: click a pinned row to *locate* it (the map flies there);
 * click its pin to *open* the workspace window. Collapses to a full-bleed map
 * when the owner just wants to read the territory.
 */

import { ChevronLeft, ChevronRight, MapPin, Plus, ExternalLink, Crosshair } from "lucide-react";
import { useMemo } from "react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import { PROJECT_STATUS_COLORS } from "@/lib/types/models";
import type { Project } from "@/lib/types/models";
import type { MapStatusFilter } from "./project-map-view";

interface ProjectSitesDrawerProps {
  /** Already search/member/client/status-filtered, non-deleted, non-archived. */
  projects: Project[];
  statusFilter: MapStatusFilter;
  statusOptions: FilterChipOption<MapStatusFilter>[];
  onStatusChange: (value: MapStatusFilter) => void;
  selectedProjectId: string | null;
  /** Pinned row click — fly the map to it + select. */
  onLocate: (project: Project) => void;
  /** No-GPS row click — open the workspace window (to add an address). */
  onOpen: (project: Project) => void;
  /** External directions for a pinned job. */
  onOpenInMaps: (project: Project) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  totalCount: number;
}

export function ProjectSitesDrawer({
  projects,
  statusFilter,
  statusOptions,
  onStatusChange,
  selectedProjectId,
  onLocate,
  onOpen,
  onOpenInMaps,
  collapsed,
  onToggleCollapsed,
  totalCount,
}: ProjectSitesDrawerProps) {
  const { t } = useDictionary("projects-canvas");

  const { pinned, noGps } = useMemo(() => {
    const pinnedList: Project[] = [];
    const noGpsList: Project[] = [];
    for (const p of projects) {
      if (p.latitude != null && p.longitude != null) pinnedList.push(p);
      else noGpsList.push(p);
    }
    return { pinned: pinnedList, noGps: noGpsList };
  }, [projects]);

  return (
    <>
      <div
        className={cn(
          "glass-surface absolute bottom-0 left-0 top-0 z-[10] flex w-[236px] flex-col border-r border-border",
          "transition-transform duration-[250ms] ease-smooth",
          collapsed ? "-translate-x-full" : "translate-x-0",
        )}
      >
        {/* Header — title + pinned/total count + status chips. */}
        <div className="space-y-2 border-b border-border-subtle p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-cakemono text-body-sm font-light uppercase tracking-[0.14em] text-text">
              <MapPin className="h-[14px] w-[14px] text-text-2" strokeWidth={1.5} />
              {t("map.sites")}
            </span>
            <span className="font-mono text-[11px] text-text-3 tabular-nums">
              <span className="text-text">{pinned.length}</span>/{totalCount} {t("map.pinned")}
            </span>
          </div>
          <FilterChips options={statusOptions} value={statusFilter} onChange={onStatusChange} />
        </div>

        {/* Roster. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-hide">
          {pinned.length === 0 && noGps.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-2 py-8 text-center">
              <MapPin className="h-[22px] w-[22px] text-text-mute" strokeWidth={1.5} />
              <span className="font-mohave text-body-sm text-text-3">{t("map.empty.title")}</span>
              <span className="font-mono text-[11px] text-text-mute">{t("map.empty.hint")}</span>
            </div>
          ) : (
            <>
              {pinned.map((p) => (
                <SiteRow
                  key={p.id}
                  project={p}
                  selected={p.id === selectedProjectId}
                  onClick={() => onLocate(p)}
                  onOpenInMaps={() => onOpenInMaps(p)}
                  locateTitle={t("map.row.locate")}
                  openInMapsTitle={t("map.openInGoogleMaps")}
                />
              ))}

              {noGps.length > 0 && (
                <div className="my-2.5 flex items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-border-subtle" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-mute">
                    {t("map.noGps")} · {noGps.length}
                  </span>
                  <span className="h-px flex-1 bg-border-subtle" />
                </div>
              )}
              {noGps.map((p) => (
                <NoGpsRow
                  key={p.id}
                  project={p}
                  onClick={() => onOpen(p)}
                  hint={t("map.row.addAddress")}
                />
              ))}
            </>
          )}
        </div>

        {/* Footer — live + total. */}
        <div className="flex items-center justify-between border-t border-border-subtle px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
            <span className="h-[5px] w-[5px] rounded-full bg-[#6B8F71]" />
            {t("map.live")}
          </span>
          <span className="font-mono text-[11px] text-text-mute tabular-nums">
            {totalCount} {t("map.total")}
          </span>
        </div>
      </div>

      {/* Collapse toggle — left-edge tab, matches the old /map muscle memory. */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("map.showSites") : t("map.hideSites")}
        className={cn(
          "glass-dense absolute top-3 z-[11] flex h-8 w-[22px] items-center justify-center rounded-r-[5px] border border-border text-text-3",
          "transition-[left,color] duration-[250ms] ease-smooth hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
          collapsed ? "left-0" : "left-[236px]",
        )}
      >
        {collapsed ? <ChevronRight className="h-[16px] w-[16px]" /> : <ChevronLeft className="h-[16px] w-[16px]" />}
      </button>
    </>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

function SiteRow({
  project,
  selected,
  onClick,
  onOpenInMaps,
  locateTitle,
  openInMapsTitle,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
  onOpenInMaps: () => void;
  locateTitle: string;
  openInMapsTitle: string;
}) {
  const color = PROJECT_STATUS_COLORS[project.status];
  return (
    <button
      type="button"
      onClick={onClick}
      title={locateTitle}
      className={cn(
        "group flex w-full items-start gap-2 rounded-[6px] border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-smooth",
        "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
        selected && "border-[rgba(255,255,255,0.18)] bg-surface-active",
      )}
    >
      <span
        className="mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 5px ${color}` }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mohave text-body-sm text-text">{project.title}</span>
        <span className="block truncate font-mono text-[11px] text-text-3">{project.address}</span>
      </span>
      <span className="mt-[2px] flex shrink-0 items-center gap-1">
        <span
          role="button"
          tabIndex={0}
          aria-label={openInMapsTitle}
          title={openInMapsTitle}
          onClick={(e) => { e.stopPropagation(); onOpenInMaps(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onOpenInMaps(); } }}
          className="text-text-mute opacity-0 transition-opacity duration-150 ease-smooth hover:text-text group-hover:opacity-100"
        >
          <ExternalLink className="h-[12px] w-[12px]" strokeWidth={1.5} />
        </span>
        <Crosshair className="h-[13px] w-[13px] text-text-mute" strokeWidth={1.5} aria-hidden="true" />
      </span>
    </button>
  );
}

function NoGpsRow({ project, onClick, hint }: { project: Project; onClick: () => void; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-[6px] border border-transparent px-2 py-1.5 text-left transition-colors duration-150 ease-smooth hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
    >
      <span className="mt-[3px] h-[8px] w-[8px] shrink-0 rounded-full border border-dashed border-text-mute" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mohave text-body-sm text-text-2">{project.title}</span>
        <span className="block truncate font-mono text-[11px] text-text-mute">{hint}</span>
      </span>
      <Plus className="mt-[2px] h-[13px] w-[13px] shrink-0 text-text-mute" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
