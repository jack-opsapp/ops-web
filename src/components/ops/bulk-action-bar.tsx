"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSelectionStore } from "@/stores/selection-store";
import { Button } from "@/components/ui/button";

export interface BulkAction {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  variant?: "default" | "destructive";
  onClick: (selectedIds: string[]) => void;
}

interface BulkActionBarProps {
  actions: BulkAction[];
  entityName?: string;
}

export function BulkActionBar({
  actions,
  entityName = "item",
}: BulkActionBarProps) {
  const { selectedIds, clearSelection, isSelecting } = useSelectionStore();
  const count = selectedIds.size;

  if (!isSelecting || count === 0) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-1.5 px-2 py-1",
        "glass-dense",
        "animate-slide-up"
      )}
    >
      {/* Count badge */}
      <div className="flex items-center gap-[6px] pr-1.5 border-r border-border">
        <div className="w-[24px] h-[24px] rounded-lg bg-[rgba(255,255,255,0.08)] flex items-center justify-center">
          <span className="font-mono text-data-sm text-text">
            {count}
          </span>
        </div>
        <span className="font-mohave text-body-sm text-text-2 whitespace-nowrap">
          {entityName}
          {count !== 1 ? "s" : ""} selected
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-[6px]">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Button
              key={action.id}
              variant={
                action.variant === "destructive" ? "destructive" : "secondary"
              }
              size="sm"
              onClick={() => action.onClick(Array.from(selectedIds))}
              className="gap-[4px]"
            >
              <Icon className="w-[14px] h-[14px]" />
              {action.label}
            </Button>
          );
        })}
      </div>

      {/* Close / clear button */}
      <button
        onClick={clearSelection}
        className="ml-0.5 p-[4px] rounded hover:bg-fill-neutral-dim text-text-mute hover:text-text-3 transition-colors"
        aria-label="Clear selection"
      >
        <X className="w-[14px] h-[14px]" />
      </button>
    </div>
  );
}
