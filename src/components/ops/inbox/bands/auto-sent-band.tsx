"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface AutoSentBandProps {
  hoursAgo: number;
  onRevise: () => void;
  className?: string;
}

export function AutoSentBand({
  hoursAgo,
  onRevise,
  className,
}: AutoSentBandProps) {
  const { t } = useDictionary("inbox");
  // Body has the {hours}h embedded inline so the mono digits can keep their
  // own typographic treatment. We split on the placeholder and render the
  // pieces around it.
  const template = t(
    "bands.autoSent.body",
    "Claude replied {hours}h ago — say something different?",
  );
  const [before, after] = template.split("{hours}h ago");
  return (
    <section
      aria-label={t("bands.autoSent.aria", "Claude auto-replied")}
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-line bg-agent-bg px-[18px] py-2.5",
        className,
      )}
    >
      <p className="font-mohave text-[12px] leading-[1.5] text-agent-text">
        {before}
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {hoursAgo}h ago
        </span>
        {after}
      </p>
      <button
        type="button"
        onClick={onRevise}
        className="ml-auto font-mohave text-[12px] text-agent-hi underline underline-offset-2 hover:text-agent-text"
      >
        {t("bands.autoSent.revise", "revise")}
      </button>
    </section>
  );
}
