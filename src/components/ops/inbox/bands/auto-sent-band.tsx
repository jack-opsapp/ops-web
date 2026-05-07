"use client";

/**
 * AutoSentBand — faithful to `reference/v4-states.jsx :: V4AutoSentDetail`
 * top ribbon. Lavender tint, calm and declarative.
 *
 *   ✦ **Claude replied for you** · 4 min ago
 *   Auto-replied with receipt confirmation. No action required.
 *                                                       [ Take over ]
 */

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface AutoSentBandProps {
  /** Hours since the auto-send. Sub-1h values can pass `0`. */
  hoursAgo: number;
  /** Optional explanation line ("Auto-replied with receipt confirmation."). */
  detail?: string;
  onTakeOver: () => void;
  className?: string;
}

function relativeAgo(hoursAgo: number): string {
  if (hoursAgo < 1) {
    const minutes = Math.max(1, Math.round(hoursAgo * 60));
    return `${minutes} min ago`;
  }
  const rounded = Math.round(hoursAgo);
  return `${rounded}h ago`;
}

export function AutoSentBand({
  hoursAgo,
  detail,
  onTakeOver,
  className,
}: AutoSentBandProps) {
  const { t } = useDictionary("inbox");
  return (
    <section
      aria-label={t("bands.autoSent.aria", "Claude auto-replied")}
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b border-line bg-agent-bg px-[18px] py-2.5",
        className,
      )}
    >
      <Sparkles
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 text-agent"
        strokeWidth={1.75}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mohave text-[12.5px] tracking-[-0.003em] text-text">
          <strong className="font-semibold">
            {t("bands.autoSent.title", "Claude replied for you")}
          </strong>{" "}
          ·{" "}
          <span
            className="font-mono text-[11px] tabular-nums text-text-2"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {relativeAgo(hoursAgo)}
          </span>
        </span>
        {detail && (
          <span
            className="mt-0.5 font-mono text-[10px] tracking-[0.18em] text-text-3"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {detail}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onTakeOver}
        className="inline-flex h-[26px] shrink-0 items-center rounded-md border border-line-hi bg-transparent px-3 font-mohave text-[11.5px] text-text-2 hover:bg-inbox-elev hover:text-text"
      >
        {t("bands.autoSent.takeOver", "Take over")}
      </button>
    </section>
  );
}
