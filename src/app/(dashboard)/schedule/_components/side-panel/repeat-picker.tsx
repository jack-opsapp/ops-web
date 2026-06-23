"use client";

/**
 * RepeatPicker — Phase 3
 *
 * Inline RRULE builder for the task detail panel. Six presets resolve to a
 * pre-shaped RRULE string. The Custom variant opens an in-panel editor with
 * frequency, interval, BYDAY for weekly, BYMONTHDAY for monthly, and end
 * conditions (Never / On <date> / After <N> occurrences).
 *
 * Output: a (parsed → re-serialized) RRULE string ready for storage on
 * task_recurrences.rrule. RRULE manipulation goes through rrule.js so we
 * don't reinvent RFC 5545.
 */

import { useEffect, useMemo, useState } from "react";
import { format, getDate } from "date-fns";
import { RRule, Frequency, Weekday } from "rrule";
import { useDictionary } from "@/i18n/client";

// ─── Presets ────────────────────────────────────────────────────────────────

export type RepeatPreset =
  | "off"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom";

interface PresetOption {
  value: RepeatPreset;
  label: string;
}

function buildPresetOptions(
  anchor: Date,
  t: (key: string, params?: Record<string, unknown>) => string,
): PresetOption[] {
  const weekdayName = format(anchor, "EEEE").toUpperCase();
  const dayOfMonth = getDate(anchor);
  return [
    { value: "off", label: t("repeat.off") },
    { value: "daily", label: t("repeat.daily") },
    { value: "weekly", label: t("repeat.weekly", { day: weekdayName }) },
    { value: "biweekly", label: t("repeat.biweekly", { day: weekdayName }) },
    { value: "monthly", label: t("repeat.monthly", { day: dayOfMonth }) },
    { value: "custom", label: t("repeat.custom") },
  ];
}

const RRULE_DAYS: { code: string; labelKey: string; rrule: Weekday }[] = [
  { code: "MO", labelKey: "repeat.day.mon", rrule: RRule.MO },
  { code: "TU", labelKey: "repeat.day.tue", rrule: RRule.TU },
  { code: "WE", labelKey: "repeat.day.wed", rrule: RRule.WE },
  { code: "TH", labelKey: "repeat.day.thu", rrule: RRule.TH },
  { code: "FR", labelKey: "repeat.day.fri", rrule: RRule.FR },
  { code: "SA", labelKey: "repeat.day.sat", rrule: RRule.SA },
  { code: "SU", labelKey: "repeat.day.sun", rrule: RRule.SU },
];

function jsDayToCode(d: Date): string {
  // 0 = Sun in JS, but RRULE days follow ISO so SU is the trailing weekday.
  const map = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  return map[d.getDay()];
}

// ─── Preset → RRULE ─────────────────────────────────────────────────────────

function presetToRrule(preset: RepeatPreset, anchor: Date): string | null {
  if (preset === "off" || preset === "custom") return null;

  switch (preset) {
    case "daily":
      return new RRule({ freq: Frequency.DAILY }).toString().replace("RRULE:", "");
    case "weekly":
      return new RRule({
        freq: Frequency.WEEKLY,
        byweekday: [
          RRULE_DAYS.find((d) => d.code === jsDayToCode(anchor))!.rrule,
        ],
      })
        .toString()
        .replace("RRULE:", "");
    case "biweekly":
      return new RRule({
        freq: Frequency.WEEKLY,
        interval: 2,
        byweekday: [
          RRULE_DAYS.find((d) => d.code === jsDayToCode(anchor))!.rrule,
        ],
      })
        .toString()
        .replace("RRULE:", "");
    case "monthly":
      return new RRule({
        freq: Frequency.MONTHLY,
        bymonthday: [getDate(anchor)],
      })
        .toString()
        .replace("RRULE:", "");
    default:
      return null;
  }
}

/**
 * Detect which preset a stored RRULE string matches. Returns "custom" if
 * the rule is well-formed but doesn't match a standard preset.
 */
