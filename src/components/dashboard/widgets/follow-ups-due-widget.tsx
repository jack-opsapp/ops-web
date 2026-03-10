"use client";

import { CalendarCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FollowUpsDueWidgetProps {
  size: WidgetSize;
}

// ---------------------------------------------------------------------------
// Component (placeholder — useFollowUps not available as standalone hook)
// ---------------------------------------------------------------------------

export function FollowUpsDueWidget({ size }: FollowUpsDueWidgetProps) {
  const { t } = useDictionary("dashboard");
  // ── SM: Placeholder count ─────────────────────────────────────────────
  if (size === "sm") {
    return (
      <Card className="p-2 h-full flex flex-col">
        <CardHeader className="pb-1 shrink-0">
          <CardTitle className="text-card-subtitle">{t("followUps.titleShort")}</CardTitle>
        </CardHeader>
        <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
          <div className="flex flex-col gap-0.5">
            <span className="font-mohave text-[24px] leading-none text-text-disabled font-medium">
              0
            </span>
            <span className="font-mono text-[11px] text-text-disabled">
              {t("followUps.due")}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── MD: Placeholder message ───────────────────────────────────────────
  return (
    <Card className="p-2 h-full flex flex-col">
      <CardHeader className="pb-1.5 shrink-0">
        <CardTitle className="text-card-subtitle">{t("followUps.title")}</CardTitle>
      </CardHeader>
      <CardContent className="py-0 flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <CalendarCheck className="w-[20px] h-[20px] text-text-disabled" />
          <p className="font-mohave text-body-sm text-text-disabled text-center">
            {t("followUps.comingSoon")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
