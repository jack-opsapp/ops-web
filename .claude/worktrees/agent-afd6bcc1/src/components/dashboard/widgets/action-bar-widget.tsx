"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDictionary } from "@/i18n/client";

interface AlertsWidgetProps {
  activeProjectCount: number;
  weekEventCount: number;
  teamMemberCount: number;
  isDataLoading: boolean;
  onNavigate: (path: string) => void;
}

export function AlertsWidget({
  activeProjectCount,
  weekEventCount,
  teamMemberCount,
  isDataLoading,
  onNavigate,
}: AlertsWidgetProps) {
  const { t } = useDictionary("dashboard");
  return (
    <Card variant="accent" className="h-full flex flex-col">
      <CardContent className="p-2 flex-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="w-[20px] h-[20px] text-text-secondary shrink-0" />
            <div>
              <p className="font-mohave text-body text-text-primary">{t("alerts.title")}</p>
              <p className="font-kosugi text-[11px] text-text-tertiary">
                {isDataLoading
                  ? t("alerts.loadingData")
                  : t("alerts.summary").replace("{activeProjectCount}", String(activeProjectCount)).replace("{weekEventCount}", String(weekEventCount)).replace("{teamMemberCount}", String(teamMemberCount))}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-[4px]"
            onClick={() => onNavigate("/projects")}
          >
            {t("alerts.viewAll")}
            <ArrowRight className="w-[14px] h-[14px]" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
