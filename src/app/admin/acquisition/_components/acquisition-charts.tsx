"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { GrowthTrendPoint } from "@/lib/admin/growth-analytics-types";
import { EASE_SMOOTH } from "@/lib/utils/motion";
import type { GrowthTranslate } from "./growth-ui";

interface GrowthTrendChartProps {
  points: GrowthTrendPoint[];
  formatNumber: (value: number | null) => string;
  t: GrowthTranslate;
}

export function GrowthTrendChart({
  points,
  formatNumber,
  t,
}: GrowthTrendChartProps) {
  const reduceMotion = useReducedMotion();
  const maximum = Math.max(1, ...points.map((point) => point.activated));
  const denominator = Math.max(1, points.length - 1);
  const polyline = points
    .map((point, index) => {
      const x = (index / denominator) * 100;
      const y = 38 - (point.activated / maximum) * 34;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mohave text-caption text-text-3">{t("trend")}</p>
        <p className="font-mono text-micro text-text-mute">
          {points.length > 0
            ? `${points[0].date} — ${points.at(-1)?.date}`
            : "—"}
        </p>
      </div>
      <svg
        aria-label={t("trend")}
        className="h-5 w-full overflow-visible text-text-2"
        preserveAspectRatio="none"
        role="img"
        viewBox="0 0 100 40"
      >
        <line
          className="stroke-border-subtle"
          vectorEffect="non-scaling-stroke"
          x1="0"
          x2="100"
          y1="38"
          y2="38"
        />
        {points.length > 0 && (
          <motion.polyline
            animate={{ opacity: 1 }}
            className="fill-none stroke-current"
            initial={reduceMotion ? false : { opacity: 0 }}
            points={polyline}
            transition={{ duration: reduceMotion ? 0.15 : 0.35, ease: EASE_SMOOTH }}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <details className="mt-2 border-t border-border-subtle pt-2 font-mohave text-caption-sm text-text-3">
        <summary className="cursor-pointer focus-visible:text-text">
          {t("trendDetails")}
        </summary>
        <div className="mt-2 max-h-7 overflow-auto">
          <table className="w-full text-left">
            <thead className="font-mono text-micro uppercase text-text-mute">
              <tr>
                <th className="pb-1 font-normal">{t("date")}</th>
                <th className="pb-1 text-right font-normal">{t("trials")}</th>
                <th className="pb-1 text-right font-normal">{t("activated")}</th>
                <th className="pb-1 text-right font-normal">{t("paid")}</th>
              </tr>
            </thead>
            <tbody className="font-mono text-data-sm text-text-2">
              {points.map((point) => (
                <tr key={point.date} className="border-t border-border-subtle">
                  <td className="py-1">{point.date}</td>
                  <td className="py-1 text-right">{formatNumber(point.trials)}</td>
                  <td className="py-1 text-right">{formatNumber(point.activated)}</td>
                  <td className="py-1 text-right">{formatNumber(point.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
