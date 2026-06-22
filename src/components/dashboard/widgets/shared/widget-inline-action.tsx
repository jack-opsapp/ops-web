"use client";

import type { LucideIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ── Types ────────────────────────────────────────────────────────────

interface SingleAction {
  icon: LucideIcon;
  label: string;
  onAction: () => void;
}

interface MultiAction {
  icon: LucideIcon;
  actions: { icon: LucideIcon; label: string; onAction: () => void }[];
}

type WidgetInlineActionProps = SingleAction | MultiAction;

// ── Component ────────────────────────────────────────────────────────

export function WidgetInlineAction(props: WidgetInlineActionProps) {
  const Icon = props.icon;
  const isMulti = "actions" in props;

  const handleSingleClick = !isMulti
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        (props as SingleAction).onAction();
      }
    : (e: React.MouseEvent) => {
        // Multi-action: stop propagation so parent row onClick doesn't fire
        e.stopPropagation();
      };

  const triggerButton = (
    <button
      onClick={handleSingleClick}
      className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-surface-hover transition-colors text-text-mute hover:text-text-2"
      title={!isMulti ? (props as SingleAction).label : undefined}
    >
      <Icon className="w-[14px] h-[14px]" />
    </button>
  );

  if (!isMulti) return triggerButton;

  const { actions } = props as MultiAction;

  return (
    <Popover>
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-1 min-w-[140px]">
        <div className="flex flex-col">
          {actions.map((action, i) => {
            const ActionIcon = action.icon;
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onAction();
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-surface-hover transition-colors rounded-sm text-left"
              >
                <ActionIcon className="w-[14px] h-[14px] text-text-3 shrink-0" />
                <span className="font-mono text-micro text-text-2">
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
