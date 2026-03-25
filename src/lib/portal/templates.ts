/**
 * OPS Web - Portal Template Definitions
 *
 * 3 templates: Modern, Classic, Bold.
 * Each defines font pairing, border radius, and layout characteristics.
 */

import type { PortalTemplate } from "@/lib/types/portal";

export interface TemplateConfig {
  id: PortalTemplate;
  name: string;
  description: string;
  headingFont: string;
  bodyFont: string;
  headingFontImport: string;
  bodyFontImport: string;
  borderRadius: string;
  borderRadiusSm: string;
  borderRadiusLg: string;
  cardPadding: string;
  headingWeight: string;
  headingTransform: string;
  letterSpacing: string;

  // Card style
  cardShadow: string;
  cardBorder: string;
  cardAccentEdge: "none" | "left" | "top";
  cardAccentEdgeWidth: string;

  // Section dividers
  sectionDivider: "spacing" | "line" | "accent-bar";
  sectionDividerColor: string;
  sectionDividerHeight: string;

  // Header style
  headerStyle: "transparent" | "solid" | "accent";
  headerBorder: string;

  // Status indicators
  statusStyle: "pill-rounded" | "pill-bordered" | "text-bold";

  // Progress bar
  progressBarHeight: string;
  progressBarRadius: string;

  // Photo gallery
  galleryGap: string;
  galleryItemRadius: string;

  // Message bubbles
  bubbleRadius: string;
}

export const PORTAL_TEMPLATES: Record<PortalTemplate, TemplateConfig> = {
  modern: {
    id: "modern",
    name: "Modern",
    description: "Clean SaaS — minimal, generous whitespace, rounded cards",
    headingFont: "'Inter', system-ui, sans-serif",
    bodyFont: "'Inter', system-ui, sans-serif",
    headingFontImport: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    bodyFontImport: "",
    borderRadius: "12px",
    borderRadiusSm: "8px",
    borderRadiusLg: "16px",
    cardPadding: "24px",
    headingWeight: "600",
    headingTransform: "none",
    letterSpacing: "normal",
    cardShadow: "0 1px 3px rgba(0,0,0,0.08)",
    cardBorder: "none",
    cardAccentEdge: "none",
    cardAccentEdgeWidth: "0",
    sectionDivider: "spacing",
    sectionDividerColor: "transparent",
    sectionDividerHeight: "0",
    headerStyle: "transparent",
    headerBorder: "1px solid var(--portal-border)",
    statusStyle: "pill-rounded",
    progressBarHeight: "4px",
    progressBarRadius: "9999px",
    galleryGap: "8px",
    galleryItemRadius: "8px",
    bubbleRadius: "16px",
  },
  classic: {
    id: "classic",
    name: "Classic",
    description: "Professional business — structured, bordered sections",
    headingFont: "'Merriweather', Georgia, serif",
    bodyFont: "'Inter', system-ui, sans-serif",
    headingFontImport: "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap",
    bodyFontImport: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
    borderRadius: "6px",
    borderRadiusSm: "4px",
    borderRadiusLg: "8px",
    cardPadding: "20px",
    headingWeight: "700",
    headingTransform: "none",
    letterSpacing: "normal",
    cardShadow: "none",
    cardBorder: "1px solid var(--portal-border)",
    cardAccentEdge: "none",
    cardAccentEdgeWidth: "0",
    sectionDivider: "line",
    sectionDividerColor: "var(--portal-border)",
    sectionDividerHeight: "1px",
    headerStyle: "solid",
    headerBorder: "2px solid var(--portal-accent)",
    statusStyle: "pill-bordered",
    progressBarHeight: "6px",
    progressBarRadius: "3px",
    galleryGap: "4px",
    galleryItemRadius: "0",
    bubbleRadius: "8px",
  },
  bold: {
    id: "bold",
    name: "Bold",
    description: "Trade/Construction — strong headers, high contrast",
    headingFont: "'Oswald', sans-serif",
    bodyFont: "'Open Sans', system-ui, sans-serif",
    headingFontImport: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap",
    bodyFontImport: "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600&display=swap",
    borderRadius: "4px",
    borderRadiusSm: "2px",
    borderRadiusLg: "6px",
    cardPadding: "20px",
    headingWeight: "700",
    headingTransform: "uppercase",
    letterSpacing: "0.02em",
    cardShadow: "none",
    cardBorder: "1px solid var(--portal-border)",
    cardAccentEdge: "left",
    cardAccentEdgeWidth: "3px",
    sectionDivider: "accent-bar",
    sectionDividerColor: "var(--portal-accent)",
    sectionDividerHeight: "3px",
    headerStyle: "accent",
    headerBorder: "none",
    statusStyle: "text-bold",
    progressBarHeight: "8px",
    progressBarRadius: "2px",
    galleryGap: "2px",
    galleryItemRadius: "0",
    bubbleRadius: "4px",
  },
};
