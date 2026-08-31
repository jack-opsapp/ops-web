import "server-only";

import type { GrowthResponseEnvelope, GrowthOverview } from "./growth-analytics-types";

type CsvCell = string | number | null;

const FORMULA_PREFIX = /^[=+\-@]/;

export function sanitizeGrowthCsvCell(value: CsvCell): string {
  const raw = value === null ? "" : String(value);
  const safe = FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function row(cells: CsvCell[]): string {
  return cells.map(sanitizeGrowthCsvCell).join(",");
}

export function buildGrowthOverviewCsv(
  envelope: GrowthResponseEnvelope<GrowthOverview>
): string {
  const rows: string[] = [
    row(["section", "dimension", "metric", "value", "period_start", "period_end", "state"]),
  ];
  const overview = envelope.data;
  if (!overview) {
    rows.push(row(["report", "growth", "state", envelope.state, null, null, envelope.state]));
    return `${rows.join("\r\n")}\r\n`;
  }

  for (const stage of overview.funnel) {
    rows.push(
      row([
        "company_funnel",
        stage.key,
        "companies",
        stage.value,
        overview.period.startDate,
        overview.period.endDate,
        envelope.state,
      ])
    );
    rows.push(
      row([
        "company_funnel",
        stage.key,
        "conversion_from_trial",
        stage.conversionFromTrial,
        overview.period.startDate,
        overview.period.endDate,
        envelope.state,
      ])
    );
  }

  for (const channel of overview.channels) {
    const metrics: Array<[string, CsvCell]> = [
      [channel.discoveryLabel, channel.discovery],
      ["trials", channel.trials],
      ["activated", channel.activated],
      ["paid", channel.paid],
      ["activation_rate", channel.activationRate],
      ["revenue_cents", channel.revenueCents],
    ];
    for (const [metric, value] of metrics) {
      rows.push(
        row([
          "channel_performance",
          channel.channel,
          metric,
          value,
          overview.period.startDate,
          overview.period.endDate,
          channel.confidence,
        ])
      );
    }
  }

  for (const source of envelope.sources) {
    rows.push(
      row([
        "source_health",
        source.source,
        "finalized_through",
        source.finalizedThrough,
        overview.period.startDate,
        overview.period.endDate,
        source.state,
      ])
    );
  }

  return `${rows.join("\r\n")}\r\n`;
}
