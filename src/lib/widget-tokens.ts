/**
 * Widget design system tokens.
 *
 * RULES:
 * 1. Use Tailwind classes (text-status-warning, bg-financial-revenue) in className.
 * 2. Use these CSS variable references ONLY for inline style={{ }} (charts, SVGs).
 * 3. NEVER hardcode hex values in widget components.
 */

// ── CSS variable references for inline styles ──
export const WT = {
  // Financial
  revenue: "var(--color-financial-revenue)",
  profit: "var(--color-financial-profit)",
  cost: "var(--color-financial-cost)",
  receivables: "var(--color-financial-receivables)",
  overdue: "var(--color-financial-overdue)",
  // Status
  success: "var(--color-status-success)",
  warning: "var(--color-status-warning)",
  error: "var(--color-status-error)",
  // Accent
  accent: "var(--color-ops-accent)",
  accentMuted: "rgba(var(--ops-accent-rgb) / 0.4)",
  accentSubtle: "rgba(var(--ops-accent-rgb) / 0.15)",
  // Muted chart fills (70% opacity — for bars/segments, NOT badges)
  errorMuted: "rgba(var(--status-error-rgb) / 0.7)",
  warningMuted: "rgba(var(--status-warning-rgb) / 0.7)",
  successMuted: "rgba(var(--status-success-rgb) / 0.7)",
  // Neutral
  muted: "rgba(255, 255, 255, 0.15)",
  faint: "rgba(255, 255, 255, 0.08)",
} as const;

// ── Hero number size by widget tier ──
export const HERO_SIZE_CLASS = {
  compact: "text-data-lg", // xs, sm
  expanded: "text-display", // md, lg, xl
} as const;

// ── Zone visibility helpers ──
export function isCompact(size: string): boolean {
  return size === "xs" || size === "sm";
}

export function showDetail(size: string): boolean {
  return size === "md" || size === "lg" || size === "xl";
}

export function showActions(size: string): boolean {
  return size === "lg" || size === "xl";
}
