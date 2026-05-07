"use client";

import { History } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface SummaryBandProps {
  body: string;
  /** ISO. Renders as "updated by Claude · {n} min ago" relative to renderedAt. */
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
  return (
    <section
      aria-label={t("bands.summary.aria", "Claude summary")}
      className={cn(
        "flex shrink-0 items-start gap-3 border-b border-line bg-agent-bg px-[18px] py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-agent-hi">
            {t("bands.summary.label", "// YOUR MOVE")}
          </span>
          {min !== null && (
            <span
              className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              {t("bands.summary.updatedBy", "updated by Claude · {min} min ago").replace(
                "{min}",
                String(min),
              )}
            </span>
          )}
        </div>
        <p className="font-mohave text-[12.5px] leading-[1.5] tracking-[-0.003em] text-agent-text text-pretty">
          {body}
        </p>
      </div>
      {onHistory && (
        <button
          type="button"
          onClick={onHistory}
          aria-label={t("bands.summary.history", "Summary history")}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-text-3 hover:bg-agent-bg-hi hover:text-agent-hi"
        >
          <History aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </section>
  );
}
