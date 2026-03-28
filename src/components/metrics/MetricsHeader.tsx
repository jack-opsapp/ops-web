"use client";

import type { MetricColumnConfig, InlineMetricConfig } from "./types";
import { MetricColumn } from "./MetricColumn";
import { InlineMetric } from "./InlineMetric";
import { MetricsToggle } from "./MetricsToggle";
import { useMetricsVisibility } from "./hooks/useMetricsVisibility";
import { cn } from "@/lib/utils/cn";

interface MetricsHeaderFullProps {
  variant: "full";
  tabId: string;
  title: string;
  metrics: MetricColumnConfig[];
  isLoading?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

interface MetricsHeaderCompactProps {
  variant: "compact";
  tabId: string;
  title: string;
  metrics: InlineMetricConfig[];
  isLoading?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export type MetricsHeaderProps = MetricsHeaderFullProps | MetricsHeaderCompactProps;

export function MetricsHeader(props: MetricsHeaderProps) {
  if (props.variant === "full") return <FullMetricsHeader {...props} />;
  return <CompactMetricsHeader {...props} />;
}

// ---------------------------------------------------------------------------
// Full-tier skeleton — matches MetricColumn layout (label + value + viz area)
// ---------------------------------------------------------------------------
function FullMetricsSkeleton() {
  return (
    <div className="flex gap-7">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="contents">
          <div className="flex-1 min-w-0">
            {/* Label placeholder — matches 9px uppercase label (h ~11px) */}
            <div
              className="mb-1 h-[11px] w-[52px] bg-white/[0.04] rounded-[2px] animate-pulse"
            />
            {/* Value placeholder — matches 28px font-mono value (h ~28px) */}
            <div className="flex items-baseline gap-1.5">
              <div
                className="h-[28px] w-[72px] bg-white/[0.04] rounded-[2px] animate-pulse"
              />
              {/* Trend placeholder */}
              <div
                className="h-[10px] w-[32px] bg-white/[0.04] rounded-[2px] animate-pulse"
              />
            </div>
            {/* Viz placeholder — matches sparkline/bar area (h ~24px, mt 6px) */}
            <div
              className="mt-1.5 h-[24px] w-full bg-white/[0.04] rounded-[2px] animate-pulse"
            />
          </div>
          {i < 4 && (
            <div className="self-stretch w-px bg-white/[0.05]" />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact-tier skeleton — matches InlineMetric layout (value + label inline)
// ---------------------------------------------------------------------------
function CompactMetricsSkeleton() {
  return (
    <>
      <div className="w-px h-2 bg-white/[0.06]" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-baseline gap-1">
          {/* Value placeholder — matches 16px font-mono value */}
          <div
            className="h-[16px] w-[28px] bg-white/[0.04] rounded-[2px] animate-pulse"
          />
          {/* Label placeholder — matches 9px uppercase label */}
          <div
            className="h-[9px] w-[36px] bg-white/[0.04] rounded-[2px] animate-pulse"
          />
        </div>
      ))}
    </>
  );
}

function FullMetricsHeader({ title, metrics, isLoading, actions, className }: MetricsHeaderFullProps) {
  const showSkeleton = isLoading || metrics.length === 0;

  return (
    <div
      className={cn("border-b border-white/[0.08] px-3 pb-1.5", className)}
    >
      {showSkeleton ? (
        <FullMetricsSkeleton />
      ) : (
        <div className="flex gap-7">
          {metrics.map((metric, i) => (
            <div key={metric.label} className="contents">
              <MetricColumn config={metric} />
              {i < metrics.length - 1 && (
                <div className="self-stretch w-px bg-white/[0.05]" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactMetricsHeader({ tabId, title, metrics, isLoading, actions, className }: MetricsHeaderCompactProps) {
  const { isVisible, toggle } = useMetricsVisibility(tabId);
  const showSkeleton = isLoading || metrics.length === 0;

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-white/[0.08] py-[14px] px-3",
        className,
      )}
    >
      <div className="flex items-center gap-5">
        <span className="font-kosugi text-micro uppercase tracking-[3px] text-[#6B6B6B]">
          {title}
        </span>

        {isVisible && showSkeleton && <CompactMetricsSkeleton />}

        {isVisible && !showSkeleton && (
          <>
            <div className="w-px h-2 bg-white/[0.06]" />
            {metrics.map((metric) => (
              <div key={metric.label} className="contents">
                <InlineMetric config={metric} />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <MetricsToggle isVisible={isVisible} onToggle={toggle} />
        {actions}
      </div>
    </div>
  );
}
