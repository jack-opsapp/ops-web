"use client";

import { useCallback } from "react";
import { motion } from "framer-motion";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDictionary } from "@/i18n/client";
import { DependencyBar } from "./dependency-bar";

export interface TimelineItem {
  id: string;
  name: string;
  color: string;
  overlapPercent: number;
}

interface DependencyTimelineStepProps {
  items: TimelineItem[];
  onItemsChange: (items: TimelineItem[]) => void;
  onDone: () => void;
}

export function DependencyTimelineStep({
  items,
  onItemsChange,
  onDone,
}: DependencyTimelineStepProps) {
  const { t } = useDictionary("settings");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      onItemsChange(arrayMove(items, oldIndex, newIndex));
    },
    [items, onItemsChange]
  );

  const handleOverlapChange = useCallback(
    (id: string, percent: number) => {
      onItemsChange(
        items.map((item) =>
          item.id === id ? { ...item, overlapPercent: percent } : item
        )
      );
    },
    [items, onItemsChange]
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col px-4"
    >
      <h2 className="font-mohave text-[28px] font-bold text-text-primary tracking-tight uppercase mb-[4px]">
        {t("wizard.timeline.headline")}
      </h2>
      <p className="font-kosugi text-[11px] text-text-disabled mb-[20px]">
        {t("wizard.timeline.subtitle")}
      </p>

      {/* Timeline bars */}
      <div className="mb-[24px]">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item, index) => (
              <DependencyBar
                key={item.id}
                id={item.id}
                name={item.name}
                color={item.color}
                overlapPercent={item.overlapPercent}
                onOverlapChange={(p) => handleOverlapChange(item.id, p)}
                isLast={index === items.length - 1}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Done button */}
      <button
        type="button"
        onClick={onDone}
        className="self-end px-[20px] py-[10px] rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(89,119,148,0.12)] hover:bg-[rgba(89,119,148,0.2)] text-text-primary font-mohave text-body-sm transition-colors"
      >
        {t("wizard.timeline.done")}
      </button>
    </motion.div>
  );
}
