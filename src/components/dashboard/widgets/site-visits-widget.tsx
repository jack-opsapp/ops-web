"use client";

import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
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

  // ── SM: Hero + title + status ───────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="h-full p-0">
        <div className="h-full flex flex-col p-3">
          <span className="font-mono text-data-lg font-bold leading-none text-text-disabled">
            0
          </span>
          <span className="font-kosugi text-micro text-text-tertiary uppercase tracking-wider mt-1">
            {t("siteVisits.title")}
          </span>
          <span className="font-kosugi text-micro-sm text-text-disabled uppercase mt-0.5">
            {filter === "recent" ? t("siteVisits.noRecent") : t("siteVisits.noUpcoming")}
          </span>
        </div>
      </Card>
    );
  }

  // ── MD: Placeholder message ───────────────────────────────────────────
  return (
    <Card className="h-full p-0">
      <div className="h-full flex flex-col p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-kosugi text-micro uppercase tracking-wider text-text-tertiary">{t("siteVisits.title")}</span>
          <span className="font-mono text-micro text-text-tertiary">
            {filterLabel}
          </span>
        </div>
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <MapPin className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            {t("siteVisits.comingSoon")}
          </p>
        </div>
      </div>
    </Card>
  );
}
