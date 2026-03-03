"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock,
  FolderKanban,
  Layers,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  useMapFilterStore,
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
  const can = usePermissionStore((s) => s.can);

  if (pathname !== "/dashboard") return null;

  const showCrewToggle = can("team.view");

  return (
    <motion.div
      layout
      className={cn(
        "fixed right-3 top-1/2 -translate-y-1/2 z-[5] flex flex-col gap-1 py-2 px-1",
        "rounded-md border border-[rgba(255,255,255,0.08)]",
        "bg-[rgba(10,10,10,0.7)] backdrop-blur-[20px] [-webkit-backdrop-filter:blur(20px)]"
      )}
      style={{ width: railExpanded ? 160 : 44 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Expand/collapse toggle */}
      <button
        onClick={toggleRail}
        className="flex items-center justify-center w-full h-7 text-text-tertiary hover:text-text-primary transition-colors duration-150"
        title={railExpanded ? "Collapse" : "Expand"}
      >
        {railExpanded ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Divider */}
      <div className="h-px bg-[rgba(255,255,255,0.06)] mx-1" />

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
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15 }}
                  className="font-kosugi text-[10px] tracking-wider whitespace-nowrap relative z-[1]"
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
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="font-kosugi text-[10px] tracking-wider whitespace-nowrap"
              >
                CREW
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      )}
    </motion.div>
  );
}
