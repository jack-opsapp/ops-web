"use client";

import { Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NotificationsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component (placeholder)
// ---------------------------------------------------------------------------

export function NotificationsWidget({ size, config }: NotificationsWidgetProps) {
  const { t } = useDictionary("dashboard");
  const sortBy = (config.sortBy as string) ?? "recent";

  const sortLabel =
    sortBy === "priority"
      ? t("notifications.sortPriority")
      : sortBy === "type"
        ? t("notifications.sortType")
        : t("notifications.sortRecent");

  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">{t("notifications.title")}</span>
          <span className="font-mono text-micro text-text-tertiary">
            {sortLabel}
          </span>
        </div>
        <div
          className={`flex flex-col items-center justify-center ${
            size === "lg" ? "py-12" : "py-8"
          } gap-2`}
        >
          <Bell className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            {t("notifications.emptyState")}
          </p>
        </div>
      </div>
    </Card>
  );
}
