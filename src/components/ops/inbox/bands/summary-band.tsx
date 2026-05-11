"use client";

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";

interface SummaryBandProps {
  body: string;
  updatedAt?: string | null;
  renderedAt?: number;
  onHistory?: () => void;
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
  onHistory,
  className,
}: SummaryBandProps) {
  const { t } = useDictionary("inbox");
  const min = minutesAgo(updatedAt, renderedAt);
  const provenance =
    min !== null
      ? t("bands.summary.provenance", "updated by Claude · {minutes} MIN AGO").replace(
          "{minutes}",
          String(min),
        )
      : t("bands.summary.updatedByNow", "updated by Claude");

  return (
    <section
      aria-label={t("bands.summary.aria", "Claude summary")}
      className={cn(
        "flex shrink-0 items-start gap-2.5 border-b border-line bg-agent-bg px-2 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-center gap-2">
          <SlashLabel label={t("bands.summary.title", "// SUMMARY")} tone="agent" />
          <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 text-agent-hi" strokeWidth={1.5} />
          <span
            className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3"
            style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
          >
            {provenance}
          </span>
          {onHistory && (
            <button
              type="button"
              onClick={onHistory}
              aria-label={t("bands.summary.history", "Summary history")}
              className="ml-auto font-cakemono text-[11px] font-light uppercase leading-none tracking-[0.14em] text-text-3 transition-colors hover:text-text-2"
            >
              {t("bands.summary.historyButton", "HISTORY")}
            </button>
          )}
        </div>
        <p className="font-mohave text-[12.5px] leading-[1.5] tracking-[-0.003em] text-agent-text text-pretty">
          {body}
        </p>
      </div>
    </section>
  );
}
