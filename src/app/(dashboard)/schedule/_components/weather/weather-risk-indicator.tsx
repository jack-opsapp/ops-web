"use client";

/**
 * WeatherRiskIndicator — the subtle tan glyph a weather-dependent event grows
 * when its forecast turns adverse (bug 9dc7c38d).
 *
 * Invisible helpfulness: it appears ONLY on a genuine risk, never on a clear
 * day and never on a material run. Tan (`--tan`) is the OPS "caution / heads-up"
 * earth tone — the same semantic the time-off palm already uses on these bars,
 * so it reads as "pay attention," not "danger" (that would be rose/brick).
 *
 * Motion: an ambient opacity reveal (a stamp, not a parade) on the OPS ease
 * curve, honoring prefers-reduced-motion. No haptic — web, passive.
 */

import { motion, useReducedMotion } from "framer-motion";
import { CloudRain, CloudSnow, CloudLightning, Wind } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import {
  weatherGlyphVariants,
  weatherGlyphVariantsReduced,
} from "@/lib/utils/motion";
import type { WeatherRisk, WeatherRiskKind } from "@/lib/utils/weather-risk";

const GLYPHS: Record<WeatherRiskKind, typeof CloudRain> = {
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
  wind: Wind,
};

/**
 * Compose the human label + screen-reader name for a risk. Shared by the glyph
 * and the hover popover's weather line so both read identically. Wind reads its
 * km/h; precip kinds read their probability when known.
 */
export function composeWeatherRiskCopy(
  risk: WeatherRisk,
  t: (key: string) => string
): { full: string; ariaLabel: string } {
  const label = t(`weather.label.${risk.kind}`);
  let metric: string | null = null;
  if (risk.kind === "wind" && risk.windSpeedKmh != null) {
    metric = `${Math.round(risk.windSpeedKmh)} km/h`;
  } else if (risk.precipitationProbability != null) {
    metric = `${risk.precipitationProbability}%`;
  }
  const full = metric ? `${label} — ${metric}` : label;
  return { full, ariaLabel: `${t("weather.ariaPrefix")}: ${full}` };
}

interface WeatherRiskIndicatorProps {
  risk: WeatherRisk;
  /** Glyph size in px. Default 12 — matches the leading Star/TreePalm glyphs. */
  size?: number;
}

export function WeatherRiskIndicator({ risk, size = 12 }: WeatherRiskIndicatorProps) {
  const { t } = useDictionary("schedule");
  const prefersReducedMotion = useReducedMotion();
  const Glyph = GLYPHS[risk.kind];
  const { full, ariaLabel } = composeWeatherRiskCopy(risk, t);

  return (
    <motion.span
      role="img"
      aria-label={ariaLabel}
      title={full}
      className="inline-flex items-center justify-center shrink-0"
      variants={prefersReducedMotion ? weatherGlyphVariantsReduced : weatherGlyphVariants}
      initial="hidden"
      animate="visible"
      style={{ color: "var(--tan)", lineHeight: 0 }}
    >
      <Glyph size={size} strokeWidth={1.5} aria-hidden="true" />
    </motion.span>
  );
}
