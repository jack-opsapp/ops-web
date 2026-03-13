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
import { useSidebarStore } from "@/stores/sidebar-store";

interface FilterItem {
  id: string;
  icon: React.ElementType;
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
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const sidebarWidth = isCollapsed ? 72 : 256;

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
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "fixed bottom-3 z-[5]",
        "flex items-center gap-0 pointer-events-auto"
      )}
      style={{ left: sidebarWidth + 12 }}
    >
      {/* Folder-style label tab */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 mr-[-1px]",
          "rounded-l-sm border border-[rgba(255,255,255,0.10)]",
          "bg-[rgba(18,18,18,0.85)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)]"
        )}
      >
        <Map className="w-[13px] h-[13px] text-text-disabled" />
        <span className="font-kosugi text-[9px] text-text-disabled tracking-wider uppercase select-none">
          MAP
        </span>
      </div>

      {/* Controls bar */}
      <div
        className={cn(
          "flex items-center gap-1 py-1.5 px-2",
          "rounded-r-sm border border-[rgba(255,255,255,0.08)]",
          "bg-[rgba(10,10,10,0.70)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)_saturate(1.2)]"
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
              "text-text-tertiary hover:text-text-primary",
              isActive && "text-text-primary"
            )}
            title={f.label}
          >
            {isActive && (
              <motion.div
                layoutId="map-filter-active"
                className="absolute inset-0 rounded bg-ops-accent/20"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                }}
              />
            )}
            <Icon className="w-[14px] h-[14px] shrink-0 relative z-[1]" />
            <span className="font-kosugi text-[9px] tracking-wider whitespace-nowrap relative z-[1]">
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
                ? "text-text-primary"
                : "text-text-disabled hover:text-text-tertiary"
            )}
            title="CREW"
          >
            <Users className="w-[14px] h-[14px] shrink-0" />
            <span className="font-kosugi text-[9px] tracking-wider whitespace-nowrap">
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
          className="flex items-center justify-center rounded px-1.5 py-1 text-text-tertiary hover:text-text-primary transition-colors duration-150"
          title="Zoom in"
        >
          <Plus className="w-[14px] h-[14px]" />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex items-center justify-center rounded px-1.5 py-1 text-text-tertiary hover:text-text-primary transition-colors duration-150"
          title="Zoom out"
        >
          <Minus className="w-[14px] h-[14px]" />
        </button>
      </div>
      </div>
    </motion.div>
  );
}
