"use client";

import { Sparkles } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";
import { StateTag } from "../state-tag";

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
  const min = pausedMinutesAgo ?? 0;
  const title = t(
    "bands.needsInput.title",
    "// PHASE C NEEDS INPUT :: PAUSED {minutes} MIN AGO",
  ).replace("{minutes}", String(min));

  return (
    <section
      aria-label={t("bands.needsInput.aria", "Phase C needs your input")}
      className={cn(
        "relative flex shrink-0 gap-2.5 border-b border-line bg-agent-bg-hi px-2 py-3",
        className,
      )}
    >
      <span aria-hidden className="absolute left-0 top-0 h-full w-[2px] bg-agent" />
      <Sparkles
        aria-hidden
        className="mt-[2px] h-3.5 w-3.5 shrink-0 text-agent-hi"
        strokeWidth={1.5}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <SlashLabel label={title} tone="agent" />
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
                className="inline-flex h-[26px] items-center rounded-chip border border-line-hi bg-transparent px-2.5 transition-colors hover:bg-inbox-elev"
              >
                <StateTag
                  tone="neutral"
                  variant="bare"
                  bracketed
                  prefix={opt.label.toUpperCase()}
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => onAction("type-reply")}
              className="inline-flex h-[26px] items-center rounded-[2.5px] px-2.5 font-mohave text-[12px] italic text-text-3 transition-colors hover:text-text-2"
            >
              {t("bands.needsInput.typeReplyEscape", "type a reply…")}
            </button>
          </div>
        ) : (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => onAction("provide-answer")}
              className="inline-flex h-[28px] items-center rounded-[2.5px] border border-agent bg-agent/[0.18] px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-agent-hi transition-colors hover:bg-agent/[0.30]"
            >
              {t("bands.needsInput.provideAnswerButton", "PROVIDE ANSWER")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
