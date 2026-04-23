/**
 * OPS Web - Portal Theme Generator
 *
 * Generates CSS custom properties from a PortalBranding config.
 * Supports light/dark mode and all 3 templates.
 */

import type { PortalBranding } from "@/lib/types/portal";
import { PORTAL_TEMPLATES } from "./templates";

export interface PortalThemeVars {
  "--portal-bg": string;
  "--portal-bg-secondary": string;
  "--portal-card": string;
  "--portal-card-hover": string;
  "--portal-text": string;
  "--portal-text-secondary": string;
  "--portal-text-tertiary": string;
  "--portal-accent": string;
  "--portal-accent-hover": string;
  "--portal-accent-text": string;
  "--portal-border": string;
  "--portal-border-strong": string;
  "--portal-success": string;
  "--portal-warning": string;
  "--portal-error": string;
  "--portal-heading-font": string;
  "--portal-body-font": string;
  "--portal-radius": string;
  "--portal-radius-sm": string;
  "--portal-radius-lg": string;
  "--portal-card-padding": string;
  "--portal-heading-weight": string;
  "--portal-heading-transform": string;
  "--portal-letter-spacing": string;

  // Card style
  "--portal-card-shadow": string;
  "--portal-card-border": string;
  "--portal-card-accent-edge": string;
  "--portal-card-accent-edge-width": string;
  "--portal-card-border-left": string;
  "--portal-card-border-top": string;

  // Section dividers
  "--portal-section-divider": string;
  "--portal-section-divider-color": string;
  "--portal-section-divider-height": string;

  // Header
  "--portal-header-style": string;
  "--portal-header-border": string;

  // Status
  "--portal-status-style": string;

  // Progress
  "--portal-progress-height": string;
  "--portal-progress-radius": string;

  // Gallery
  "--portal-gallery-gap": string;
  "--portal-gallery-item-radius": string;

  // Bubbles
  "--portal-bubble-radius": string;
}

/**
 * Lighten a hex color by a percentage (0-100).
 */
function lightenHex(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * (percent / 100)));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * (percent / 100)));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * (percent / 100)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Generate all CSS custom properties for a portal theme.
 */
export function generatePortalTheme(branding: PortalBranding): PortalThemeVars {
  const template = PORTAL_TEMPLATES[branding.template] ?? PORTAL_TEMPLATES.modern;
  const isDark = branding.themeMode === "dark";

  return {
    // Backgrounds
    "--portal-bg": isDark ? "#0A0A0A" : "#FAFAFA",
    "--portal-bg-secondary": isDark ? "#111111" : "#F3F4F6",
    "--portal-card": isDark ? "#191919" : "#FFFFFF",
    "--portal-card-hover": isDark ? "#1F1F1F" : "#F9FAFB",

    // Text
    "--portal-text": isDark ? "#EDEDED" : "#1A1A1A",
    "--portal-text-secondary": isDark ? "#B5B5B5" : "#6B7280",
    "--portal-text-tertiary": isDark ? "#6B7280" : "#9CA3AF",

    // Accent
    "--portal-accent": branding.accentColor,
    "--portal-accent-hover": lightenHex(branding.accentColor, 10),
    "--portal-accent-text": "#FFFFFF",

    // Borders
    "--portal-border": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    "--portal-border-strong": isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",

    // Status colors
    "--portal-success": "#9DB582",
    "--portal-warning": "#C4A868",
    "--portal-error": "#B58289",

    // Typography (from template)
    "--portal-heading-font": template.headingFont,
    "--portal-body-font": template.bodyFont,

    // Border radius (from template)
    "--portal-radius": template.borderRadius,
    "--portal-radius-sm": template.borderRadiusSm,
    "--portal-radius-lg": template.borderRadiusLg,

    // Layout (from template)
    "--portal-card-padding": template.cardPadding,
    "--portal-heading-weight": template.headingWeight,
    "--portal-heading-transform": template.headingTransform,
    "--portal-letter-spacing": template.letterSpacing,

    // Card style
    "--portal-card-shadow": template.cardShadow,
    "--portal-card-border": template.cardBorder,
    "--portal-card-accent-edge": template.cardAccentEdge,
    "--portal-card-accent-edge-width": template.cardAccentEdgeWidth,
    "--portal-card-border-left": template.cardAccentEdge === "left"
      ? `${template.cardAccentEdgeWidth} solid var(--portal-accent)`
      : "none",
    "--portal-card-border-top": template.cardAccentEdge === "top"
      ? `${template.cardAccentEdgeWidth} solid var(--portal-accent)`
      : "none",

    // Section dividers
    "--portal-section-divider": template.sectionDivider,
    "--portal-section-divider-color": template.sectionDividerColor,
    "--portal-section-divider-height": template.sectionDividerHeight,

    // Header
    "--portal-header-style": template.headerStyle,
    "--portal-header-border": template.headerBorder,

    // Status
    "--portal-status-style": template.statusStyle,

    // Progress
    "--portal-progress-height": template.progressBarHeight,
    "--portal-progress-radius": template.progressBarRadius,

    // Gallery
    "--portal-gallery-gap": template.galleryGap,
    "--portal-gallery-item-radius": template.galleryItemRadius,

    // Bubbles
    "--portal-bubble-radius": template.bubbleRadius,
  };
}

/**
 * Convert theme vars to a CSS style string for inline usage.
 */
export function themeVarsToStyle(vars: PortalThemeVars): Record<string, string> {
  return vars as unknown as Record<string, string>;
}

/**
 * Get Google Fonts import URLs for a template.
 */
export function getTemplateFontImports(template: PortalBranding["template"]): string[] {
  const config = PORTAL_TEMPLATES[template] ?? PORTAL_TEMPLATES.modern;
  const urls: string[] = [];
  if (config.headingFontImport) urls.push(config.headingFontImport);
  if (config.bodyFontImport) urls.push(config.bodyFontImport);
  return urls;
}
