"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";

interface AutoSentBandProps {
  hoursAgo: number;
  detail?: string;
  className?: string;
}

function relativeAgo(hoursAgo: number): string {
  if (hoursAgo < 1) {
    const minutes = Math.max(1, Math.round(hoursAgo * 60));
    return `${minutes} MIN AGO`;
  }
  return `${Math.round(hoursAgo)}H AGO`;
}

export function AutoSentBand({
  hoursAgo,
  detail,
  className,
}: AutoSentBandProps) {
  const { t } = useDictionary("inbox");
  const ago = relativeAgo(hoursAgo);
  const body = detail
    ? t("bands.autoSent.body", "[—] {detail} · {ago}")
        .replace("{detail}", detail.toLowerCase())
        .replace("{ago}", ago)
    : `[—] ${ago}`;

  return (
    <section
      aria-label={t("bands.autoSent.aria", "Phase C auto-replied")}
      className={cn(
        "flex shrink-0 items-center gap-2.5 border-b border-line bg-agent-bg px-2 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <SlashLabel label={t("bands.autoSent.title", "// AUTO-SENT BY PHASE C")} tone="agent" />
        <span
          className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {body}
        </span>
      </div>
    </section>
  );
}
