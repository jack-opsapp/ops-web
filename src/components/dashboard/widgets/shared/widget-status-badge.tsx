"use client";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { getStatusColor, getStatusLabel } from "./widget-utils";

interface WidgetStatusBadgeProps {
  status: string;
  entity: "invoice" | "estimate" | "opportunity" | "task" | "project";
  className?: string;
}

export function WidgetStatusBadge({
  status,
  entity,
  className,
}: WidgetStatusBadgeProps) {
  const { t } = useDictionary("dashboard");
  const colors = getStatusColor(status, entity);
  const label = getStatusLabel(status, entity, t);

  return (
    <span
      className={cn(
        "font-mono px-1 py-[1px] rounded-sm uppercase tracking-normal border shrink-0 whitespace-nowrap",
        colors.text,
        colors.bg,
        colors.border,
        className
      )}
      style={{ fontSize: "9px", lineHeight: "1.3" }}
    >
      {label}
    </span>
  );
}
