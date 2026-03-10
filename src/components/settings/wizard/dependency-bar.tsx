"use client";

import { useRef, useCallback, useState } from "react";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDictionary } from "@/i18n/client";

interface DependencyBarProps {
  id: string;
  name: string;
  color: string;
  overlapPercent: number;
  onOverlapChange: (percent: number) => void;
  isLast: boolean;
}

export function DependencyBar({
  id,
  name,
  color,
  overlapPercent,
  onOverlapChange,
  isLast,
}: DependencyBarProps) {
  const { t } = useDictionary("settings");
  const barRef = useRef<HTMLDivElement>(null);
  const [isDraggingOverlap, setIsDraggingOverlap] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  // Right-edge drag for overlap
  const handleOverlapPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isLast) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOverlap(true);

      const bar = barRef.current;
      if (!bar) return;

      const barWidth = bar.offsetWidth;
      const startX = e.clientX;
      const startPercent = overlapPercent;

      const onMove = (me: PointerEvent) => {
        const dx = me.clientX - startX;
        const deltaPercent = Math.round((dx / barWidth) * 100);
        const newPercent = Math.max(
          0,
          Math.min(100, startPercent + deltaPercent)
        );
        onOverlapChange(newPercent);
      };

      const onUp = () => {
        setIsDraggingOverlap(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [isLast, overlapPercent, onOverlapChange]
  );

  // Calculate visual width: base width + overlap extension
  const baseWidthPercent = 60;
  const overlapExtension = isLast ? 0 : (overlapPercent / 100) * 30; // up to 30% extra width
  const totalWidth = baseWidthPercent + overlapExtension;

  return (
    <div ref={setNodeRef} style={style} className="relative mb-[2px]">
      <div
        ref={barRef}
        className="relative flex items-center h-[36px] rounded-sm overflow-hidden"
        style={{
          width: `${totalWidth}%`,
          opacity: isDragging ? 0.7 : 1,
        }}
      >
        {/* Main bar */}
        <div
          className="absolute inset-0 rounded-sm"
          style={{ backgroundColor: color, opacity: 0.25 }}
        />
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-sm"
          style={{ backgroundColor: color }}
        />

        {/* Drag handle for reordering */}
        <button
          type="button"
          className="flex items-center px-[6px] h-full cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-[14px] h-[14px] text-text-disabled" />
        </button>

        {/* Task name */}
        <span className="font-mohave text-body-sm text-text-primary truncate flex-1 pr-[8px]">
          {name}
        </span>

        {/* Overlap percentage label */}
        {!isLast && overlapPercent > 0 && (
          <span className="font-mono text-[9px] text-text-disabled pr-[8px] shrink-0">
            {overlapPercent}% {t("wizard.timeline.overlap")}
          </span>
        )}

        {/* Right edge drag handle for overlap */}
        {!isLast && (
          <div
            onPointerDown={handleOverlapPointerDown}
            className="absolute right-0 top-0 bottom-0 w-[10px] cursor-col-resize flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <div
              className="w-[2px] h-[16px] rounded-full transition-colors"
              style={{
                backgroundColor: isDraggingOverlap
                  ? color
                  : "rgba(255,255,255,0.15)",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
