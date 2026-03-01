"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import { X, Search, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  WIDGET_TYPE_REGISTRY,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type WidgetTypeId,
  type WidgetCategory,
  type WidgetTag,
  type WidgetInstance,
} from "@/lib/types/dashboard-widgets";
import { trayVariants } from "@/lib/utils/motion";
import { WidgetTrayCard } from "./widget-tray-card";

// ── Detent heights ──
const DETENT_PEEK = 160;
const DETENT_HALF = 320;
const DETENT_FULL_VH = 0.6; // 60% of viewport height
const SNAP_VELOCITY_THRESHOLD = 300; // px/s — flick faster than this to snap to next detent

function getDetentFull() {
  return typeof window !== "undefined" ? window.innerHeight * DETENT_FULL_VH : 500;
}

function nearestDetent(height: number): number {
  const full = getDetentFull();
  const detents = [DETENT_PEEK, DETENT_HALF, full];
  let best = detents[0];
  let bestDist = Math.abs(height - best);
  for (const d of detents) {
    const dist = Math.abs(height - d);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

function nextDetentUp(height: number): number {
  const full = getDetentFull();
  if (height < DETENT_HALF - 20) return DETENT_HALF;
  if (height < full - 20) return full;
  return full;
}

function nextDetentDown(height: number): number {
  const full = getDetentFull();
  if (height > full - 20) return DETENT_HALF;
  if (height > DETENT_PEEK + 20) return DETENT_PEEK;
  return DETENT_PEEK;
}

interface WidgetTrayProps {
  open: boolean;
  onClose: () => void;
}

export function WidgetTray({ open, onClose }: WidgetTrayProps) {
  const { t } = useDictionary("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentDetent, setCurrentDetent] = useState(DETENT_HALF);
  const sheetHeight = useMotionValue(DETENT_HALF);
  const dragStartHeight = useRef(DETENT_HALF);

  // Transform: invert y drag delta into height change
  // (dragging up = negative y = increase height)
  const displayHeight = useTransform(sheetHeight, (h) => h);

  const widgetInstances = usePreferencesStore((s) => s.widgetInstances);
  const resetWidgetInstances = usePreferencesStore((s) => s.resetWidgetInstances);

  // Count instances per type
  const instanceCountByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inst of widgetInstances) {
      counts[inst.typeId] = (counts[inst.typeId] || 0) + 1;
    }
    return counts;
  }, [widgetInstances]);

  // Set of in-use type IDs for quick lookup
  const inUseTypeIdSet = useMemo(() => {
    const seen = new Set<WidgetTypeId>();
    for (const inst of widgetInstances) {
      if (inst.visible) seen.add(inst.typeId as WidgetTypeId);
    }
    return seen;
  }, [widgetInstances]);

  // Group widget types by category, split into available vs in-use, filtered by search
  const groupedTypes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const groups: Record<WidgetCategory, { available: WidgetTypeId[]; inUse: WidgetTypeId[] }> =
      {} as Record<WidgetCategory, { available: WidgetTypeId[]; inUse: WidgetTypeId[] }>;

    for (const cat of CATEGORY_ORDER) {
      groups[cat] = { available: [], inUse: [] };
    }

    for (const [id, entry] of Object.entries(WIDGET_TYPE_REGISTRY)) {
      const typeId = id as WidgetTypeId;

      if (query) {
        const matchesLabel = entry.label.toLowerCase().includes(query);
        const matchesDescription = entry.description.toLowerCase().includes(query);
        const matchesTags = entry.tags.some((tag: WidgetTag) => tag.toLowerCase().includes(query));
        const matchesCategory = CATEGORY_LABELS[entry.category].toLowerCase().includes(query);
        if (!matchesLabel && !matchesDescription && !matchesTags && !matchesCategory) continue;
      }

      if (inUseTypeIdSet.has(typeId)) {
        groups[entry.category].inUse.push(typeId);
      } else {
        groups[entry.category].available.push(typeId);
      }
    }

    return groups;
  }, [searchQuery, inUseTypeIdSet]);

  // Categories with at least one widget type (available or in-use)
  const visibleCategories = useMemo(
    () => CATEGORY_ORDER.filter((cat) => groupedTypes[cat].available.length > 0 || groupedTypes[cat].inUse.length > 0),
    [groupedTypes]
  );

  const totalActiveCount = widgetInstances.filter((i: WidgetInstance) => i.visible).length;

  // ── Drag handle logic ──
  const handleDragStart = useCallback(() => {
    dragStartHeight.current = sheetHeight.get();
  }, [sheetHeight]);

  const handleDrag = useCallback(
    (_: unknown, info: PanInfo) => {
      const full = getDetentFull();
      const newHeight = Math.max(DETENT_PEEK, Math.min(full, dragStartHeight.current - info.offset.y));
      sheetHeight.set(newHeight);
    },
    [sheetHeight]
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const full = getDetentFull();
      const current = sheetHeight.get();
      const vy = info.velocity.y;

      let target: number;
      if (Math.abs(vy) > SNAP_VELOCITY_THRESHOLD) {
        // Flick: snap in flick direction
        target = vy < 0 ? nextDetentUp(current) : nextDetentDown(current);
      } else {
        // Slow drag: snap to nearest
        target = nearestDetent(current);
      }

      // If dragged well below peek, close
      if (current < DETENT_PEEK * 0.6 || (vy > SNAP_VELOCITY_THRESHOLD && current <= DETENT_PEEK)) {
        onClose();
        return;
      }

      target = Math.max(DETENT_PEEK, Math.min(full, target));
      setCurrentDetent(target);
      animate(sheetHeight, target, { type: "spring", stiffness: 500, damping: 35, mass: 0.8 });
    },
    [sheetHeight, onClose]
  );

  // Reset detent when tray opens
  const handleAnimationStart = useCallback(() => {
    if (open) {
      sheetHeight.set(DETENT_HALF);
      setCurrentDetent(DETENT_HALF);
    }
  }, [open, sheetHeight]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Bottom gradient (no blocking backdrop — dashboard stays interactive) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-0 left-0 right-0 h-[400px] pointer-events-none z-30"
            style={{ background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.5))" }}
          />

          {/* Bottom sheet */}
          <motion.div
            variants={trayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onAnimationStart={handleAnimationStart}
            className="fixed bottom-0 left-0 right-0 z-40 flex flex-col rounded-t-xl shadow-[0_-8px_32px_rgba(0,0,0,0.6)]"
            style={{
              height: displayHeight,
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Drag handle pill — pan gesture drives detent snapping */}
            <motion.div
              className="flex justify-center pt-[8px] pb-[4px] shrink-0 cursor-grab active:cursor-grabbing touch-none"
              onPanStart={handleDragStart}
              onPan={handleDrag}
              onPanEnd={handleDragEnd}
            >
              <div className="w-[40px] h-[4px] rounded-full bg-[rgba(255,255,255,0.2)]" />
            </motion.div>

            {/* Header row */}
            <div className="flex items-center justify-between px-3 pb-[6px] shrink-0">
              <div className="flex items-center gap-[8px]">
                <h2 className="font-mohave text-body-lg text-text-primary font-medium">
                  {t("tray.title")}
                </h2>
                <span className="font-mono text-[10px] text-text-disabled">
                  {totalActiveCount} {t("tray.active")}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-[4px] rounded-sm text-text-disabled hover:text-text-secondary transition-colors"
              >
                <X className="w-[16px] h-[16px]" />
              </button>
            </div>

            {/* Search input */}
            <div className="px-3 pb-[8px] shrink-0">
              <div className="relative">
                <Search className="absolute left-[8px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-text-disabled" />
                <input
                  type="text"
                  placeholder={t("tray.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-[28px] pr-[8px] py-[6px] rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-text-primary font-mohave text-body-sm placeholder:text-text-placeholder focus:border-[rgba(255,255,255,0.2)] focus:outline-none transition-colors"
                />
              </div>
            </div>

            {/* Scrollable body — category rows with horizontal card scrolls */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-2 scrollbar-hide">
              {visibleCategories.length === 0 ? (
                <p className="font-mohave text-body-sm text-text-disabled py-3 text-center">
                  {t("tray.noResults")}
                </p>
              ) : (
                <div className="space-y-[10px]">
                  {visibleCategories.map((category) => {
                    const { available, inUse } = groupedTypes[category];
                    return (
                      <div key={category}>
                        {/* Category label */}
                        <div className="flex items-center gap-[6px] mb-[6px]">
                          <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-widest">
                            {CATEGORY_LABELS[category]}
                          </span>
                          <span className="font-mono text-[9px] text-text-disabled">
                            {available.length + inUse.length}
                          </span>
                        </div>

                        {/* Available widgets — horizontal scroll */}
                        {available.length > 0 && (
                          <div className="flex gap-[8px] overflow-x-auto px-0 pb-[8px] snap-x snap-mandatory scrollbar-hide">
                            {available.map((typeId, i) => (
                              <WidgetTrayCard
                                key={typeId}
                                typeId={typeId}
                                index={i}
                                instanceCount={instanceCountByType[typeId] || 0}
                              />
                            ))}
                          </div>
                        )}

                        {/* In-use subsection within this category */}
                        {inUse.length > 0 && (
                          <>
                            <div className="flex items-center gap-[6px] mb-[4px] mt-[2px]">
                              <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-widest">
                                {t("tray.alreadyInUse")}
                              </span>
                              <span className="font-mono text-[8px] text-text-disabled">
                                {inUse.length}
                              </span>
                            </div>
                            <div className="flex gap-[8px] overflow-x-auto px-0 pb-[8px] snap-x snap-mandatory scrollbar-hide opacity-60">
                              {inUse.map((typeId, i) => (
                                <WidgetTrayCard
                                  key={`inuse-${typeId}`}
                                  typeId={typeId}
                                  index={i}
                                  instanceCount={instanceCountByType[typeId] || 0}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-3 py-[6px] border-t border-border shrink-0">
              <button
                onClick={resetWidgetInstances}
                className="flex items-center gap-[6px] font-mohave text-body-sm text-text-disabled hover:text-text-secondary transition-colors w-full justify-center py-[4px]"
              >
                <RotateCcw className="w-[12px] h-[12px]" />
                {t("tray.resetToDefaults")}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
