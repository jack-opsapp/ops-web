/**
 * OPS Email Tokens
 *
 * Single source of truth for every color, spacing, and font stack used in
 * React Email templates. All primitives import from here.
 *
 * Derived from OPS-Web/.interface-design/system.md and the auth-action-handler
 * design spec (docs/tailored/auth-action-handler-design.md §4).
 */

export const emailTokens = {
  color: {
    ink: "#0A0A0A",
    paper: "#F6F4EF",
    paperRule: "rgba(10,10,10,0.12)",
    paperTextPrimary: "rgba(10,10,10,0.84)",
    paperTextSecondary: "rgba(10,10,10,0.56)",
    inkTextPrimary: "rgba(255,255,255,0.72)",
    inkTextSecondary: "rgba(255,255,255,0.64)",
    inkTextMeta: "rgba(255,255,255,0.44)",
    inkRule: "rgba(255,255,255,0.08)",
    success: "#A5B368",
    error: "#93321A",
    white: "#FFFFFF",
  },
  font: {
    sans: "Mohave, 'Helvetica Neue', Arial, sans-serif",
    // Micro labels use JetBrains Mono (retired font 2026-04-17).
    // Cake Mono is Adobe Typekit only and is not available in email.
    label:
      "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
  },
  size: {
    h1: "28px",
    h1Line: "34px",
    h2: "18px",
    h2Line: "24px",
    body: "16px",
    bodyLine: "24px",
    small: "13px",
    smallLine: "20px",
    eyebrow: "11px",
    eyebrowLine: "14px",
    ctaLabel: "13px",
    meta: "11px",
    metaLine: "16px",
    footerBody: "12px",
    footerBodyLine: "18px",
  },
  weight: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  tracking: {
    tight: "0.02em",
    eyebrow: "2px",
    ctaLabel: "1.8px",
    meta: "1.5px",
  },
  spacing: {
    xs: "8px",
    sm: "16px",
    md: "24px",
    lg: "32px",
    xl: "40px",
    xxl: "48px",
  },
  layout: {
    containerWidth: "560px",
    bandPaddingX: "32px",
    bandPaddingY: "40px",
    buttonRadius: "2px",
    buttonPaddingX: "32px",
    buttonPaddingY: "16px",
  },
} as const;

export type EmailTokens = typeof emailTokens;
