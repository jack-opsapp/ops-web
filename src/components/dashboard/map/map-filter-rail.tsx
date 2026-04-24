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

// ── Config ──

interface FilterItem {
  id: string;
  value: MapViewFilter;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const VIEW_FILTERS: FilterItem[] = [
  { id: "today", value: "today", icon: CalendarClock, label: "TODAY" },
  { id: "active", value: "active", icon: FolderKanban, label: "ACTIVE" },
  { id: "all", value: "all", icon: Layers, label: "ALL" },
];

// ── Component ──

export function MapFilterRail() {
  const pathname = usePathname();
  const { view, showCrew, setView, toggleCrew } = useMapFilterStore();
  const map = useMapInstanceStore((s) => s.map);
  const userLocation = useMapInstanceStore((s) => s.userLocation);
  const can = usePermissionStore((s) => s.can);
  const dashboardCustomizing = useDashboardCustomizeStore((s) => s.isCustomizing);

  // Sidebar-fixed offset — matches bug-report-button.tsx (sidebarWidth = 72 + 12px gap)
  const sidebarWidth = 72;

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
        "fixed bottom-3 z-[5]", // content layer per spec v2 z-scale
        "flex items-center gap-[8px] px-[6px] py-[3px]",
        "glass-surface",
        dashboardCustomizing ? "pointer-events-none" : "pointer-events-auto"
      )}
      style={{ left: sidebarWidth + 12 }}
    >
      {/* View filters */}
      {VIEW_FILTERS.map((f) => {
        const Icon = f.icon;
        return (
          <ToolbarAction
            key={f.id}
            onClick={() => setView(f.value)}
            isActive={view === f.value}
            title={f.label}
          >
            <Icon className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              {f.label}
            </span>
          </ToolbarAction>
        );
      })}

      {showCrewToggle && (
        <>
          <div className="w-[1px] h-[18px] bg-border-subtle" />
          <ToolbarAction
            onClick={toggleCrew}
            isActive={showCrew}
            title="CREW"
          >
            <Users className="w-[13px] h-[13px]" />
            <span className="font-mono text-micro uppercase tracking-wider">
              CREW
            </span>
          </ToolbarAction>
        </>
      )}

      <div className="w-[1px] h-[18px] bg-border-subtle" />

      {/* Zoom controls — icon-only ToolbarActions */}
      <ToolbarAction onClick={handleZoomIn} title="Zoom in">
        <Plus className="w-[13px] h-[13px]" />
      </ToolbarAction>
      <ToolbarAction onClick={handleZoomOut} title="Zoom out">
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
        "flex items-center gap-[5px] px-[8px] py-[5px] rounded-sm transition-colors duration-150 cursor-pointer",
        isActive
          ? "text-text bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.18)]"
          : "text-text-3 hover:text-text hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
      )}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
