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

  const triggerButton = (
    <button
      onClick={!isMulti ? (props as SingleAction).onAction : undefined}
      className="w-[20px] h-[20px] flex items-center justify-center rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors text-text-disabled hover:text-text-secondary"
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
                onClick={action.onAction}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-[rgba(255,255,255,0.04)] transition-colors rounded-sm text-left"
              >
                <ActionIcon className="w-[14px] h-[14px] text-text-tertiary shrink-0" />
                <span className="font-kosugi text-micro-sm text-text-secondary">
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
