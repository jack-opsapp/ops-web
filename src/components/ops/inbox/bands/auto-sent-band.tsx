"use client";

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
  return (
    <section
      aria-label="Claude auto-replied"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-line bg-agent-bg px-[18px] py-2.5",
        className,
      )}
    >
      <p className="font-mohave text-[12px] leading-[1.5] text-agent-text">
        Claude replied{" "}
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {hoursAgo}h ago
        </span>{" "}
        — say something different?
      </p>
      <button
        type="button"
        onClick={onRevise}
        className="ml-auto font-mohave text-[12px] text-agent-hi underline underline-offset-2 hover:text-agent-text"
      >
        revise
      </button>
    </section>
  );
}
