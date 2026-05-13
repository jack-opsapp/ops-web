"use client";

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface SummaryBandProps {
  body: string;
  updatedAt?: string | null;
  renderedAt?: number;
  className?: string;
}

function minutesAgo(updatedAt: string | null | undefined, now: number): number | null {
  if (!updatedAt) return null;
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.round((now - ts) / 60_000));
}

export function SummaryBand({
  body,
  updatedAt,
  renderedAt = Date.now(),
  className,
}: SummaryBandProps) {
  const { t } = useDictionary("inbox");
  const min = minutesAgo(updatedAt, renderedAt);
  const provenance =
    min !== null
      ? t("bands.summary.provenance", "updated by Phase C · {minutes} MIN AGO").replace(
          "{minutes}",
          String(min),
        )
      : t("bands.summary.updatedByNow", "updated by Phase C");

  return (
    <section
      aria-label={t("bands.summary.aria", "Phase C summary")}
      className={cn(
        // Compact single-row treatment: sparkle + body inline, provenance
        // collapsed to a hover-revealed trailing affordance via the parent
        // group. The summary is informational chrome — it shouldn't claim
        // a second row.
        "group/summary relative flex shrink-0 items-center gap-2 border-b border-line bg-agent-bg py-1.5 pl-2.5 pr-2",
        className,
      )}
    >
      <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-agent-hi" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 truncate font-mohave text-[12.5px] leading-[1.4] tracking-[-0.003em] text-agent-text">
        {body}
      </p>
      <span
        className="hidden shrink-0 font-mono text-[11px] uppercase tracking-[0.10em] text-text-3 group-hover/summary:inline"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {provenance}
      </span>
    </section>
  );
}
