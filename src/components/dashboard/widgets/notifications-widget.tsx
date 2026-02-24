"use client";

import { Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

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
  const sortBy = (config.sortBy as string) ?? "recent";

  const sortLabel =
    sortBy === "priority"
      ? "Priority"
      : sortBy === "type"
        ? "Type"
        : "Recent";

  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Notifications</CardTitle>
          <span className="font-mono text-[11px] text-text-tertiary">
            {sortLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        <div
          className={`flex flex-col items-center justify-center ${
            size === "lg" ? "py-12" : "py-8"
          } gap-2`}
        >
          <Bell className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            Notifications will appear here
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
