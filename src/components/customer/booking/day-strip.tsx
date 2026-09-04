"use client";

import { useState } from "react";
import type { Locale } from "@/i18n/types";
import { formatDayChip, type BookingDay } from "./booking-format";

/**
 * Days that have nothing open are not here. There is no greyed-out row
 * explaining why a Tuesday is unavailable — the design's rule is absence,
 * not a disabled control that spends attention to say "no" (design §7).
 */
const DAYS_BEFORE_DISCLOSURE = 8;

interface DayStripProps {
  days: BookingDay[];
  selectedKey: string | null;
  onSelect: (day: BookingDay) => void;
  timezone: string;
  locale: Locale;
  disabled?: boolean;
  label: string;
  moreLabel: string;
}

export function DayStrip({
  days,
  selectedKey,
  onSelect,
  timezone,
  locale,
  disabled = false,
  label,
  moreLabel,
}: DayStripProps) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, days.length - DAYS_BEFORE_DISCLOSURE);
  // Nearly every booking happens in the first week; the rest stay one tap away
  // rather than owning a screen of chips a homeowner has to scroll past.
  const visible = expanded ? days : days.slice(0, DAYS_BEFORE_DISCLOSURE);

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-micro uppercase tracking-widest cs-text-2">{label}</span>

      {/* Four across: eight days fill exactly two tidy rows on a phone. */}
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-0.5">
        {visible.map((day) => {
          const face = formatDayChip(day.date, timezone, locale);
          const selected = day.key === selectedKey;
          return (
            <button
              key={day.key}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(day)}
              data-day={day.key}
              className="cs-choice h-control-40 rounded px-0.5 flex flex-col items-center justify-center"
            >
              <span className="font-mono text-micro uppercase tracking-widest leading-none">
                {face.weekday}
              </span>
              <span className="font-mono text-data-sm uppercase tabular-nums leading-none">
                {face.date}
              </span>
            </button>
          );
        })}
      </div>

      {hidden > 0 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          disabled={disabled}
          className="cs-ghost self-start font-mono text-micro uppercase tracking-widest"
        >
          {moreLabel}
        </button>
      ) : null}
    </div>
  );
}
