"use client";

/**
 * SummaryBand — faithful to `reference/v4-detail.jsx :: V4SummaryBand`.
 *
 * Accent-tinted (not lavender) container — the band signals "your move".
 * Leading accent dot. Label "Your move" sits in text-2 (Cake 10 / 0.18em).
 * Provenance line: agent sparkles + "updated by Claude · {n} min ago" in
 * muted mono. Body is the rolling AI summary in agent-text. Optional
 * history button on the right.
 */

import { History, Sparkles } from "lucide-react";
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
        "flex shrink-0 items-start gap-2.5 border-b border-line bg-ops-accent/[0.06] px-[18px] py-2.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ops-accent"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-text-2">
            {t("bands.summary.label", "Your move")}
          </span>
          {min !== null && (
            <>
              <span aria-hidden className="font-mono text-[9.5px] text-text-mute">
                ·
              </span>
              <span
                className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.18em] text-text-mute"
                style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
              >
                <Sparkles
                  aria-hidden
                  className="h-2.5 w-2.5 text-agent"
                  strokeWidth={1.75}
                />
                {t(
                  "bands.summary.updatedBy",
                  "updated by Claude · {min} min ago",
                ).replace("{min}", String(min))}
              </span>
            </>
          )}
          {onHistory && (
            <button
              type="button"
              onClick={onHistory}
              aria-label={t("bands.summary.history", "Summary history")}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-text-3 hover:text-text-2"
            >
              <History aria-hidden className="h-2.5 w-2.5" strokeWidth={1.75} />
              {t("bands.summary.historyLabel", "history")}
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
