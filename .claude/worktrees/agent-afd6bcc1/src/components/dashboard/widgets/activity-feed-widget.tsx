"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDictionary } from "@/i18n/client";

export function ActivityWidget() {
  const { t } = useDictionary("dashboard");
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">{t("activity.title")}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto min-h-0 scrollbar-hide">
        <div className="space-y-[4px]">
          {[
            {
              text: t("activity.comingSoon"),
              time: "--",
              type: "update",
            },
          ].map((activity, i) => (
            <div
              key={i}
              className="flex items-start gap-1 px-1 py-[7px] rounded hover:bg-[rgba(255,255,255,0.04)] cursor-pointer transition-colors"
            >
              <div
                className={cn(
                  "w-[8px] h-[8px] rounded-full shrink-0 mt-[5px]",
                  "bg-[rgba(255,255,255,0.15)]"
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="font-mohave text-body-sm text-text-secondary">
                  {activity.text}
                </p>
                <span className="font-mono text-[10px] text-text-disabled">
                  {activity.time}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
