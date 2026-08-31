import { Surface } from "@/components/ui/surface";
import type { GrowthChannelPerformanceRow } from "@/lib/admin/growth-analytics-types";
import type { GrowthTranslate } from "./growth-ui";

interface ChannelPerformanceTableProps {
  rows: GrowthChannelPerformanceRow[];
  formatCurrency: (value: number | null) => string;
  formatNumber: (value: number | null) => string;
  formatPercent: (value: number | null) => string;
  t: GrowthTranslate;
}

export function ChannelPerformanceTable({
  rows,
  formatCurrency,
  formatNumber,
  formatPercent,
  t,
}: ChannelPerformanceTableProps) {
  const maximum = Math.max(1, ...rows.map((row) => row.activated));

  return (
    <section aria-labelledby="channel-performance-heading">
      <h2
        className="mb-2 font-cakemono text-cake-section uppercase text-text"
        id="channel-performance-heading"
      >
        {t("channelPerformance")}
      </h2>
      <Surface className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-table text-left">
            <thead className="border-b border-border bg-surface-input font-mono text-micro uppercase text-text-mute">
              <tr>
                <th className="px-3 py-2 font-normal">{t("channel")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("discovery")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("trials")}</th>
                <th className="px-2 py-2 font-normal">{t("activated")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("paid")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("conversion")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("revenue")}</th>
                <th className="px-3 py-2 text-right font-normal">{t("confidence")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="border-b border-border-subtle font-mono text-data-sm text-text-2 last:border-b-0"
                  key={row.channel}
                >
                  <th className="px-3 py-2 font-mohave font-normal text-text">
                    {t(row.channel)}
                  </th>
                  <td className="px-2 py-2 text-right">
                    <span className="block">{formatNumber(row.discovery)}</span>
                    <span className="block font-mohave text-micro text-text-mute">
                      {t(row.discoveryLabel.replaceAll(" ", "_"), row.discoveryLabel)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.trials)}</td>
                  <td className="px-2 py-2">
                    <div className="flex min-w-chart items-center gap-2">
                      <div className="h-0.5 flex-1 overflow-hidden rounded-bar bg-fill-neutral-dim">
                        <div
                          className="h-full rounded-bar bg-fill-neutral transition-[width] duration-150 ease-smooth motion-reduce:transition-none"
                          style={{ width: `${(row.activated / maximum) * 100}%` }}
                        />
                      </div>
                      <span className="w-data text-right">{formatNumber(row.activated)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.paid)}</td>
                  <td className="px-2 py-2 text-right">{formatPercent(row.activationRate)}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(row.revenueCents)}</td>
                  <td className="px-3 py-2 text-right font-mohave text-caption-sm text-text-3">
                    {t(`confidence${row.confidence[0].toUpperCase()}${row.confidence.slice(1)}`)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-4 text-center font-mohave text-body-sm text-text-3"
                    colSpan={8}
                  >
                    {t("stateEmptyMessage")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Surface>
    </section>
  );
}
