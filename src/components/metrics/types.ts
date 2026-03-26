export type TrendDirection = "up" | "down" | "flat";
export type TrendSentiment = "positive" | "negative" | "neutral";
export type VizType = "sparkline" | "bars" | "progress" | "dots";
export type FormatType = "currency" | "percentage" | "count" | "days";

export interface MetricTrend {
  direction: TrendDirection;
  value: string;
  sentiment: TrendSentiment;
}

export interface MetricViz {
  type: VizType;
  data: number[];
  color: string;
}

export interface MetricColumnConfig {
  label: string;
  value: number;
  formatType: FormatType;
  trend?: MetricTrend;
  viz?: MetricViz;
  color?: string;
}

export interface InlineMetricConfig {
  value: string | number;
  label: string;
  color?: string;
}
