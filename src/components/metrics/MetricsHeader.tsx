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
  actions?: React.ReactNode;
  className?: string;
}

interface MetricsHeaderCompactProps {
  variant: "compact";
  tabId: string;
  title: string;
  metrics: InlineMetricConfig[];
  actions?: React.ReactNode;
  className?: string;
}

export type MetricsHeaderProps = MetricsHeaderFullProps | MetricsHeaderCompactProps;

export function MetricsHeader(props: MetricsHeaderProps) {
  if (props.variant === "full") return <FullMetricsHeader {...props} />;
  return <CompactMetricsHeader {...props} />;
}

function FullMetricsHeader({ title, metrics, actions, className }: MetricsHeaderFullProps) {
  return (
    <div
      className={cn("border-b border-white/[0.08]", className)}
      style={{ padding: "16px 24px 12px" }}
    >
      <div className="flex items-center justify-between mb-3.5">
        <span
          className="font-kosugi"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "3px",
            color: "#6B6B6B",
          }}
        >
          {title}
        </span>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>

      <div className="flex gap-7">
        {metrics.map((metric, i) => (
          <div key={metric.label} className="contents">
            <MetricColumn config={metric} />
            {i < metrics.length - 1 && (
              <div
                className="self-stretch"
                style={{ width: 1, background: "rgba(255,255,255,0.05)" }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactMetricsHeader({ tabId, title, metrics, actions, className }: MetricsHeaderCompactProps) {
  const { isVisible, toggle } = useMetricsVisibility(tabId);

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-white/[0.08]",
        className,
      )}
      style={{ padding: "14px 24px" }}
    >
      <div className="flex items-center gap-5">
        <span
          className="font-kosugi"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "3px",
            color: "#6B6B6B",
          }}
        >
          {title}
        </span>

        {isVisible && (
          <>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.06)" }} />
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
