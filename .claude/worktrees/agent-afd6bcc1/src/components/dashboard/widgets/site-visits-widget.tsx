"use client";

import { MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

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
  const { t } = useDictionary("dashboard");
  const filter = (config.filter as string) ?? "upcoming";

  const filterLabel = filter === "recent" ? t("siteVisits.filterRecent") : t("siteVisits.filterUpcoming");

  // ── SM: Placeholder count ─────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-card-subtitle">{t("siteVisits.title")}</CardTitle>
            <span className="font-mono text-[11px] text-text-disabled">
              {filterLabel}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          <p className="font-mohave text-body-sm text-text-disabled">
            {filter === "recent" ? t("siteVisits.noRecent") : t("siteVisits.noUpcoming")}
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
          <CardTitle className="text-card-subtitle">{t("siteVisits.title")}</CardTitle>
          <span className="font-mono text-[11px] text-text-disabled">
            {filterLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <MapPin className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            {t("siteVisits.comingSoon")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
