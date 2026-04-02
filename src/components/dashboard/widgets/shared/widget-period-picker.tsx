"use client";

import { CalendarDays } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { isCompact } from "@/lib/widget-tokens";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

interface WidgetPeriodPickerProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  size: WidgetSize;
}

export function WidgetPeriodPicker({
  options,
  value,
  onChange,
  size,
}: WidgetPeriodPickerProps) {
  // SM: icon button → popover dropdown
  if (isCompact(size)) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button className="p-0.5 rounded-sm hover:bg-[rgba(255,255,255,0.08)] transition-colors">
            <CalendarDays className="w-[14px] h-[14px] text-text-disabled" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-1 min-w-[100px]">
          <div className="flex flex-col">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onChange(opt.value)}
                className={cn(
                  "font-kosugi text-micro-sm uppercase tracking-wider px-2 py-1 rounded-sm text-left transition-colors",
                  value === opt.value
                    ? "text-ops-accent bg-ops-accent/15"
                    : "text-text-tertiary hover:text-text-secondary"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // MD+: inline pill group
  return (
    <div className="flex items-center gap-[3px]">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "font-kosugi text-micro-sm uppercase tracking-wider px-1.5 py-[1px] rounded-sm transition-colors",
            value === opt.value
              ? "bg-ops-accent/15 text-ops-accent border border-ops-accent/30"
              : "text-text-tertiary hover:text-text-secondary border border-transparent"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
