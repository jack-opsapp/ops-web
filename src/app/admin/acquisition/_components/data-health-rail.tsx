import type { GrowthSourceStatus } from "@/lib/admin/growth-analytics-types";
import { stateKey, stateTone, type GrowthTranslate } from "./growth-ui";

interface DataHealthRailProps {
  statuses: GrowthSourceStatus[];
  t: GrowthTranslate;
}

const SOURCE_LABELS: Record<GrowthSourceStatus["source"], [string, string]> = {
  business_records: ["sourceBusiness", "Business records"],
  search_console: ["sourceSearchConsole", "Search Console"],
  ga4_marketing: ["sourceGaMarketing", "GA4 · marketing"],
  ga4_web_app: ["sourceGaWeb", "GA4 · web app"],
  ga4_ios_qa: ["sourceGaIos", "GA4 · iOS QA"],
  app_store: ["sourceAppStore", "App Store Connect"],
};

export function DataHealthRail({ statuses, t }: DataHealthRailProps) {
  return (
    <section
      aria-labelledby="data-health-heading"
      className="border-t border-border pt-3"
    >
      <h2
        className="font-cakemono text-cake-badge uppercase text-text-3"
        id="data-health-heading"
      >
        {t("dataHealth")}
      </h2>
      <div className="mt-2 grid gap-1 md:grid-cols-2 xl:grid-cols-3">
        {statuses.map((status) => {
          const [labelKey, fallback] = SOURCE_LABELS[status.source];
          return (
            <div
              className="flex min-w-0 items-center justify-between gap-2 border-l border-border pl-2"
              data-state={status.state}
              key={status.source}
            >
              <div className="min-w-0">
                <p className="truncate font-mohave text-caption-sm text-text-2">
                  {t(labelKey, fallback)}
                </p>
                <p className="truncate font-mono text-micro text-text-mute" title={status.detail}>
                  {status.finalizedThrough
                    ? t("through", { date: status.finalizedThrough })
                    : status.detail}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-chip border px-1 py-0.5 font-cakemono text-cake-badge uppercase ${stateTone(status.state)}`}
              >
                {t(stateKey(status.state))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
