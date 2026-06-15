"use client";

/**
 * ProjectMapPin — the status-colored round-glow pin for the Projects MAP view.
 *
 * Deliberately the SAME visual language as the project workspace window's
 * `ProjectPin` (`workspace/map/project-map.tsx`): radial glow + 14px status
 * dot + dark hairline + white core. That continuity is the whole argument for
 * unifying the map view on Mapbox GL — clicking a pin opens the workspace
 * window, and the pin you clicked is the pin you keep looking at.
 *
 * Extensions over the workspace pin, earned by the multi-project context:
 *  - `selected` adds the breathing pulse ring (the `animate-pin-pulse`
 *    keyframe, reduced-motion aware) so the located job stays findable.
 *  - `stackCount` adds the count badge for location-coincident projects
 *    (parity with the old Leaflet `createStackedProjectPin`).
 *  - `dimmed` drops terminal-status pins back under the ALL filter.
 */

import { memo } from "react";
import { withAlpha } from "@/lib/utils/color";

interface ProjectMapPinProps {
  /** Status hex from PROJECT_STATUS_COLORS. */
  color: string;
  selected?: boolean;
  /** > 1 renders the stacked-location count badge. */
  stackCount?: number;
  dimmed?: boolean;
  reducedMotion?: boolean;
}

export const ProjectMapPin = memo(function ProjectMapPin({
  color,
  selected = false,
  stackCount = 1,
  dimmed = false,
  reducedMotion = false,
}: ProjectMapPinProps) {
  const dotSize = selected ? 16 : 14;
  const half = dotSize / 2;
  return (
    <div
      className="ops-map-pin"
      aria-hidden="true"
      style={{ position: "relative", opacity: dimmed ? 0.45 : 1 }}
    >
      {/* Selected: breathing pulse ring — the located job's heartbeat. */}
      {selected && (
        <span
          className={reducedMotion ? undefined : "animate-pin-pulse"}
          style={{
            position: "absolute",
            top: -half - 6,
            left: -half - 6,
            width: dotSize + 12,
            height: dotSize + 12,
            borderRadius: "50%",
            border: `1.5px solid ${color}`,
            opacity: reducedMotion ? 0.5 : undefined,
          }}
        />
      )}
      {/* Radial glow. */}
      <span
        style={{
          position: "absolute",
          top: -14,
          left: -14,
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${withAlpha(color, selected ? 45 : 33)} 0%, ${withAlpha(color, 0)} 70%)`,
        }}
      />
      {/* Status dot. */}
      <span
        style={{
          position: "absolute",
          top: -half,
          left: -half,
          width: dotSize,
          height: dotSize,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 12px ${color}`,
          border: "2px solid var(--scrim-edge-stroke)",
        }}
      />
      {/* White core. */}
      <span
        style={{
          position: "absolute",
          top: -2,
          left: -2,
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "var(--text)",
        }}
      />
      {/* Stacked-location count badge. */}
      {stackCount > 1 && (
        <span
          className="font-mono"
          style={{
            position: "absolute",
            top: -half - 7,
            left: half - 2,
            minWidth: 16,
            height: 16,
            padding: "0 3px",
            borderRadius: "50%",
            background: "var(--surface-glass-dense)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "var(--text)",
            fontSize: 11,
            lineHeight: "14px",
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {stackCount}
        </span>
      )}
    </div>
  );
});
