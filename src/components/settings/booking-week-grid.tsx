"use client";

import { Plus, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { BOOKING_LIMITS, sortWindows, type BookingWindow } from "@/lib/booking/policy";

/**
 * The business's week, as a week (PUBLIC API P2-4, design §8).
 *
 * Seven rows — the working week first, because that is the order a trades
 * business thinks in — each carrying that day's hours or an em dash. Never
 * twenty-one separate inputs: a day is opened with one action, closed with
 * one, and the hours themselves are a start and an end, not free text.
 */

/** Monday first; Sunday last. Values are Postgres `dow`. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** The weekdays the copy-across affordance fills. */
const WEEKDAYS = [2, 3, 4, 5] as const;

/** The trade's own day — what a new row opens to, so nobody types 08:00 seven times. */
export const DEFAULT_WINDOW = Object.freeze({ start: "08:00", end: "16:00" });

const EMPTY_GLYPH = "—";

export interface BookingWeekGridProps {
  windows: readonly BookingWindow[];
  onChange: (windows: BookingWindow[]) => void;
  timezone: string;
}

function withoutIndex(windows: readonly BookingWindow[], index: number): BookingWindow[] {
  return windows.filter((_, position) => position !== index);
}

export function BookingWeekGrid({ windows, onChange, timezone }: BookingWeekGridProps) {
  const { t } = useDictionary("settings");

  const ordered = sortWindows(windows);
  const full = ordered.length >= BOOKING_LIMITS.maxWindows;

  const dayName = (weekday: number) => t(`booking.day.${weekday}`);

  const monday = ordered.filter((window) => window.weekday === 1);
  // Offered only when Monday is set and the weekdays do not already match it —
  // an action that would change nothing is not an action.
  const weekdaysMatchMonday = WEEKDAYS.every((weekday) => {
    const day = ordered.filter((window) => window.weekday === weekday);
    return (
      day.length === monday.length &&
      day.every(
        (window, index) =>
          window.start === monday[index].start && window.end === monday[index].end
      )
    );
  });
  const canCopyWeekdays = monday.length > 0 && !weekdaysMatchMonday;

  const replaceWindow = (target: BookingWindow, next: Partial<BookingWindow>) => {
    onChange(
      ordered.map((window) => (window === target ? { ...window, ...next } : window))
    );
  };

  const addWindow = (weekday: number) => {
    if (full) return;
    onChange([...ordered, { weekday, ...DEFAULT_WINDOW }]);
  };

  const copyMondayAcross = () => {
    const kept = ordered.filter(
      (window) => !(WEEKDAYS as readonly number[]).includes(window.weekday)
    );
    const copied = WEEKDAYS.flatMap((weekday) =>
      monday.map((window) => ({ weekday, start: window.start, end: window.end }))
    );
    // The store takes fourteen; a copy that would exceed it fills what it can.
    onChange([...kept, ...copied].slice(0, BOOKING_LIMITS.maxWindows));
  };

  return (
    <section
      data-testid="booking-hours"
      className="glass-surface space-y-2 rounded-panel p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <div>
          <span className="block font-mono text-micro uppercase tracking-[0.16em] text-text-3">
            <span className="text-text-mute">{"// "}</span>
            {t("booking.hours")}
          </span>
          <p className="mt-1 font-mono text-micro text-text-3">
            [{t("booking.hoursTimezone", { timezone })}]
          </p>
        </div>
        {canCopyWeekdays ? (
          <button
            type="button"
            onClick={copyMondayAcross}
            className={cn(
              "font-mono text-micro uppercase tracking-[0.14em] text-text-3",
              "transition-colors duration-150 ease-smooth hover:text-text-2",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
            )}
          >
            {t("booking.copyWeekdays")}
          </button>
        ) : null}
      </div>

      <ul className="divide-y divide-glass-border">
        {WEEK_ORDER.map((weekday) => {
          const day = ordered.filter((window) => window.weekday === weekday);
          const label = dayName(weekday);

          return (
            <li
              key={weekday}
              data-testid={`booking-day-${weekday}`}
              data-day={weekday}
              className="group flex items-start gap-2 py-1"
            >
              <span className="mt-1.5 w-[36px] shrink-0 font-mono text-micro uppercase tracking-[0.12em] text-text-3">
                {label}
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {day.length === 0 ? (
                  <span className="py-1.5 font-mono text-micro text-text-mute">
                    {EMPTY_GLYPH}
                  </span>
                ) : (
                  day.map((window) => {
                    const index = ordered.indexOf(window);
                    return (
                      <div key={`${index}`} className="flex items-center gap-1">
                        <input
                          type="time"
                          aria-label={`${t("booking.windowStart")} — ${label}`}
                          value={window.start}
                          onChange={(event) =>
                            replaceWindow(window, { start: event.target.value })
                          }
                          className={cn(
                            "h-control-32 rounded border border-border bg-surface-input px-1",
                            "font-mono text-data-sm tabular-nums text-text",
                            "[font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]",
                            "transition-colors duration-150 ease-smooth",
                            "focus:border-line-hi focus:outline-none"
                          )}
                        />
                        <span aria-hidden className="font-mono text-micro text-text-mute">
                          –
                        </span>
                        <input
                          type="time"
                          aria-label={`${t("booking.windowEnd")} — ${label}`}
                          value={window.end}
                          onChange={(event) =>
                            replaceWindow(window, { end: event.target.value })
                          }
                          className={cn(
                            "h-control-32 rounded border border-border bg-surface-input px-1",
                            "font-mono text-data-sm tabular-nums text-text",
                            "[font-feature-settings:'tnum'_1,'zero'_1] [color-scheme:dark]",
                            "transition-colors duration-150 ease-smooth",
                            "focus:border-line-hi focus:outline-none"
                          )}
                        />
                        <button
                          type="button"
                          aria-label={t("booking.removeWindow", {
                            start: window.start,
                            end: window.end,
                            day: label,
                          })}
                          onClick={() => onChange(withoutIndex(ordered, index))}
                          className={cn(
                            "flex h-icon-20 w-icon-20 items-center justify-center rounded text-text-mute",
                            "opacity-0 transition-opacity duration-150 ease-smooth",
                            "group-hover:opacity-100 group-focus-within:opacity-100",
                            "hover:text-text-2 motion-reduce:transition-none",
                            "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
                          )}
                        >
                          <X className="h-[16px] w-[16px]" strokeWidth={1.75} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                disabled={full}
                aria-label={t("booking.addWindow", { day: label })}
                onClick={() => addWindow(weekday)}
                className={cn(
                  "mt-1 flex h-icon-20 w-icon-20 shrink-0 items-center justify-center rounded",
                  "text-text-3 transition-colors duration-150 ease-smooth hover:text-text-2",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent",
                  "disabled:cursor-not-allowed disabled:text-text-mute disabled:hover:text-text-mute"
                )}
              >
                <Plus className="h-[16px] w-[16px]" strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ul>

      {full ? (
        <p className="font-mono text-micro text-text-3">[{t("booking.windowsFull")}]</p>
      ) : null}
    </section>
  );
}
