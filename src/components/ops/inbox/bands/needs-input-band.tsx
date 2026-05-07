"use client";

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
  onAction: (id: string) => void;
  className?: string;
}

export function NeedsInputBand({
  question,
  options,
  onAction,
  className,
}: NeedsInputBandProps) {
  const { t } = useDictionary("inbox");
  const hasOptions = !!options?.length;
  return (
    <section
      aria-label={t("bands.needsInput.aria", "Claude needs your input")}
      className={cn(
        "flex shrink-0 flex-col gap-2 border-b border-line bg-agent-bg px-[18px] py-3",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="h-3.5 w-3.5 text-agent-hi" strokeWidth={1.75} />
        <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-agent-hi">
          {t("bands.needsInput.label", "// CLAUDE NEEDS YOUR INPUT")}
        </span>
      </div>
      <p className="font-mohave text-[12.5px] leading-[1.5] tracking-[-0.003em] text-agent-text text-pretty">
        {question}
      </p>
      {hasOptions ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {options!.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onAction(`answer:${opt.id}`)}
              className="inline-flex h-[26px] items-center rounded-chip border border-agent-border-hi bg-transparent px-2.5 font-mohave text-[11.5px] text-agent-text hover:bg-agent-bg-hi hover:text-agent-hi"
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAction("type-reply")}
            className="inline-flex h-[26px] items-center rounded-chip border border-line bg-transparent px-2.5 font-mohave text-[11.5px] text-text-3 hover:bg-inbox-elev hover:text-text-2"
          >
            {t("bands.needsInput.typeReply", "type a reply…")}
          </button>
        </div>
      ) : (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => onAction("provide-answer")}
            className="inline-flex h-[28px] items-center rounded-[5px] border border-agent-border-hi bg-agent-bg-hi px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-agent-hi hover:bg-agent/[0.18]"
          >
            {t("bands.needsInput.provideAnswer", "PROVIDE ANSWER")}
          </button>
        </div>
      )}
    </section>
  );
}
