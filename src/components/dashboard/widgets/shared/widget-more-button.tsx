"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

interface WidgetMoreButtonProps {
  /** Number of remaining items not shown */
  remaining: number;
  /** Whether the list is currently expanded */
  expanded: boolean;
  /** Toggle callback */
  onToggle: () => void;
  /** Custom label (default: "more" via i18n) */
  label?: string;
  className?: string;
}

export function WidgetMoreButton({
  remaining,
  expanded,
  onToggle,
  label,
  className,
}: WidgetMoreButtonProps) {
  const { t } = useDictionary("dashboard");

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={cn(
        "w-full flex items-center justify-center gap-1 py-1 mt-1 rounded-sm",
        "text-text-mute hover:text-text-3 hover:bg-[rgba(255,255,255,0.04)]",
        "transition-colors cursor-pointer",
        className
      )}
    >
      {expanded ? (
        <>
          <ChevronUp className="w-3 h-3" />
          <span className="font-kosugi text-micro uppercase tracking-wider">
            {t("widgets.showLess") ?? "Show less"}
          </span>
        </>
      ) : (
        <>
          <span className="font-mono text-micro">+{remaining}</span>
          <span className="font-kosugi text-micro uppercase tracking-wider">
            {label ?? t("widgets.more") ?? "more"}
          </span>
          <ChevronDown className="w-3 h-3" />
        </>
      )}
    </button>
  );
}
