"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Checkbox } from "@/components/ui/checkbox";
import { useSelectionStore } from "@/stores/selection-store";

interface SelectableRowProps {
  /** Unique ID of this row item */
  id: string;
  /** All IDs in the current list (for shift+click range selection) */
  allIds: string[];
  /** Content to render inside the row */
  children: React.ReactNode;
  /** Additional className for the wrapper */
  className?: string;
  /** Called when the row itself is clicked (not the checkbox) */
  onClick?: () => void;
  /** Whether selection mode is active (controls checkbox visibility) */
  selectionActive: boolean;
}

export function SelectableRow({
  id,
  allIds,
  children,
  className,
  onClick,
  selectionActive,
}: SelectableRowProps) {
  const {
    selectedIds,
    toggleSelection,
    selectRange,
    lastSelectedId,
  } = useSelectionStore();

  const isChecked = selectedIds.has(id);

  const handleCheckboxClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      if (e.shiftKey && lastSelectedId) {
        selectRange(allIds, lastSelectedId, id);
      } else {
        toggleSelection(id);
      }
    },
    [id, allIds, lastSelectedId, selectRange, toggleSelection]
  );

  const handleRowClick = React.useCallback(() => {
    if (selectionActive) {
      toggleSelection(id);
    } else {
      onClick?.();
    }
  }, [selectionActive, id, toggleSelection, onClick]);

  return (
    <div
      className={cn(
        "group relative flex items-center transition-all duration-150",
        isChecked && "bg-[rgba(255,255,255,0.04)]",
        className
      )}
      onClick={handleRowClick}
    >
      {/* Checkbox column */}
      <div
        className={cn(
          "flex items-center justify-center shrink-0 transition-all duration-150 overflow-hidden",
          selectionActive
            ? "w-[40px] opacity-100"
            : "w-0 opacity-0"
        )}
      >
        <div onClick={handleCheckboxClick}>
          <Checkbox
            checked={isChecked}
            onCheckedChange={() => {
              /* handled by click on parent div */
            }}
            className="pointer-events-none"
            aria-label={`Select item`}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">{children}</div>

      {/* Selected left indicator — unified pattern (2px text-2 bar) */}
      {isChecked && (
        <div className="absolute left-0 top-[8px] bottom-[8px] w-[2px] bg-text-2 rounded-[1px]" />
      )}
    </div>
  );
}
