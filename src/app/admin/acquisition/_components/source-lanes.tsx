import { Surface } from "@/components/ui/surface";
import type { GrowthSourceLane } from "@/lib/admin/growth-analytics-types";
import { stateKey, stateTone, type GrowthTranslate } from "./growth-ui";

interface SourceLanesProps {
  lanes: GrowthSourceLane[];
  formatNumber: (value: number | null) => string;
  formatPercent: (value: number | null) => string;
  t: GrowthTranslate;
}

export function SourceLanes({
  lanes,
  formatNumber,
  formatPercent,
  t,
}: SourceLanesProps) {
  return (
    <section aria-labelledby="growth-source-lanes">
      <h2
        className="mb-2 font-cakemono text-cake-section uppercase text-text"
        id="growth-source-lanes"
      >
        {t("sourceLanes")}
      </h2>
      <div className="grid gap-2 xl:grid-cols-2">
        {lanes.map((lane) => (
          <Surface className="p-3" data-state={lane.state} key={lane.source}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-mohave text-card-title text-text">
                  {lane.source === "web_search" ? t("webSearch") : t("appStore")}
                </h3>
                <p className="mt-0.5 font-mono text-micro text-text-mute">
                  {lane.finalizedThrough
                    ? t("finalized", { date: lane.finalizedThrough })
                    : "—"}
                </p>
              </div>
              <span
                className={`rounded-chip border px-1.5 py-0.5 font-cakemono text-cake-badge uppercase ${stateTone(lane.state)}`}
              >
                {t(stateKey(lane.state))}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {lane.metrics.map((metric) => (
                <div className="border-l border-border pl-2" key={metric.key}>
                  <p className="font-mono text-data text-text">
                    {metric.key === "ctr" || metric.key.includes("rate")
                      ? formatPercent(metric.value)
                      : formatNumber(metric.value)}
                  </p>
                  <p className="mt-0.5 font-mohave text-caption-sm text-text-3">
                    {t(metric.key, metric.label)}
                  </p>
                </div>
              ))}
            </div>
            {lane.note && (
              <p className="mt-3 border-t border-border-subtle pt-2 font-mohave text-caption-sm text-text-3">
                {lane.note === "paid_split_unavailable"
                  ? t("paidSplitUnavailable")
                  : lane.note}
              </p>
            )}
          </Surface>
        ))}
      </div>
    </section>
  );
}
