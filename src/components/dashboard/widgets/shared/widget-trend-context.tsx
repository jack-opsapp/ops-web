"use client";

import { ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import { useDictionary } from "@/i18n/client";

// ── Types ────────────────────────────────────────────────────────────

interface TrendProps {
  variant: "trend";
  /** Arrow direction */
  direction: "up" | "down" | "neutral";
  /** Percentage delta (e.g., "27%") */
  delta: string;
  /** Comparison text (e.g., "vs last month") */
  comparison: string;
  /** Override color — defaults to green (up) / red (down) / disabled (neutral) */
  color?: { up: string; down: string };
}

interface HealthProps {
  variant: "health";
  /** Dot + label color (CSS value, e.g., WT.success) */
  color: string;
  /** Status label (e.g., "Healthy", "3 Overdue") */
  label: string;
}

interface SnapshotProps {
  variant: "snapshot";
  /** Period or context label (e.g., "This Month", "Today") */
  label: string;
}

type WidgetTrendContextProps = TrendProps | HealthProps | SnapshotProps;

// ── Component ────────────────────────────────────────────────────────

export function WidgetTrendContext(props: WidgetTrendContextProps) {
  if (props.variant === "trend") {
    const { direction, delta, comparison, color } = props;
    const upColor = color?.up ?? "var(--color-status-success)";
    const downColor = color?.down ?? "var(--color-status-error)";
    const arrowColor =
      direction === "up" ? upColor : direction === "down" ? downColor : undefined;

    const Arrow =
      direction === "up"
        ? ChevronUp
        : direction === "down"
          ? ChevronDown
          : ChevronRight;

    return (
      <div className="flex items-center gap-0.5">
        <Arrow
          className="w-3 h-3 shrink-0"
          style={arrowColor ? { color: arrowColor } : undefined}
        />
        {delta && delta !== "0%" && (
          <span
            className="font-mono text-micro font-medium"
            style={arrowColor ? { color: arrowColor } : undefined}
          >
            {delta}
          </span>
        )}
        <span className="font-kosugi text-micro text-text-mute uppercase">
          {comparison}
        </span>
      </div>
    );
  }

  if (props.variant === "health") {
    const { color, label } = props;
    return (
      <div className="flex items-center gap-1">
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span
          className="font-kosugi text-micro uppercase"
          style={{ color }}
        >
          {label}
        </span>
      </div>
    );
  }

  // snapshot
  return (
    <span className="font-kosugi text-micro text-text-mute uppercase">
      {props.label}
    </span>
  );
}
