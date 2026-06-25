"use client";

/**
 * RunningTotals — the canvas header readout: "N proposed · M added".
 *
 * Intent: the owner mid-build wants live confirmation that the pile is shrinking
 * and the catalog is growing. Two numbers, mono, tabular — proposed (neutral,
 * "still on the canvas") and added (olive, "going live"). The added count ticks
 * up on change via the foundations count-up (ACHIEVEMENT beat, 800ms quadratic
 * ease-out) so a freshly-accepted card lands as a deliberate increment, not a jump.
 *
 * Olive lands ONLY on the added count (positive/committed). No accent anywhere.
 * Strings via useDictionary("catalog-setup").
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import type { RunningTotals as RunningTotalsModel } from "@/lib/catalog-setup/staging-card";
import { useCountUp } from "@/lib/catalog-setup/motion";

const MONO_NUM: React.CSSProperties = { fontFeatureSettings: '"tnum" 1, "zero" 1' };

export interface RunningTotalsProps {
  totals: RunningTotalsModel;
  className?: string;
}

export function RunningTotals({ totals, className }: RunningTotalsProps) {
  const { t } = useDictionary("catalog-setup");

  // Count-up both numbers on change; the hook honors prefers-reduced-motion
  // (snaps instantly) so the readout serves the same beat through a fade only.
  const proposed = useCountUp(totals.proposed);
  const added = useCountUp(totals.added);

  return (
    <p
      data-testid="running-totals"
      className={cn("flex items-baseline gap-[6px] font-mono text-[12px]", className)}
      style={MONO_NUM}
    >
      <span data-testid="running-totals-proposed" className="text-text-2">
        {proposed}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-text-3">
        {t("totals.proposed", "PROPOSED")}
      </span>
      <span aria-hidden className="text-text-mute">
        {t("totals.separator", "·")}
      </span>
      <span data-testid="running-totals-added" className="text-olive">
        {added}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-text-3">
        {t("totals.added", "ADDED")}
      </span>
    </p>
  );
}
