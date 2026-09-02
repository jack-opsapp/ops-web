/**
 * OPS Web - Hosted Customer Surface: theme derivation
 *
 * The hosted pages (`/c/<handle>/...`) take their COLOR from the company's
 * `portal_branding` row through the existing `generatePortalTheme`, and
 * everything else — type, spacing, radii, motion — from the OPS design
 * system. This module is the seam: it sanitizes the company accent and picks
 * a legible on-accent text color, then returns the CSS custom properties the
 * shell root carries.
 */

import type { CSSProperties } from "react";
import type { PortalBranding } from "@/lib/types/portal";
import { generatePortalTheme } from "@/lib/portal/theme";
import { PORTAL_DEFAULT_ACCENT } from "@/lib/portal/defaults";

/**
 * Normalize a user-entered hex color to `#rrggbb` (lowercase). Accepts
 * `#abc`, `abc`, `#aabbcc`, `AABBCC`. Anything else returns null.
 */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` color. */
export function relativeLuminance(hex6: string): number {
  const n = parseInt(hex6.slice(1), 16);
  const r = channel((n >> 16) & 0xff);
  const g = channel((n >> 8) & 0xff);
  const b = channel(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export type AccentForeground = "dark" | "light";

/**
 * Which text pole reads best on a filled accent surface. Compares the WCAG
 * contrast of the accent against pure black and pure white and returns the
 * winner — the shell maps "dark" to the OPS canvas pole and "light" to the
 * OPS primary text pole.
 */
export function accentForeground(hex6: string): AccentForeground {
  const l = relativeLuminance(hex6);
  const againstBlack = (l + 0.05) / 0.05;
  const againstWhite = 1.05 / (l + 0.05);
  return againstBlack >= againstWhite ? "dark" : "light";
}

/**
 * Sanitize the branding row's accent. A malformed value (legacy rows, hand
 * edits) falls back to the database default so `lightenHex` never produces
 * `#NaN`.
 */
export function sanitizeBranding(branding: PortalBranding): PortalBranding {
  const accent = normalizeHexColor(branding.accentColor) ?? PORTAL_DEFAULT_ACCENT;
  return accent === branding.accentColor ? branding : { ...branding, accentColor: accent };
}

/**
 * CSS custom properties for the hosted shell root: every `--portal-*` var
 * from the shared generator plus a contrast-aware `--portal-accent-text`.
 */
export function buildHostedThemeStyle(branding: PortalBranding): CSSProperties {
  const safe = sanitizeBranding(branding);
  const vars = generatePortalTheme(safe);
  const foreground = accentForeground(safe.accentColor);
  return {
    ...(vars as unknown as CSSProperties),
    ["--portal-accent-text" as string]:
      foreground === "dark" ? "var(--cs-on-accent-dark)" : "var(--cs-on-accent-light)",
  } as CSSProperties;
}
