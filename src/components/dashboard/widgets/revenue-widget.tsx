"use client";

import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WidgetSize } from "@/lib/types/dashboard-widgets";

interface RevenueWidgetProps {
  size: WidgetSize;
}

const months = [
  { label: "Sep", value: 0, target: 0 },
  { label: "Oct", value: 0, target: 0 },
  { label: "Nov", value: 0, target: 0 },
  { label: "Dec", value: 0, target: 0 },
  { label: "Jan", value: 0, target: 0 },
  { label: "Feb", value: 0, target: 0, isCurrent: true },
];

export function RevenueWidget({ size }: RevenueWidgetProps) {
  const maxValue = 1;

  // sm: just show MTD number
  if (size === "sm") {
    return (
      <Card className="p-2">
        <CardHeader className="pb-1">
          <CardTitle className="text-card-subtitle">Revenue</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <p className="font-mono text-data-lg text-text-disabled">--</p>
          <p className="font-kosugi text-[10px] text-text-tertiary mt-[2px]">MTD Revenue</p>
          <span className="font-kosugi text-[9px] text-text-disabled">Coming Soon</span>
        </CardContent>
      </Card>
    );
  }

  // md: full chart (current default)
  return (
    <Card className="p-2">
      <CardHeader className="pb-1.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-card-subtitle">Revenue</CardTitle>
          <span className="font-kosugi text-[9px] text-text-disabled">Coming Soon</span>
        </div>
      </CardHeader>
      <CardContent className="py-0">
        <div className="flex items-end gap-[6px] h-[120px]">
          {months.map((month, i) => {
            const barHeight = (month.value / maxValue) * 100;

            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-[4px] h-full">
                <div className="flex-1 w-full flex items-end justify-center relative">
                  <div
                    className="w-[70%] rounded-t-sm transition-all duration-700 bg-[rgba(255,255,255,0.06)]"
                    style={{
                      height: barHeight > 0 ? `${barHeight}%` : "2px",
                      animationDelay: `${i * 100}ms`,
                    }}
                  />
                </div>
                <span className="font-mono text-[9px] text-text-disabled">--</span>
                <span
                  className={cn(
                    "font-kosugi text-[9px]",
                    month.isCurrent ? "text-text-secondary font-medium" : "text-text-disabled"
                  )}
                >
                  {month.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
          <div>
            <span className="font-kosugi text-[10px] text-text-tertiary">MTD Revenue</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Monthly Target</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
          <div className="text-right">
            <span className="font-kosugi text-[10px] text-text-tertiary">Progress</span>
            <p className="font-mono text-body text-text-disabled">--</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
