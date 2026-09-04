"use client";

import { fillCopy, formatCountdown, type CustomerCopy } from "@/lib/customer-identity/hosted-format";

/** Under a minute the hold is genuinely nearly gone — that is when the tone shifts. */
const HOLD_WARNING_SECONDS = 60;

interface HoldPanelProps {
  /** `Mon, Sep 8 · 9:00 AM` — the appointment, in the business's timezone. */
  stamp: string;
  secondsLeft: number;
  copy: CustomerCopy;
  /** Back to step one. Absent once the visitor is past the point of changing it. */
  onChangeTime?: () => void;
  disabled?: boolean;
}

/**
 * The chosen time, carried through the rest of the flow, with its hold
 * counting down beside it.
 *
 * The countdown is deliberately quiet: mono metadata, no ticking animation,
 * no colour until the last minute, and no live region — a screen reader
 * announcing a number every second would be unusable. It exists so nobody is
 * surprised when the slot goes back, not to hurry anyone.
 */
export function HoldPanel({
  stamp,
  secondsLeft,
  copy,
  onChangeTime,
  disabled = false,
}: HoldPanelProps) {
  const expiring = secondsLeft <= HOLD_WARNING_SECONDS;

  return (
    <div className="cs-panel rounded-panel px-1.5 py-1 flex flex-col gap-0.5">
      <span className="font-mono text-data-sm uppercase tabular-nums cs-text">{stamp}</span>
      <div className="flex items-center justify-between gap-1">
        <span
          data-hold-remaining={secondsLeft}
          className={
            expiring
              ? "font-mono text-micro uppercase tracking-widest tabular-nums cs-warning"
              : "font-mono text-micro uppercase tracking-widest tabular-nums cs-text-2"
          }
        >
          {fillCopy(copy["book.hold.label"], { time: formatCountdown(secondsLeft) })}
        </span>
        {onChangeTime ? (
          <button
            type="button"
            onClick={onChangeTime}
            disabled={disabled}
            className="cs-ghost font-mohave text-body-sm"
          >
            {copy["book.details.changeTime"]}
          </button>
        ) : null}
      </div>
    </div>
  );
}
