/**
 * Shared formatters for the project-detail tabs. Mirrors the F.1 shell's
 * `_components/format.ts` exports (the F.1 ones live in the `app` tree, scoped
 * to the overview shell) but keeps the detail tabs decoupled so the two
 * surfaces can move independently. Numbers always render in JetBrains Mono
 * with tabular-lining + slashed-zero (CSS-level token).
 */

const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const CAD_DECIMAL = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents === 0) return "$0";
  const dollars = cents / 100;
  return Math.abs(dollars % 1) < 0.005 ? CAD.format(dollars) : CAD_DECIMAL.format(dollars);
}

const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const ISO_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return DATE_FMT.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return DATETIME_FMT.format(d);
}

export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // YYYY-MM-DD; used in the ETA date input as the default value.
  const parts = ISO_DATE_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${y}-${m}-${day}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const sign = ms >= 0 ? "" : "in ";
  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / 60000);
  if (minutes < 60) return `${sign}${minutes}m${ms < 0 ? "" : " ago"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${sign}${hours}h${ms < 0 ? "" : " ago"}`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${sign}${days}d${ms < 0 ? "" : " ago"}`;
  const months = Math.floor(days / 30);
  return `${sign}${months}mo${ms < 0 ? "" : " ago"}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

export function truncateHash(hash: string | null | undefined, len = 10): string {
  if (!hash) return "—";
  if (hash.length <= len) return hash;
  return `${hash.slice(0, len)}…`;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

export function tierLabel(tier: string): string {
  return tier.toUpperCase();
}
