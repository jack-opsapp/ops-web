import { z } from "zod-v4";

const Civil = z.iso.datetime({ local: true, precision: 0 });
/** Resolve a wall-clock value only when exactly one instant represents it.
 * No viewer-zone parsing and no fixed-offset approximation. The sampling window
 * covers both sides of modern civil-time transitions, including skipped dates.
 */
export function resolveScheduleCivilTime(local: string, timezone: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(local) || !Civil.safeParse(local).success) throw new Error("INVALID_LOCAL_TIME");
  const nominal = Date.parse(`${local}Z`);
  if (new Date(nominal).toISOString().slice(0, 19) !== local) throw new Error("INVALID_LOCAL_TIME");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const wall = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  };
  const offsets = new Set<number>();
  for (let hour = -48; hour <= 48; hour += 6) {
    const instant = nominal + hour * 3_600_000;
    offsets.add(Date.parse(`${wall(instant)}Z`) - instant);
  }
  const candidates = [...offsets].map(offset => nominal - offset).filter(instant => wall(instant) === local);
  if (candidates.length !== 1) throw new Error("LOCAL_TIME_NOT_UNIQUE");
  return new Date(candidates[0]).toISOString();
}

export function scheduleCivilDay(date: string, timezone: string): { start: string; end: string } {
  z.iso.date().parse(date);
  const nextLabel = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: resolveScheduleCivilTime(`${date}T00:00:00`, timezone), end: resolveScheduleCivilTime(`${nextLabel}T00:00:00`, timezone) };
}

export function assertScheduleTimezoneParity(local: string, timezone: string, databaseInstant: string): void {
  assertScheduleRuntimeTimezoneRules();
  if (Date.parse(resolveScheduleCivilTime(local, timezone)) !== Date.parse(databaseInstant)) throw new Error("TIMEZONE_RULES_MISMATCH");
}

/** Matching two stale runtimes is not proof of the known Vancouver correction. */
export function assertScheduleRuntimeTimezoneRules(): void {
  if (resolveScheduleCivilTime("2026-11-02T00:00:00", "America/Vancouver") !== "2026-11-02T07:00:00.000Z") {
    throw new Error("TIMEZONE_RUNTIME_UPDATE_REQUIRED");
  }
}
