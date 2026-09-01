"use client";

import { useState } from "react";
import { Surface } from "@/components/ui/surface";
import type { GrowthSearchReport } from "@/lib/admin/growth-analytics-types";
import type { GrowthTranslate } from "./growth-ui";

interface ContentPerformanceTableProps {
  report: GrowthSearchReport | null;
  formatNumber: (value: number | null) => string;
  formatPercent: (value: number | null) => string;
  t: GrowthTranslate;
}

export function ContentPerformanceTable({
  report,
  formatNumber,
  formatPercent,
  t,
}: ContentPerformanceTableProps) {
  const [mode, setMode] = useState<"pages" | "queries">("pages");
  const rows = report?.[mode] ?? [];

  return (
    <section aria-labelledby="content-performance-heading">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            className="font-cakemono text-cake-section uppercase text-text"
            id="content-performance-heading"
          >
            {t("contentPerformance")}
          </h2>
          <p className="mt-0.5 font-mohave text-caption-sm text-text-3">
            {t("privacyNote")}
          </p>
        </div>
        <div
          aria-label={t("contentPerformance")}
          className="flex rounded-chip border border-border bg-surface-input p-0.5"
          role="tablist"
        >
          {(["pages", "queries"] as const).map((tab) => (
            <button
              aria-selected={mode === tab}
              className={`rounded-sm px-2 py-1 font-mohave text-caption-sm transition-colors duration-150 ease-smooth focus-visible:outline-none ${
                mode === tab ? "bg-surface-active text-text" : "text-text-3 hover:text-text-2"
              }`}
              key={tab}
              onClick={() => setMode(tab)}
              role="tab"
              type="button"
            >
              {tab === "pages" ? t("landingPages") : t("searchQueries")}
            </button>
          ))}
        </div>
      </div>
      <Surface className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-content-table table-fixed text-left">
            <thead className="border-b border-border bg-surface-input font-mono text-micro uppercase text-text-mute">
              <tr>
                <th className="w-content-label px-3 py-2 font-normal">
                  {mode === "pages" ? t("page") : t("query")}
                </th>
                <th className="px-2 py-2 text-right font-normal">{t("impressions")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("clicks")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("ctr")}</th>
                <th className="px-2 py-2 text-right font-normal">{t("position")}</th>
                <th className="px-3 py-2 text-right font-normal">{t("sessions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row) => (
                <tr
                  className="border-b border-border-subtle font-mono text-data-sm text-text-2 last:border-b-0"
                  key={`${mode}-${row.label}`}
                >
                  <th
                    className="truncate px-3 py-2 font-mohave font-normal text-text"
                    title={row.label}
                  >
                    {row.label || "—"}
                  </th>
                  <td className="px-2 py-2 text-right">{formatNumber(row.impressions)}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(row.clicks)}</td>
                  <td className="px-2 py-2 text-right">{formatPercent(row.ctr)}</td>
                  <td className="px-2 py-2 text-right">
                    {row.position === null ? "—" : row.position.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(row.sessions)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    className="px-3 py-4 text-center font-mohave text-body-sm text-text-3"
                    colSpan={6}
                  >
                    {t("noContentRows")}
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
