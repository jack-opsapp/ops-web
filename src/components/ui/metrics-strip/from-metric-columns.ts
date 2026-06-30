/**
 * Adapter — the existing `MetricColumnConfig[]` shape (useProjectMetrics /
 * usePipelineMetrics / useMapMetrics / metrics-service) → unified `MetricCell[]`.
 *
 * Lets the table-v2 grids (Projects, Pipeline) feed their current metrics data
 * straight into the shared MetricsStrip with ZERO bespoke mapping per surface —
 * the same data that drove the old MetricsHeader now drives the one strip, so the
 * metric bar reads identically across all five surfaces (WEB OVERHAUL P6-2).
 *
 * Recovers a semantic tone from the config's color hex (the old MetricColumn
 * colored its value directly) and maps the legacy viz vocabulary onto StripViz:
 *   sparkline → sparkline · bars → bars · progress → meter (value/100) ·
 *   dots → (omitted; the value + tone carry the severity in the compact strip).
 */

import { formatMetricCurrency } from "@/components/metrics/format";
import type { MetricColumnConfig } from "@/components/metrics/types";
import type { MetricCell, MetricTone } from "./metrics-strip";
import type { StripVizConfig } from "./strip-viz";

function formatterFor(formatType: MetricColumnConfig["formatType"]): (n: number) => string {
  switch (formatType) {
    case "currency":
      return formatMetricCurrency;
    case "percentage":
      return (n) => `${Math.round(n)}%`;
    case "days":
      return (n) => `${Math.round(n)}d`;
    case "count":
    default:
      return (n) => new Intl.NumberFormat("en-US").format(Math.round(n));
  }
}

/** Recover a semantic tone from the legacy value color (earth-tone hexes). */
function toneFor(color: string | undefined): MetricTone {
  if (!color) return "default";
  const c = color.toUpperCase();
  if (c.includes("B58289") || c.includes("93321A")) return "rose";
  if (c.includes("9DB582") || c.includes("A5B368")) return "olive";
  if (c.includes("C4A868") || c.includes("D4A574")) return "tan";
  return "default";
}

function vizFor(config: MetricColumnConfig): StripVizConfig | undefined {
  const viz = config.viz;
  if (!viz) return undefined;
  switch (viz.type) {
    case "sparkline":
      return { type: "sparkline", data: viz.data, color: viz.color };
    case "bars":
      return { type: "bars", data: viz.data, color: viz.color };
    case "progress":
      // The legacy progress bar read the metric's value (0–100), not viz.data.
      return { type: "meter", pct: Math.max(0, Math.min(1, config.value / 100)), color: viz.color };
    case "dots":
      return undefined;
    default:
      return undefined;
  }
}

export function fromMetricColumns(configs: MetricColumnConfig[]): MetricCell[] {
  return configs.map((c) => ({
    label: c.label,
    value: c.value,
    format: formatterFor(c.formatType),
    tone: toneFor(c.color),
    trend: c.trend,
    viz: vizFor(c),
  }));
}
