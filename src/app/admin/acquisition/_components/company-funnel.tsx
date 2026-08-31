import { Surface } from "@/components/ui/surface";
import type { GrowthFunnelStage } from "@/lib/admin/growth-analytics-types";
import type { GrowthTranslate } from "./growth-ui";

interface CompanyFunnelProps {
  stages: GrowthFunnelStage[];
  formatNumber: (value: number | null) => string;
  formatPercent: (value: number | null) => string;
  t: GrowthTranslate;
}

const LABEL_KEYS: Record<GrowthFunnelStage["key"], string> = {
  trial: "trial",
  first_project: "firstProject",
  first_value: "firstValue",
  paid: "paid",
};

export function CompanyFunnel({
  stages,
  formatNumber,
  formatPercent,
  t,
}: CompanyFunnelProps) {
  const maximum = Math.max(1, stages[0]?.value ?? 0);

  return (
    <section aria-labelledby="company-funnel-heading">
      <h2
        className="mb-2 font-cakemono text-cake-section uppercase text-text"
        id="company-funnel-heading"
      >
        {t("companyFunnel")}
      </h2>
      <Surface className="p-3">
        <ol className="grid gap-3 lg:grid-cols-4">
          {stages.map((stage) => (
            <li key={stage.key}>
              <div className="mb-1 flex items-end justify-between gap-2">
                <div>
                  <p className="font-mohave text-caption text-text-3">
                    {t(LABEL_KEYS[stage.key])}
                  </p>
                  <p className="font-mono text-data-lg tabular-nums text-text">
                    {formatNumber(stage.value)}
                  </p>
                </div>
                <p className="font-mono text-micro text-text-mute">
                  {formatPercent(stage.conversionFromTrial)} {t("conversionFromTrial")}
                </p>
              </div>
              <div
                aria-label={`${t(LABEL_KEYS[stage.key])}: ${formatNumber(stage.value)}`}
                className="h-0.5 overflow-hidden rounded-bar bg-fill-neutral-dim"
                role="img"
              >
                <div
                  className="h-full rounded-bar bg-fill-neutral transition-[width] duration-150 ease-smooth motion-reduce:transition-none"
                  style={{ width: `${(stage.value / maximum) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
        <details className="mt-3 border-t border-border-subtle pt-2 font-mohave text-caption-sm text-text-3">
          <summary className="cursor-pointer focus-visible:text-text">
            {t("conversionFromTrial")}
          </summary>
          <table className="mt-2 w-full text-left">
            <thead className="font-mono text-micro uppercase text-text-mute">
              <tr>
                <th className="pb-1 font-normal">{t("channel")}</th>
                <th className="pb-1 text-right font-normal">{t("activated")}</th>
                <th className="pb-1 text-right font-normal">{t("conversion")}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-data-sm text-text-2">
              {stages.map((stage) => (
                <tr className="border-t border-border-subtle" key={stage.key}>
                  <td className="py-1 font-mohave">{t(LABEL_KEYS[stage.key])}</td>
                  <td className="py-1 text-right">{formatNumber(stage.value)}</td>
                  <td className="py-1 text-right">{formatPercent(stage.conversionFromTrial)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Surface>
    </section>
  );
}
