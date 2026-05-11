"use client";

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";
import { KeyHint } from "@/components/ui/key-hint";

interface BallYoursBandProps {
  clientName: string;
  /** Pre-formatted wait clock — "18H" / "12D" / "MAR 4". */
  waitDuration: string;
  onReply: () => void;
  className?: string;
}

export function BallYoursBand({
  clientName,
  waitDuration,
  onReply,
  className,
}: BallYoursBandProps) {
  const { t } = useDictionary("inbox");
  const title = t("bands.ballYours.title", "// YOUR TURN :: {client}").replace(
    "{client}",
    clientName.toUpperCase(),
  );
  const wait = waitDuration
    ? t("bands.ballYours.wait", "WAITING · {duration}").replace(
        "{duration}",
        waitDuration,
      )
    : t("bands.ballYours.waitNone", "WAITING");
  return (
    <section
      aria-label={t("bands.ballYours.aria", "Your turn")}
      className={cn(
        "relative flex shrink-0 items-center gap-2.5 border-b border-line bg-ops-accent/[0.06] px-2 py-2.5",
        className,
      )}
    >
      <span aria-hidden className="absolute left-0 top-0 h-full w-[3px] bg-ops-accent" />
      <SlashLabel label={title} tone="accent" className="flex-shrink-0" />
      <span
        className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-2"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {wait}
      </span>
      <button
        type="button"
        onClick={onReply}
        className="ml-auto inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[2.5px] border border-ops-accent bg-transparent px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-ops-accent transition-colors hover:bg-ops-accent hover:text-black"
      >
        {t("bands.ballYours.reply", "REPLY")}
        <KeyHint variant="inline" keys={["⌘", "↵"]} />
      </button>
    </section>
  );
}
