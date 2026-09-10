/** Number and time formatting for the engine console. Numbers always formatted; empty is `—`. */

export const DASH = "—";

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CAD_WHOLE = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const INT = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

export function money(value: number | null | undefined, whole = false): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return (whole ? CAD_WHOLE : CAD).format(value);
}

export function integer(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return DASH;
  return INT.format(value);
}

export function percent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return DASH;
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString("en-CA", { month: "short", day: "2-digit", timeZone: "America/Vancouver" });
}

export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleString("en-CA", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Vancouver" });
}

/** "2h ago" style, minute floor, day cap. */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return DASH;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return DASH;
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function inHours(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return DASH;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return DASH;
  const minutes = Math.max(0, Math.round((then - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.ceil((then - now.getTime()) / 86_400_000));
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.max(0, Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / 86_400_000));
}
