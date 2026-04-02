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
        "font-mono text-micro-sm px-1.5 py-[1px] rounded-sm uppercase tracking-wider border shrink-0 whitespace-nowrap",
        colors.text,
        colors.bg,
        colors.border,
        className
      )}
    >
      {label}
    </span>
  );
}
