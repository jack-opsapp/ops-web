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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";
import { useThreadActions } from "@/lib/hooks/use-inbox-threads";
import { SlashLabel } from "./voice/slash-label";
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
  /** Dictionary key for the primary label. */
  labelKey: string;
  /** Default English fallback for the label. */
  labelDefault: string;
  compute: (now: Date) => Date | null; // null = hide this preset
}

// ─── Preset computations ─────────────────────────────────────────────────────

function laterToday(now: Date): Date | null {
  const target = new Date(now);
  target.setHours(now.getHours() + 3, 0, 0, 0);
  // Only show if the result is still today AND before 20:00 local.
  const stillToday =
    target.getDate() === now.getDate() && target.getHours() < 20;
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

function buildPresets(): SnoozePreset[] {
  return [
    {
      id: "later-today",
      labelKey: "modal.snooze.presetLaterToday",
      labelDefault: "[LATER TODAY]",
      compute: laterToday,
    },
    {
      id: "tomorrow",
      labelKey: "modal.snooze.presetTomorrow",
      labelDefault: "[TOMORROW 8AM]",
      compute: tomorrowMorning,
    },
    {
      id: "weekend",
      labelKey: "modal.snooze.presetWeekend",
      labelDefault: "[WEEKEND]",
      compute: thisWeekend,
    },
    {
      id: "next-week",
      labelKey: "modal.snooze.presetNextMon",
      labelDefault: "[NEXT MON]",
      compute: nextWeek,
    },
    {
      id: "next-month",
      labelKey: "modal.snooze.presetNextMonth",
      labelDefault: "[NEXT MONTH]",
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

  const { t } = useDictionary("inbox");
  const { snooze, unsnooze } = useThreadActions();
  const now = useMemo(() => new Date(), [isOpen]);
  const presets = useMemo(() => buildPresets(), []);

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
        message: t(
          "toast.snoozedTactic",
          "SYS :: SNOOZED UNTIL {time}"
        ).replace("{time}", humanLabel.toUpperCase()),
        onUndo: () => unsnooze.mutate(threadId),
      });
    },
    [snooze, unsnooze, threadId, setOpen, t]
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
        className="w-[300px] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-b border-line px-1.5 py-1">
          <SlashLabel label={t("modal.snooze.title", "// SNOOZE")} size="md" />
          <p className="mt-0.5 font-mono text-micro leading-snug text-text-3">
            {t(
              "modal.snooze.body",
              "[—] hide until · returns to inbox automatically"
            )}
          </p>
        </div>

        <div className="py-0.5">
          {presets.map((preset) => {
            const computed = preset.compute(now);
            if (!computed) return null;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => commit(computed, formatPresetValue(computed))}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-1.5 py-0.5 text-left",
                  "transition-colors duration-150",
                  "hover:bg-surface-hover focus-visible:bg-surface-active focus-visible:outline-none"
                )}
              >
                <span className="min-w-0 truncate font-mono text-micro uppercase tracking-wider text-text-2">
                  {t(preset.labelKey, preset.labelDefault)}
                </span>
                <span className="shrink-0 font-mono text-micro tabular-nums text-text-mute">
                  {formatPresetValue(computed)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-line px-1.5 py-1">
          <label
            htmlFor={`snooze-custom-${threadId}`}
            className="mb-0.5 block font-mono text-micro uppercase tracking-wider text-text-3"
          >
            {t("modal.snooze.presetCustom", "[CUSTOM]")}
          </label>
          <div className="flex items-stretch gap-0.5">
            <input
              id={`snooze-custom-${threadId}`}
              type="datetime-local"
              value={customValue}
              min={toLocalDatetimeInput(new Date(Date.now() + 60_000))}
              onChange={(e) => setCustomValue(e.target.value)}
              className={cn(
                "min-w-0 flex-1 rounded border border-line bg-surface-input px-1 py-0.5",
                "font-mono text-micro text-text",
                "focus:border-line-hi focus:outline-none"
              )}
            />
            <button
              type="button"
              onClick={onCustomCommit}
              className={cn(
                "shrink-0 rounded border border-line bg-transparent px-1 py-0.5",
                "font-cakemono text-micro font-light uppercase tracking-wider text-text-2",
                "hover:bg-surface-hover hover:text-text focus-visible:outline-none",
                "focus-visible:ring-[1.5px] focus-visible:ring-ops-accent focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                "transition-colors duration-150"
              )}
            >
              {t("modal.snooze.customCommit", "SET")}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
