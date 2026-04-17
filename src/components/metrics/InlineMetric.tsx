import type { InlineMetricConfig } from "./types";

interface InlineMetricProps {
  config: InlineMetricConfig;
}

export function InlineMetric({ config }: InlineMetricProps) {
  const { value, label, color } = config;

  return (
    <div className="flex items-baseline gap-1">
      <span
        className="font-mono text-body font-semibold"
        style={{ color: color ?? "#E5E5E5" }}
      >
        {value}
      </span>
      <span className="font-mono text-micro uppercase tracking-[1px] text-[#6B6B6B]">
        {label}
      </span>
    </div>
  );
}
