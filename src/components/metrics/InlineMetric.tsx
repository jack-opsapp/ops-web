import type { InlineMetricConfig } from "./types";

interface InlineMetricProps {
  config: InlineMetricConfig;
}

export function InlineMetric({ config }: InlineMetricProps) {
  const { value, label, color } = config;

  return (
    <div className="flex items-baseline gap-1">
      <span
        className="font-mono"
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: color ?? "#E5E5E5",
        }}
      >
        {value}
      </span>
      <span
        className="font-kosugi"
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "#6B6B6B",
        }}
      >
        {label}
      </span>
    </div>
  );
}
