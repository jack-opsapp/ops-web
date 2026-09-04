"use client";

import type { Locale } from "@/i18n/types";
import { formatSlotTime, type AvailableSlot } from "./booking-format";

interface SlotGridProps {
  slots: AvailableSlot[];
  selected: string | null;
  onSelect: (slot: AvailableSlot) => void;
  timezone: string;
  locale: Locale;
  disabled?: boolean;
  label: string;
  /** Changes with the chosen day so the grid re-enters instead of swapping in place. */
  dayKey: string;
}

/**
 * The open times for one day. Times are mono and tabular (they are data), and
 * they read in the business's timezone — the crew's clock, not the visitor's.
 */
export function SlotGrid({
  slots,
  selected,
  onSelect,
  timezone,
  locale,
  disabled = false,
  label,
  dayKey,
}: SlotGridProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-micro uppercase tracking-widest cs-text-2">{label}</span>
      <div
        key={dayKey}
        role="group"
        aria-label={label}
        className="cs-fade-enter grid grid-cols-3 gap-0.5"
      >
        {slots.map((slot) => {
          const time = formatSlotTime(slot.startAt, timezone, locale);
          return (
            <button
              key={slot.slot}
              type="button"
              aria-pressed={slot.slot === selected}
              disabled={disabled}
              onClick={() => onSelect(slot)}
              data-slot-time={slot.startAt.toISOString()}
              className="cs-choice h-control-40 rounded px-0.5 font-mono text-data-sm tabular-nums"
            >
              {time}
            </button>
          );
        })}
      </div>
    </div>
  );
}
