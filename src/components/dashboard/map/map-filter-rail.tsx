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
  Map,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useMapFilterStore,
  useMapInstanceStore,
  type MapViewFilter,
} from "@/stores/map-filter-store";
import { usePermissionStore } from "@/lib/store/permissions-store";

import { useDashboardCustomizeStore } from "@/stores/dashboard-customize-store";

interface FilterItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const VIEW_FILTERS: (FilterItem & { value: MapViewFilter })[] = [
  { id: "today", value: "today", icon: CalendarClock, label: "TODAY" },
  { id: "active", value: "active", icon: FolderKanban, label: "ACTIVE" },
  { id: "all", value: "all", icon: Layers, label: "ALL" },
];

export function MapFilterRail() {
  const pathname = usePathname();
  const {
    view,
    showCrew,
    setView,
    toggleCrew,
  } = useMapFilterStore();
  const map = useMapInstanceStore((s) => s.map);
  const userLocation = useMapInstanceStore((s) => s.userLocation);
  const can = usePermissionStore((s) => s.can);
  const sidebarWidth = 72;
  const dashboardCustomizing = useDashboardCustomizeStore((s) => s.isCustomizing);

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
      animate={{ opacity: dashboardCustomizing ? 0 : 1, y: dashboardCustomizing ? 8 : 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed bottom-3 z-[5]",
        "flex flex-col items-start",
        dashboardCustomizing ? "pointer-events-none" : "pointer-events-auto"
      )}
      style={{ left: sidebarWidth + 12 }}
    >
      {/* Manila folder label tab — sits on top of the controls bar */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-[4px] mb-[-1px] ml-[8px]",
          "rounded-t-[10px] border border-b-0 border-[rgba(255,255,255,0.09)]",
          "bg-[rgba(18,18,20,0.78)] backdrop-blur-[28px] [-webkit-backdrop-filter:blur(28px)_saturate(1.3)]"
        )}
      >
        <Map className="w-[12px] h-[12px] text-text-mute" />
        <span className="font-mono text-micro text-text-mute tracking-wider uppercase select-none">
          MAP
        </span>
      </div>

      {/* Controls bar */}
      <div
        className={cn(
          "flex items-center gap-1 py-1.5 px-2",
          "glass-surface"
        )}
      >

      {/* View filters */}
      {VIEW_FILTERS.map((f) => {
        const isActive = view === f.value;
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            onClick={() => setView(f.value)}
            className={cn(
              "relative flex items-center gap-1.5 rounded px-2 py-1 transition-all duration-150",
              "text-text-3 hover:text-text",
              isActive && "text-text"
            )}
            title={f.label}
          >
            {isActive && (
              <motion.div
                layoutId="map-filter-active"
                className="absolute inset-0 rounded bg-[rgba(255,255,255,0.08)]"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
              />
            )}
            <Icon className="w-[14px] h-[14px] shrink-0 relative z-[1]" />
            <span className="font-mono text-micro tracking-wider whitespace-nowrap relative z-[1]">
              {f.label}
            </span>
          </button>
        );
      })}

      {/* Crew toggle */}
      {showCrewToggle && (
        <>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.06)] mx-1" />
          <button
            onClick={toggleCrew}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 transition-all duration-150",
              showCrew
                ? "text-text"
                : "text-text-mute hover:text-text-3"
            )}
            title="CREW"
          >
            <Users className="w-[14px] h-[14px] shrink-0" />
            <span className="font-mono text-micro tracking-wider whitespace-nowrap">
              CREW
            </span>
          </button>
        </>
      )}

      {/* Zoom controls */}
      <div className="w-px h-4 bg-[rgba(255,255,255,0.06)] mx-1" />
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleZoomIn}
          className="flex items-center justify-center rounded px-1.5 py-1 text-text-3 hover:text-text transition-colors duration-150"
          title="Zoom in"
        >
          <Plus className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex items-center justify-center rounded px-1.5 py-1 text-text-3 hover:text-text transition-colors duration-150"
          title="Zoom out"
        >
          <Minus className="w-[14px] h-[14px]" />
        </button>
      </div>
      </div>
    </motion.div>
  );
}
