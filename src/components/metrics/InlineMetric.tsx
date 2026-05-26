import type { InlineMetricConfig } from "./types";
import { formatMetricValue } from "./format";

interface InlineMetricProps {
  config: InlineMetricConfig;
}

export function InlineMetric({ config }: InlineMetricProps) {
  const { value, label, color, formatType } = config;
  const displayValue =
    typeof value === "number" && formatType
      ? formatMetricValue(value, formatType)
      : value;

  return (
    <div className="flex items-baseline gap-1">
      <span
        className="font-mono text-body font-semibold"
        style={{ color: color ?? "#EDEDED" }}
      >
        {displayValue}
      </span>
      <span className="font-mono text-micro uppercase tracking-[1px] text-[#6B6B6B]">
        {label}
      </span>
    </div>
  );
}
