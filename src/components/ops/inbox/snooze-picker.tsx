"use client";

/**
 * SnoozePicker — popover with preset snooze durations + a custom datetime
 * picker. Commits via `useThreadActions().snooze` and fires an undo toast.
 *
 * Presets are clock-aware: "Later today" only appears before 18:00, "This
 * weekend" skips if already weekend, etc. All presets are computed in the
 * user's local timezone; the mutation sends an ISO UTC string.
 */

import { useCallback, useMemo, useState } from "react";
import { Clock, Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import { enqueueUndoToast } from "./undo-toast";

interface SnoozePickerProps {
  threadId: string;
  trigger: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
}

interface SnoozePreset {
  id: string;
  label: string;
  sublabel: string;
  compute: (now: Date) => Date | null;  // null = hide this preset
}

// ─── Preset computations ─────────────────────────────────────────────────────

function laterToday(now: Date): Date | null {
  const target = new Date(now);
  target.setHours(now.getHours() + 3, 0, 0, 0);
  // Only show if the result is still today AND before 20:00 local.
  const stillToday = target.getDate() === now.getDate() && target.getHours() < 20;
  return stillToday ? target : null;
}

function tomorrowMorning(now: Date): Date {
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  t.setHours(8, 0, 0, 0);
  return t;
}

function thisWeekend(now: Date): Date | null {
  // Saturday at 9am. Skip if today is already Saturday or Sunday.
  const dow = now.getDay();
  if (dow === 6 || dow === 0) return null;
  const t = new Date(now);
  const diff = 6 - dow;
  t.setDate(now.getDate() + diff);
  t.setHours(9, 0, 0, 0);
  return t;
}

function nextWeek(now: Date): Date {
  const t = new Date(now);
  const dow = now.getDay();
  // Next Monday at 8am.
  const diff = dow === 0 ? 1 : 8 - dow;
  t.setDate(now.getDate() + diff);
  t.setHours(8, 0, 0, 0);
  return t;
}

function nextMonth(now: Date): Date {
  const t = new Date(now);
  t.setMonth(now.getMonth() + 1, 1);
  t.setHours(8, 0, 0, 0);
  return t;
}

function buildPresets(now: Date): SnoozePreset[] {
  return [
    {
      id: "later-today",
      label: "Later today",
      sublabel: "in 3 hours",
      compute: laterToday,
    },
    {
      id: "tomorrow",
      label: "Tomorrow",
      sublabel: "8:00 AM",
      compute: tomorrowMorning,
    },
    {
      id: "weekend",
      label: "This weekend",
      sublabel: "Sat 9:00 AM",
      compute: thisWeekend,
    },
    {
      id: "next-week",
      label: "Next week",
      sublabel: "Mon 8:00 AM",
      compute: nextWeek,
    },
    {
      id: "next-month",
      label: "Next month",
      sublabel: "1st at 8:00 AM",
      compute: nextMonth,
    },
  ];
}

function formatPresetValue(date: Date): string {
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return date.toLocaleString(undefined, opts);
}

function toLocalDatetimeInput(date: Date): string {
  // Returns a value compatible with <input type="datetime-local" /> in local TZ.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SnoozePicker({
  threadId,
  trigger,
  open,
  onOpenChange,
  align = "end",
}: SnoozePickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  const { snooze, unsnooze } = useThreadActions();
  const now = useMemo(() => new Date(), [isOpen]);
  const presets = useMemo(() => buildPresets(now), [now]);

  const defaultCustom = useMemo(() => {
    const d = new Date(now);
    d.setHours(now.getHours() + 24, 0, 0, 0);
    return toLocalDatetimeInput(d);
  }, [now]);
  const [customValue, setCustomValue] = useState(defaultCustom);

  const commit = useCallback(
    (until: Date, humanLabel: string) => {
      setOpen(false);
      snooze.mutate({ threadId, until });
      enqueueUndoToast({
        message: `Snoozed until ${humanLabel}`,
        onUndo: () => unsnooze.mutate(threadId),
      });
    },
    [snooze, unsnooze, threadId, setOpen]
  );

  const onCustomCommit = useCallback(() => {
    const parsed = new Date(customValue);
    if (isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return;
    commit(parsed, formatPresetValue(parsed));
  }, [customValue, commit]);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        className="w-[260px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-3 pt-2.5 pb-1.5 border-b border-border-subtle">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-mute">
            // Snooze
          </p>
          <p className="font-cakemono font-light uppercase text-[13px] tracking-[0.14em] text-text mt-0.5">
            Come back when
          </p>
        </div>

        <div className="py-1">
          {presets.map((preset) => {
            const computed = preset.compute(now);
            if (!computed) return null;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => commit(computed, formatPresetValue(computed))}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-1.5 text-left",
                  "hover:bg-[rgba(255,255,255,0.05)] transition-colors duration-150"
                )}
              >
                <Clock className="w-[12px] h-[12px] text-text-mute shrink-0" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <p className="font-cakemono font-light uppercase text-[12px] tracking-[0.14em] text-text-2">
                    {preset.label}
                  </p>
                  <p className="font-mono text-[10px] text-text-mute mt-[1px]">
                    {preset.sublabel}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-text-mute tabular-nums shrink-0">
                  {formatPresetValue(computed)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="px-3 pt-2 pb-2.5 border-t border-border-subtle">
          <label
            htmlFor={`snooze-custom-${threadId}`}
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-mute mb-1"
          >
            <CalendarIcon className="w-[10px] h-[10px]" strokeWidth={1.75} />
            Pick date & time
          </label>
          <div className="flex items-stretch gap-1">
            <input
              id={`snooze-custom-${threadId}`}
              type="datetime-local"
              value={customValue}
              min={toLocalDatetimeInput(new Date(Date.now() + 60_000))}
              onChange={(e) => setCustomValue(e.target.value)}
              className={cn(
                "flex-1 rounded-[5px] px-2 py-1.5",
                "bg-surface-input border border-border-subtle",
                "font-mono text-[11px] text-text",
                "focus:outline-none focus:border-[rgba(255,255,255,0.20)]"
              )}
            />
            <button
              type="button"
              onClick={onCustomCommit}
              className={cn(
                "px-2.5 py-1.5 rounded-[5px] border border-[rgba(255,255,255,0.18)]",
                "bg-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.12)]",
                "font-cakemono font-light uppercase text-[11px] tracking-[0.14em] text-text",
                "transition-colors duration-150"
              )}
            >
              Snooze
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
