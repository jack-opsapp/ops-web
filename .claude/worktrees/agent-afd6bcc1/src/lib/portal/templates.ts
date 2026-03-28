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
  },
};
