/**
 * OPS Web - Hosted Guest Booking: pure formatting helpers
 *
 * Shared by the booking components and the unit tests. No framework imports,
 * no I/O — everything here is a deterministic function of its arguments.
 *
 * Two rules govern this file:
 *
 * 1. **Every time renders in the business's timezone**, never the visitor's.
 *    The policy owns the clock (design D10); a homeowner booking from an
 *    airport must see the time the crew will show up, not their own.
 * 2. **The slot descriptor is opaque** (design §4.4). It is an HMAC the page
 *    can neither read nor trust, so the start time always travels beside it.
 */

import type { Locale } from "@/i18n/types";

/** One bookable start: the opaque descriptor plus the instant it names. */
export interface AvailableSlot {
  /** `sl_…` — passed back to the broker verbatim, never parsed. */
  slot: string;
  startAt: Date;
}

/** A calendar day in the policy timezone that has at least one open slot. */
export interface BookingDay {
  /** `YYYY-MM-DD` in the policy timezone — stable across renders and locales. */
  key: string;
  /** The first slot of the day; carries the date for every label. */
  date: Date;
  slots: AvailableSlot[];
}

/**
 * How firmly the business books. Absent when the broker does not say, in
 * which case the page stays neutral: every string it shows before the
 * outcome arrives must be true under both modes.
 */
export type BookingMode = "instant" | "request";

export interface Availability {
  slots: AvailableSlot[];
  /** IANA name from the policy, e.g. `America/Denver`. */
  timezone: string;
  durationMinutes: number;
  mode: BookingMode | null;
}

/**
 * The formatting locale behind each product locale. Explicit rather than the
 * browser's, so the server and the client render the same string and a visitor
 * who chose a language gets that language's own clock and date conventions.
 */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", es: "es-MX" };

function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale] ?? INTL_LOCALE.en;
}

/**
 * A timezone the runtime cannot resolve would make every `Intl` call throw
 * mid-render. Fall back to UTC and let the times read honestly rather than
 * taking the page down.
 */
export function safeTimeZone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

/** `YYYY-MM-DD` for an instant *as the policy timezone sees it*. */
export function dayKey(date: Date, timezone: string): string {
  // en-CA yields ISO-ordered parts, so the key sorts lexicographically.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The time on the business's clock: `9:00 AM`, `9:00 a.m.` — the locale decides the shape. */
export function formatSlotTime(date: Date, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Day chip face: `{ weekday: "Mon", date: "Sep 8" }`. Uppercased by CSS, not here. */
export function formatDayChip(
  date: Date,
  timezone: string,
  locale: Locale
): { weekday: string; date: string } {
  const l = intlLocale(locale);
  return {
    weekday: new Intl.DateTimeFormat(l, { timeZone: timezone, weekday: "short" }).format(date),
    date: new Intl.DateTimeFormat(l, { timeZone: timezone, month: "short", day: "numeric" }).format(
      date
    ),
  };
}

/**
 * The one line that names the appointment: `Mon, Sep 8 · 9:00 AM`.
 * Mono everywhere it appears — it is data, not prose.
 */
export function formatSlotStamp(date: Date, timezone: string, locale: Locale): string {
  const day = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  return `${day} · ${formatSlotTime(date, timezone, locale)}`;
}

function zoneName(
  date: Date,
  timezone: string,
  locale: Locale,
  style: "short" | "shortGeneric"
): string | null {
  const parts = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: timezone,
    hour: "numeric",
    timeZoneName: style,
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? null;
}

/**
 * The zone a visitor can actually read: `MDT` in English, `hora de Denver` in
 * Spanish.
 *
 * `short` is preferred because it names the zone *and* its current offset —
 * but for locales with no abbreviation it degrades to a bare `GMT-6`, which
 * tells a homeowner nothing. Anything offset-shaped falls through to the
 * generic name, and a zone with neither falls back to its IANA city.
 */
export function formatZoneLabel(date: Date, timezone: string, locale: Locale): string {
  const short = zoneName(date, timezone, locale, "short");
  if (short && !/^(GMT|UTC)[+-]/i.test(short)) return short;
  return (
    zoneName(date, timezone, locale, "shortGeneric") ??
    short ??
    timezone.split("/").pop()?.replace(/_/g, " ") ??
    timezone
  );
}

/**
 * Group open slots into the days that hold them, both in chronological order.
 *
 * Days with nothing open never appear — there is no row to disable, because
 * there is no row (design §7). Slots that land on the same instant collapse
 * to one; a duplicate descriptor would otherwise render two identical buttons.
 */
export function groupSlotsByDay(slots: AvailableSlot[], timezone: string): BookingDay[] {
  const byDay = new Map<string, BookingDay>();
  const seen = new Set<number>();

  for (const slot of [...slots].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const time = slot.startAt.getTime();
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);

    const key = dayKey(slot.startAt, timezone);
    const day = byDay.get(key);
    if (day) day.slots.push(slot);
    else byDay.set(key, { key, date: slot.startAt, slots: [slot] });
  }

  return [...byDay.values()];
}

/**
 * The window the page asks the broker for: yesterday through five weeks out.
 *
 * Yesterday absorbs the skew between the visitor's date and the policy's;
 * five weeks is well past the 21-day default horizon and far past the point
 * where a homeowner is still choosing a site visit. The server clamps to the
 * policy's own horizon either way (design §5).
 */
export const AVAILABILITY_LOOKBACK_DAYS = 1;
export const AVAILABILITY_WINDOW_DAYS = 35;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function availabilityRange(now: Date = new Date()): { from: string; to: string } {
  const day = 24 * 60 * 60 * 1000;
  return {
    from: isoDate(new Date(now.getTime() - AVAILABILITY_LOOKBACK_DAYS * day)),
    to: isoDate(new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * day)),
  };
}

/**
 * Phone numbers are evidence, not an identifier (design §4.2 — stored raw,
 * never matched on), so the page only checks that something dialable was
 * typed. Empty is valid: the field is optional.
 */
export function isPlausiblePhone(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  const digits = trimmed.replace(/\D+/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
