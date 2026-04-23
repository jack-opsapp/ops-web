/**
 * Shared inline styles and helpers for the PMF email templates.
 *
 * Centralized so the three templates (threshold-alert, daily-digest,
 * weekly-digest) cannot drift apart visually. Values exactly match the
 * prior per-file constants — visual output is unchanged.
 *
 * Font note (I6): product UI loads Mohave, JetBrains Mono, and Cake Mono
 * via web fonts, but email clients do not fetch web fonts reliably.
 * Mohave/JetBrains/Cake will fall back to the generic `sans-serif` /
 * `monospace` families on most clients (Gmail, Outlook, Apple Mail).
 * This is accepted — layout and spacing remain correct.
 *
 * Likewise, `backdrop-filter: blur()` does not render in any major email
 * client, so the glass surfaces use an opaque `rgba(10,10,10,0.70)`
 * fill rather than the spec-v2 web-UI value `rgba(18,18,20,0.58)`.
 */
import type React from "react";
import type { MarkerStatus } from "@/lib/pmf/types";

export const CANVAS: React.CSSProperties = {
  background: "#000000",
  margin: 0,
  padding: 24,
  fontFamily: "'Mohave', sans-serif",
  color: "#EDEDED",
};

/** Glass panel used when multiple panels are stacked (daily + weekly digests). */
export const GLASS: React.CSSProperties = {
  background: "rgba(10,10,10,0.70)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 5,
  padding: 24,
  marginBottom: 12,
};

/** Glass panel used when there is only one panel on the page (threshold alert). */
export const GLASS_SINGLE: React.CSSProperties = {
  background: "rgba(10,10,10,0.70)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 5,
  padding: 24,
};

export const MONO11: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "#8A8A8A",
};

export const HERO: React.CSSProperties = {
  fontFamily: "'Mohave', sans-serif",
  fontWeight: 300,
  fontSize: 40,
  lineHeight: 1,
  color: "#EDEDED",
  fontFeatureSettings: '"tnum" 1, "zero" 1',
};

export const CAKE_DISPLAY: React.CSSProperties = {
  fontFamily: "'Cake Mono', sans-serif",
  fontWeight: 300,
  fontSize: 18,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#EDEDED",
};

export const STATUS_COLOR: Record<MarkerStatus, string> = {
  green: "#9DB582",
  amber: "#C4A868",
  red: "#B58289",
};

export const ACCENT = "#6F94B0";

/**
 * Normalize a dashboard URL for use in an `href=`. Returns the parsed URL
 * string when it is a valid http(s) URL, otherwise `null` so the caller
 * can omit the link entirely rather than linking to `#`.
 */
export function sanitizeDashboardUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
