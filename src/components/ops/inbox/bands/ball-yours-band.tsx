"use client";

/**
 * BallYoursBand — non-AI fallback for "your turn".
 *
 * Per the handoff README: "accent left bar, plain panel body, accent CTA".
 * The V3MessagesPane variant adds an inline last-reply timestamp; we surface
 * that on the right when provided.
 *
 *   |  ●  Your turn — Jeanne is waiting on a reply       Last reply · 2h
 *
 * (where `|` is the 2px accent left bar, `●` an accent dot.)
 */

import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";

interface BallYoursBandProps {
  clientName: string;
  lastReplyLabel?: string;
  onReply: () => void;
  className?: string;
}

export function BallYoursBand({
  clientName,
  lastReplyLabel,
  onReply,
  className,
}: BallYoursBandProps) {
  const { t } = useDictionary("inbox");
  const label = t(
    "bands.ballYours.label",
    "Your turn — {client} is waiting",
  ).replace("{client}", clientName);
  return (
    <section
      aria-label={t("bands.ballYours.aria", "Your turn")}
      className={cn(
        "relative flex shrink-0 items-center gap-2.5 border-b border-line bg-ops-accent/[0.06] px-[18px] py-2.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[2px] bg-ops-accent"
      />
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-ops-accent"
      />
      <span className="min-w-0 flex-1 truncate font-mohave text-[12px] tracking-[-0.003em] text-text">
        {label}
      </span>
      {lastReplyLabel && (
        <span
          className="shrink-0 font-mono text-[11px] tracking-[0.2em] text-text-3"
          style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
        >
          {lastReplyLabel}
        </span>
      )}
      <button
        type="button"
        onClick={onReply}
        className="inline-flex h-[26px] shrink-0 items-center rounded-[2.5px] border border-ops-accent bg-transparent px-3 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-ops-accent hover:bg-ops-accent hover:text-black"
      >
        {t("bands.ballYours.reply", "Reply")}
      </button>
    </section>
  );
}
