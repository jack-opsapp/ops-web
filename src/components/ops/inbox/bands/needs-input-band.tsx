"use client";

/**
 * NeedsInputBand — faithful to `reference/v4-detail.jsx :: V4NeedsInputBand`.
 *
 * Lavender-tinted container; agent sparkles + "Claude needs your input"
 * Cake label + "· paused {n} min ago" muted mono. Question body in
 * agent-text. When options provided: ghost buttons in neutral hairline
 * border (NOT lavender) + a final italic "type a reply…" escape hatch.
 * When no options: a single filled-lavender "PROVIDE ANSWER" CTA.
 */

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface NeedsInputOption {
  id: string;
  label: string;
}

interface NeedsInputBandProps {
  question: string;
  options?: NeedsInputOption[];
  pausedMinutesAgo?: number;
  onAction: (id: string) => void;
  className?: string;
}

export function NeedsInputBand({
  question,
  options,
  pausedMinutesAgo,
  onAction,
  className,
}: NeedsInputBandProps) {
  const { t } = useDictionary("inbox");
  const hasOptions = !!options?.length;
  return (
    <section
      aria-label={t("bands.needsInput.aria", "Claude needs your input")}
      className={cn(
        "flex shrink-0 gap-2.5 border-b border-line bg-agent-bg px-[18px] py-3",
        className,
      )}
    >
      <Sparkles
        aria-hidden
        className="mt-[2px] h-3.5 w-3.5 shrink-0 text-agent"
        strokeWidth={1.5}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-agent-hi">
            {t("bands.needsInput.label", "Claude needs your input")}
          </span>
          {pausedMinutesAgo != null && (
            <span
              className="font-mono text-[9.5px] tracking-[0.18em] text-text-mute"
              style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
            >
              ·{" "}
              {t(
                "bands.needsInput.pausedAgo",
                "paused {min} min ago",
              ).replace("{min}", String(pausedMinutesAgo))}
            </span>
          )}
        </div>
        <p className="font-mohave text-[13px] leading-[1.5] tracking-[-0.003em] text-agent-text text-pretty">
          {question}
        </p>
        {hasOptions ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {options!.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onAction(`answer:${opt.id}`)}
                className="inline-flex h-[26px] items-center rounded-md border border-line-hi bg-inbox-elev px-2.5 font-mohave text-[12px] tracking-[-0.003em] text-text-2 hover:bg-inbox-panel hover:text-text"
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onAction("type-reply")}
              className="inline-flex h-[26px] items-center rounded-md border border-line bg-transparent px-2.5 font-mohave text-[12px] italic text-text-3 hover:text-text-2"
            >
              {t("bands.needsInput.typeReply", "type a reply…")}
            </button>
          </div>
        ) : (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => onAction("provide-answer")}
              className="inline-flex h-[28px] items-center rounded-md border border-agent bg-agent/[0.18] px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-agent-hi hover:bg-agent/[0.30]"
            >
              {t("bands.needsInput.provideAnswer", "Provide answer")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
