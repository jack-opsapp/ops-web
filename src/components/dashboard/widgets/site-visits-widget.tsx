"use client";

import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SiteVisitsWidgetProps {
  size: WidgetSize;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Component (placeholder — site visits not tracked on dashboard yet)
// ---------------------------------------------------------------------------

export function SiteVisitsWidget({ size, config }: SiteVisitsWidgetProps) {
  const filter = (config.filter as string) ?? "upcoming";

  const filterLabel = filter === "recent" ? "Recent" : "Upcoming";

  // ── SM: Placeholder count ─────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">Site Visits</CardTitle>
            <span className="font-mono text-[11px] text-text-disabled">
              {filterLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
          <p className="font-mohave text-body-sm text-text-disabled">
            No {filter === "recent" ? "recent" : "upcoming"} visits
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── MD: Placeholder message ───────────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Site Visits</CardTitle>
          <span className="font-mono text-[11px] text-text-disabled">
            {filterLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-hidden min-h-0">
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <MapPin className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            Site visit tracking coming soon
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
