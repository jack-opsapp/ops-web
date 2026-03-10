"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
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
    railExpanded,
    setView,
    toggleCrew,
    toggleRail,
  } = useMapFilterStore();
  const map = useMapInstanceStore((s) => s.map);
  const can = usePermissionStore((s) => s.can);

  if (pathname !== "/dashboard") return null;

  const showCrewToggle = can("team.view");

  function handleZoomIn() {
    map?.zoomIn();
  }

  function handleZoomOut() {
    map?.zoomOut();
  }

  return (
    <motion.div
      layout
      className={cn(
        "fixed right-3 top-1/2 -translate-y-1/2 z-[5] flex flex-col gap-1 py-2 px-1",
        "rounded-md border border-[rgba(255,255,255,0.08)]",
        "bg-[rgba(10,10,10,0.7)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)]",
        // On narrow screens, collapse to icon-only regardless of railExpanded
        "max-w-[calc(100vw-24px)]"
      )}
      style={{ width: railExpanded ? 140 : 44 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* View filters (radio) */}
      {VIEW_FILTERS.map((f) => {
        const isActive = view === f.value;
        const Icon = f.icon;
        return (
          <button
            key={f.id}
            onClick={() => setView(f.value)}
            className={cn(
              "relative flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150",
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
            <Icon className="w-[18px] h-[18px] shrink-0 relative z-[1]" />
            <AnimatePresence>
              {railExpanded && (
                <motion.span
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  className="font-kosugi text-[10px] tracking-wider whitespace-nowrap overflow-hidden relative z-[1]"
                >
                  {f.label}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        );
      })}

      {/* Divider before crew toggle */}
      {showCrewToggle && (
        <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />
      )}

      {/* Crew layer toggle */}
      {showCrewToggle && (
        <button
          onClick={toggleCrew}
          className={cn(
            "flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-150",
            showCrew
              ? "text-text-primary"
              : "text-text-disabled hover:text-text-tertiary"
          )}
          title="CREW"
        >
          <Users className="w-[18px] h-[18px] shrink-0" />
          <AnimatePresence>
            {railExpanded && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="font-kosugi text-[10px] tracking-wider whitespace-nowrap overflow-hidden"
              >
                CREW
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      )}

      {/* Divider before zoom */}
      <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />

      {/* Zoom controls */}
      <div className="flex flex-col gap-0.5">
        <button
          onClick={handleZoomIn}
          className="flex items-center justify-center rounded px-2 py-1.5 text-text-tertiary hover:text-text-primary transition-colors duration-150"
          title="Zoom in"
        >
          <Plus className="w-[18px] h-[18px] shrink-0" />
        </button>
        <button
          onClick={handleZoomOut}
          className="flex items-center justify-center rounded px-2 py-1.5 text-text-tertiary hover:text-text-primary transition-colors duration-150"
          title="Zoom out"
        >
          <Minus className="w-[18px] h-[18px] shrink-0" />
        </button>
      </div>

      {/* Divider before expand toggle */}
      <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />

      {/* Expand/collapse toggle — at bottom */}
      <button
        onClick={toggleRail}
        className="flex items-center justify-center w-full py-1 text-text-disabled hover:text-text-tertiary transition-colors duration-150"
        title={railExpanded ? "Collapse" : "Expand"}
      >
        <motion.div
          animate={{ rotate: railExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-4 h-4 flex items-center justify-center"
        >
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1L5 5L9 1" />
          </svg>
        </motion.div>
      </button>
    </motion.div>
  );
}