function rruleToPreset(rrule: string | null, anchor: Date): RepeatPreset {
  if (!rrule) return "off";
  try {
    const opts = RRule.parseString(rrule);
    const day = jsDayToCode(anchor);
    const dayOfMonth = getDate(anchor);

    if (
      opts.freq === Frequency.DAILY &&
      (opts.interval == null || opts.interval === 1) &&
      !opts.byweekday &&
      !opts.bymonthday &&
      !opts.until &&
      !opts.count
    ) {
      return "daily";
    }
    if (opts.freq === Frequency.WEEKLY) {
      const weekdays = (opts.byweekday ?? []) as Weekday[];
      const matchesAnchor =
        weekdays.length === 1 && (weekdays[0] as Weekday).toString() === day;
      if (matchesAnchor && (opts.interval == null || opts.interval === 1)) {
        return "weekly";
      }
      if (matchesAnchor && opts.interval === 2) {
        return "biweekly";
      }
    }
    if (
      opts.freq === Frequency.MONTHLY &&
      Array.isArray(opts.bymonthday) &&
      opts.bymonthday.length === 1 &&
      opts.bymonthday[0] === dayOfMonth &&
      (opts.interval == null || opts.interval === 1) &&
      !opts.until &&
      !opts.count
    ) {
      return "monthly";
    }
  } catch {
    return "custom";
  }
  return "custom";
}

// ─── Custom editor state ────────────────────────────────────────────────────

interface CustomState {
  freq: Frequency;
  interval: number;
  byweekday: string[]; // codes "MO" / "TU" / ...
  bymonthday: number | null;
  endMode: "never" | "until" | "count";
  until: string; // YYYY-MM-DD
  count: number;
}

function defaultCustomState(anchor: Date): CustomState {
  return {
    freq: Frequency.WEEKLY,
    interval: 1,
    byweekday: [jsDayToCode(anchor)],
    bymonthday: null,
    endMode: "never",
    until: "",
    count: 10,
  };
}

function customStateToRrule(s: CustomState): string {
  const opts: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: s.freq,
    interval: s.interval > 0 ? s.interval : 1,
  };
  if (s.freq === Frequency.WEEKLY && s.byweekday.length > 0) {
    opts.byweekday = s.byweekday
      .map((code) => RRULE_DAYS.find((d) => d.code === code)?.rrule)
      .filter((d): d is Weekday => Boolean(d));
  }
  if (s.freq === Frequency.MONTHLY && s.bymonthday) {
    opts.bymonthday = [s.bymonthday];
  }
  if (s.endMode === "until" && s.until) {
    opts.until = new Date(`${s.until}T23:59:59Z`);
  }
  if (s.endMode === "count" && s.count > 0) {
    opts.count = s.count;
  }
  return new RRule(opts as ConstructorParameters<typeof RRule>[0])
    .toString()
    .replace("RRULE:", "");
}

