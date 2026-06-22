"use client";

import { motion } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  WIDGET_TYPE_REGISTRY,
  type WidgetTypeId,
} from "@/lib/types/dashboard-widgets";
import { trayCardVariants } from "@/lib/utils/motion";
import { WidgetPreview } from "./widget-preview";

interface WidgetTrayCardProps {
  typeId: WidgetTypeId;
  index: number;
  instanceCount: number;
}

export function WidgetTrayCard({ typeId, index, instanceCount }: WidgetTrayCardProps) {
  const { t } = useDictionary("dashboard");
  const addWidgetInstance = usePreferencesStore((s) => s.addWidgetInstance);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tray__${typeId}`,
    data: { type: "tray-widget", typeId },
  });

  const entry = WIDGET_TYPE_REGISTRY[typeId];
  if (!entry) return null;

  const isAdded = instanceCount > 0;
  const canAddMore = entry.allowMultiple || instanceCount === 0;

  return (
    <motion.div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      variants={trayCardVariants}
      initial="hidden"
      animate="visible"
      custom={index}
      className={cn(
        "shrink-0 snap-start rounded-lg p-[8px] flex flex-col",
        "cursor-grab active:cursor-grabbing select-none transition-colors duration-150",
        isAdded
          ? "opacity-50 saturate-0"
          : "bg-[rgba(255,255,255,0.03)] hover:bg-surface-hover",
        isDragging && "opacity-40 scale-95"
      )}
    >
      {/* Widget preview */}
      <WidgetPreview typeId={typeId} />

      {/* Footer: status + add button */}
      <div className="flex items-center justify-between mt-[4px]">
        {isAdded ? (
          <div className="flex items-center gap-[4px]">
            <span className="font-mono text-micro text-text-mute">{t("tray.card.added")}</span>
            {entry.allowMultiple && instanceCount > 1 && (
              <span className="font-mono text-micro px-[3px] py-[1px] rounded bg-fill-neutral-dim text-text-mute">
                {instanceCount}x
              </span>
            )}
          </div>
        ) : (
          <span className="font-mono text-micro text-text-mute">{t("tray.card.dragHint")}</span>
        )}

        {canAddMore && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              addWidgetInstance(typeId);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "w-[18px] h-[18px] rounded-md flex items-center justify-center border transition-all duration-150",
              isAdded
                ? "bg-transparent text-text-mute border-border/50 hover:bg-fill-neutral-dim"
                : "bg-surface-hover text-text-2 border-border-medium hover:bg-surface-hover hover:text-text"
            )}
            title={`${t("tray.card.addTitle")} ${entry.label}`}
          >
            <Plus className="w-[10px] h-[10px]" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
