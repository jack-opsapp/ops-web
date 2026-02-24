"use client";

import { motion } from "framer-motion";
import { useDraggable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  UserCheck,
  ClipboardCheck,
  ListTodo,
  GitBranch,
  TrendingUp,
  Activity,
  AlertTriangle,
  FileText,
  Calculator,
  Target,
  CreditCard,
  Receipt,
  Clock,
  MapPin,
  List,
  BarChart3,
  Gauge,
  PieChart,
  Contact,
  MessageSquare,
  AlertCircle,
  Bell,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  WIDGET_TYPE_REGISTRY,
  CATEGORY_LABELS,
  type WidgetTypeId,
} from "@/lib/types/dashboard-widgets";
import { trayCardVariants } from "@/lib/utils/motion";

const ICON_MAP: Record<string, LucideIcon> = {
  FolderKanban,
  CalendarDays,
  Users,
  DollarSign,
  UserCheck,
  ClipboardCheck,
  ListTodo,
  GitBranch,
  TrendingUp,
  Activity,
  AlertTriangle,
  FileText,
  Calculator,
  Target,
  CreditCard,
  Receipt,
  Clock,
  MapPin,
  List,
  BarChart3,
  Gauge,
  PieChart,
  Contact,
  MessageSquare,
  AlertCircle,
  Bell,
  Filter,
};

interface WidgetTrayCardProps {
  typeId: WidgetTypeId;
  index: number;
  instanceCount: number;
}

export function WidgetTrayCard({ typeId, index, instanceCount }: WidgetTrayCardProps) {
  const addWidgetInstance = usePreferencesStore((s) => s.addWidgetInstance);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tray__${typeId}`,
    data: { type: "tray-widget", typeId },
  });

  const entry = WIDGET_TYPE_REGISTRY[typeId];
  if (!entry) return null;

  const Icon = ICON_MAP[entry.icon] ?? Activity;
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
        "w-[160px] h-[120px] shrink-0 snap-start rounded-lg border p-[10px] flex flex-col justify-between",
        "cursor-grab active:cursor-grabbing select-none transition-colors duration-150",
        isAdded
          ? "border-ops-accent/30 bg-ops-accent/5"
          : "border-border bg-[rgba(255,255,255,0.03)] hover:border-border-medium hover:bg-[rgba(255,255,255,0.05)]",
        isDragging && "opacity-40 scale-95"
      )}
    >
      {/* Top: Icon + category badge */}
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "w-[28px] h-[28px] rounded-md flex items-center justify-center",
            isAdded ? "bg-ops-accent/15" : "bg-[rgba(255,255,255,0.06)]"
          )}
        >
          <Icon
            className={cn(
              "w-[14px] h-[14px]",
              isAdded ? "text-ops-accent" : "text-text-secondary"
            )}
          />
        </div>
        <span className="font-mono text-[9px] text-text-disabled uppercase tracking-wider">
          {CATEGORY_LABELS[entry.category]}
        </span>
      </div>

      {/* Middle: Label + description */}
      <div className="flex-1 flex flex-col justify-center min-h-0 mt-[6px]">
        <p className="font-mohave text-[13px] text-text-primary leading-tight truncate">
          {entry.label}
        </p>
        <p className="font-mono text-[9px] text-text-disabled leading-tight mt-[2px] truncate-2">
          {entry.description}
        </p>
      </div>

      {/* Bottom: Add button or Added indicator */}
      <div className="flex items-center justify-between mt-[4px]">
        {isAdded ? (
          <div className="flex items-center gap-[4px]">
            <span className="font-mono text-[9px] text-ops-accent">Added</span>
            {entry.allowMultiple && instanceCount > 1 && (
              <span className="font-mono text-[9px] px-[4px] py-[1px] rounded bg-ops-accent/15 text-ops-accent">
                {instanceCount}x
              </span>
            )}
          </div>
        ) : (
          <span className="font-mono text-[9px] text-text-disabled">Drag or tap +</span>
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
              "w-[22px] h-[22px] rounded-md flex items-center justify-center border transition-all duration-150",
              isAdded
                ? "bg-transparent text-ops-accent border-ops-accent/30 hover:bg-ops-accent/10"
                : "bg-ops-accent/10 text-ops-accent border-ops-accent/20 hover:bg-ops-accent/20"
            )}
            title={`Add ${entry.label}`}
          >
            <Plus className="w-[11px] h-[11px]" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
