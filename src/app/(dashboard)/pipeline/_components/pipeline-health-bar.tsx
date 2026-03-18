"use client";

import { useReducedMotion } from "framer-motion";
import { useDictionary } from "@/i18n/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PipelineHealthBarProps {
  daysInStage: number;
  expectedDays: number; // from PIPELINE_STAGES_DEFAULT autoFollowUpDays
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
type HealthZone = "healthy" | "atRisk" | "overdue";

function getHealthZone(percentage: number): HealthZone {
  if (percentage >= 100) return "overdue";
  if (percentage >= 70) return "atRisk";
  return "healthy";
}

function getZoneColor(zone: HealthZone): string {
  switch (zone) {
    case "healthy":
      return "#A5B368";
    case "atRisk":
      return "#C4A868";
    case "overdue":
      return "#93321A";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function PipelineHealthBar({
  daysInStage,
  expectedDays,
}: PipelineHealthBarProps) {
  const { t } = useDictionary("pipeline");
  const prefersReducedMotion = useReducedMotion();

  // Edge case: if expectedDays is 0 or falsy, render empty bar
  if (!expectedDays || expectedDays <= 0) {
    return (
      <div
        role="progressbar"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[4px] w-full rounded-full bg-[rgba(255,255,255,0.06)]"
      />
    );
  }

  // Cap at 150% visual maximum
  const rawPercentage = (daysInStage / expectedDays) * 100;
  const percentage = Math.min(rawPercentage, 150);

  const zone = getHealthZone(rawPercentage);
  const fillColor = getZoneColor(zone);

  // aria-label key lookup
  const ariaLabel: string =
    zone === "healthy"
      ? t("healthBar.healthy")
      : zone === "atRisk"
        ? t("healthBar.atRisk")
        : t("healthBar.overdue");

  // Width as a percentage of the track. 150% raw maps to 100% visual fill.
  // We normalise so 150 raw = 100% display width.
  const displayWidth = (percentage / 150) * 100;

  // Transition: applied only when the user has NOT requested reduced motion.
  const transitionStyle = prefersReducedMotion
    ? undefined
    : { transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)" };

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(rawPercentage)}
      aria-valuemin={0}
      aria-valuemax={150}
      className="h-[4px] w-full rounded-full bg-[rgba(255,255,255,0.06)]"
    >
      <div
        style={{
          width: `${displayWidth}%`,
          backgroundColor: fillColor,
          ...transitionStyle,
        }}
        className="h-full rounded-full"
      />
    </div>
  );
}
