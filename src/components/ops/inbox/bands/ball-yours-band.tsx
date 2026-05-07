"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface BallYoursBandProps {
  clientName: string;
  onReply: () => void;
  className?: string;
}

export function BallYoursBand({
  clientName,
  onReply,
  className,
}: BallYoursBandProps) {
  const { t } = useDictionary("inbox");
  return (
    <section
      aria-label={t("bands.ballYours.aria", "Your turn")}
      className={cn(
        "relative flex shrink-0 items-center gap-3 border-b border-line bg-inbox-panel px-[18px] py-3",
        className,
      )}
    >
      <span aria-hidden className="absolute left-0 top-0 h-full w-[2px] bg-ops-accent" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-cakemono text-[10px] font-light uppercase leading-none tracking-[0.18em] text-text">
          {t(
            "bands.ballYours.label",
            "// YOUR TURN — {client} is waiting",
          ).replace("{client}", clientName)}
        </span>
      </div>
      <button
        type="button"
        onClick={onReply}
        className="inline-flex h-[28px] shrink-0 items-center rounded-md border border-ops-accent bg-transparent px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-ops-accent hover:bg-ops-accent hover:text-black"
      >
        {t("bands.ballYours.reply", "Reply")}
      </button>
    </section>
  );
}
