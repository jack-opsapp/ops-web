import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card } from "@/components/ui/card";

export interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: "up" | "down" | "flat";
    value: string;
  };
  icon?: React.ReactNode;
  className?: string;
}

const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  ({ label, value, trend, icon, className }, ref) => {
    const TrendIcon =
      trend?.direction === "up"
        ? TrendingUp
        : trend?.direction === "down"
          ? TrendingDown
          : Minus;

    const trendColor =
      trend?.direction === "up"
        ? "text-status-success"
        : trend?.direction === "down"
          ? "text-ops-error"
          : "text-text-tertiary";

    return (
      <Card
        ref={ref}
        variant="default"
        className={cn("flex flex-col gap-1.5 p-2", className)}
      >
        {/* Header row: label + icon */}
        <div className="flex items-center justify-between">
          <span className="font-kosugi text-caption-sm text-text-tertiary uppercase tracking-widest">
            {label}
          </span>
          {icon && (
            <div className="text-text-disabled" aria-hidden="true">
              {icon}
            </div>
          )}
        </div>

        {/* Value */}
        <div className="font-mono text-data-lg text-text-primary tracking-wider">{value}</div>

        {/* Trend */}
        {trend && (
          <div className={cn("flex items-center gap-0.5", trendColor)}>
            <TrendIcon className="h-[14px] w-[14px]" />
            <span className="font-mono text-caption-sm">{trend.value}</span>
          </div>
        )}
      </Card>
    );
  }
);
MetricCard.displayName = "MetricCard";

export { MetricCard };
