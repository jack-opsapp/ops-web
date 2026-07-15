"use client";

import type { MetricColumnConfig, InlineMetricConfig } from "./types";
import { InlineMetric } from "./InlineMetric";
import { MetricsToggle } from "./MetricsToggle";
import { useMetricsVisibility } from "./hooks/useMetricsVisibility";
import { cn } from "@/lib/utils/cn";

// The `full` tier (MetricColumn + its flip) was the pre-unification metric bar.
// It is retired — every table surface now renders the unified MetricsStrip
// (`@/components/ui/metrics-strip`), which owns the click-to-flip formula
// reveal. Only the compact inline header survives here (Projects/Schedule/Map).
interface MetricsHeaderCompactProps {
  variant: "compact";
  tabId: string;
  title: string;
  metrics: InlineMetricConfig[] | MetricColumnConfig[];
  isLoading?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export type MetricsHeaderProps = MetricsHeaderCompactProps;

export function MetricsHeader(props: MetricsHeaderProps) {
  return <CompactMetricsHeader {...props} />;
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
            className="h-[16px] w-[28px] bg-white/[0.04] rounded-bar animate-pulse"
          />
          {/* Label placeholder — matches 9px uppercase label */}
          <div
            className="h-[9px] w-[36px] bg-white/[0.04] rounded-bar animate-pulse"
          />
        </div>
      ))}
    </>
  );
}

function CompactMetricsHeader({ tabId, title: _title, metrics, isLoading, actions, className }: MetricsHeaderCompactProps) {
  const { isVisible, toggle } = useMetricsVisibility(tabId);
  const showSkeleton = isLoading || metrics.length === 0;

  // Collapsed: just the toggle button, no container
  if (!isVisible) {
    return (
      <div className={cn("mx-3 flex justify-end", className)}>
        <MetricsToggle isVisible={false} onToggle={toggle} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "max-w-full overflow-x-auto overflow-y-hidden border border-white/[0.06] px-4 py-1.5 rounded-chip scrollbar-hide",
        className,
      )}
      style={{
        background: "rgba(10, 10, 10, 0.50)",
        backdropFilter: "blur(16px) saturate(1.2)",
        WebkitBackdropFilter: "blur(16px) saturate(1.2)",
      }}
    >
      <div className="flex min-w-max items-center gap-5">
        {actions && actions}

        {showSkeleton ? (
          <CompactMetricsSkeleton />
        ) : (
          metrics.map((metric) => (
            <div key={metric.label} className="contents">
              <InlineMetric config={metric} />
            </div>
          ))
        )}

        <div className="ml-auto">
          <MetricsToggle isVisible={true} onToggle={toggle} />
        </div>
      </div>
    </div>
  );
}
