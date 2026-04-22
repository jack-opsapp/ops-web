import { formatInTimeZone } from 'date-fns-tz';

const TZ = 'America/Vancouver';

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

export function fmtUsd(cents: number | null | undefined, opts: { withCents?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  const n = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: opts.withCents ? 2 : 0,
    maximumFractionDigits: opts.withCents ? 2 : 0,
  }).format(n);
}

export function fmtPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || !Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtRatio(num: number, denom: number): string {
  return `${fmtInt(num)} / ${fmtInt(denom)}`;
}

export function fmtTime(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'HH:mm');
}

export function fmtDate(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'yyyy-MM-dd');
}

export function fmtDateTime(iso: string | Date): string {
  return formatInTimeZone(iso, TZ, 'yyyy-MM-dd · HH:mm');
}

export function daysUntilGate(now: Date = new Date()): number {
  const gate = new Date('2026-09-01T00:00:00-07:00');
  const ms = gate.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
