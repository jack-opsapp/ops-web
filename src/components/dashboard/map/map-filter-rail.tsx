"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  CalendarClock,
  FolderKanban,
  Layers,
  Users,
  Plus,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useMapFilterStore,
  useMapInstanceStore,
  type MapViewFilter,
} from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { useDashboardCustomizeStore } from "@/stores/dashboard-customize-store";
import { useDictionary } from "@/i18n/client";

// ── Config ──

interface FilterItem {
  id: string;
  value: MapViewFilter;
  icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  fallback: string;
}

const VIEW_FILTERS: FilterItem[] = [
  { id: "today", value: "today", icon: CalendarClock, labelKey: "mapFilter.today", fallback: "TODAY" },
  { id: "active", value: "active", icon: FolderKanban, labelKey: "mapFilter.active", fallback: "ACTIVE" },
  { id: "all", value: "all", icon: Layers, labelKey: "mapFilter.all", fallback: "ALL" },
];

// ── Component ──

export function MapFilterRail() {
  const { t } = useDictionary("dashboard");
  const pathname = usePathname();
  const { view, showCrew, setView, toggleCrew } = useMapFilterStore();
  const map = useMapInstanceStore((s) => s.map);
  const userLocation = useMapInstanceStore((s) => s.userLocation);
  const can = usePermissionStore((s) => s.can);
  const dashboardCustomizing = useDashboardCustomizeStore((s) => s.isCustomizing);

  // Route-scoped: only render on the dashboard (where the map lives)
  if (pathname !== "/dashboard") return null;

  const showCrewToggle = can("team.view");

  function handleZoomIn() {
    if (!map) return;
    if (userLocation) {
      const nextZoom = Math.min(map.getZoom() + 1, map.getMaxZoom());
      map.setView(userLocation, nextZoom, { animate: true, duration: 0.3 });
    } else {
      map.zoomIn();
    }
  }

  function handleZoomOut() {
    map?.zoomOut();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: dashboardCustomizing ? 0 : 1,
        y: dashboardCustomizing ? 8 : 0,
      }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed bottom-3 left-[84px] max-[640px]:left-3 max-[640px]:right-3 z-[5]", // content layer per spec v2 z-scale
        "flex max-w-[calc(100vw-24px)] items-center gap-[8px] overflow-x-auto px-[6px] py-[3px] scrollbar-hide",
        "glass-surface",
        dashboardCustomizing ? "pointer-events-none" : "pointer-events-auto"
      )}
    >
      {/* View filters */}
      {VIEW_FILTERS.map((f) => {
        const Icon = f.icon;
        const label = t(f.labelKey, f.fallback);
        return (
          <ToolbarAction
            key={f.id}
            onClick={() => setView(f.value)}
            isActive={view === f.value}
            title={label}
          >
            <Icon className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-[0.16em]">
              {label}
            </span>
          </ToolbarAction>
        );
      })}

      {showCrewToggle && (
        <>
          <div className="h-[18px] w-[1px] shrink-0 bg-border-subtle" />
          <ToolbarAction
            onClick={toggleCrew}
            isActive={showCrew}
            title={t("mapFilter.crew", "CREW")}
          >
            <Users className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-[0.16em]">
              {t("mapFilter.crew", "CREW")}
            </span>
          </ToolbarAction>
        </>
      )}

      <div className="h-[18px] w-[1px] shrink-0 bg-border-subtle" />

      {/* Zoom controls — icon-only ToolbarActions */}
      <ToolbarAction onClick={handleZoomIn} title={t("mapFilter.zoomIn", "Zoom in")}>
        <Plus className="w-[13px] h-[13px]" />
      </ToolbarAction>
      <ToolbarAction onClick={handleZoomOut} title={t("mapFilter.zoomOut", "Zoom out")}>
        <Minus className="w-[13px] h-[13px]" />
      </ToolbarAction>
    </motion.div>
  );
}

// ── Sub-component (spec v2 toolbar action — mirrors project-floating-toolbar.tsx:391) ──

function ToolbarAction({
  children,
  onClick,
  isActive,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  title?: string;
}) {
  return (
    <button
      className={cn(
        "flex shrink-0 items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-text bg-surface-hover border border-border-medium"
          : "text-text-3 hover:text-text hover:bg-surface-hover border border-transparent"
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
