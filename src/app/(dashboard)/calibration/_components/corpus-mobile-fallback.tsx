"use client";

import { Monitor } from "lucide-react";
import { useDictionary } from "@/i18n/client";

interface Props {
  onViewFacts: () => void;
}

export function CorpusMobileFallback({ onViewFacts }: Props) {
  const { t } = useDictionary("calibration");
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <Monitor className="w-8 h-8 text-text-mute" aria-hidden="true" />
      <h3 className="font-cakemono font-light uppercase text-[18px] text-text">
        {t("sections.corpus.mobileFallback.heading")}
      </h3>
      <p className="font-mohave text-body-sm text-text-2 max-w-[320px]">
        {t("sections.corpus.mobileFallback.body")}
      </p>
      <button
        onClick={onViewFacts}
        className="font-cakemono font-light uppercase text-[14px] px-4 py-2.5 rounded-[5px] border border-ops-accent text-ops-accent hover:bg-ops-accent hover:text-black transition-colors"
      >
        {t("sections.corpus.mobileFallback.cta")}
      </button>
    </div>
  );
}
