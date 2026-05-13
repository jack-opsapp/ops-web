"use client";

/**
 * BallYoursBand — single-row compact chip strip. Replaces the previous
 * two-line banner so the detail pane spends less vertical space on chrome
 * before the first message bubble.
 *
 * Anatomy (left → right):
 *   • 3px accent stripe (depth without a fill)
 *   • `// YOUR TURN` slash label
 *   • client name (UPPERCASE mono)
 *   • `WAITING · 18H` wait clock
 *   • `[REPLY ⌘↵]` primary button — calls onReply
 *   • `[✓]` acknowledge — calls onAcknowledge (dismisses AWAITING_REPLY)
 *   • `[⏱]` snooze — wrapped in `snoozeSlot` by the parent so a click opens
 *     the shared `<SnoozePicker>` popover anchored to the icon.
 *
 * onAcknowledge + snoozeSlot are both optional — when absent (e.g. on rails
 * where the override doesn't make sense), the corresponding icon is hidden.
 */

import { forwardRef, type ReactNode } from "react";
import { Check, Clock } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { SlashLabel } from "../voice/slash-label";
import { KeyHint } from "@/components/ui/key-hint";

interface BallYoursBandProps {
  clientName: string;
  /** Pre-formatted wait clock — "18H" / "12D" / "MAR 4". */
  waitDuration: string;
  onReply: () => void;
  /**
   * Clears AWAITING_REPLY on the thread. Hidden when undefined. Mirrors the
   * hover-X affordance on the YOURS chip in the thread list — same outcome,
   * same backend route.
   */
  onAcknowledge?: () => void;
  /**
   * Render-prop that wraps the snooze icon in the shared <SnoozePicker> so
   * clicking it opens the picker anchored to the icon. Hidden when
   * undefined. Pattern mirrors the detail-header's snoozeSlot.
   */
  snoozeSlot?: (button: ReactNode) => ReactNode;
  className?: string;
}

const iconBtnClass =
  "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] text-text-3 transition-colors hover:bg-ops-accent/[0.18] hover:text-ops-accent focus-visible:outline-none focus-visible:ring-[1.5px] focus-visible:ring-ops-accent";

const IconButton = forwardRef<
  HTMLButtonElement,
  {
    icon: typeof Check;
    label: string;
    onClick?: () => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function IconButton({ icon: Icon, label, onClick, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={iconBtnClass}
      {...rest}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );
});

export function BallYoursBand({
  clientName,
  waitDuration,
  onReply,
  onAcknowledge,
  snoozeSlot,
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

  const snoozeBtn = (
    <IconButton
      icon={Clock}
      label={t("bands.ballYours.snooze", "Snooze thread")}
    />
  );

  return (
    <section
      aria-label={t("bands.ballYours.aria", "Your turn")}
      className={cn(
        "relative flex shrink-0 items-center gap-2 border-b border-line bg-ops-accent/[0.06] py-1.5 pl-2.5 pr-1.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[2px] bg-ops-accent"
      />
      <SlashLabel label={title} tone="accent" size="sm" className="flex-shrink-0" />
      <span
        className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-2"
        style={{ fontFeatureSettings: '"tnum" 1, "zero" 1' }}
      >
        {wait}
      </span>
      <button
        type="button"
        onClick={onReply}
        className="ml-auto inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-[3px] border border-ops-accent bg-transparent px-2.5 font-cakemono text-[11px] font-light uppercase tracking-[0.14em] text-ops-accent transition-colors hover:bg-ops-accent hover:text-black"
      >
        {t("bands.ballYours.reply", "REPLY")}
        <KeyHint variant="inline" keys={["⌘", "↵"]} />
      </button>
      {onAcknowledge && (
        <IconButton
          icon={Check}
          label={t("bands.ballYours.acknowledge", "Mark no reply needed")}
          onClick={onAcknowledge}
        />
      )}
      {snoozeSlot ? snoozeSlot(snoozeBtn) : null}
    </section>
  );
}