function rruleToCustomState(rrule: string, anchor: Date): CustomState {
  try {
    const opts = RRule.parseString(rrule);
    const days = (opts.byweekday ?? []) as Weekday[];
    return {
      freq: opts.freq ?? Frequency.WEEKLY,
      interval: opts.interval ?? 1,
      byweekday: days.map((d) => d.toString()),
      bymonthday: Array.isArray(opts.bymonthday)
        ? (opts.bymonthday[0] as number)
        : null,
      endMode: opts.until ? "until" : opts.count ? "count" : "never",
      until: opts.until
        ? format(new Date(opts.until), "yyyy-MM-dd")
        : "",
      count: opts.count ?? 10,
    };
  } catch {
    return defaultCustomState(anchor);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface RepeatPickerProps {
  /**
   * Anchor date used to label presets (e.g. "// WEEKLY ON THURSDAY") and seed
   * the custom editor's BYDAY / BYMONTHDAY.
   */
  anchor: Date;
  /**
   * Current RRULE string. Null = no recurrence.
   */
  value: string | null;
  /**
   * Called when the user picks a non-Custom preset OR confirms the custom
   * editor. Receives the new RRULE string (or null for Off).
   */
  onChange: (rrule: string | null) => void;
  /** Disable interaction (e.g. while a series mutation is pending). */
  disabled?: boolean;
}

export function RepeatPicker({
  anchor,
  value,
  onChange,
  disabled = false,
}: RepeatPickerProps) {
  const { t } = useDictionary("schedule");
  const presetOptions = useMemo(
    () => buildPresetOptions(anchor, t),
    [anchor, t]
  );
  const detectedPreset = useMemo(
    () => rruleToPreset(value, anchor),
    [value, anchor]
  );
  const [preset, setPreset] = useState<RepeatPreset>(detectedPreset);
  const [customOpen, setCustomOpen] = useState(detectedPreset === "custom");
  const [custom, setCustom] = useState<CustomState>(() =>
    value ? rruleToCustomState(value, anchor) : defaultCustomState(anchor)
  );

  // Keep local state in sync with prop when the task changes.
  useEffect(() => {
    setPreset(detectedPreset);
    if (detectedPreset === "custom" && value) {
      setCustom(rruleToCustomState(value, anchor));
      setCustomOpen(true);
    }
  }, [detectedPreset, value, anchor]);

  const handlePresetChange = (next: RepeatPreset) => {
    setPreset(next);
    if (next === "custom") {
      setCustomOpen(true);
      // Don't fire onChange yet — wait for user to APPLY.
      return;
    }
    setCustomOpen(false);
    onChange(presetToRrule(next, anchor));
  };

  const handleApplyCustom = () => {
    onChange(customStateToRrule(custom));
    setCustomOpen(false);
  };

  const toggleWeekday = (code: string) => {
    setCustom((prev) => ({
      ...prev,
      byweekday: prev.byweekday.includes(code)
        ? prev.byweekday.filter((c) => c !== code)
        : [...prev.byweekday, code],
    }));
  };

  return (
    <div className="space-y-[8px]">
      {/* Preset select — radio-style buttons in a column */}
      <div
        className="flex flex-col rounded-[5px] overflow-hidden"
        style={{ border: "1px solid var(--line)" }}
      >
        {presetOptions.map((opt, i) => {
          const isActive = preset === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => handlePresetChange(opt.value)}
              className="text-left px-[10px] py-[6px] font-mono text-micro uppercase tracking-[0.16em] transition-colors"
              style={{
                color: isActive ? "var(--text)" : "var(--text-3)",
                background: isActive
                  ? "rgba(255,255,255,0.06)"
                  : "transparent",
                borderTop:
                  i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Custom editor */}
      {customOpen && (
        <div
          className="rounded-[5px] p-[10px] space-y-[8px]"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--line)",
          }}
        >
          {/* Frequency + Interval */}
          <div className="flex items-center gap-[6px]">
            <span
              className="font-mono text-micro uppercase tracking-[0.16em]"
              style={{ color: "var(--text-3)" }}
            >
              {t("repeat.every")}
            </span>
            <input
              type="number"
              min={1}
              value={custom.interval}
              onChange={(e) =>
                setCustom((s) => ({
                  ...s,
                  interval: Math.max(1, parseInt(e.target.value, 10) || 1),
                }))
              }
              className="w-[56px] px-[6px] py-[3px] rounded-[5px] font-mono text-[13px] outline-none tabular-nums"
              style={{
                backgroundColor: "var(--surface-input)",
                border: "1px solid var(--line)",
                color: "var(--text)",
                colorScheme: "dark",
              }}
            />
            <select
              value={String(custom.freq)}
              onChange={(e) =>
                setCustom((s) => ({
                  ...s,
                  freq: Number(e.target.value) as Frequency,
                }))
              }
              className="flex-1 px-[6px] py-[3px] rounded-[5px] font-mono text-micro uppercase tracking-[0.16em] outline-none"
              style={{
                backgroundColor: "var(--surface-input)",
                border: "1px solid var(--line)",
                color: "var(--text)",
                colorScheme: "dark",
              }}
            >
              <option value={Frequency.DAILY}>{t("repeat.days")}</option>
              <option value={Frequency.WEEKLY}>{t("repeat.weeks")}</option>
              <option value={Frequency.MONTHLY}>{t("repeat.months")}</option>
              <option value={Frequency.YEARLY}>{t("repeat.years")}</option>
            </select>
          </div>

          {/* BYDAY (weekly only) */}
          {custom.freq === Frequency.WEEKLY && (
            <div className="flex flex-col gap-[4px]">
              <span
                className="font-mono text-micro uppercase tracking-[0.16em]"
                style={{ color: "var(--text-3)" }}
              >
                {t("repeat.on")}
              </span>
              <div className="flex gap-[4px] flex-wrap">
                {RRULE_DAYS.map((d) => {
                  const active = custom.byweekday.includes(d.code);
                  return (
                    <button
                      key={d.code}
                      type="button"
                      onClick={() => toggleWeekday(d.code)}
                      className="px-[8px] py-[3px] rounded-[4px] font-mono text-micro uppercase tracking-[0.16em] transition-colors"
                      style={{
                        color: active ? "var(--text)" : "var(--text-3)",
                        background: active
                          ? "rgba(255,255,255,0.08)"
                          : "transparent",
                        border: active
                          ? "1px solid rgba(255,255,255,0.18)"
                          : "1px solid var(--line)",
                      }}
                    >
                      {t(d.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* BYMONTHDAY (monthly only) */}
          {custom.freq === Frequency.MONTHLY && (
            <div className="flex items-center gap-[6px]">
              <span
                className="font-mono text-micro uppercase tracking-[0.16em]"
                style={{ color: "var(--text-3)" }}
              >
                {t("repeat.onDay")}
              </span>
              <input
                type="number"
                min={1}
                max={31}
                value={custom.bymonthday ?? getDate(anchor)}
                onChange={(e) =>
                  setCustom((s) => ({
                    ...s,
                    bymonthday: Math.max(
                      1,
                      Math.min(31, parseInt(e.target.value, 10) || 1)
                    ),
                  }))
                }
                className="w-[64px] px-[6px] py-[3px] rounded-[5px] font-mono text-[13px] outline-none tabular-nums"
                style={{
                  backgroundColor: "var(--surface-input)",
                  border: "1px solid var(--line)",
                  color: "var(--text)",
                  colorScheme: "dark",
                }}
              />
            </div>
          )}

          {/* End condition */}
          <div className="flex flex-col gap-[4px]">
            <span
              className="font-mono text-micro uppercase tracking-[0.16em]"
              style={{ color: "var(--text-3)" }}
            >
              {t("repeat.ends")}
            </span>
            <div className="flex gap-[4px] flex-wrap">
              {(["never", "until", "count"] as const).map((mode) => {
                const active = custom.endMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setCustom((s) => ({ ...s, endMode: mode }))
                    }
                    className="px-[8px] py-[3px] rounded-[4px] font-mono text-micro uppercase tracking-[0.16em] transition-colors"
                    style={{
                      color: active ? "var(--text)" : "var(--text-3)",
                      background: active
                        ? "rgba(255,255,255,0.08)"
                        : "transparent",
                      border: active
                        ? "1px solid rgba(255,255,255,0.18)"
                        : "1px solid var(--line)",
                    }}
                  >
                    {mode === "never"
                      ? t("repeat.never")
                      : mode === "until"
                        ? t("repeat.onDate")
                        : t("repeat.afterN")}
                  </button>
                );
              })}
            </div>
            {custom.endMode === "until" && (
              <input
                type="date"
                value={custom.until}
                onChange={(e) =>
                  setCustom((s) => ({ ...s, until: e.target.value }))
                }
                className="px-[6px] py-[3px] rounded-[5px] font-mono text-[13px] outline-none"
                style={{
                  backgroundColor: "var(--surface-input)",
                  border: "1px solid var(--line)",
                  color: "var(--text)",
                  colorScheme: "dark",
                }}
              />
            )}
            {custom.endMode === "count" && (
              <div className="flex items-center gap-[6px]">
                <input
                  type="number"
                  min={1}
                  value={custom.count}
                  onChange={(e) =>
                    setCustom((s) => ({
                      ...s,
                      count: Math.max(1, parseInt(e.target.value, 10) || 1),
                    }))
                  }
                  className="w-[64px] px-[6px] py-[3px] rounded-[5px] font-mono text-[13px] outline-none tabular-nums"
                  style={{
                    backgroundColor: "var(--surface-input)",
                    border: "1px solid var(--line)",
                    color: "var(--text)",
                    colorScheme: "dark",
                  }}
                />
                <span
                  className="font-mono text-micro uppercase tracking-[0.16em]"
                  style={{ color: "var(--text-3)" }}
                >
                  {t("repeat.occurrences")}
                </span>
              </div>
            )}
          </div>

          {/* Apply */}
          <button
            type="button"
            onClick={handleApplyCustom}
            disabled={disabled}
            className="w-full px-[10px] py-[6px] rounded-[5px] font-cakemono font-light uppercase tracking-[0.16em] transition-colors"
            style={{
              fontSize: 12,
              color: "var(--ops-accent)",
              border: "1px solid var(--ops-accent)",
              background: "transparent",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {t("repeat.applyCustom")}
          </button>
        </div>
      )}
    </div>
  );
}
