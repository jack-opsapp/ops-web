"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Pencil,
  Archive,
  Trash2,
  ArrowRight,
  UserPlus,
  Trophy,
  XCircle,
  ArrowDownWideNarrow,
  ArrowDownAZ,
  Calendar,
  Clock,
  LayoutGrid,
  CheckSquare,
} from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  OpportunityStage,
  getActiveStages,
  getStageDisplayName,
  OPPORTUNITY_STAGE_COLORS,
} from "@/lib/types/pipeline";
import { useSpatialCanvasStore, type ContextMenuState } from "./spatial-canvas-store";
import {
  spatialContextMenuVariants,
  spatialContextMenuVariantsReduced,
} from "@/lib/utils/motion";

// ── Types ──

interface SpatialContextMenuProps {
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onArchiveBatch: (ids: string[]) => void;
  onDelete: (id: string) => void;
  onMoveToStage: (ids: string[], stage: OpportunityStage) => void;
  onAssign: (ids: string[]) => void;
  onMarkWon: (ids: string[]) => void;
  onMarkLost: (ids: string[]) => void;
  onSelectAll: () => void;
  teamMembers?: { id: string; name: string }[];
}

// ── Component ──

export function SpatialContextMenu({
  onEdit,
  onArchive,
  onArchiveBatch,
  onDelete,
  onMoveToStage,
  onAssign,
  onMarkWon,
  onMarkLost,
  onSelectAll,
}: SpatialContextMenuProps) {
  const { t } = useDictionary("pipeline");
  const reduced = useReducedMotion();
  const variants = reduced
    ? spatialContextMenuVariantsReduced
    : spatialContextMenuVariants;

  const contextMenu = useSpatialCanvasStore((s) => s.contextMenu);
  const hideContextMenu = useSpatialCanvasStore((s) => s.hideContextMenu);
  const selectedCardIds = useSpatialCanvasStore((s) => s.selectedCardIds);
  const setSortBy = useSpatialCanvasStore((s) => s.setSortBy);
  const resetLayout = useSpatialCanvasStore((s) => s.resetLayout);

  const menuRef = useRef<HTMLDivElement>(null);
  const [showStageSubmenu, setShowStageSubmenu] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // Reset delete confirmation when menu closes
  useEffect(() => {
    if (!contextMenu) {
      setConfirmingDelete(null);
    }
  }, [contextMenu]);

  // Dismiss on Escape, click outside, or scroll/zoom
  // Use requestAnimationFrame to prevent the opening right-click from immediately closing the menu
  useEffect(() => {
    if (!contextMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hideContextMenu();
      }
    };

    const handleWheel = () => hideContextMenu();

    const frame = requestAnimationFrame(() => {
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("wheel", handleWheel, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("wheel", handleWheel);
    };
  }, [contextMenu, hideContextMenu]);

  const handleItemClick = useCallback(
    (action: () => void) => {
      action();
      hideContextMenu();
    },
    [hideContextMenu]
  );

  const activeStages = getActiveStages();

  // Clamp menu position to viewport
  const menuWidth = contextMenu?.type === "selection" ? 220 : 180;
  const menuHeight = 300;
  const clampedX = contextMenu
    ? Math.min(contextMenu.x, window.innerWidth - menuWidth - 8)
    : 0;
  const clampedY = contextMenu
    ? Math.min(contextMenu.y, window.innerHeight - menuHeight - 8)
    : 0;

  return (
    <AnimatePresence>
      {contextMenu && (
        <motion.div
          ref={menuRef}
          className="fixed"
          style={{
            left: clampedX,
            top: clampedY,
            zIndex: 1000,
          }}
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
        >
          <div
            className="rounded-[4px] overflow-hidden"
            style={{
              background: "rgba(10, 10, 10, 0.70)",
              backdropFilter: "blur(20px) saturate(1.2)",
              WebkitBackdropFilter: "blur(20px) saturate(1.2)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              width: contextMenu.type === "selection" ? 220 : 180,
            }}
          >
            {/* ── Card context menu ── */}
            {contextMenu.type === "card" && contextMenu.targetCardId && (
              <>
                <MenuItem
                  icon={<Pencil className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.edit")}
                  onClick={() =>
                    handleItemClick(() =>
                      onEdit(contextMenu.targetCardId!)
                    )
                  }
                />
                <MenuItem
                  icon={<Archive className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.archive")}
                  onClick={() =>
                    handleItemClick(() =>
                      onArchive(contextMenu.targetCardId!)
                    )
                  }
                />
                {confirmingDelete === contextMenu.targetCardId ? (
                  <div className="px-3 py-1.5">
                    <p className="font-mohave text-body-sm text-ops-error mb-1">
                      {t("contextMenu.deleteConfirm")}
                    </p>
                    <div className="flex gap-1">
                      <button
                        className="font-kosugi text-micro-sm text-text-primary px-2 py-0.5 rounded-[2px] bg-[#93321A] cursor-pointer"
                        onClick={() =>
                          handleItemClick(() =>
                            onDelete(contextMenu.targetCardId!)
                          )
                        }
                      >
                        {t("spatial.confirm")}
                      </button>
                      <button
                        className="font-kosugi text-micro-sm text-text-tertiary px-2 py-0.5 cursor-pointer"
                        onClick={() => setConfirmingDelete(null)}
                      >
                        {t("spatial.cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <MenuItem
                    icon={<Trash2 className="w-[14px] h-[14px]" />}
                    label={t("contextMenu.delete")}
                    onClick={() =>
                      setConfirmingDelete(contextMenu.targetCardId!)
                    }
                    destructive
                  />
                )}
              </>
            )}

            {/* ── Selection context menu ── */}
            {contextMenu.type === "selection" && (
              <>
                <div
                  className="relative"
                  onMouseEnter={() => setShowStageSubmenu(true)}
                  onMouseLeave={() => setShowStageSubmenu(false)}
                >
                  <MenuItem
                    icon={<ArrowRight className="w-[14px] h-[14px]" />}
                    label={t("contextMenu.moveToStage")}
                    hasSubmenu
                  />
                  {showStageSubmenu && (
                    <div
                      className="absolute left-full top-0 ml-1 rounded-[4px] overflow-hidden"
                      style={{
                        background: "rgba(10, 10, 10, 0.70)",
                        backdropFilter: "blur(20px) saturate(1.2)",
                        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        width: 180,
                      }}
                    >
                      {activeStages.map((stage) => (
                        <MenuItem
                          key={stage}
                          icon={
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{
                                background: OPPORTUNITY_STAGE_COLORS[stage],
                              }}
                            />
                          }
                          label={getStageDisplayName(stage)}
                          onClick={() =>
                            handleItemClick(() =>
                              onMoveToStage(
                                Array.from(selectedCardIds),
                                stage
                              )
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                <MenuItem
                  icon={<UserPlus className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.assignTo")}
                  onClick={() =>
                    handleItemClick(() =>
                      onAssign(Array.from(selectedCardIds))
                    )
                  }
                />
                <MenuItem
                  icon={<Archive className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.archive")}
                  onClick={() =>
                    handleItemClick(() =>
                      onArchiveBatch(Array.from(selectedCardIds))
                    )
                  }
                />
                <MenuItem
                  icon={<Trophy className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.markWon")}
                  onClick={() =>
                    handleItemClick(() =>
                      onMarkWon(Array.from(selectedCardIds))
                    )
                  }
                />
                <MenuItem
                  icon={<XCircle className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.markLost")}
                  onClick={() =>
                    handleItemClick(() =>
                      onMarkLost(Array.from(selectedCardIds))
                    )
                  }
                />
              </>
            )}

            {/* ── Canvas context menu ── */}
            {contextMenu.type === "canvas" && (
              <>
                <MenuItem
                  icon={<ArrowDownWideNarrow className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.sortByValue")}
                  onClick={() => handleItemClick(() => setSortBy("value"))}
                />
                <MenuItem
                  icon={<ArrowDownAZ className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.sortByName")}
                  onClick={() => handleItemClick(() => setSortBy("name"))}
                />
                <MenuItem
                  icon={<Calendar className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.sortByDate")}
                  onClick={() => handleItemClick(() => setSortBy("date"))}
                />
                <MenuItem
                  icon={<Clock className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.sortByDays")}
                  onClick={() =>
                    handleItemClick(() => setSortBy("days_in_stage"))
                  }
                />
                <Divider />
                <MenuItem
                  icon={<LayoutGrid className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.organizeByStage")}
                  onClick={() => handleItemClick(resetLayout)}
                />
                <MenuItem
                  icon={<CheckSquare className="w-[14px] h-[14px]" />}
                  label={t("contextMenu.selectAll")}
                  onClick={() => handleItemClick(onSelectAll)}
                />
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Sub-components ──

function MenuItem({
  icon,
  label,
  onClick,
  hasSubmenu,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  hasSubmenu?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      className="w-full flex items-center gap-2 px-3 h-8 hover:bg-[rgba(255,255,255,0.06)] transition-colors cursor-pointer"
      onClick={onClick}
    >
      <span className={destructive ? "text-ops-error" : "text-text-tertiary"}>
        {icon}
      </span>
      <span
        className={`font-mohave text-body-sm flex-1 text-left ${
          destructive ? "text-ops-error" : "text-text-primary"
        }`}
      >
        {label}
      </span>
      {hasSubmenu && (
        <ArrowRight className="w-3 h-3 text-text-tertiary" />
      )}
    </button>
  );
}

function Divider() {
  return (
    <div className="my-1 border-t border-[rgba(255,255,255,0.06)]" />
  );
}
