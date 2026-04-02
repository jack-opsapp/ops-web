"use client";

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
      onClick={onToggle}
      className={cn(
        "font-kosugi text-micro-sm text-text-tertiary cursor-pointer hover:text-text-secondary transition-colors block px-1",
        className
      )}
    >
      {expanded
        ? (t("widgets.showLess") ?? "Show less")
        : `+${remaining} ${label ?? t("widgets.more") ?? "more"}`}
    </button>
  );
}
